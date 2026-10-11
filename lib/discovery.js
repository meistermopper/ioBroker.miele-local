'use strict';

/**
 * mDNS-Discovery der Miele-Geräte (_mieleathome._tcp).
 *
 * Record-Struktur (real beobachtet):
 *   PTR  _mieleathome._tcp.local            → "Miele <TechType>._mieleathome._tcp.local"
 *   SRV  Miele <TechType>._mieleathome...   → target "Miele-<MAC>.local", port 80
 *   TXT  Miele <TechType>._mieleathome...   → group=<GroupID>, devicetype, pairing, …
 *   A    Miele-<MAC>.local                  → IP
 *
 * Liefert je Gerät: ip, host, techType, txt (group/devicetype/pairing/…).
 * Die Seriennummer steht NICHT im mDNS – sie kommt aus dem signierten /Ident.
 *
 * Nutzt `multicast-dns` (pure JS, keine nativen Abhängigkeiten).
 */

// multicast-dns wird bewusst NICHT top-level geladen: mDNS-Discovery ist experimentell und im
// Bridge-Netz (Docker) ohnehin funktionslos (Multicast wird nicht gebrückt) - der Normalbetrieb
// nutzt manuelle Geräte-IPs. Fehlt das Modul (z. B. nach einem abgebrochenen npm-Install), darf das
// NICHT den ganzen Adapter am Start crashen. Daher lazy require erst in discover().
const SERVICE = '_mieleathome._tcp.local';

function parseTxt(buffers) {
    const txt = {};
    for (const b of buffers || []) {
        const s = b.toString('utf8');
        const eq = s.indexOf('=');
        if (eq > 0) {
            txt[s.slice(0, eq)] = s.slice(eq + 1);
        } else if (s) {
            txt[s] = true;
        }
    }
    return txt;
}

/**
 * @param {number} timeoutMs  Sammelzeit
 * @param {(msg:string)=>void} [log] Ausgabe fuer Hinweise
 * @param adapter Adapterinstanz fuer setTimeout/clearTimeout; ohne sie die globalen Timer
 * @returns {Promise<Array<{ip:string, host:string, port:number, techType:string, txt:object}>>} gefundene Miele-Module
 */
function discover(timeoutMs = 5000, log = () => {}, adapter = null) {
    // Timer über den Adapter, damit sie beim Beenden sauber aufgeräumt werden (ioBroker-Vorgabe)
    const setT = adapter ? adapter.setTimeout.bind(adapter) : global.setTimeout;
    const clearT = adapter ? adapter.clearTimeout.bind(adapter) : global.clearTimeout;
    return new Promise(resolve => {
        let multicastDns;
        try {
            multicastDns = require('multicast-dns');
        } catch {
            log('mDNS discovery unavailable (multicast-dns not installed) - please configure device IPs manually.');
            return resolve([]);
        }
        const mdns = multicastDns();
        const instances = {}; // instanceName → { techType, host, port, txt }
        const hostToIp = {}; // host → ip

        mdns.on('response', res => {
            for (const a of [...(res.answers || []), ...(res.additionals || [])]) {
                if (a.type === 'SRV' && a.name.endsWith(`.${SERVICE}`)) {
                    const inst = (instances[a.name] = instances[a.name] || {
                        techType: '',
                        host: null,
                        port: 80,
                        txt: {},
                    });
                    inst.host = a.data.target;
                    inst.port = a.data.port;
                    inst.techType = a.name
                        .replace(`.${SERVICE}`, '')
                        .replace(/^Miele\s*/i, '')
                        .trim();
                } else if (a.type === 'TXT' && a.name.endsWith(`.${SERVICE}`)) {
                    const inst = (instances[a.name] = instances[a.name] || {
                        techType: '',
                        host: null,
                        port: 80,
                        txt: {},
                    });
                    Object.assign(inst.txt, parseTxt(a.data));
                    if (!inst.techType) {
                        inst.techType = a.name
                            .replace(`.${SERVICE}`, '')
                            .replace(/^Miele\s*/i, '')
                            .trim();
                    }
                } else if (a.type === 'A') {
                    hostToIp[a.name] = a.data;
                }
            }
        });

        const query = () => mdns.query({ questions: [{ name: SERVICE, type: 'PTR' }] });
        query();
        const q2 = setT(query, 1000);

        setT(() => {
            clearT(q2);
            try {
                mdns.destroy();
            } catch {
                /* egal */
            }
            const list = [];
            for (const inst of Object.values(instances)) {
                const ip = inst.host ? hostToIp[inst.host] : null;
                if (ip) {
                    list.push({ ip, host: inst.host, port: inst.port, techType: inst.techType, txt: inst.txt });
                }
            }
            log(`mDNS: ${list.length} Miele device(s) found`);
            resolve(list);
        }, timeoutMs);
    });
}

/*
 * Rueckfall, wenn ein Geraet seine IP gewechselt hat.
 *
 * Die Geraete haengen am DHCP. Ohne feste Zuordnung im Router bekommt eines nach einem
 * Stromausfall oder einem langen Standby eine andere Adresse - und ist damit weg, obwohl es
 * eingeschaltet im selben Netz steht. mDNS waere der saubere Weg dorthin, funktioniert aber
 * im Docker-Bridge-Netz nicht (Multicast wird nicht gebrueckt).
 *
 * Bleibt das Abklopfen des Subnetzes. Ein Miele-Modul ist dabei eindeutig zu erkennen: Es
 * antwortet auf eine unsignierte Anfrage mit 401 oder 404 UND dem Content-Type
 * "application/vnd.miele.v1+json" - kein anderes Geraet im Haus tut das. Es wird nichts
 * geschrieben und nichts angemeldet, nur eine Kopfzeile gelesen.
 */

const http = require('node:http');

/**
 * Klopft eine einzelne Adresse ab. Liefert true, wenn dort ein Miele-Modul antwortet.
 *
 * @param ip zu pruefende IP-Adresse
 * @param timeoutMs Zeitlimit in Millisekunden
 */
function istMiele(ip, timeoutMs = 800) {
    return new Promise(resolve => {
        const req = http.request({ host: ip, port: 80, path: '/Devices/', method: 'GET', timeout: timeoutMs }, res => {
            const typ = String(res.headers['content-type'] || '');
            res.resume(); // Antwort verwerfen, Verbindung freigeben
            resolve(typ.includes('miele'));
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

/**
 * Sucht Miele-Module im Subnetz von [vorlageIp].
 *
 * In Bloecken statt alle 254 auf einmal: Ein Schwall gleichzeitiger Verbindungen laesst
 * schwaechere Geraete im Netz Pakete verwerfen, und die Antwortzeiten werden unbrauchbar.
 * Mit 32 gleichzeitigen Anfragen ist ein /24 in wenigen Sekunden durch.
 *
 * @param vorlageIp eine bekannte Adresse im Subnetz, etwa die eigene
 * @param log Ausgabe fuer Hinweise
 * @param opt Optionen: timeoutMs je Adresse, gleichzeitig = Anzahl paralleler Abfragen
 */
async function scanSubnet(vorlageIp, log = () => {}, opt = {}) {
    const teile = String(vorlageIp || '').split('.');
    if (teile.length !== 4) {
        return [];
    }
    const netz = teile.slice(0, 3).join('.');
    const timeoutMs = opt.timeoutMs || 800;
    const gleichzeitig = opt.gleichzeitig || 32;

    const gefunden = [];
    for (let start = 1; start <= 254; start += gleichzeitig) {
        const block = [];
        for (let i = start; i < start + gleichzeitig && i <= 254; i++) {
            block.push(`${netz}.${i}`);
        }
        const ergebnis = await Promise.all(block.map(ip => istMiele(ip, timeoutMs)));
        ergebnis.forEach((ja, idx) => {
            if (ja) {
                gefunden.push(block[idx]);
            }
        });
    }
    log(`Subnet ${netz}.0/24 scanned: ${gefunden.length} Miele module(s) - ${gefunden.join(', ') || 'none'}`);
    return gefunden;
}

module.exports = { discover, SERVICE, scanSubnet, istMiele };

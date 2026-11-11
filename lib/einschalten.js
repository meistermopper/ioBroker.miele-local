'use strict';

/*
 * Ein- und Ausschalten wie die Miele-App (seit 0.4.3).
 *
 * Bis 0.4.2 schickten control.powerOn/powerOff den Benutzerwunsch 2/1583 mit den Opcodes
 * 0x10/0x13. Das geht am Backofen H7560BP, aber nicht ueberall: Eine G7310 antwortete darauf
 * nur mit HTTP 500, und ein Kaffeevollautomat CM6360 (Forum, Thema 85536) liess sich so gar
 * nicht einschalten.
 *
 * Die App schaltet anders. Sie schreibt den Geraetezustand in den DOP2-Leaf 2/1586
 * (DeviceCombiState), Feld 1 "ApplianceState": 4 = ein, 1 = aus. Schlaeft das Geraet, kommt
 * HTTP 500 zurueck; dann weckt die App es mit PUT /State {"DeviceAction":2}, wartet und
 * versucht es noch einmal. Belegt an Backofen und Spuelmaschine (ha-miele-at-lan, MIT,
 * Issue #16 und PR #49). Der Ablauf hier ist nach diesen Fakten neu geschrieben.
 *
 *   1. Zustand lesen und protokollieren (Status, RemoteEnable, StandbyState). Nur zur
 *      Auskunft - die App weigert sich bei RemoteEnable 7, die Cloud schaltet trotzdem.
 *   2. 2/1586 lesen, Feld 1 setzen und den ganzen Leaf zurueckschreiben, wie die App beim
 *      Kaffeevollautomaten. Laesst sich der Leaf nicht lesen, der feste Rumpf mit nur Feld 1.
 *   3. Bei HTTP 500 wecken und wiederholen, hoechstens zwei Runden.
 *   4. Erst danach der alte Weg 2/1583 als Rueckfall - mit unveraendertem Kopf.
 *   5. Kaffeevollautomaten mit ProtocolVersion 2 sprechen kein DOP2: dort Dop1-Objekt 1101.
 *   6. Danach den Status nachlesen. Ein 204 heisst nur "angenommen", nicht "geschaltet".
 */

/** Der Leaf mit dem Geraetezustand. */
const LEAF_UNIT = 2;
const LEAF_ATTR = 1586;
/** ApplianceState: 4 = ein (NORMAL), 1 = aus (OFF). */
const ZUSTAND_AN = 4;
const ZUSTAND_AUS = 1;
/** Kaffeevollautomat. */
const TYP_KAFFEE = 17;
/** Hoechstens so viele Weckrunden je Befehl. */
const WECKRUNDEN_MAX = 2;
/** Wartezeit nach dem Wecken; der Kaffeevollautomat braucht laenger. */
const WARTEN_WECKEN_MS = 3000;
const WARTEN_WECKEN_KAFFEE_MS = 5000;
/** Der Kaffeevollautomat bekommt vor dem Schreiben noch eine Atempause. */
const WARTEN_VOR_SCHREIBEN_KAFFEE_MS = 1500;

/** Der bisherige Benutzerwunsch 2/1583 - Kopf bewusst unveraendert (Unit 1, Laenge 16). */
const USER_REQ_PREFIX = Buffer.from('00100001062f00000000000100010700', 'hex');
const OPCODE_AN = 0x10;
const OPCODE_AUS = 0x13;

/** Feste Laengen der einfachen DOP2-Feldtypen (wie lib/dop2.js). */
const FESTE_LAENGE = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 4, 9: 4, 10: 4, 11: 8, 12: 8, 13: 8, 14: 4, 15: 8 };

/**
 * Rumpf fuer 2/1583 mit einem Opcode.
 *
 * @param {number} opcode Benutzerwunsch, etwa 0x10
 * @returns {Buffer} 32 Byte
 */
function benutzerwunsch(opcode) {
    return Buffer.concat([USER_REQ_PREFIX, Buffer.from([opcode & 0xff]), Buffer.alloc(15, 0x20)]);
}

/**
 * Auf ein Vielfaches von 16 Byte mit Leerzeichen auffuellen, mindestens 32.
 *
 * @param {Buffer} buf Rumpf
 * @returns {Buffer} aufgefuellter Rumpf
 */
function auffuellen(buf) {
    let ziel = Math.max(32, buf.length);
    if (ziel % 16) {
        ziel += 16 - (ziel % 16);
    }
    return Buffer.concat([buf, Buffer.alloc(ziel - buf.length, 0x20)]);
}

/**
 * Der feste Rumpf: nur Feld 1 (E8) mit dem Zielzustand.
 *
 * Aufbau (big-endian): Laenge 14 (ohne das Laengenfeld), Unit 2, Attribut 1586, idx1 0,
 * idx2 0, Feldanzahl 1, Feld 1, Typ 4, Wert.
 *
 * @param {boolean} an einschalten?
 * @returns {Buffer} 32 Byte
 */
function festerRumpf(an) {
    const b = Buffer.alloc(16);
    b.writeUInt16BE(14, 0);
    b.writeUInt16BE(LEAF_UNIT, 2);
    b.writeUInt16BE(LEAF_ATTR, 4);
    b.writeUInt16BE(0, 6);
    b.writeUInt16BE(0, 8);
    b.writeUInt16BE(1, 10);
    b.writeUInt16BE(1, 12);
    b.writeUInt8(4, 14);
    b.writeUInt8(an ? ZUSTAND_AN : ZUSTAND_AUS, 15);
    return auffuellen(b);
}

/**
 * Den gelesenen Leaf 2/1586 mit neuem ApplianceState zurueckgeben - so, wie die App es tut.
 *
 * Alle Felder bleiben, wie das Geraet sie geliefert hat; nur der Wert von Feld 1 wird ersetzt.
 * Zurueckgegeben wird null, wenn der Leaf nicht so aussieht wie erwartet (andere Adresse,
 * zusammengesetzte Feldtypen, kein Feld 1 mit einem Byte). Dann nimmt der Aufrufer den
 * festen Rumpf - lieber den belegten Minimalbefehl als einen geratenen Nachbau.
 *
 * @param {Buffer} gelesen entschluesselte Antwort auf GET 2/1586
 * @param {boolean} an einschalten?
 * @returns {Buffer|null} Schreibrumpf oder null
 */
function leafAendern(gelesen, an) {
    if (!Buffer.isBuffer(gelesen) || gelesen.length < 12) {
        return null;
    }
    const laenge = gelesen.readUInt16BE(0);
    if (laenge + 2 > gelesen.length || laenge < 10) {
        return null;
    }
    if (gelesen.readUInt16BE(2) !== LEAF_UNIT || gelesen.readUInt16BE(4) !== LEAF_ATTR) {
        return null;
    }
    const leaf = Buffer.from(gelesen.subarray(0, laenge + 2));
    const anzahl = leaf.readUInt16BE(10);
    let p = 12;
    let wertStelle = -1;
    for (let i = 0; i < anzahl; i++) {
        if (p + 3 > leaf.length) {
            return null;
        }
        const feld = leaf.readUInt16BE(p);
        const typ = leaf[p + 2];
        const len = FESTE_LAENGE[typ];
        if (len == null || p + 3 + len > leaf.length) {
            return null;
        }
        if (feld === 1) {
            if (len !== 1) {
                return null;
            }
            wertStelle = p + 3;
        }
        p += 3 + len;
    }
    if (wertStelle < 0 || p !== leaf.length) {
        return null;
    }
    leaf[wertStelle] = an ? ZUSTAND_AN : ZUSTAND_AUS;
    return auffuellen(leaf);
}

/**
 * Dop1-Rumpf fuer Kaffeevollautomaten mit ProtocolVersion 2: Objekt 1101 "DeviceAction",
 * Schreibtyp 02, Strukturversion 1, Aktion 2 = ein, 3 = aus.
 *
 * @param {boolean} an einschalten?
 * @returns {string} JSON-Rumpf
 */
function dop1Rumpf(an) {
    return JSON.stringify({ Request: an ? '110102000102' : '110102000103' });
}

/**
 * Was ein HTTP-Status beim Schalten bedeutet - als Text fuer Log und Kommentarfeld.
 *
 * @param {number|null} status HTTP-Status, null bei Zeitueberschreitung oder Verbindungsfehler
 * @returns {string} Erklaerung, englisch
 */
function statusDeutung(status) {
    if (status === 404) {
        return 'the communication module does not offer DOP2 control (HTTP 404)';
    }
    if (status === 403) {
        return 'remote control is switched off on the appliance (HTTP 403)';
    }
    if (status === 500) {
        return 'the appliance does not accept the command in its current state (HTTP 500)';
    }
    if (status == null) {
        return 'no answer from the appliance (timeout or connection error)';
    }
    return `the appliance answered HTTP ${status}`;
}

/**
 * Von mehreren Fehlschlaegen den aussagekraeftigsten waehlen.
 *
 * 403 sagt dem Nutzer, was er am Geraet aendern muss; 404 sagt, dass es hier nicht geht;
 * 500 heisst "jetzt nicht". Eine Zeitueberschreitung ist am wenigsten aussagekraeftig.
 *
 * @param {Array<number|null>} liste gesammelte Status
 * @returns {number|null} der wichtigste
 */
function wichtigsterStatus(liste) {
    for (const s of [403, 404, 500]) {
        if (liste.includes(s)) {
            return s;
        }
    }
    const andere = liste.filter(s => s != null);
    return andere.length ? andere[andere.length - 1] : null;
}

/**
 * Den Zustand lesen, ohne zu werfen.
 *
 * @param api Geraete-Client (lib/api.js)
 * @param {string} route Seriennummer
 * @returns {Promise<object|null>} State oder null
 */
async function zustandLesen(api, route) {
    try {
        return await api.getState(route);
    } catch {
        return null;
    }
}

/**
 * Pruefen, ob der Befehl gewirkt hat: Status nachlesen, bis er passt oder die Zeit um ist.
 *
 * Aus ist Status 1. Eingeschaltet ist alles andere - welcher Status nach dem Einschalten
 * kommt, haengt vom Geraet ab (2 = ein, beim Ofen mitunter gleich 3 = programmiert).
 *
 * @param api Geraete-Client
 * @param {string} route Seriennummer
 * @param {boolean} an einschalten?
 * @param {(ms: number) => Promise<void>} warten Wartefunktion
 * @param {number} [versuche] Zahl der Leseversuche
 * @param {number} [abstandMs] Abstand zwischen den Versuchen
 * @returns {Promise<{wirkung: boolean|null, status: number|null}>} Wirkung (null = nicht lesbar)
 */
async function wirkungPruefen(api, route, an, warten, versuche = 6, abstandMs = 2500) {
    let letzter = null;
    for (let i = 0; i < versuche; i++) {
        await warten(abstandMs);
        const st = await zustandLesen(api, route);
        if (!st || typeof st.Status !== 'number') {
            continue;
        }
        letzter = st.Status;
        if (an ? st.Status !== 1 : st.Status === 1) {
            return { wirkung: true, status: st.Status };
        }
    }
    return { wirkung: letzter == null ? null : false, status: letzter };
}

/**
 * Ein Geraet ein- oder ausschalten.
 *
 * @param api Geraete-Client (anfrage, getState)
 * @param {string} route Seriennummer des Geraets
 * @param {boolean} an true = einschalten, false = ausschalten
 * @param {object} opt Optionen
 * @param {number|null} [opt.deviceType] DeviceType aus Ident
 * @param {number|null} [opt.protocolVersion] ProtocolVersion aus Ident
 * @param {{debug: (m: string) => void, info: (m: string) => void}} opt.log Protokoll
 * @param {string} [opt.name] Geraetename fuers Log
 * @param {(ms: number) => Promise<void>} opt.warten Wartefunktion
 * @param {boolean} [opt.pruefen] Wirkung nachlesen (Standard ja)
 * @param {boolean} [opt.ganzerLeaf] ganzen Leaf zurueckschreiben (Standard: nur Kaffeevollautomat)
 * @returns {Promise<{angenommen: boolean, weg: string, status: number|null, fehler: string|null,
 *   wirkung: boolean|null, statusVorher: number|null, statusNachher: number|null, ganz: boolean,
 *   schritte: string[]}>}
 *   Ergebnis des Befehls
 */
async function schalten(api, route, an, opt) {
    const { log, warten } = opt;
    const name = opt.name || route;
    const kaffee = Number(opt.deviceType) === TYP_KAFFEE;
    const ganzerLeaf = opt.ganzerLeaf != null ? !!opt.ganzerLeaf : kaffee;
    const schritte = [];
    const was = an ? 'power on' : 'power off';
    const notiz = text => {
        schritte.push(text);
        log.debug(`${name}: ${was} - ${text}`);
    };

    /*
     * Eine Anfrage stellen und protokollieren: Ressource, Status, Antwort als Hex.
     * Gesendet wird nur Klartext des Befehls - Schluessel und Signatur stehen nie im Log.
     */
    const schritt = async (method, resource, rumpf) => {
        const gesendet = rumpf == null ? '' : Buffer.isBuffer(rumpf) ? rumpf.toString('hex') : String(rumpf);
        try {
            const r = await api.anfrage(method, resource, rumpf);
            notiz(
                `${method} ${resource}${gesendet ? ` body ${gesendet}` : ''} -> HTTP ${r.status}` +
                    `, response ${r.body && r.body.length ? r.body.toString('hex') : '(empty)'}`,
            );
            return r;
        } catch (e) {
            notiz(`${method} ${resource}${gesendet ? ` body ${gesendet}` : ''} -> ${e.message}`);
            return { status: null, body: Buffer.alloc(0), fehler: e.message };
        }
    };
    const ok = s => s === 200 || s === 204;

    // 1. Zustand vorher - nur zur Auskunft, es wird nichts deswegen verweigert.
    const vorher = await zustandLesen(api, route);
    const statusVorher = vorher && typeof vorher.Status === 'number' ? vorher.Status : null;
    if (vorher) {
        notiz(
            `before: Status ${vorher.Status}, RemoteEnable ${JSON.stringify(vorher.RemoteEnable)}, ` +
                `StandbyState ${vorher.StandbyState}, DeviceType ${opt.deviceType}, ` +
                `ProtocolVersion ${opt.protocolVersion}`,
        );
        const re = Array.isArray(vorher.RemoteEnable) ? vorher.RemoteEnable[0] : null;
        if (re != null && re !== 15) {
            log.info(
                `${name}: RemoteEnable is ${JSON.stringify(vorher.RemoteEnable)} - the Miele app would ` +
                    `refuse to switch now; trying anyway`,
            );
        }
    } else {
        notiz('before: State not readable');
    }

    const ergebnis = (angenommen, weg, status, fehler) => ({
        angenommen,
        weg,
        status,
        fehler,
        wirkung: null,
        statusVorher,
        statusNachher: null,
        ganz: false,
        schritte,
    });
    let erg;

    if (Number(opt.protocolVersion) === 2 && kaffee) {
        // Kaffeevollautomat der aelteren Generation: Dop1 statt DOP2.
        const r = await schritt('POST', `Devices/${route}/DOP/`, dop1Rumpf(an));
        erg = ok(r.status)
            ? ergebnis(true, 'dop1', r.status, null)
            : ergebnis(false, 'dop1', r.status, `Dop1 1101: ${statusDeutung(r.status)}`);
    } else {
        erg = await dop2Weg();
    }

    /*
     * Abgelehnt, aber trotzdem am Ziel? Das Wecken allein kann ein Geraet einschalten: Am
     * 10.11.2026 ging eine WCR860 durch {"DeviceAction":2} von Status 1 auf 2, lehnte danach
     * aber jeden Schreibbefehl mit 500 ab. Dann zaehlt das Ergebnis, nicht der Weg.
     */
    if (!erg.angenommen && erg.status != null && opt.pruefen !== false) {
        const st = await zustandLesen(api, route);
        const s = st && typeof st.Status === 'number' ? st.Status : null;
        if (s != null && (an ? s !== 1 : s === 1) && s !== statusVorher) {
            notiz(`after: Status ${s} - target reached by the wake-up alone, the writes were refused`);
            erg.angenommen = true;
            erg.weg = 'wake';
            erg.wirkung = true;
            erg.statusNachher = s;
            return erg;
        }
    }

    if (erg.angenommen && opt.pruefen !== false) {
        const w = await wirkungPruefen(api, route, an, warten);
        erg.wirkung = w.wirkung;
        erg.statusNachher = w.status;
        notiz(`after: Status ${w.status} - ${w.wirkung ? 'switched' : 'no change seen'}`);
        /*
         * Der ganze Leaf wurde angenommen, aber nichts ist passiert? Dann einmal der feste
         * Rumpf hinterher. Am 10.11.2026 nahm eine G5840 den zurueckgeschriebenen Leaf mit
         * 204 an (gelesen kurz nach dem Wecken: ApplianceState 2, OperationState 15) und
         * blieb aus; der feste Rumpf schaltete sie danach sofort ein.
         */
        if (erg.ganz && w.wirkung === false) {
            notiz('whole leaf had no effect, writing the fixed body');
            const r = await schritt(
                'PUT',
                `Devices/${route}/DOP2/${LEAF_UNIT}/${LEAF_ATTR}?idx1=0&idx2=0`,
                festerRumpf(an),
            );
            if (ok(r.status)) {
                const w2 = await wirkungPruefen(api, route, an, warten);
                erg.status = r.status;
                erg.wirkung = w2.wirkung;
                erg.statusNachher = w2.status;
                notiz(`after: Status ${w2.status} - ${w2.wirkung ? 'switched' : 'no change seen'}`);
            }
        }
    }
    return erg;

    async function dop2Weg() {
        const leafPfad = `Devices/${route}/DOP2/${LEAF_UNIT}/${LEAF_ATTR}?idx1=0&idx2=0`;
        let runden = 0;
        const wecken = async () => {
            runden++;
            notiz(`waking the appliance (round ${runden}/${WECKRUNDEN_MAX})`);
            await schritt('PUT', `Devices/${route}/State`, JSON.stringify({ DeviceAction: 2 }));
            await warten(kaffee ? WARTEN_WECKEN_KAFFEE_MS : WARTEN_WECKEN_MS);
        };

        /*
         * 2. Lesen. Beim Kaffeevollautomaten wie die App: Feld 1 ersetzen und den ganzen Leaf
         * zurueckschreiben. Bei allen anderen Geraeten nur Feld 1 (fester Rumpf) - so schaltet
         * die App Ofen und Spuelmaschine, und so ging es am 10.11.2026 an der G5840, waehrend
         * der ganze Leaf dort zwar angenommen wurde, aber nichts bewirkte. Gelesen wird
         * trotzdem: Das weckt nebenbei, und der Inhalt steht fuer Tester im Debug-Log.
         */
        let gelesen = await schritt('GET', leafPfad, null);
        if (gelesen.status === 500 && runden < WECKRUNDEN_MAX) {
            await wecken();
            gelesen = await schritt('GET', leafPfad, null);
        }
        const fest = festerRumpf(an);
        let rumpf = gelesen.status === 200 && ganzerLeaf ? leafAendern(gelesen.body, an) : null;
        if (rumpf) {
            notiz('writing back the whole leaf with the new ApplianceState');
            if (kaffee) {
                await warten(WARTEN_VOR_SCHREIBEN_KAFFEE_MS);
            }
        } else {
            notiz(
                ganzerLeaf
                    ? 'leaf not usable, writing the fixed body (field 1 only)'
                    : 'writing the fixed body (field 1 only)',
            );
            rumpf = fest;
        }

        const fehlschlaege = [];
        for (;;) {
            const r = await schritt('PUT', leafPfad, rumpf);
            if (ok(r.status)) {
                const e = ergebnis(true, runden > 0 ? '1586+wake' : '1586', r.status, null);
                e.ganz = rumpf !== fest;
                return e;
            }
            fehlschlaege.push(r.status);
            if (r.status === 500 && runden < WECKRUNDEN_MAX) {
                await wecken();
                if (kaffee) {
                    await warten(WARTEN_VOR_SCHREIBEN_KAFFEE_MS);
                }
                continue;
            }
            // Den ganzen Leaf mag es nicht? Dann einmal der belegte Minimalbefehl.
            if (rumpf !== fest && r.status !== 403 && r.status !== 404) {
                notiz('whole leaf refused, trying the fixed body');
                rumpf = fest;
                continue;
            }
            break;
        }

        // 3. Rueckfall: der bisherige Benutzerwunsch 2/1583.
        notiz('falling back to UserRequest 2/1583');
        const r = await schritt(
            'PUT',
            `Devices/${route}/DOP2/2/1583?idx1=0&idx2=0`,
            benutzerwunsch(an ? OPCODE_AN : OPCODE_AUS),
        );
        if (ok(r.status)) {
            return ergebnis(true, '1583', r.status, null);
        }
        fehlschlaege.push(r.status);
        const haupt = wichtigsterStatus(fehlschlaege);
        const liste = fehlschlaege.map(s => (s == null ? 'timeout' : s)).join(', ');
        return ergebnis(false, '1583', haupt, `${statusDeutung(haupt)} [2/1586 and 2/1583 answered: ${liste}]`);
    }
}

module.exports = {
    LEAF_UNIT,
    LEAF_ATTR,
    TYP_KAFFEE,
    WECKRUNDEN_MAX,
    benutzerwunsch,
    festerRumpf,
    leafAendern,
    dop1Rumpf,
    statusDeutung,
    wichtigsterStatus,
    wirkungPruefen,
    schalten,
};

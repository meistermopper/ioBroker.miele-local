'use strict';

const { expect } = require('chai');
const net = require('node:net');
const { MieleZeitdienst, istZeitabfrage, zeitRumpf, absender } = require('../lib/zeitdienst');

/*
 * Der Zeitdienst gegen die Anfrage, wie sie ein Miele-Modul wirklich schickt.
 *
 * Das Modul schreibt die ABSOLUTE Adresse in die Anfragezeile (Proxy-Form). Ein Dienst, der
 * nur "/V2/NTP/" erkennt, wuerde jede echte Anfrage mit 404 beantworten - deshalb laeuft der
 * Haupttest ueber einen rohen Socket mit genau dieser Zeile, nicht ueber http.get.
 */

const stumm = { debug() {}, warn() {}, error() {} };

/**
 * Rohe HTTP-Anfrage schicken und die ganze Antwort lesen.
 *
 * @param {number} port Port des Dienstes
 * @param {string} text Anfrage, wie sie auf der Leitung steht
 * @returns {Promise<{status: number, kopf: string, rumpf: string}>} Antwort
 */
function roh(port, text) {
    return new Promise((resolve, reject) => {
        const s = net.connect(port, '127.0.0.1', () => s.write(text));
        let daten = '';
        s.setEncoding('utf8');
        s.on('data', d => {
            daten += d;
            const trenn = daten.indexOf('\r\n\r\n');
            if (trenn >= 0) {
                const kopf = daten.slice(0, trenn);
                const laenge = Number((/content-length:\s*(\d+)/i.exec(kopf) || [])[1] || 0);
                const rumpf = daten.slice(trenn + 4);
                if (Buffer.byteLength(rumpf) >= laenge) {
                    s.destroy();
                    resolve({ status: Number(kopf.split(' ')[1]), kopf, rumpf });
                }
            }
        });
        s.on('error', reject);
        s.setTimeout(3000, () => {
            s.destroy();
            reject(new Error('Zeitueberschreitung'));
        });
    });
}

const MIELE_ANFRAGE =
    'GET http://ntp.mcs2.miele.com/V2/NTP/ HTTP/1.1\r\n' +
    'Host: ntp.mcs2.miele.com\r\n' +
    'Accept: application/vnd.miele.v1+json\r\n' +
    'Content-Length: 0\r\n\r\n';

describe('Zeitdienst', () => {
    describe('istZeitabfrage', () => {
        for (const a of [
            '/V2/NTP/',
            '/V2/NTP',
            '/v2/ntp/',
            'http://ntp.mcs2.miele.com/V2/NTP/',
            'http://ntp.mcs2.miele.com/V2/NTP',
            'http://ntp.mcs2.miele.com:80/V2/NTP/',
            '/V2/NTP/?x=1',
        ]) {
            it(`erkennt ${a}`, () => expect(istZeitabfrage(a)).to.equal(true));
        }
        for (const a of ['/', '/V2/', '/V2/NTP/x', '/V3/NTP/', 'http://ntp.mcs2.miele.com/', '', undefined]) {
            it(`lehnt ${String(a)} ab`, () => expect(istZeitabfrage(a)).to.equal(false));
        }
    });

    it('liefert ganze Unix-Sekunden', () => {
        expect(zeitRumpf(1761400000999)).to.equal('{"time":1761400000}');
    });

    it('entfernt die IPv4-in-IPv6-Huelle', () => {
        expect(absender('::ffff:192.168.30.80')).to.equal('192.168.30.80');
        expect(absender('192.168.30.81')).to.equal('192.168.30.81');
        expect(absender(undefined)).to.equal('unknown');
    });

    describe('Server', () => {
        /** @type {MieleZeitdienst} */
        let dienst;
        let port;
        const abrufe = [];

        before(async () => {
            dienst = new MieleZeitdienst({
                port: 0,
                bind: '127.0.0.1',
                log: stumm,
                jetzt: () => 1761400000123,
                onAbruf: (ip, t) => abrufe.push({ ip, t }),
            });
            port = await dienst.start();
        });

        after(async () => {
            await dienst.stop();
        });

        it('beantwortet die echte Miele-Anfrage (absolute Adresse)', async () => {
            const a = await roh(port, MIELE_ANFRAGE);
            expect(a.status).to.equal(200);
            expect(a.kopf).to.match(/content-type: application\/json/i);
            expect(JSON.parse(a.rumpf)).to.deep.equal({ time: 1761400000 });
            expect(abrufe.at(-1)).to.deep.equal({ ip: '127.0.0.1', t: 1761400000123 });
        });

        it('beantwortet die Pfad-Form ohne Schraegstrich', async () => {
            const a = await roh(port, 'GET /V2/NTP HTTP/1.1\r\nHost: x\r\n\r\n');
            expect(a.status).to.equal(200);
            expect(JSON.parse(a.rumpf).time).to.equal(1761400000);
        });

        it('antwortet auf anderes mit 404 und zaehlt es nicht', async () => {
            const vorher = abrufe.length;
            const a = await roh(port, 'GET /Devices/ HTTP/1.1\r\nHost: x\r\n\r\n');
            expect(a.status).to.equal(404);
            const b = await roh(port, 'POST /V2/NTP/ HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n');
            expect(b.status).to.equal(404);
            expect(abrufe.length).to.equal(vorher);
        });

        it('bricht bei kaputter Anfrage nicht zusammen', async () => {
            await new Promise(resolve => {
                const s = net.connect(port, '127.0.0.1', () => s.end('KAPUTT\r\n\r\n'));
                s.on('close', resolve);
                s.on('error', resolve);
                s.resume();
            });
            const a = await roh(port, MIELE_ANFRAGE);
            expect(a.status).to.equal(200);
        });
    });

    it('meldet einen belegten Port als Fehler', async () => {
        const erster = new MieleZeitdienst({ port: 0, bind: '127.0.0.1', log: stumm });
        const p = await erster.start();
        const zweiter = new MieleZeitdienst({ port: p, bind: '127.0.0.1', log: stumm });
        let fehler;
        try {
            await zweiter.start();
        } catch (e) {
            fehler = e;
        }
        await erster.stop();
        expect(fehler && fehler.code).to.equal('EADDRINUSE');
    });

    it('gibt den Port beim Beenden frei, auch mit offener Verbindung', async () => {
        const d = new MieleZeitdienst({ port: 0, bind: '127.0.0.1', log: stumm });
        const p = await d.start();
        const offen = net.connect(p, '127.0.0.1');
        await new Promise(r => offen.on('connect', r));
        await d.stop();
        offen.destroy();
        const neu = new MieleZeitdienst({ port: p, bind: '127.0.0.1', log: stumm });
        await neu.start();
        await neu.stop();
    });
});

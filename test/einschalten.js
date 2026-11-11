'use strict';

/*
 * Ein- und Ausschalten (seit 0.4.3): 2/1586, Wecken bei 500, Rueckfall 2/1583, Dop1.
 *
 * Das Geraet ist nachgebaut: Jede Anfrage landet in einer Liste und bekommt die Antwort, die
 * der Test vorgibt. Gewartet wird nicht wirklich.
 */

const { expect } = require('chai');
const ein = require('../lib/einschalten');
const befehle = require('../lib/befehle');

const ROUTE = '000111111111';
const LEAF = `Devices/${ROUTE}/DOP2/2/1586?idx1=0&idx2=0`;
const UREQ = `Devices/${ROUTE}/DOP2/2/1583?idx1=0&idx2=0`;
const STATE = `Devices/${ROUTE}/State`;

/** Leaf 2/1586 mit drei E8-Feldern, wie ihn ein Geraet liefert (aus = 1). */
const LEAF_GELESEN = Buffer.concat([
    Buffer.from('001600020632000000000003000104010002040200030403', 'hex'),
    Buffer.alloc(8, 0x20),
]);

/**
 * Ein nachgebautes Geraet.
 *
 * @param {object} antworten je Schluessel "METHODE Ressource" eine Liste von Status (der letzte gilt weiter)
 * @param {number[]} statusFolge Status beim Lesen von /State, der letzte gilt weiter
 */
function geraet(antworten, statusFolge = [1, 2]) {
    const anfragen = [];
    let stIdx = 0;
    return {
        anfragen,
        api: {
            anfrage: async (method, resource, body) => {
                const k = `${method} ${resource}`;
                anfragen.push({ k, body });
                const liste = antworten[k] || [404];
                const s = liste.length > 1 ? liste.shift() : liste[0];
                if (s === 'timeout') {
                    throw new Error(`Timeout 192.0.2.10/${resource}`);
                }
                const rumpf = k === `GET ${LEAF}` && s === 200 ? LEAF_GELESEN : Buffer.alloc(0);
                return { status: s, body: rumpf };
            },
            getState: async () => {
                const s = statusFolge[Math.min(stIdx, statusFolge.length - 1)];
                stIdx++;
                return { Status: s, RemoteEnable: [15, 0, 0], StandbyState: 1 };
            },
        },
    };
}

function optionen(extra = {}) {
    const logs = [];
    return {
        logs,
        opt: {
            log: { debug: m => logs.push(m), info: m => logs.push(m) },
            warten: async () => {},
            deviceType: 7,
            protocolVersion: 4,
            ...extra,
        },
    };
}

describe('Einschalten: Rumpf', () => {
    it('fester Rumpf entspricht dem belegten Aufbau', () => {
        const hexAn = ein.festerRumpf(true).toString('hex');
        expect(hexAn).to.equal(`000e00020632000000000001000104${'04'}${'20'.repeat(16)}`);
        expect(ein.festerRumpf(false).toString('hex').slice(30, 32)).to.equal('01');
        expect(ein.festerRumpf(true)).to.have.length(32);
    });

    it('gelesener Leaf: nur Feld 1 wird ersetzt, der Rest bleibt', () => {
        const neu = ein.leafAendern(LEAF_GELESEN, true);
        expect(neu).to.have.length(32);
        expect(neu.subarray(0, 24).toString('hex')).to.equal('001600020632000000000003000104040002040200030403');
        expect(ein.leafAendern(LEAF_GELESEN, false)[15]).to.equal(1);
    });

    it('unbekannter Aufbau ergibt null (dann gilt der feste Rumpf)', () => {
        expect(ein.leafAendern(Buffer.from('0010000106'), true)).to.equal(null);
        const fremd = Buffer.from(LEAF_GELESEN);
        fremd.writeUInt16BE(1583, 4);
        expect(ein.leafAendern(fremd, true)).to.equal(null);
        const struktur = Buffer.from(LEAF_GELESEN);
        struktur[14] = 16; // Feld 1 als Struktur
        expect(ein.leafAendern(struktur, true)).to.equal(null);
    });

    it('der Rueckfall 2/1583 behaelt den alten Kopf', () => {
        expect(ein.benutzerwunsch(0x10).toString('hex')).to.equal(
            `00100001062f0000000000010001070010${'20'.repeat(15)}`,
        );
    });
});

describe('Einschalten: Ablauf', () => {
    it('204 auf 2/1586: angenommen, Status nachgelesen', async () => {
        const g = geraet({ [`GET ${LEAF}`]: [200], [`PUT ${LEAF}`]: [204] });
        const { opt, logs } = optionen();
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg).to.include({ angenommen: true, weg: '1586', status: 204, wirkung: true, statusVorher: 1 });
        expect(erg.statusNachher).to.equal(2);
        // ausser beim Kaffeevollautomaten nur Feld 1 (fester Rumpf)
        const put = g.anfragen.find(a => a.k === `PUT ${LEAF}`);
        expect(put.body.toString('hex')).to.equal(ein.festerRumpf(true).toString('hex'));
        expect(g.anfragen.some(a => a.k === `PUT ${UREQ}`)).to.equal(false);
        // Debug-Log: Ressource, Status, Hex
        expect(logs.some(m => m.includes(`PUT ${LEAF}`) && m.includes('HTTP 204'))).to.equal(true);
        expect(logs.some(m => m.includes(`GET ${LEAF}`) && m.includes('response 0016'))).to.equal(true);
    });

    it('404 ueberall: nicht angenommen, Deutung "kein DOP2"', async () => {
        const g = geraet({}, [1]);
        const { opt } = optionen();
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg.angenommen).to.equal(false);
        expect(erg.status).to.equal(404);
        expect(erg.fehler).to.match(/does not offer DOP2/);
        // gelesen, fest geschrieben, Rueckfall - kein Wecken
        expect(g.anfragen.map(a => a.k)).to.deep.equal([`GET ${LEAF}`, `PUT ${LEAF}`, `PUT ${UREQ}`]);
    });

    it('500 -> wecken -> 204', async () => {
        const g = geraet({
            [`GET ${LEAF}`]: [500, 200],
            [`PUT ${STATE}`]: [204],
            [`PUT ${LEAF}`]: [204],
        });
        const { opt } = optionen();
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg).to.include({ angenommen: true, weg: '1586+wake', wirkung: true });
        const weck = g.anfragen.find(a => a.k === `PUT ${STATE}`);
        expect(JSON.parse(weck.body)).to.deep.equal({ DeviceAction: 2 });
    });

    it('Schreiben 500 -> wecken -> 204, hoechstens zwei Runden', async () => {
        const g = geraet({
            [`GET ${LEAF}`]: [500],
            [`PUT ${STATE}`]: [204],
            [`PUT ${LEAF}`]: [500, 204],
        });
        const { opt } = optionen();
        const erg = await ein.schalten(g.api, ROUTE, false, opt);
        expect(erg).to.include({ angenommen: true, weg: '1586+wake' });
        expect(g.anfragen.filter(a => a.k === `PUT ${STATE}`)).to.have.length(2);
        // aus = Feld 1 auf 1, fester Rumpf (Leaf war nicht lesbar)
        expect(g.anfragen.find(a => a.k === `PUT ${LEAF}`).body[15]).to.equal(1);
    });

    it('500 bleibt -> Rueckfall auf 2/1583 mit Opcode 0x10', async () => {
        const g = geraet({
            [`GET ${LEAF}`]: [500],
            [`PUT ${STATE}`]: [204],
            [`PUT ${LEAF}`]: [500],
            [`PUT ${UREQ}`]: [204],
        });
        const { opt } = optionen();
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg).to.include({ angenommen: true, weg: '1583', status: 204 });
        expect(g.anfragen.filter(a => a.k === `PUT ${STATE}`)).to.have.length(ein.WECKRUNDEN_MAX);
        const ureq = g.anfragen.find(a => a.k === `PUT ${UREQ}`);
        expect(ureq.body.toString('hex').slice(0, 34)).to.equal('00100001062f0000000000010001070010');
    });

    it('500 ueberall: Deutung "nimmt den Befehl nicht an"', async () => {
        const g = geraet(
            { [`GET ${LEAF}`]: [500], [`PUT ${STATE}`]: [204], [`PUT ${LEAF}`]: [500], [`PUT ${UREQ}`]: [500] },
            [1],
        );
        const { opt } = optionen();
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg.angenommen).to.equal(false);
        expect(erg.fehler).to.match(/does not accept the command/);
    });

    it('Schreiben abgelehnt, aber das Wecken hat eingeschaltet: Weg "wake"', async () => {
        const g = geraet(
            { [`GET ${LEAF}`]: [500, 200], [`PUT ${STATE}`]: [200], [`PUT ${LEAF}`]: [500], [`PUT ${UREQ}`]: [500] },
            [1, 2],
        );
        const { opt } = optionen({ deviceType: 1 });
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg).to.include({ angenommen: true, weg: 'wake', wirkung: true, statusNachher: 2 });
    });

    it('403: Deutung "Fernsteuerung aus"', async () => {
        const g = geraet({ [`GET ${LEAF}`]: [403], [`PUT ${LEAF}`]: [403], [`PUT ${UREQ}`]: [403] });
        const { opt } = optionen();
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg.fehler).to.match(/remote control is switched off/);
    });

    it('Kaffeevollautomat: der ganze gelesene Leaf geht zurueck, Feld 1 = 4', async () => {
        const g = geraet({ [`GET ${LEAF}`]: [200], [`PUT ${LEAF}`]: [204] });
        const { opt } = optionen({ deviceType: 17 });
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg).to.include({ angenommen: true, weg: '1586', ganz: true, wirkung: true });
        const put = g.anfragen.find(a => a.k === `PUT ${LEAF}`);
        expect(put.body.subarray(0, 24).toString('hex')).to.equal('001600020632000000000003000104040002040200030403');
    });

    it('ganzer Leaf ohne Wirkung: der feste Rumpf hinterher', async () => {
        const g = geraet({ [`GET ${LEAF}`]: [200], [`PUT ${LEAF}`]: [204] }, [1, 1, 1, 1, 1, 1, 1, 2]);
        const { opt } = optionen({ deviceType: 17 });
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        const puts = g.anfragen.filter(a => a.k === `PUT ${LEAF}`);
        expect(puts).to.have.length(2);
        expect(puts[1].body.toString('hex')).to.equal(ein.festerRumpf(true).toString('hex'));
        expect(erg).to.include({ angenommen: true, wirkung: true, statusNachher: 2 });
    });

    it('ganzer Leaf abgelehnt (400): einmal der feste Rumpf', async () => {
        const g = geraet({ [`GET ${LEAF}`]: [200], [`PUT ${LEAF}`]: [400, 204] });
        const { opt } = optionen({ deviceType: 17 });
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg).to.include({ angenommen: true, weg: '1586' });
        const puts = g.anfragen.filter(a => a.k === `PUT ${LEAF}`);
        expect(puts[1].body.toString('hex')).to.equal(ein.festerRumpf(true).toString('hex'));
    });

    it('Zeitueberschreitung beim Lesen: fester Rumpf, kein Abbruch', async () => {
        const g = geraet({ [`GET ${LEAF}`]: ['timeout'], [`PUT ${LEAF}`]: [204] });
        const { opt } = optionen();
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg).to.include({ angenommen: true, weg: '1586' });
    });

    it('Kaffeevollautomat mit ProtocolVersion 2: Dop1 1101', async () => {
        const g = geraet({ [`POST Devices/${ROUTE}/DOP/`]: [204] });
        const { opt } = optionen({ deviceType: 17, protocolVersion: 2 });
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg).to.include({ angenommen: true, weg: 'dop1' });
        expect(g.anfragen).to.have.length(1);
        expect(JSON.parse(g.anfragen[0].body)).to.deep.equal({ Request: '110102000102' });
    });

    it('Kaffeevollautomat ProtocolVersion 2, aus: Aktion 3', async () => {
        const g = geraet({ [`POST Devices/${ROUTE}/DOP/`]: [204] }, [2, 1]);
        const { opt } = optionen({ deviceType: 17, protocolVersion: 2 });
        const erg = await ein.schalten(g.api, ROUTE, false, opt);
        expect(JSON.parse(g.anfragen[0].body).Request).to.equal('110102000103');
        expect(erg.wirkung).to.equal(true);
    });

    it('Kaffeevollautomat mit DOP2 wartet laenger nach dem Wecken', async () => {
        const gewartet = [];
        const g = geraet({ [`GET ${LEAF}`]: [500, 200], [`PUT ${STATE}`]: [204], [`PUT ${LEAF}`]: [204] });
        const { opt } = optionen({ deviceType: 17, protocolVersion: 4, pruefen: false });
        opt.warten = async ms => gewartet.push(ms);
        await ein.schalten(g.api, ROUTE, true, opt);
        expect(gewartet).to.deep.equal([5000, 1500]);
    });

    it('204 ohne Wirkung: wirkung=false', async () => {
        const g = geraet({ [`GET ${LEAF}`]: [200], [`PUT ${LEAF}`]: [204] }, [1]);
        const { opt } = optionen();
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg).to.include({ angenommen: true, wirkung: false, statusNachher: 1 });
    });

    it('RemoteEnable 7 wird nur protokolliert, nicht blockiert', async () => {
        const g = geraet({ [`GET ${LEAF}`]: [200], [`PUT ${LEAF}`]: [204] });
        g.api.getState = async () => ({ Status: 1, RemoteEnable: [7, 1, 0] });
        const { opt, logs } = optionen({ pruefen: false });
        const erg = await ein.schalten(g.api, ROUTE, true, opt);
        expect(erg.angenommen).to.equal(true);
        expect(logs.some(m => m.includes('RemoteEnable is [7,1,0]'))).to.equal(true);
    });
});

describe('Einschalten: Abschluss des Datenpunkts', () => {
    const ID = `miele-local.0.${ROUTE}.control.powerOn`;
    function adapter() {
        const gesetzt = [];
        return {
            gesetzt,
            config: { allowControl: true },
            devices: { [ROUTE]: { route: ROUTE } },
            log: { warn: () => {}, info: () => {}, debug: () => {} },
            setStateAsync: async (id, st) => gesetzt.push({ id, ...st }),
            getObjectAsync: async () => ({ native: { opcode: 0x10 } }),
        };
    }
    const lauf = (a, erg) =>
        befehle.verarbeiten(
            a,
            { id: ID, deviceId: ROUTE, sub: 'powerOn', val: true },
            { senden: async () => 204, schalten: async () => erg },
        );

    it('Erfolg mit Wirkung: Weg und Status im Kommentar', async () => {
        const a = adapter();
        await lauf(a, {
            angenommen: true,
            weg: '1586+wake',
            status: 204,
            wirkung: true,
            statusVorher: 1,
            statusNachher: 2,
        });
        expect(a.gesetzt[0]).to.include({ val: false, ack: true });
        expect(a.gesetzt[0].q).to.equal(undefined);
        expect(a.gesetzt[0].c).to.equal('done via 1586+wake (HTTP 204), status 1 -> 2');
    });

    it('angenommen ohne Wirkung: q=0x44', async () => {
        const a = adapter();
        await lauf(a, {
            angenommen: true,
            weg: '1586',
            status: 204,
            wirkung: false,
            statusVorher: 1,
            statusNachher: 1,
        });
        expect(a.gesetzt[0]).to.include({ val: false, ack: true, q: 0x44 });
        expect(a.gesetzt[0].c).to.match(/did not change/);
    });

    it('abgelehnt: Deutung im Kommentar', async () => {
        const a = adapter();
        await lauf(a, { angenommen: false, weg: '1583', status: 404, fehler: ein.statusDeutung(404) });
        expect(a.gesetzt[0]).to.include({ val: false, ack: true, q: 0x44 });
        expect(a.gesetzt[0].c).to.match(/does not offer DOP2/);
    });
});

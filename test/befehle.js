'use strict';

/*
 * Steuerbefehle werden immer abgeschlossen (seit 0.3.47).
 *
 * Bis 0.3.46 blieb ein Befehl, der nicht ausgefuehrt werden konnte, mit ack=false stehen -
 * am 16.10.2026 ein control.powerOn seit 52 Tagen. Die Tests rufen die Methoden des Adapters
 * mit einer nachgebauten Umgebung auf; es wird nichts gesendet.
 */

const { expect } = require('chai');
const befehle = require('../lib/befehle');

const ID = 'miele-local.0.000111111111.control.powerOn';

function umgebung({ allowControl = true, geraet = true, put = async () => 200 } = {}) {
    const gesetzt = [];
    const logs = [];
    const ctx = {
        config: { allowControl },
        devices: geraet ? { '000111111111': { route: '000111111111' } } : {},
        log: {
            warn: m => logs.push(['warn', m]),
            info: m => logs.push(['info', m]),
            debug: () => {},
        },
        setStateAsync: async (id, st) => gesetzt.push({ id, ...st }),
        getObjectAsync: async () => ({ native: { opcode: 0x10 } }),
    };
    ctx.put = put;
    return { ctx, gesetzt, logs };
}

const befehl = (ctx, val = true) =>
    befehle.verarbeiten(ctx, { id: ID, deviceId: '000111111111', sub: 'powerOn', val }, { senden: () => ctx.put() });

describe('Steuerbefehle', () => {
    it('Steuerung aus: Befehl wird mit ack und Grund abgeschlossen, nichts gesendet', async () => {
        let gesendet = false;
        const { ctx, gesetzt } = umgebung({ allowControl: false, put: async () => ((gesendet = true), 200) });
        await befehl(ctx);
        expect(gesendet).to.equal(false);
        expect(gesetzt).to.have.length(1);
        expect(gesetzt[0]).to.include({ id: ID, val: false, ack: true, q: 0x11 });
        expect(gesetzt[0].c).to.match(/disabled/);
    });

    it('Geraet unbekannt: Abschluss mit q=0x42', async () => {
        const { ctx, gesetzt } = umgebung({ geraet: false });
        await befehl(ctx);
        expect(gesetzt[0]).to.include({ val: false, ack: true, q: 0x42 });
    });

    it('HTTP-Fehler des Geraets: Abschluss mit q=0x44 und Statuscode im Kommentar', async () => {
        const { ctx, gesetzt } = umgebung({ put: async () => 404 });
        await befehl(ctx);
        expect(gesetzt[0]).to.include({ val: false, ack: true, q: 0x44 });
        expect(gesetzt[0].c).to.match(/HTTP 404/);
    });

    it('Verbindungsfehler: Abschluss mit q=0x42 und Fehlermeldung', async () => {
        const { ctx, gesetzt } = umgebung({
            put: async () => {
                throw new Error('connect EHOSTUNREACH 192.0.2.10:80');
            },
        });
        await befehl(ctx);
        expect(gesetzt[0]).to.include({ val: false, ack: true, q: 0x42 });
        expect(gesetzt[0].c).to.match(/EHOSTUNREACH/);
    });

    it('Erfolg: zurueckgesetzt ohne Fehlerqualitaet', async () => {
        const { ctx, gesetzt } = umgebung({ put: async () => 204 });
        await befehl(ctx);
        expect(gesetzt[0]).to.deep.equal({ id: ID, val: false, ack: true });
    });

    it('false loest nichts aus, wird aber bestaetigt', async () => {
        let gesendet = false;
        const { ctx, gesetzt } = umgebung({ put: async () => ((gesendet = true), 200) });
        await befehl(ctx, false);
        expect(gesendet).to.equal(false);
        expect(gesetzt[0]).to.deep.equal({ id: ID, val: false, ack: true });
    });

    it('Beim Start: offene Befehle werden geschlossen, nicht ausgefuehrt', async () => {
        const { ctx, gesetzt, logs } = umgebung();
        ctx.getStatesAsync = async () => ({
            [ID]: { val: true, ack: false, ts: Date.UTC(2026, 7, 25) },
            'miele-local.0.000111111111.control.stop': { val: false, ack: true, ts: 1 },
        });
        expect(await befehle.offeneSchliessen(ctx)).to.equal(1);
        expect(gesetzt).to.have.length(1);
        expect(gesetzt[0]).to.include({ id: ID, val: false, ack: true, q: 0x11 });
        expect(gesetzt[0].c).to.match(/2026-08-25/);
        expect(logs.some(([, m]) => m.includes('not sent'))).to.equal(true);
    });
});

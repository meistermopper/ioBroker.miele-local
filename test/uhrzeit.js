'use strict';

/*
 * Geraeteuhr auf Ortszeit halten (lib/uhrzeit.js, seit 0.4.1).
 *
 * Der Ausgangsfall ist echt: Am 25.10.2026 (Rueckstellung auf Winterzeit um 03:00) meldete ein
 * Backofen um 15:11:11 UTC die Ortszeit 17:11:11 - noch Sommerzeit, eine Stunde vor.
 */

const { expect } = require('chai');
const uhr = require('../lib/uhrzeit');

const BERLIN = 'Europe/Berlin';

describe('Geräteuhr (uhrzeit.js)', () => {
    it('Ortszeit Berlin als DateTime-Feld, Winter- und Sommerzeit', () => {
        expect(uhr.ortszeitFeld(Date.UTC(2026, 9, 25, 15, 11, 11), BERLIN)).to.deep.equal([25, 10, 2026, 16, 11, 11]);
        expect(uhr.ortszeitFeld(Date.UTC(2026, 6, 1, 22, 30, 0), BERLIN)).to.deep.equal([2, 7, 2026, 0, 30, 0]);
    });

    it('Umstellungstag: kurz vor und nach 03:00 Sommerzeit', () => {
        expect(uhr.ortszeitFeld(Date.UTC(2026, 9, 25, 0, 59, 59), BERLIN)).to.deep.equal([25, 10, 2026, 2, 59, 59]);
        expect(uhr.ortszeitFeld(Date.UTC(2026, 9, 25, 1, 0, 0), BERLIN)).to.deep.equal([25, 10, 2026, 2, 0, 0]);
    });

    it('der Backofen vom 25.10.2026 geht eine Stunde vor und wird gestellt', () => {
        const ts = { DateTime: [25, 10, 2026, 17, 11, 11], NTPEnabled: false, UTCOffset: [0, 0, 0], TimeMaster: false };
        const r = uhr.pruefen(ts, Date.UTC(2026, 9, 25, 15, 11, 11), BERLIN);
        expect(r.abweichungS).to.equal(3600);
        expect(r.setzen).to.equal(true);
    });

    it('bis 2 Minuten Abweichung bleibt die Uhr unberührt, darüber wird gestellt', () => {
        const jetzt = Date.UTC(2026, 9, 25, 15, 0, 0);
        const um = s => ({ DateTime: uhr.ortszeitFeld(jetzt + s * 1000, BERLIN) });
        expect(uhr.pruefen(um(120), jetzt, BERLIN)).to.deep.equal({ abweichungS: 120, setzen: false });
        expect(uhr.pruefen(um(-120), jetzt, BERLIN)).to.deep.equal({ abweichungS: -120, setzen: false });
        expect(uhr.pruefen(um(121), jetzt, BERLIN).setzen).to.equal(true);
        expect(uhr.pruefen(um(-121), jetzt, BERLIN).setzen).to.equal(true);
    });

    it('Abweichung über Tages-, Monats- und Jahresgrenze', () => {
        const ts = { DateTime: [31, 12, 2026, 23, 59, 0] };
        expect(uhr.abweichung(ts, Date.UTC(2026, 11, 31, 23, 1, 0), BERLIN)).to.equal(-120);
    });

    it('ohne lesbares DateTime wird nichts gestellt', () => {
        for (const ts of [
            null,
            {},
            { DateTime: [25, 10, 2026] },
            { DateTime: [0, 13, 2026, 1, 1, 1] },
            { DateTime: 'x' },
        ]) {
            expect(uhr.pruefen(ts, Date.now(), BERLIN)).to.deep.equal({ abweichungS: null, setzen: false });
        }
    });

    it('der PUT-Rumpf enthält nur DateTime (NTPEnabled/UTCOffset/TimeMaster bleiben unberührt)', () => {
        const rumpf = JSON.parse(uhr.stellRumpf(Date.UTC(2026, 9, 25, 14, 43, 24), BERLIN));
        expect(rumpf).to.deep.equal({ DateTime: [25, 10, 2026, 15, 43, 24] });
    });

    it('ohne Angabe gilt die Zeitzone des Prozesses', () => {
        expect(uhr.zeitzone()).to.be.a('string').and.not.equal('');
        expect(uhr.zeitzone('Europe/Vienna')).to.equal('Europe/Vienna');
    });
});

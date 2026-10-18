'use strict';

/*
 * Restzeit ohne Programm (seit 0.3.47) und die Netze des IP-Rueckfalls.
 *
 * Die G5840 meldete am 16.10.2026 im Zustand Aus RemainingTime [0, 1]; der Adapter zeigte
 * daraufhin 0:01 und ein Programmende in einer Minute.
 */

const { expect } = require('chai');
const objdef = require('../lib/objects');
const { subnetzVorlagen } = require('../lib/discovery');

describe('Restzeit ohne Programm', () => {
    it('Aus (1), Ende (7), nicht verbunden (255): Restzeit 0', () => {
        for (const Status of [1, 7, 255]) {
            const s = objdef.restzeitBereinigen({ Status, RemainingTime: [0, 1] });
            expect(s.RemainingTime).to.deep.equal([0, 0]);
            expect(objdef.STATE_FIELDS.RemainingTime.decode(s.RemainingTime)).to.deep.equal([
                { sub: 'remainingMinutes', val: 0 },
                { sub: 'remainingHHMM', val: '0:00' },
            ]);
        }
    });

    it('In Betrieb, Pause, programmiert, An: Restzeit bleibt', () => {
        for (const Status of [2, 3, 4, 5, 6, 9]) {
            const roh = { Status, RemainingTime: [1, 25] };
            expect(objdef.restzeitBereinigen(roh)).to.equal(roh);
        }
    });

    it('veraendert die Rohantwort nicht', () => {
        const roh = { Status: 1, RemainingTime: [0, 1] };
        objdef.restzeitBereinigen(roh);
        expect(roh.RemainingTime).to.deep.equal([0, 1]);
    });

    it('ohne Status oder ohne Restzeit: unveraendert', () => {
        const a = { RemainingTime: [0, 1] };
        const b = { Status: 1 };
        expect(objdef.restzeitBereinigen(a)).to.equal(a);
        expect(objdef.restzeitBereinigen(b)).to.equal(b);
    });
});

describe('IP-Rueckfall: zu durchsuchende Netze', () => {
    it('ein Netz je /24, erste Adresse als Vorlage', () => {
        expect(subnetzVorlagen(['192.0.2.25', '192.0.2.27', '198.51.100.80'])).to.deep.equal([
            '192.0.2.25',
            '198.51.100.80',
        ]);
    });

    it('ungueltige Eintraege werden uebergangen', () => {
        expect(subnetzVorlagen(['', null, 'abc', '203.0.113.5'])).to.deep.equal(['203.0.113.5']);
    });
});

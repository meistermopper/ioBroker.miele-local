'use strict';

/*
 * Vollstaendige deutsche Uebersetzung und die Statuswerte 144/145.
 *
 * Idee und Uebersetzungen von meistermopper (PR #14). Ein neuer Phasenname ohne deutsche
 * Fassung faellt hier sofort auf, statt in der Oberflaeche als englischer Bezeichner.
 */

const { expect } = require('chai');
const enums = require('../lib/enums');
const enumsDe = require('../lib/enums_de');
const { STATE_FIELDS } = require('../lib/objects');

describe('Enums', () => {
    it('jede Phase in jeder Phasentabelle hat einen deutschen Namen', () => {
        for (const [tabelle, eintraege] of Object.entries(enums.TABLES)) {
            if (!tabelle.startsWith('ProgramPhase')) {
                continue;
            }
            for (const wert of Object.values(eintraege)) {
                if (!wert || wert === 'not_running') {
                    continue;
                }
                expect(enumsDe.PhaseNameDe[wert], `${tabelle}: "${wert}" ohne deutschen Namen`).to.exist;
            }
        }
    });

    it('Status 144 und 145 werden aufgeloest', () => {
        expect(enums.statusText(144)).to.equal('default');
        expect(enums.statusText(145)).to.equal('locked');
        expect(enumsDe.statusDe(144)).to.equal('Standard');
        expect(enumsDe.statusDe(145)).to.equal('Gesperrt');
    });

    it('Trocknerphasen kommen nicht mehr aus der Waschmaschinentabelle', () => {
        // 513 ist beim Trockner "program_running". Die deutsche Fassung kommt ueber den
        // englischen Namen, nicht ueber die Nummerntabelle der Waschmaschine.
        const text = STATE_FIELDS.ProgramPhase.decode(513, { deviceType: 2 })[1].val;
        expect(text).to.equal(enumsDe.PhaseNameDe.program_running);
    });
});

describe('Klartexte folgen der Sprachoption (0.3.45)', () => {
    const { STATE_FIELDS } = require('../lib/objects');
    const text = (feld, v, ctx) => STATE_FIELDS[feld].decode(v, ctx)[1].val;

    it('schreibt bei abgeschalteten deutschen Namen englische Texte', () => {
        // Bis 0.3.44 standen Status, Programm und Phase immer deutsch im Datenpunkt.
        const en = { deviceType: 1, german: false };
        expect(text('Status', 5, en)).to.equal('In use');
        expect(text('ProgramID', 1, en)).to.equal('Cottons');
        expect(text('ProgramPhase', 260, en)).to.equal('Main wash');
        expect(text('ProgramType', 1, en)).to.equal('Own program');
        expect(text('ProgramID', 9999, en)).to.equal('Program 9999');
    });

    it('bleibt deutsch, wenn die Option gesetzt ist oder fehlt', () => {
        for (const ctx of [{ deviceType: 1, german: true }, { deviceType: 1 }]) {
            expect(text('Status', 5, ctx)).to.equal('In Betrieb');
            expect(text('ProgramID', 1, ctx)).to.equal('Baumwolle');
            expect(text('ProgramID', 9999, ctx)).to.equal('Programm 9999');
        }
    });
});

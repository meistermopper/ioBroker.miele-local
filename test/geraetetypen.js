'use strict';

/*
 * Geraetetyp -> Programm-/Phasentabelle.
 *
 * Bis 0.3.40 stimmten vier Eintraege in BY_TYPE nicht: 16 stand als Dampfbackofen (ist die
 * Mikrowelle), 67 als Waermeschublade (ist der Dialoggarer, die Schublade ist 25), der
 * Waschtrockner nahm die Trocknerprogramme und 13 die Backofenphasen. An den eigenen Geraeten
 * (Waschmaschine, Spuelmaschine, Backofen) faellt das nie auf - deshalb steht die Zuordnung
 * hier fest, abgeglichen mit Home Assistant (MieleAppliance, ha-miele-at-lan sensor.py).
 */

const { expect } = require('chai');
const enums = require('../lib/enums');
const { STATE_FIELDS } = require('../lib/objects');

const ERWARTET = {
    1: ['WashingMachineProgramId', 'ProgramPhaseWashingMachine'],
    2: ['TumbleDryerProgramId', 'ProgramPhaseTumbleDryer'],
    7: ['DishWasherProgramId', 'ProgramPhaseDishwasher'],
    12: ['OvenProgramId', 'ProgramPhaseOven'],
    13: ['OvenProgramId', 'ProgramPhaseMicrowaveOvenCombo'],
    15: ['OvenProgramId', 'ProgramPhaseSteamOven'],
    16: ['OvenProgramId', 'ProgramPhaseMicrowave'],
    17: ['CoffeeSystemProgramId', 'ProgramPhaseCoffeeSystem'],
    23: ['RobotVacuumCleanerProgramId', 'ProgramPhaseRobotVacuumCleaner'],
    24: ['WashingMachineProgramId', 'ProgramPhaseWasherDryer'],
    25: ['DishWarmerProgramId', 'ProgramPhaseWarmingDrawer'],
    31: ['OvenProgramId', 'ProgramPhaseSteamOvenCombi'],
    45: ['SteamOvenMicroProgramId', 'ProgramPhaseSteamOvenMicro'],
    67: ['OvenProgramId', 'ProgramPhaseOven'],
};

describe('Geraetetypen', () => {
    for (const [typ, [programm, phase]] of Object.entries(ERWARTET)) {
        it(`Typ ${typ} nutzt ${programm} / ${phase}`, () => {
            expect(enums.BY_TYPE[typ]).to.deep.equal({ program: programm, phase });
        });
    }

    it('jede in BY_TYPE genannte Tabelle existiert', () => {
        for (const [typ, m] of Object.entries(enums.BY_TYPE)) {
            expect(enums.TABLES, `Typ ${typ}`).to.have.property(m.program);
            expect(enums.TABLES, `Typ ${typ}`).to.have.property(m.phase);
        }
    });

    it('ein Programm ohne deutschen Namen erscheint lesbar, nicht als Bezeichner', () => {
        const [id, schluessel] = Object.entries(enums.TABLES.SteamOvenMicroProgramId).find(
            ([, v]) => v === 'artichokes_small',
        );
        expect(schluessel).to.equal('artichokes_small');
        const text = STATE_FIELDS.ProgramID.decode(Number(id), { deviceType: 45 })[1].val;
        expect(text).to.equal('Artichokes small');
    });
});

'use strict';

/*
 * Alles, was die Geraetekarten anzeigen, in allen elf ioBroker-Sprachen (seit 0.5.1).
 *
 * Bis 0.5.0 standen auf der Karte die Textdatenpunkte (statusText, programText …), die der
 * Adapter nur auf Deutsch oder Englisch schreibt - ein franzoesischer ioBroker zeigte "In
 * Betrieb". Jetzt zeigt die Karte den Rohwert mit einer Wertetabelle in der Systemsprache
 * (lib/werte.js); die Textdatenpunkte bleiben fuer Skripte unveraendert.
 */

const { expect } = require('chai');
const path = require('node:path');
const gm = require('../lib/geraetemanager');
const werte = require('../lib/werte');
const enums = require('../lib/enums');
const objdef = require('../lib/objects');
const namen = require('../lib/names');
const HA = require('../lib/werte_ha');
const { SPRACHEN, pruefe } = require('./lib/sprachpruefung');

const NS = 'miele-local.0';
const BAUM = require(path.join(__dirname, '..', 'miele-local.0.json'));
const OFEN = '000133333333';

function objekte() {
    const m = new Map();
    for (const [id, o] of Object.entries(BAUM)) {
        if (o.type === 'state' && id.startsWith(`${NS}.`)) {
            m.set(id.slice(NS.length + 1), o);
        }
    }
    return m;
}

function zeilen(k) {
    const aus = {};
    for (const z of Object.values(k.customInfo.schema.items)) {
        if (z.oid) {
            aus[z.oid.replace(`${NS}.${OFEN}.`, '')] = z;
        }
    }
    return aus;
}

/** Wie der Admin den Wert einer Zeile mit options anzeigt (ConfigState, control text). */
function anzeige(z, val) {
    const o = (z.options || []).find(e => String(e.value) === String(val));
    return o ? o.label : val;
}

/** Je Art die Rohwerte samt einer Geraeteart, fuer die sie gelten. */
function alleWerte() {
    const aus = [];
    const gesehen = new Set();
    const art = (a, tabelle, dt) => {
        for (const k of Object.keys(enums.TABLES[tabelle])) {
            const schluessel = enums.TABLES[tabelle][k];
            if (schluessel && !gesehen.has(`${a}|${schluessel}`)) {
                gesehen.add(`${a}|${schluessel}`);
                aus.push({ art: a, dt, code: Number(k), schluessel });
            }
        }
    };
    art('status', 'StateStatus', null);
    art('programType', 'StateProgramType', null);
    art('dryingStep', 'StateDryingStep', null);
    for (const [dt, m] of Object.entries(enums.BY_TYPE)) {
        art('phase', m.phase, Number(dt));
    }
    return aus;
}

describe('Sprachen: Karten, Datenpunkte und Werte', () => {
    it('Sprachprüfung: Kartentexte, Datenpunktnamen, Beschreibungen und Wertetabellen ohne Fund', () => {
        const funde = [];
        for (const [k, v] of Object.entries(gm.TEXTE)) {
            funde.push(...pruefe('TEXTE', k, v));
        }
        for (const f of objdef.IDENT_FIELDS) {
            funde.push(...pruefe(`info.${f.sub}`, f.sub, objdef.nameFor('info', f.sub, f.name, true)));
        }
        for (const def of Object.values(objdef.STATE_FIELDS)) {
            for (const s of def.states) {
                funde.push(...pruefe(`state.${s.sub}`, s.sub, objdef.nameFor('state', s.sub, s.name, true)));
            }
        }
        for (const c of [...objdef.CONTROL_STATES, ...objdef.ANGEBOT_STATES]) {
            funde.push(...pruefe(`control.${c.sub}`, c.sub, objdef.nameFor('control', c.sub, c.name, true)));
        }
        for (const id of [
            'control.canPowerOn',
            'control.canPowerOff',
            'control.canStart',
            'control.canPause',
            'control.canStop',
            'state.progress',
        ]) {
            funde.push(...pruefe(`desc.${id}`, id, namen.beschreibung(id, true)));
        }
        for (const w of alleWerte()) {
            if (werte.NICHTS.has(w.schluessel)) {
                continue;
            }
            const o = {};
            for (const sp of SPRACHEN) {
                o[sp] = werte.wertText(w.art, sp, w.dt, w.code);
            }
            funde.push(...pruefe(`wert.${w.art}`, w.schluessel, o));
        }
        expect(funde, funde.join('\n')).to.deep.equal([]);
    });

    it('Deutsch und Englisch auf der Karte = Text im Datenpunkt (germanNames an/aus)', () => {
        const feld = {
            status: 'Status',
            programType: 'ProgramType',
            dryingStep: 'DryingStep',
            phase: 'ProgramPhase',
            program: 'ProgramID',
        };
        const liste = alleWerte();
        for (const [dt, m] of Object.entries(enums.BY_TYPE)) {
            for (const k of Object.keys(enums.TABLES[m.program])) {
                liste.push({ art: 'program', dt: Number(dt), code: Number(k), schluessel: enums.TABLES[m.program][k] });
            }
        }
        for (const w of liste) {
            if (!w.schluessel || werte.NICHTS.has(w.schluessel)) {
                continue;
            }
            for (const [sp, german] of [
                ['de', true],
                ['en', false],
            ]) {
                const paare = objdef.STATE_FIELDS[feld[w.art]].decode(w.code, { deviceType: w.dt, german });
                const text = paare.find(p => p.sub.endsWith('Text')).val;
                expect(werte.wertText(w.art, sp, w.dt, w.code), `${w.art} ${w.code} ${sp}`).to.equal(text);
            }
        }
    });

    it('Programmnamen: Home Assistant, sonst Englisch - nie leer, nie geraten', () => {
        for (const [dt, m] of Object.entries(enums.BY_TYPE)) {
            for (const [k, schluessel] of Object.entries(enums.TABLES[m.program])) {
                if (!schluessel || werte.NICHTS.has(schluessel)) {
                    continue;
                }
                for (const sp of SPRACHEN) {
                    const t = werte.wertText('program', sp, Number(dt), Number(k));
                    expect(t, `${dt}/${k} ${sp}`).to.be.a('string').and.not.equal('');
                    if (sp !== 'de' && sp !== 'en') {
                        const ha = HA[sp].program[schluessel];
                        expect(t).to.equal(ha || werte.wertText('program', 'en', Number(dt), Number(k)));
                    }
                }
            }
        }
        // Beispiel: Baumwolle der Waschmaschine
        expect(werte.wertText('program', 'fr', 1, 1)).to.equal('Coton');
        expect(werte.wertText('program', 'uk', 1, 1)).to.equal('Cottons');
    });

    it('unbekannte Sprache faellt auf Englisch, unbekannter Rohwert auf null', () => {
        expect(werte.sprache('xx')).to.equal('en');
        expect(werte.sprache(undefined)).to.equal('en');
        expect(werte.wertText('status', 'xx', null, 5)).to.equal('In use');
        expect(werte.wertText('program', 'fr', 1, 99999)).to.equal(null);
        expect(werte.wertText('program', 'fr', 999, 1)).to.equal(null);
        expect(werte.wertText('program', 'fr', 1, 0)).to.equal('');
    });

    it('Karte in Systemsprache: Rohwert-Zeilen mit Wertetabelle, Beschriftung bleibt mehrsprachig', () => {
        const k = gm.karte({
            ns: NS,
            id: OFEN,
            obj: BAUM[`${NS}.${OFEN}`],
            objekte: objekte(),
            deviceType: 12,
            steuerung: false,
            sprache: 'fr',
        });
        const z = zeilen(k);
        for (const sub of ['state.status', 'state.programId', 'state.programPhase']) {
            expect(z[sub].noTranslation, sub).to.equal(true);
            expect(z[sub].control).to.equal('text');
            expect(z[sub].options.length, sub).to.be.greaterThan(3);
        }
        expect(anzeige(z['state.status'], 5)).to.equal('En utilisation');
        expect(anzeige(z['state.programPhase'], 3073)).to.equal(werte.wertText('phase', 'fr', 12, 3073));
        expect(anzeige(z['state.programId'], 13)).to.equal(werte.wertText('program', 'fr', 12, 13));
        // unbekannter Rohwert: die Zahl
        expect(anzeige(z['state.programId'], 4711)).to.equal(4711);
        expect(z['state.status'].label.fr).to.be.a('string');
        expect(z['state.programId'].label.de).to.equal('Programm');
        // Deutsch wie bisher
        const de = zeilen(
            gm.karte({
                ns: NS,
                id: OFEN,
                obj: BAUM[`${NS}.${OFEN}`],
                objekte: objekte(),
                deviceType: 12,
                steuerung: false,
                sprache: 'de',
            }),
        );
        expect(anzeige(de['state.status'], 5)).to.equal('In Betrieb');
        // ohne Sprache: Englisch
        const en = zeilen(
            gm.karte({
                ns: NS,
                id: OFEN,
                obj: BAUM[`${NS}.${OFEN}`],
                objekte: objekte(),
                deviceType: 12,
                steuerung: false,
            }),
        );
        expect(anzeige(en['state.status'], 5)).to.equal('In use');
    });

    it('ohne Rohwert-Objekt (ältere Objekte) bleibt die Textzeile', () => {
        const o = objekte();
        o.delete(`${OFEN}.state.status`);
        const z = zeilen(
            gm.karte({
                ns: NS,
                id: OFEN,
                obj: BAUM[`${NS}.${OFEN}`],
                objekte: o,
                deviceType: 12,
                steuerung: false,
                sprache: 'fr',
            }),
        );
        expect(z['state.statusText']).to.be.an('object');
        expect(z['state.statusText'].options).to.equal(undefined);
    });

    it('Aufklappfeld: Programmart über den Rohwert in Systemsprache', () => {
        const d = gm.details(OFEN, objekte(), 'es', 12);
        const typ = Object.values(d.schema.items).find(i => i.oid === `${OFEN}.state.programType`);
        expect(typ, 'programType-Zeile').to.be.an('object');
        expect(anzeige(typ, 2)).to.equal('Programa automático');
        expect(typ.noTranslation).to.equal(true);
    });

    it('Geräte-Manager liest die Systemsprache aus system.config', async () => {
        const adapter = {
            namespace: NS,
            config: { allowControl: false },
            log: { debug() {}, info() {}, warn() {}, error() {} },
            on() {},
            getObjectViewAsync: async (_d, typ) => ({
                rows: Object.entries(BAUM)
                    .filter(([id, o]) => o.type === typ && id.startsWith(`${NS}.`))
                    .map(([id, o]) => ({ id, value: { ...o, _id: id } })),
            }),
            getStateAsync: async id => (id.endsWith('info.deviceType') ? { val: 12 } : null),
            getForeignObjectAsync: async id => (id === 'system.config' ? { common: { language: 'it' } } : null),
        };
        const mgr = new gm.MieleGeraeteManager(adapter);
        expect(await mgr.sprache()).to.equal('it');
        const karten = [];
        await mgr.loadDevices({ addDevice: k => karten.push(k), setTotalDevices() {} });
        const ofen = karten.find(k => k.id === OFEN);
        expect(anzeige(zeilen(ofen)['state.status'], 6)).to.equal('Pausa');
        adapter.getForeignObjectAsync = async () => {
            throw new Error('weg');
        };
        expect(await mgr.sprache()).to.equal('en');
    });

    it('Textdatenpunkte bleiben Deutsch/Englisch - unabhängig von der Systemsprache', () => {
        const de = objdef.STATE_FIELDS.Status.decode(5, { deviceType: 12, german: true });
        const en = objdef.STATE_FIELDS.Status.decode(5, { deviceType: 12, german: false });
        expect(de.find(p => p.sub === 'statusText').val).to.equal('In Betrieb');
        expect(en.find(p => p.sub === 'statusText').val).to.equal('In use');
    });

    it('germanNames aus: Namen und Beschreibungen schlicht Englisch (bewusst, siehe README)', () => {
        expect(objdef.nameFor('control', 'canStart', 'Start possible', false)).to.equal('Start possible');
        expect(namen.beschreibung('control.canStart', false))
            .to.be.a('string')
            .and.match(/^true if/);
        expect(namen.beschreibung('state.progress', true).uk).to.match(/[Ѐ-ӿ]/);
    });
});

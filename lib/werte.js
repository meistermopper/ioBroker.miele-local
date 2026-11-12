'use strict';
/*
 * Klartext der Rohwerte (Status, Programmart, Trockenstufe, Phase, Programm) in jeder der elf
 * ioBroker-Sprachen - fuer die Geraetekarten des Device-Managers.
 *
 * WARUM NICHT DIE TEXT-DATENPUNKTE. state.statusText, programText, programPhaseText,
 * programTypeText und dryingStepText schreibt der Adapter auf Deutsch oder Englisch (Option
 * germanNames). Skripte und VIS vergleichen mit diesen Texten; sie in die Systemsprache zu
 * drehen, wuerde bei jedem Nutzer ausserhalb Deutschlands bestehende Werte aendern. Die Karte
 * zeigt deshalb den ROHWERT (state.status …) und bekommt dazu eine Wertetabelle in der
 * Systemsprache (JSON-Config "options"). Die Datenpunkte bleiben, wie sie sind.
 *
 * QUELLEN, in dieser Reihenfolge:
 *   de  - lib/enums_de.js, genau wie im Datenpunkt
 *   en  - der englische Bezeichner lesbar gemacht, genau wie im Datenpunkt (germanNames aus)
 *   sonst - KORREKTUR (lib/werte_eigen.js), Home Assistant (lib/werte_ha.js), ERGAENZUNG
 *           (lib/werte_eigen.js), zuletzt Englisch
 *
 * PROGRAMMNAMEN kommen nur aus Home Assistant. Fehlt dort eine Uebersetzung (Ukrainisch ganz,
 * Polnisch fast ganz, Russisch und Niederlaendisch teilweise), steht der englische Name da -
 * geraten wird nicht.
 */
const enums = require('./enums');
const objdef = require('./objects');
const namen = require('./names');
const HA = require('./werte_ha');
const { ERGAENZUNG, KORREKTUR } = require('./werte_eigen');

/** Arten und ihre Enum-Tabelle (fest oder je Geraeteart). */
const ARTEN = {
    status: () => 'StateStatus',
    programType: () => 'StateProgramType',
    dryingStep: () => 'StateDryingStep',
    phase: dt => enums.BY_TYPE[dt] && enums.BY_TYPE[dt].phase,
    program: dt => enums.BY_TYPE[dt] && enums.BY_TYPE[dt].program,
};

/** Bezeichner, die "nichts" bedeuten - die Kartenzeile blendet sich dann aus. */
const NICHTS = new Set(['no_program', 'not_running']);

/** Deutsche Texte, wie sie im Datenpunkt stehen. */
const DEUTSCH = {
    status: (dt, v) => objdef.statusTextDe(v),
    programType: (dt, v) => objdef.programTypeTextDe(v),
    dryingStep: (dt, v) => objdef.dryingStepTextDe(v),
    phase: (dt, v) => objdef.phaseTextDe(dt, v),
    program: (dt, v) => objdef.programTextDe(dt, v),
};

/**
 * Sprache auf eine der elf ioBroker-Sprachen abbilden.
 *
 * @param {string|undefined|null} sprache z. B. aus system.config common.language
 * @returns {string} unterstuetzte Sprache, sonst "en"
 */
function sprache(sprache) {
    return namen.SPRACHEN.includes(sprache) ? sprache : 'en';
}

/**
 * Uebersetzung eines englischen Bezeichners in eine der weiteren neun Sprachen.
 *
 * @param {string} art status | programType | dryingStep | phase | program
 * @param {string} sp Sprache (nicht de/en)
 * @param {string} schluessel englischer Bezeichner aus lib/enums.js
 * @returns {string|null} Text oder null
 */
function fremd(art, sp, schluessel) {
    const aus = q => (q && q[sp] && q[sp][art] && q[sp][art][schluessel]) || null;
    if (art === 'program') {
        return aus(HA);
    }
    return aus(KORREKTUR) || aus(HA) || aus(ERGAENZUNG);
}

/**
 * Klartext eines Rohwerts in einer Sprache.
 *
 * @param {string} art status | programType | dryingStep | phase | program
 * @param {string} sp Sprache
 * @param {number|null} deviceType Miele-Geraeteart (fuer Phase und Programm)
 * @param {number} code Rohwert
 * @returns {string|null} Text; '' fuer "kein Programm"/"laeuft nicht"; null, wenn unbekannt
 */
function wertText(art, sp, deviceType, code) {
    const tabelle = ARTEN[art] && ARTEN[art](deviceType);
    const schluessel = tabelle ? enums.lookup(tabelle, code) : null;
    if (!schluessel) {
        return null;
    }
    if (NICHTS.has(schluessel)) {
        return '';
    }
    sp = sprache(sp);
    if (sp === 'de') {
        const t = DEUTSCH[art](deviceType, code);
        return t == null ? objdef.lesbar(schluessel) : t;
    }
    if (sp !== 'en') {
        const t = fremd(art, sp, schluessel);
        if (t) {
            return t;
        }
    }
    return objdef.lesbar(schluessel);
}

/**
 * Wertetabelle fuer eine Kartenzeile: alle Rohwerte der Art mit ihrem Text.
 *
 * @param {string} art status | programType | dryingStep | phase | program
 * @param {string} sp Sprache
 * @param {number|null} deviceType Miele-Geraeteart
 * @returns {{options: {value: number, label: string}[], leer: number[]}|null} Tabelle und die
 *   Rohwerte ohne Text (Zeile ausblenden); null, wenn die Geraeteart keine Tabelle hat
 */
function werteTabelle(art, sp, deviceType) {
    const tabelle = ARTEN[art] && ARTEN[art](deviceType);
    if (!tabelle || !enums.TABLES[tabelle]) {
        return null;
    }
    const options = [];
    const leer = [];
    for (const k of Object.keys(enums.TABLES[tabelle])) {
        const code = Number(k);
        const t = wertText(art, sp, deviceType, code);
        if (t === '' || t == null) {
            leer.push(code);
            continue;
        }
        options.push({ value: code, label: t });
    }
    return { options, leer };
}

module.exports = { wertText, werteTabelle, sprache, ARTEN, NICHTS };

'use strict';
/*
 * Erzeugt lib/werte_ha.js aus den Uebersetzungen der Miele-Integration von Home Assistant.
 *
 * WOHER. Die Tabellen in lib/enums.js stammen aus Home Assistant (siehe dort). Home Assistant
 * uebersetzt genau diese Bezeichner (status, program_id, program_phase, program_type,
 * drying_step) in seiner Community-Uebersetzung (Lokalise). Die fertigen Sprachdateien liegen
 * im Python-Paket "homeassistant" unter homeassistant/components/miele/translations/*.json -
 * im Quell-Repository selbst stehen sie nicht.
 *
 * AUFRUF (Beispiel):
 *   pip download homeassistant --no-deps -d /tmp/ha && unzip -q /tmp/ha/*.whl \
 *       'homeassistant/components/miele/translations/*' -d /tmp/ha/x
 *   node tools/werte-uebersetzungen.js /tmp/ha/x/homeassistant/components/miele/translations 2026.11.1
 *   npx prettier --write lib/werte_ha.js
 *
 * Uebernommen wird nur, was der Adapter auch kennt; Englisch und Deutsch bleiben bei den eigenen
 * Tabellen (lib/enums.js, lib/enums_de.js), damit Karte und Datenpunkte dieselben Texte zeigen.
 */
const fs = require('node:fs');
const path = require('node:path');
const enums = require('../lib/enums');

const [ordner, version] = process.argv.slice(2);
if (!ordner || !version) {
    console.error('Aufruf: node tools/werte-uebersetzungen.js <translations-Ordner> <HA-Version>');
    process.exit(1);
}

/** ioBroker-Sprache -> Dateiname bei Home Assistant */
const DATEIEN = { ru: 'ru', pt: 'pt', nl: 'nl', fr: 'fr', it: 'it', es: 'es', pl: 'pl', uk: 'uk', 'zh-cn': 'zh-Hans' };

const werte = tabellen => {
    const s = new Set();
    for (const [name, t] of Object.entries(enums.TABLES)) {
        if (tabellen(name)) {
            Object.values(t).forEach(v => s.add(v));
        }
    }
    return s;
};
/** Art im Adapter -> [Schluessel bei Home Assistant, benutzte Bezeichner] */
const ARTEN = {
    status: ['status', werte(n => n === 'StateStatus')],
    programType: ['program_type', werte(n => n === 'StateProgramType')],
    dryingStep: ['drying_step', werte(n => n === 'StateDryingStep')],
    phase: ['program_phase', werte(n => /^ProgramPhase/.test(n))],
    program: ['program_id', werte(n => /ProgramId$/.test(n))],
};

const aus = {};
for (const [sp, datei] of Object.entries(DATEIEN)) {
    const pfad = path.join(ordner, `${datei}.json`);
    const sensor = fs.existsSync(pfad) ? (JSON.parse(fs.readFileSync(pfad, 'utf8')).entity || {}).sensor || {} : {};
    aus[sp] = {};
    for (const [art, [haName, benutzt]] of Object.entries(ARTEN)) {
        const st = (sensor[haName] && sensor[haName].state) || {};
        const t = {};
        for (const k of [...benutzt].sort()) {
            const v = st[k];
            if (typeof v === 'string' && v.trim() && !v.includes('[%key')) {
                t[k] = v.trim();
            }
        }
        aus[sp][art] = t;
    }
}

const kopf = `'use strict';
/*
 * AUTOMATISCH ERZEUGT von tools/werte-uebersetzungen.js - nicht von Hand bearbeiten.
 *
 * Uebersetzungen der Miele-Bezeichner (Status, Programmart, Trockenstufe, Phase, Programm) aus
 * Home Assistant ${version}, homeassistant/components/miele/translations/*.json
 * (https://github.com/home-assistant/core, Apache License 2.0, (c) Home Assistant Authors;
 * Community-Uebersetzung ueber Lokalise). Schluessel = englischer Bezeichner aus lib/enums.js.
 * Fehlt eine Sprache oder ein Eintrag, ergaenzt lib/werte_eigen.js (ausser Programmnamen) -
 * siehe lib/werte.js.
 */
module.exports = `;
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'werte_ha.js'), `${kopf}${JSON.stringify(aus, null, 4)};\n`);
for (const [sp, t] of Object.entries(aus)) {
    console.log(
        sp,
        Object.entries(t)
            .map(([a, v]) => `${a}:${Object.keys(v).length}`)
            .join(' '),
    );
}

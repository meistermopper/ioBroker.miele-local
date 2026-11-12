'use strict';
/*
 * Sprachpruefung fuer Texte in allen elf ioBroker-Sprachen (Hilfsmodul fuer test/sprachen.js).
 *
 * Geprueft wird je Text: alle Sprachen vorhanden und nicht leer, Russisch/Ukrainisch mit
 * kyrillischen, Chinesisch mit chinesischen Zeichen, keine Sprache woertlich gleich Englisch
 * (bzw. Deutsch gleich Englisch), Ukrainisch nicht gleich Russisch, Portugiesisch nicht gleich
 * Spanisch, Platzhalter wie {name} in jeder Sprache dieselben.
 *
 * Die Gleichheits-Regeln sind Faustregeln: "Pause" ist Deutsch und Franzoesisch, "Temperatura"
 * Portugiesisch und Spanisch. Solche Treffer sind von Hand geprueft und stehen in ERLAUBT -
 * jeder neue Treffer muss ebenso geprueft und eingetragen oder uebersetzt werden.
 */
const SPRACHEN = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];

/** Geprueft gleichlautend: "<Quelle>|<Schluessel>|<Sprache>". */
const ERLAUBT = new Set([
    // Kartentexte: gleiches Wort in der jeweiligen Sprache
    'TEXTE|start|de',
    'TEXTE|start|nl',
    'TEXTE|start|pl',
    'TEXTE|pause|de',
    'TEXTE|pause|fr',
    'TEXTE|stop|nl',
    'TEXTE|stop|pl',
    'TEXTE|program|fr',
    'TEXTE|phase|de',
    'TEXTE|phase|fr',
    // Datenpunktnamen
    'state.statusText|statusText|de',
    'state.statusText|statusText|nl',
    'state.statusText|statusText|pl',
    'control.canPause|canPause|fr',
    'info.matNumber|matNumber|pt',
    'state.status|status|pt',
    'state.programType|programType|pt',
    'state.programTypeText|programTypeText|pt',
    'state.temperature|temperature|pt',
    'state.temperature|temperature|uk',
    'state.temperatureZone2|temperatureZone2|pt',
    'state.temperatureZone2|temperatureZone2|uk',
    'state.temperatureZone3|temperatureZone3|pt',
    'state.temperatureZone3|temperatureZone3|uk',
    'state.standbyState|standbyState|pt',
    'state.internalState|internalState|pt',
    'control.start|start|pt',
    'control.pause|pause|pt',
    // Werte: Status
    'wert.status|reserved|pt',
    'wert.status|programmed|pt',
    'wert.status|pause|de',
    'wert.status|service|de',
    'wert.status|service|fr',
    'wert.status|default|uk',
    'wert.status|locked|pt',
    // Werte: Programmart und Trockenstufe
    'wert.programType|automatic_program|pt',
    'wert.dryingStep|extra_dry|pt',
    'wert.dryingStep|normal_plus|de',
    'wert.dryingStep|normal_plus|fr',
    'wert.dryingStep|normal_plus|es',
    'wert.dryingStep|normal_plus|uk',
    'wert.dryingStep|normal|de',
    'wert.dryingStep|normal|pt',
    'wert.dryingStep|normal|fr',
    'wert.dryingStep|normal|es',
    'wert.dryingStep|normal|uk',
    // Werte: Phasen
    'wert.phase|finished|uk',
    'wert.phase|hygiene|de',
    'wert.phase|normal|de',
    'wert.phase|normal|pt',
    'wert.phase|normal|fr',
    'wert.phase|normal|es',
    'wert.phase|normal|uk',
    'wert.phase|normal_plus|de',
    'wert.phase|normal_plus|fr',
    'wert.phase|normal_plus|es',
    'wert.phase|normal_plus|uk',
    'wert.phase|extra_dry|pt',
    'wert.phase|moisten|pt',
    'wert.phase|espresso|de',
    'wert.phase|espresso|fr',
]);

const KYRILLISCH = /[Ѐ-ӿ]/;
const CHINESISCH = /[一-鿿]/;

/**
 * Einen Text pruefen.
 *
 * @param {string} quelle z. B. "TEXTE" oder "wert.status"
 * @param {string} schluessel Schluessel innerhalb der Quelle
 * @param {string|Record<string, string>} obj Text je Sprache
 * @returns {string[]} Funde, leer wenn in Ordnung
 */
function pruefe(quelle, schluessel, obj) {
    const funde = [];
    const fund = (sp, was, wert) => {
        if (!ERLAUBT.has(`${quelle}|${schluessel}|${sp}`)) {
            funde.push(`${quelle} | ${schluessel} | ${sp} | ${was} | ${wert}`);
        }
    };
    if (!obj || typeof obj !== 'object') {
        return [`${quelle} | ${schluessel} | - | kein Sprachobjekt | ${obj}`];
    }
    const platzhalter = s => (String(s).match(/\{[a-zA-Z]+\}|%[sd]/g) || []).sort().join();
    for (const sp of SPRACHEN) {
        const v = obj[sp];
        if (v === undefined || v === null || v === '') {
            funde.push(`${quelle} | ${schluessel} | ${sp} | fehlt | `);
            continue;
        }
        if (sp !== 'en' && sp !== 'de' && obj.en && v === obj.en && /[A-Za-z]{4,}/.test(v)) {
            fund(sp, 'unuebersetzt (=en)', v);
        }
        if (sp === 'de' && obj.en && v === obj.en && /[A-Za-z]{5,}/.test(v)) {
            fund(sp, 'de=en?', v);
        }
        if ((sp === 'ru' || sp === 'uk') && !KYRILLISCH.test(v)) {
            funde.push(`${quelle} | ${schluessel} | ${sp} | keine kyrill. Zeichen | ${v}`);
        }
        if (sp === 'zh-cn' && !CHINESISCH.test(v)) {
            funde.push(`${quelle} | ${schluessel} | ${sp} | keine CJK-Zeichen | ${v}`);
        }
        if (sp === 'uk' && obj.ru && v === obj.ru && v.length > 6) {
            fund(sp, 'uk=ru', v);
        }
        if (sp === 'pt' && obj.es && v === obj.es && v.length > 8) {
            fund(sp, 'pt=es (pruefen)', v);
        }
        if (obj.en && platzhalter(v) !== platzhalter(obj.en)) {
            funde.push(`${quelle} | ${schluessel} | ${sp} | Platzhalter abweichend | ${v}`);
        }
    }
    for (const sp of Object.keys(obj)) {
        if (!SPRACHEN.includes(sp)) {
            funde.push(`${quelle} | ${schluessel} | ${sp} | unbekannte Sprache | `);
        }
    }
    return funde;
}

module.exports = { SPRACHEN, ERLAUBT, pruefe };

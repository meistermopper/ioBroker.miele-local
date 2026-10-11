'use strict';

const { isDeepStrictEqual } = require('node:util');

/**
 * Ob ein vorhandenes Objekt nachgezogen werden muss.
 *
 * Ein extendObject auf ein unveraendertes Objekt ist nicht harmlos: Jeder Schreibvorgang loest
 * beim history-Adapter ein objectChange aus. Hat er den Datenpunkt nur ueber storeState in seiner
 * Liste (ohne common.custom), sieht er darin ein Objekt ohne History-Einstellung, meldet
 * "disabled logging" und setzt einen Leerpunkt (null) als Lueckenmarke. Am 25./27.09.2026 stand
 * so nach jedem Adapterneustart eine Luecke im Verlauf der Waschmaschine.
 *
 * Verglichen werden nur die Felder, die der Adapter selbst setzt - was andere (custom, Aliase,
 * Raumzuordnung) dazugeschrieben haben, zaehlt nicht als Abweichung.
 *
 * @param {object|null|undefined} vorhanden Das Objekt aus der Datenbank (oder nichts)
 * @param {{type?: string, common?: object, native?: object}} soll Was der Adapter schreiben wuerde
 * @returns {boolean} true, wenn das Objekt fehlt oder ein gesetztes Feld abweicht
 */
function mussNachziehen(vorhanden, soll) {
    if (!vorhanden) {
        return true;
    }
    if (soll.type && vorhanden.type !== soll.type) {
        return true;
    }
    const ist = vorhanden.common || {};
    for (const [schluessel, wert] of Object.entries(soll.common || {})) {
        // undefined heisst "nicht setzen" - extendObject ueberginge es ebenso.
        if (wert === undefined) {
            continue;
        }
        if (!isDeepStrictEqual(ist[schluessel], wert)) {
            return true;
        }
    }
    return false;
}

module.exports = { mussNachziehen };

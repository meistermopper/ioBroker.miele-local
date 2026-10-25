'use strict';

/*
 * Geraeteuhr auf Ortszeit halten (Einstellung keepDeviceClock).
 *
 * WARUM. Manche Geraete fuehren unter /Devices/<route>/Settings/TimeSync/ eine Ortszeit
 * (DateTime [Tag, Monat, Jahr, Stunde, Minute, Sekunde]), die sie aus der UTC-Zeit und einer
 * eigenen Sommerzeitregel bilden. Am 25.10.2026 - dem Tag der Rueckstellung auf Winterzeit -
 * zeigte ein Backofen H2469BP noch Sommerzeit (eine Stunde vor), obwohl seine UTC-Zeit stimmte.
 * Ein signierter PUT mit {"DateTime":[...]} stellt die Ortszeit; danach war auch die UTC-Zeit
 * des Moduls (Date-Header) weiter richtig.
 *
 * Andere Geraete (G5840, WCR860) antworten auf TimeSync mit 503 - die laesst der Adapter aus.
 *
 * Die Abweichung wird als Differenz der WANDUHR-Zeiten gerechnet: Geraete-DateTime und die
 * Ortszeit von ioBroker werden beide als "Uhrzeit ohne Zone" verglichen. So spielt es keine
 * Rolle, welchen Versatz das Geraet intern annimmt.
 */

/** Ab dieser Abweichung (Sekunden) wird gestellt. */
const GRENZE_S = 120;

/**
 * Die Zeitzone, in der ioBroker laeuft (Prozess-Zeitzone), oder die angegebene.
 *
 * @param {string} [zone] gewuenschte Zone, sonst die des Prozesses
 * @returns {string} IANA-Name der Zeitzone
 */
function zeitzone(zone) {
    if (zone) {
        return zone;
    }
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

/**
 * Ortszeit als DateTime-Feld des Geraets: [Tag, Monat, Jahr, Stunde, Minute, Sekunde].
 *
 * @param {Date|number} zeitpunkt Zeitpunkt (Date oder ms)
 * @param {string} [zone] Zeitzone, Standard: die des Prozesses
 * @returns {number[]} sechs Zahlen
 */
function ortszeitFeld(zeitpunkt, zone) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: zeitzone(zone),
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hourCycle: 'h23',
    });
    const t = {};
    for (const p of fmt.formatToParts(new Date(zeitpunkt))) {
        t[p.type] = Number(p.value);
    }
    return [t.day, t.month, t.year, t.hour, t.minute, t.second];
}

/**
 * Prueft, ob ein Wert wie ein DateTime-Feld des Geraets aussieht.
 *
 * @param {unknown} feld Wert aus der TimeSync-Antwort
 * @returns {boolean} true bei sechs plausiblen Zahlen
 */
function istDateTime(feld) {
    if (!Array.isArray(feld) || feld.length !== 6 || !feld.every(n => Number.isInteger(n))) {
        return false;
    }
    const [d, mo, y, h, mi, s] = feld;
    return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2200 && h <= 23 && mi <= 59 && s <= 60;
}

/**
 * Wanduhr-Sekunden eines DateTime-Feldes (als ob es UTC waere) - nur fuer Differenzen.
 *
 * @param {number[]} feld [Tag, Monat, Jahr, Stunde, Minute, Sekunde]
 * @returns {number} Sekunden
 */
function wanduhrSekunden(feld) {
    const [d, mo, y, h, mi, s] = feld;
    return Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
}

/**
 * Abweichung der Geraeteuhr von der Ortszeit in Sekunden (positiv = Geraet geht vor).
 *
 * @param {object} timeSync Antwort von Settings/TimeSync
 * @param {Date|number} jetzt Zeitpunkt der Antwort
 * @param {string} [zone] Zeitzone
 * @returns {number|null} Sekunden oder null, wenn kein DateTime lesbar ist
 */
function abweichung(timeSync, jetzt, zone) {
    if (!timeSync || !istDateTime(timeSync.DateTime)) {
        return null;
    }
    return wanduhrSekunden(timeSync.DateTime) - wanduhrSekunden(ortszeitFeld(jetzt, zone));
}

/**
 * Entscheidet, ob gestellt werden muss.
 *
 * @param {object} timeSync Antwort von Settings/TimeSync
 * @param {Date|number} jetzt Zeitpunkt der Antwort
 * @param {string} [zone] Zeitzone
 * @param {number} [grenzeS] Grenze in Sekunden
 * @returns {{abweichungS: number|null, setzen: boolean}} Ergebnis
 */
function pruefen(timeSync, jetzt, zone, grenzeS = GRENZE_S) {
    const abw = abweichung(timeSync, jetzt, zone);
    return { abweichungS: abw, setzen: abw !== null && Math.abs(abw) > grenzeS };
}

/**
 * Der Rumpf fuer den PUT: nur DateTime. NTPEnabled, UTCOffset und TimeMaster bleiben unberuehrt.
 *
 * @param {Date|number} jetzt Zeitpunkt
 * @param {string} [zone] Zeitzone
 * @returns {string} JSON
 */
function stellRumpf(jetzt, zone) {
    return JSON.stringify({ DateTime: ortszeitFeld(jetzt, zone) });
}

module.exports = { GRENZE_S, zeitzone, ortszeitFeld, istDateTime, abweichung, pruefen, stellRumpf };

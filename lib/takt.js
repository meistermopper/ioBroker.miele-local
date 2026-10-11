'use strict';

/*
 * Abfragetakt je Geraet (seit 0.3.46).
 *
 * Bis 0.3.45 galt der kurze Takt fuer ALLE Geraete, sobald eines lief: Backte der Ofen, wurden
 * Wasch- und Spuelmaschine im Minutentakt mitgefragt, obwohl sie aus waren. Ein XKM-Modul bedient
 * nur eine Verbindung gleichzeitig - jede ueberfluessige Frage nimmt der Miele-App einen
 * Zeitschlitz weg. Jetzt hat jedes Geraet seinen eigenen Termin: kurz, solange es laeuft, sonst
 * der Ruhetakt. Die Schleife wacht zum fruehesten Termin auf und fragt nur, wer dran ist.
 */

/** Kein Wecken in kuerzeren Abstaenden als diesem - auch wenn mehrere Termine dicht liegen. */
const MIN_WECKABSTAND_MS = 1000;

/**
 * Abstand bis zur naechsten Abfrage eines Geraets.
 *
 * @param {{active?: boolean}} dev Geraeteeintrag
 * @param {number} aktivMs Takt im Betrieb
 * @param {number} ruheMs Takt in Ruhe
 * @returns {number} Millisekunden
 */
function abstand(dev, aktivMs, ruheMs) {
    return dev && dev.active ? aktivMs : ruheMs;
}

/**
 * Ist dieses Geraet jetzt dran? Ein Geraet ohne Termin (gerade gefunden) ist sofort dran.
 *
 * @param {{naechsteAbfrage?: number}} dev Geraeteeintrag
 * @param {number} jetzt Zeitpunkt in ms
 * @returns {boolean} true, wenn es jetzt abgefragt werden soll
 */
function istFaellig(dev, jetzt) {
    return (dev.naechsteAbfrage || 0) <= jetzt;
}

/**
 * Wann die Schleife wieder aufwachen soll: zum fruehesten Termin aller Geraete.
 *
 * @param {Array<{naechsteAbfrage?: number}>} geraete alle Geraeteeintraege
 * @param {number} jetzt Zeitpunkt in ms
 * @param {number} ruheMs Abstand, wenn (noch) kein Geraet bekannt ist
 * @returns {number} Millisekunden bis zum naechsten Durchgang
 */
function weckAbstand(geraete, jetzt, ruheMs) {
    if (!geraete.length) {
        return ruheMs;
    }
    const fruehester = Math.min(...geraete.map(d => d.naechsteAbfrage || 0));
    return Math.max(MIN_WECKABSTAND_MS, fruehester - jetzt);
}

module.exports = { abstand, istFaellig, weckAbstand, MIN_WECKABSTAND_MS };

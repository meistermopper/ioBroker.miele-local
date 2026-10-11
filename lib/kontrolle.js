'use strict';

/*
 * Laufende Kontrolle der EINGESTELLTEN Feldzuordnung.
 *
 * WOZU - UND WORIN SIE SICH VON DER FELDSUCHE UNTERSCHEIDET
 * lib/feldsuche.js fragt "welches Feld traegt die Groesse?" und durchsucht dafuer alle
 * Felder. Dieser Modul fragt etwas Engeres, dafuer Dauerhaftes: "liefert das Feld, das
 * gerade eingestellt ist, weiterhin richtige Werte?" - Zyklus fuer Zyklus, mit Verlauf.
 *
 * Das ist noetig, weil eine einmal belegte Zuordnung nicht fuer immer gilt. Am 04.09.2026
 * wurde Feld 21 als Wasserzaehler nachgewiesen (0,49 % mittlere Abweichung ueber acht
 * Zyklen). Ein Firmware-Update kann die Feldreihenfolge verschieben, ohne dass es jemand
 * ankuendigt - und dann stimmen die Zahlen weiter plausibel, nur eben nicht mehr.
 *
 * SOLANGE DIE CLOUD LAEUFT, IST SIE DER MASSSTAB. Faellt sie weg, bleibt die Ablesung aus
 * der Miele-App; die Kontrolle rechnet mit beidem und schreibt dazu, woher der
 * Vergleichswert kam.
 */

/** Ab welcher Abweichung ein einzelner Zyklus als Ausreisser gilt. */
const AUSREISSER = 0.1;

/**
 * Ab wie vielen Ausreissern in Folge gemeldet wird.
 *
 * Nicht beim ersten: Die Cloud rundet auf ganze Liter, und zwischen dem lokalen Abruf und
 * dem Cloud-Stand liegen Minuten. Ein einzelner Ausschlag ist Rauschen. Drei hintereinander
 * sind es nicht mehr - dann hat sich etwas geaendert.
 */
const AUSREISSER_BIS_MELDUNG = 3;

/** So viele Vergleiche werden aufgehoben - der Datenpunkt soll lesbar bleiben. */
const MAX_VERLAUF = 40;

/**
 * Zahl aus einem Wert machen; alles Unbrauchbare wird null.
 *
 * @param v beliebiger Wert
 */
function alsZahl(v) {
    if (v == null) {
        return null;
    }
    if (typeof v === 'bigint') {
        return Number(v);
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Einen Vergleich bilden.
 *
 * @param {object} q
 *   lokal    {energyKwh, waterL}  was der Adapter aus dem Leaf gelesen hat
 *   cloud    {energyKwh, waterL}  oder null
 *   manuell  {energyKwh, waterL}  oder null - Ablesung aus der Miele-App
 *   unvollstaendig {waterL?, energyKwh?}  je Groesse ein Grundtext, wenn die lokale Ablesung
 *                  den Schluss nicht mehr erwischt hat - solche Werte zaehlen als Luecke
 *   programm Text, nur zur Einordnung im Verlauf
 *   zeit     Zeitstempel in ms (von aussen, damit der Modul pruefbar bleibt)
 * @returns {object|null} Vergleich, oder null wenn nichts zu vergleichen war
 */
function vergleichen(q) {
    const eintrag = { zeit: q.zeit, programm: q.programm || null, werte: {} };
    let etwas = false;
    for (const groesse of ['waterL', 'energyKwh']) {
        const lokal = alsZahl(q.lokal && q.lokal[groesse]);
        let soll = null,
            quelle = null;
        for (const [name, topf] of [
            ['cloud', q.cloud],
            ['manuell', q.manuell],
        ]) {
            const w = alsZahl(topf && topf[groesse]);
            if (w != null && w > 0) {
                soll = w;
                quelle = name;
                break;
            }
        }
        /*
         * Eine Null heisst "nichts geliefert", nicht "null Liter".
         *
         * Am 04.09.2026 nachgezaehlt: Die Eco-Felder stehen in sieben von elf Zyklen auf 0,
         * weil die Maschine sie zurueckstellt, bevor der Abruf sie erwischt. Solche Zyklen
         * gehoeren in die Zaehlung der Luecken, nicht in die der Abweichungen.
         */
        if (soll == null) {
            continue;
        }
        if (lokal == null || lokal === 0) {
            eintrag.werte[groesse] = { lokal, soll, quelle, fehlt: true };
            etwas = true;
            continue;
        }
        /*
         * Ein Zwischenstand ist keine Abweichung.
         *
         * Hat die letzte Ablesung das Programmende nicht mehr erwischt, steht dort ein
         * richtiger Wert zur falschen Zeit - siehe lib/eco.js, ablesungBewerten. Ihn gegen
         * den Endwert zu rechnen erzeugt eine Abweichung, die nichts ueber das Feld sagt: Am
         * 10.09.2026 ergaben 20,77 gegen 31 Liter 33 Prozent, und das eingestellte Feld sah
         * dadurch fehlerhaft aus, obwohl es seit zwoelf Zyklen auf unter zwei Prozent genau
         * lief.
         *
         * Er wird deshalb dorthin gebucht, wo er hingehoert: zu den Luecken. Der Wert bleibt
         * sichtbar, samt Grund - verschwiegen wird nichts, nur nicht mehr falsch verrechnet.
         */
        if (q.unvollstaendig && q.unvollstaendig[groesse]) {
            eintrag.werte[groesse] = { lokal, soll, quelle, fehlt: true, grund: q.unvollstaendig[groesse] };
            etwas = true;
            continue;
        }
        eintrag.werte[groesse] = {
            lokal,
            soll,
            quelle,
            abweichung: Math.round((Math.abs(lokal - soll) / soll) * 10000) / 10000,
        };
        etwas = true;
    }
    return etwas ? eintrag : null;
}

/**
 * Einen Vergleich in den Verlauf aufnehmen.
 *
 * @param bisher bisheriger Verlauf
 * @param eintrag neuer Vergleich, null wird uebergangen
 */
function aufnehmen(bisher, eintrag) {
    const liste = Array.isArray(bisher) ? bisher.slice() : [];
    if (eintrag) {
        liste.push(eintrag);
    }
    return liste.slice(-MAX_VERLAUF);
}

/** Anzeigenamen der Vergleichsquellen - die Kennungen selbst bleiben (cloud, manuell). */
const QUELLE_TEXT = { cloud: 'cloud', manuell: 'manual input' };

/**
 * Wie steht es um eine Groesse - im Klartext.
 *
 * Getrennt nach drei Zahlen, weil sie Verschiedenes bedeuten: wie GENAU die Werte sind
 * (mittlere Abweichung), wie ZUVERLAESSIG sie kommen (Luecken), und ob es gerade
 * WEGLAEUFT (Ausreisser in Folge). Ein Feld kann genau und trotzdem unbrauchbar sein, wenn
 * es die Haelfte der Zyklen ueberspringt.
 *
 * @param verlauf Verlauf der Vergleiche
 * @param groesse Vergleichsgroesse, "energyKwh" oder "waterL"
 */
function stand(verlauf, groesse) {
    const liste = (Array.isArray(verlauf) ? verlauf : []).map(e => e.werte && e.werte[groesse]).filter(Boolean);
    if (!liste.length) {
        return { zyklen: 0, text: 'no comparison yet' };
    }

    const mitWert = liste.filter(w => !w.fehlt && w.abweichung != null);
    const luecken = liste.length - mitWert.length;
    if (!mitWert.length) {
        return {
            zyklen: 0,
            luecken,
            text: `not a single value in ${liste.length} cycles - ` + 'the field delivers nothing',
        };
    }
    const mittel = mitWert.reduce((a, w) => a + w.abweichung, 0) / mitWert.length;
    const groesste = Math.max(...mitWert.map(w => w.abweichung));

    // Ausreisser am Ende der Reihe - nur die zaehlen, alte sind Geschichte.
    let inFolge = 0;
    for (let i = mitWert.length - 1; i >= 0; i--) {
        if (mitWert[i].abweichung > AUSREISSER) {
            inFolge++;
        } else {
            break;
        }
    }
    const quellen = [...new Set(mitWert.map(w => QUELLE_TEXT[w.quelle] || w.quelle))].join(' and ');
    let text =
        `${mitWert.length} comparisons against ${quellen}: on average ` +
        `${(mittel * 100).toFixed(1)} % deviation, largest ${(groesste * 100).toFixed(1)} %`;
    if (luecken) {
        text += `; ${luecken} cycles without a local value`;
    }
    if (inFolge >= AUSREISSER_BIS_MELDUNG) {
        text +=
            `. WARNING: the last ${inFolge} cycles were above ` +
            `${AUSREISSER * 100} % - the field mapping may no longer be correct`;
    }
    return {
        zyklen: mitWert.length,
        luecken,
        mittel,
        groesste,
        inFolge,
        warnt: inFolge >= AUSREISSER_BIS_MELDUNG,
        text,
    };
}

/**
 * Beide Groessen in einem Satz - fuer den Datenpunkt, den ein Mensch liest.
 *
 * @param verlauf Verlauf der Vergleiche
 */
function bericht(verlauf) {
    const teile = [];
    for (const [groesse, beschriftung] of [
        ['waterL', 'Water'],
        ['energyKwh', 'Energy'],
    ]) {
        const s = stand(verlauf, groesse);
        if (s.zyklen || s.luecken) {
            teile.push(`${beschriftung}: ${s.text}.`);
        }
    }
    return teile.length ? teile.join(' ') : 'no comparisons recorded yet.';
}

module.exports = { AUSREISSER, AUSREISSER_BIS_MELDUNG, MAX_VERLAUF, alsZahl, vergleichen, aufnehmen, stand, bericht };

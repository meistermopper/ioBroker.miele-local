'use strict';

/*
 * Wann lohnt sich eine EcoFeedback-Abfrage?
 *
 * Das DOP2-Leaf 2/6195 antwortet nur, solange das Geraet wach ist. Eine ausgeschaltete
 * Maschine meldet HTTP 500 - keine Aussage ueber das Modell, nur ueber den Augenblick.
 * Belegt an der Waschmaschine: Ihr letzter Wert kam am 23.08.2026 um 11:24, mitten im
 * Programm. Danach stand sie still, und jede weitere Anfrage ging ins Leere - eine pro
 * Minute, ueber Tage. Jede belegt das XKM-Modul, das ohnehin nur eine gleichzeitig
 * beantwortet.
 *
 * Gefragt wird deshalb nur noch:
 *   - waehrend ein Programm laeuft,
 *   - im Nachlauf danach, weil der Schlussstand erst nach dem Statuswechsel feststeht,
 *   - einmal beim Start, damit ueberhaupt erkennbar ist, ob ein Modell den Leaf kennt.
 */

/** Wie lange nach dem Programmende weiter gefragt wird. */
const NACHLAUF_MS = 10 * 60 * 1000;

/** Wie oft derselbe Wert kommen muss, damit der Nachlauf vorzeitig endet. */
const STABIL_MAX = 2;

/**
 * @param {boolean} erkundet  Wurde dieses Geraet seit dem Adapterstart schon einmal gefragt?
 * @param {{ecoLaeuft?: boolean, ecoNachlaufBis?: number}} dev  Zustand des Geraets
 * @param {number} [jetzt]  Zeitpunkt, standardmaessig die aktuelle Zeit
 */
function abfragenSinnvoll(erkundet, dev, jetzt = Date.now()) {
    if (!erkundet) {
        return true;
    }
    if (!dev) {
        return false;
    }
    if (dev.ecoLaeuft) {
        return true;
    }
    return !!(dev.ecoNachlaufBis && jetzt < dev.ecoNachlaufBis);
}

/**
 * Nachlauf fortschreiben: Aendert sich der Wert nicht mehr, steht der Schlussstand fest.
 *
 * Gibt den neuen Zustand zurueck, statt das Geraeteobjekt zu veraendern - so laesst sich die
 * Regel pruefen, ohne einen Adapter zu bauen.
 *
 * @param dev bisheriger Eco-Zustand des Geraets
 * @param wert zuletzt gelesener Eco-Wert
 */
function nachlaufFortschreiben(dev, wert) {
    if (dev.ecoLaeuft || !dev.ecoNachlaufBis) {
        return { ecoLetzter: wert, ecoStabil: 0, ecoNachlaufBis: dev.ecoNachlaufBis || 0 };
    }
    const stabil = wert === dev.ecoLetzter ? (dev.ecoStabil || 0) + 1 : 0;
    return {
        ecoLetzter: wert,
        ecoStabil: stabil,
        ecoNachlaufBis: stabil >= STABIL_MAX ? 0 : dev.ecoNachlaufBis,
    };
}

/**
 * Ab welcher Restzeit engmaschiger abgelesen wird - und in welchem Takt.
 *
 * DAS PROBLEM, DAS DAS LOEST. Der regulaere Takt steht auf zehn Minuten. Bei einem langen
 * Programm faellt das nicht auf; bei einem kurzen entscheidet es ueber den Endwert. Am
 * 10.09.2026 an der WCR860 belegt: Programm "Seide" von 17:10 bis 17:45, abgelesen um 17:16,
 * 17:26 und 17:36. Die letzte Ablesung lag neun Minuten vor Schluss und stand bei 20,77 l -
 * das Programm brauchte 31 l. Um 17:46 hatte das Geraet die Zaehler bereits zurueckgesetzt.
 *
 * Der vorhandene Schlussstand-Abruf (siehe ecoSchlussstandHolen) greift erst NACH dem
 * Statuswechsel und kommt damit grundsaetzlich zu spaet: Zu diesem Zeitpunkt steht im Leaf
 * schon die Null. Der Endwert ist nur VOR dem Ende zu holen.
 *
 * Zehn Minuten Vorlauf und ein Minutentakt kosten hoechstens zehn zusaetzliche Abfragen je
 * Programm - und nur in der Phase, in der das Geraet ohnehin wach ist.
 */
const ENDSPURT_AB_MIN = 10;
const ENDSPURT_TAKT_MS = 60 * 1000;

/**
 * Wie alt darf die letzte Ablesung gemessen am Programmende hoechstens sein?
 *
 * Zwei Minuten. Der Wert folgt aus dem Endspurt-Takt oben: Wer im Minutentakt liest, hat den
 * Schluss erwischt; wer laenger nichts gehoert hat, war nicht dabei.
 */
const ABLESUNG_FRISCH_MS = 2 * 60 * 1000;

/**
 * Um welchen Anteil darf der Zaehler zuletzt noch gestiegen sein?
 *
 * WARUM ES BEIDE BEDINGUNGEN BRAUCHT - Alter UND Anstieg. Jede fuer sich verwirft auch
 * brauchbare Zyklen. Die beiden "Seide"-Laeufe der WCR860 zeigen es:
 *
 *   06.09.  9,48 -> 10,10 -> 30,94   letzte Ablesung ~2 min vor Schluss   30,94 gegen 31 - richtig
 *   10.09. 10,11 -> 10,11 -> 20,77   letzte Ablesung  9 min vor Schluss   20,77 gegen 31 - Zwischenstand
 *
 * Der Anstieg allein wuerde auch den 06.09. aussortieren, denn dort stieg der Zaehler zuletzt
 * ebenso kraeftig (+20,84). Das Alter allein trifft ihn nicht, taugt aber nicht als einziges
 * Mass: Eine Ablesung kann alt und trotzdem endgueltig sein, wenn der Zaehler laengst steht.
 * Erst zusammen trennen sie sauber.
 *
 * Zehn Prozent, weil darunter der Unterschied zur blossen Messungenauigkeit verschwimmt - und
 * ein Zyklus, dem zwei Prozent fehlen, ist ein brauchbarer Zyklus.
 */
const ANSTIEG_ANTEIL = 0.1;

/**
 * Ab diesem Alter ist eine Ablesung KEIN Endwert - auch wenn der Zaehler zuletzt stillstand.
 *
 * DAS LOCH IN DER REGEL OBEN. Stillstand heisst nicht immer "fertig". Am 09.09.2026 lief an der
 * WCR860 dasselbe Seidenprogramm wie am Tag darauf: abgelesen 17:06 mit 10,10 l, 17:16 wieder
 * 10,10 l - die Maschine weichte ein und zog kein Wasser. Das Programm endete um 17:37 und hatte
 * 31 l gebraucht. Kein Anstieg, also haette die Bedingung darueber die Ablesung durchgelassen,
 * obwohl sie 21 Minuten vor Schluss lag.
 *
 * Die Grenze ist das Endspurt-Fenster selbst: Sobald die Restzeit darunter faellt, wird im
 * Minutentakt gelesen. Liegt die letzte Ablesung trotzdem weiter zurueck, hat der Endspurt den
 * Schluss nachweislich nicht erfasst - und was davor stand, sagt ueber den Endwert nichts.
 *
 * Darunter bleibt es bei Alter UND Anstieg; eine Ablesung neun Minuten vor Schluss mit
 * stehendem Zaehler gilt weiter als Endwert.
 */
const ABLESUNG_VERALTET_MS = ENDSPURT_AB_MIN * 60 * 1000;

/**
 * War die letzte Ablesung der Endstand des Programms - oder ein Zwischenstand?
 *
 * Ein Zwischenstand ist KEIN Messfehler: Der Zaehler stand wirklich dort. Falsch waere nur,
 * ihn als Endwert gegen einen Vergleichswert zu stellen. Deshalb sagt diese Funktion nicht
 * "verwirf den Zyklus", sondern nur "diese Zahl ist nicht der Schlussstand" - was damit
 * geschieht, entscheidet der Aufrufer (siehe main.js: er bucht ihn als Luecke, nicht als
 * Abweichung, und der Zyklus bleibt vollstaendig erhalten).
 *
 * @param {object} a die Ablesung mit Zeitpunkt und Werten
 *   letzteAblesungMs  Zeitpunkt der letzten Ablesung mit gueltigem Wert
 *   endeMs            Zeitpunkt, zu dem das Programm endete
 *   wert              zuletzt gelesener Wert
 *   vorletzterWert    der Wert davor, oder null
 * @returns {{vollstaendig: boolean, alterMs: number|null, anstieg: number|null, grund: string|null}} Bewertung der Ablesung mit Grund, falls unvollstaendig
 */
function ablesungBewerten(a) {
    const { letzteAblesungMs, endeMs, wert, vorletzterWert } = a || {};
    if (!letzteAblesungMs || !endeMs || typeof wert !== 'number' || wert <= 0) {
        return { vollstaendig: true, alterMs: null, anstieg: null, grund: null };
    }
    // Eine Ablesung NACH dem Programmende ist nie zu alt - sie hat den Schluss gesehen.
    const alterMs = Math.max(0, endeMs - letzteAblesungMs);
    const anstieg = typeof vorletzterWert === 'number' && vorletzterWert >= 0 ? (wert - vorletzterWert) / wert : null;
    if (alterMs <= ABLESUNG_FRISCH_MS) {
        return { vollstaendig: true, alterMs, anstieg, grund: null };
    }
    if (alterMs > ABLESUNG_VERALTET_MS) {
        return {
            vollstaendig: false,
            alterMs,
            anstieg,
            grund:
                `last reading ${Math.round(alterMs / 60000)} min before the end of the program - ` +
                'the final phase missed the end, this is an interim value',
        };
    }
    if (anstieg == null || anstieg <= ANSTIEG_ANTEIL) {
        return { vollstaendig: true, alterMs, anstieg, grund: null };
    }
    return {
        vollstaendig: false,
        alterMs,
        anstieg,
        grund:
            `last reading ${Math.round(alterMs / 60000)} min before the end of the program, ` +
            `the meter was still rising by ${(anstieg * 100).toFixed(0)} % ` +
            '- this is an interim value, not the final one',
    };
}

/**
 * Laeuft das Geraet, und ist die Restzeit im Endspurt-Fenster?
 *
 * @param statusVal Statuswert des Geraets
 * @param restMin Restzeit in Minuten
 */
function imEndspurt(statusVal, restMin) {
    const laeuft = statusVal === 5 || statusVal === 6;
    return laeuft && typeof restMin === 'number' && restMin >= 0 && restMin <= ENDSPURT_AB_MIN;
}

module.exports = {
    NACHLAUF_MS,
    STABIL_MAX,
    abfragenSinnvoll,
    nachlaufFortschreiben,
    ENDSPURT_AB_MIN,
    ENDSPURT_TAKT_MS,
    ABLESUNG_FRISCH_MS,
    ABLESUNG_VERALTET_MS,
    ANSTIEG_ANTEIL,
    ablesungBewerten,
    imEndspurt,
};

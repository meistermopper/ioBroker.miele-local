'use strict';

/*
 * Was sich in den gefundenen Leafs bewegt - dauerhaft mitgeschrieben.
 *
 * WOZU
 * Der Leaf-Scan sagt, WELCHE Adressen ein Geraet beantwortet. Das allein hilft wenig: Ein Leaf
 * mit siebenundvierzig Feldern ist eine Wand aus Zahlen, und ohne zu wissen, welche davon sich
 * mit der Maschine bewegen, laesst sich keine davon deuten. Die Energie, die in 2/6195 nicht
 * steckt, koennte in einem der neu gefundenen Nachbarn liegen - aber nur, wenn man sieht, wie
 * ihre Felder waehrend eines Programms laufen.
 *
 * WAS HIER GESPEICHERT WIRD
 * Je Leaf und Feld eine Reihe von Wertwechseln mit Zeitstempel. NUR WECHSEL: Ein Feld, das
 * eine Woche lang 7 zeigt, belegt einen Eintrag, nicht tausend. Damit bleibt die Ablage klein
 * genug fuer einen ioBroker-Datenpunkt und enthaelt trotzdem genau das, was interessiert -
 * denn eine Zahl, die sich nie aendert, ist Konfiguration und keine Messung.
 *
 * WARUM NICHT DIE IOBROKER-HISTORY
 * Sie waere der naheliegende Ort, verlangt aber je Feld einen eigenen Datenpunkt samt
 * Aufzeichnung. Bei sechs Leafs mit zusammen ueber achtzig Feldern - und der Aussicht auf mehr,
 * je weiter der Scan kommt - waeren das Hunderte Objekte, von denen sich die allermeisten als
 * unbrauchbar herausstellen werden. Diese Ablage kostet einen Datenpunkt und laesst sich
 * wegwerfen, sobald klar ist, welche Felder taugen.
 */

/** So viele Wechsel je Feld werden aufgehoben - danach faellt der aelteste heraus. */
const WECHSEL_JE_FELD = 60;

/**
 * Einen Abruf einarbeiten.
 *
 * @param {object} bisher   bisheriger Verlauf {"2/6195": {"21": [[zeit, wert], ...]}}
 * @param {string} leaf     "2/6195"
 * @param {object} felder   {"21": 13341, "25": 319}
 * @param {number} zeit     Zeitstempel in Millisekunden
 * @returns {object} der neue Verlauf - die Eingabe bleibt unberuehrt
 */
function aufnehmen(bisher, leaf, felder, zeit) {
    const verlauf = Object.assign({}, bisher);
    const je = Object.assign({}, verlauf[leaf] || {});

    for (const [feld, wert] of Object.entries(felder || {})) {
        const reihe = (je[feld] || []).slice();
        const letzter = reihe.length ? reihe[reihe.length - 1][1] : undefined;
        /*
         * Nur bei Aenderung anhaengen.
         *
         * Der Vergleich laeuft ueber JSON, damit auch Listen und verschachtelte Werte
         * zuverlaessig verglichen werden - ein Feld kann durchaus ein Array tragen, und
         * "[1,2] !== [1,2]" waere in JavaScript sonst immer wahr.
         */
        if (JSON.stringify(letzter) === JSON.stringify(wert)) {
            continue;
        }
        reihe.push([zeit, wert]);
        while (reihe.length > WECHSEL_JE_FELD) {
            reihe.shift();
        }
        je[feld] = reihe;
    }
    verlauf[leaf] = je;
    return verlauf;
}

/**
 * Welche Felder haben sich in einem Zeitraum bewegt?
 *
 * DAS IST DER EIGENTLICHE ZWECK DER ABLAGE. Wer wissen will, wo die Energie steht, laesst ein
 * Programm laufen und fragt danach: Welche Felder sind zwischen Start und Ende gewandert? Alles
 * andere ist Konfiguration und scheidet aus.
 *
 * @param verlauf gespeicherter Feldverlauf
 * @param vonZeit Beginn des Zeitraums in Millisekunden
 * @param bisZeit Ende des Zeitraums in Millisekunden
 * @returns {Array} [{leaf, feld, wechsel, von, bis}] - nach Anzahl der Wechsel sortiert
 */
function bewegt(verlauf, vonZeit, bisZeit) {
    const raus = [];
    for (const [leaf, felder] of Object.entries(verlauf || {})) {
        if (leaf === '_zustand') {
            continue;
        } // kein Leaf, sondern der Geraetezustand
        for (const [feld, reihe] of Object.entries(felder || {})) {
            const drin = reihe.filter(([t]) => t >= vonZeit && t <= bisZeit);
            if (drin.length < 1) {
                continue;
            }
            // Der Wert VOR dem Zeitraum ist der Ausgangspunkt - sonst faengt die Spur erst
            // beim ersten Wechsel an und der Startwert fehlt.
            const davor = reihe.filter(([t]) => t < vonZeit).slice(-1)[0];
            raus.push({
                leaf,
                feld,
                wechsel: drin.length,
                von: davor ? davor[1] : drin[0][1],
                bis: drin[drin.length - 1][1],
            });
        }
    }
    return raus.sort((a, b) => b.wechsel - a.wechsel);
}

/**
 * Wie viele Felder und Wechsel die Ablage haelt - fuer die Anzeige.
 *
 * @param verlauf gespeicherter Feldverlauf
 */
function umfang(verlauf) {
    let felder = 0;
    let wechsel = 0;
    // Der Zustandszweig ist kein Leaf - er wuerde die Zaehlung sonst um eins verfaelschen.
    const leafs = Object.entries(verlauf || {}).filter(([k]) => k !== '_zustand');
    for (const [, je] of leafs) {
        for (const reihe of Object.values(je || {})) {
            felder++;
            wechsel += reihe.length;
        }
    }
    return { leafs: leafs.length, felder, wechsel };
}

/**
 * Den Zustand des Geraets zum Zeitpunkt der Messung festhalten.
 *
 * WOZU. Eine Zahlenreihe allein laesst sich nicht deuten. "608, 368, -378, -598, 676" wird
 * erst zu einer Aussage, wenn danebensteht, was die Maschine in diesem Augenblick tat -
 * Waschen, Spuelen, Schleudern. Am 05.09.2026 stand die Vermutung im Raum, ein Feld zeige die
 * Trommeldrehzahl mit Vorzeichen fuer die Drehrichtung; pruefen laesst sich das nur, wenn die
 * Phase danebensteht.
 *
 * Gespeichert wird unter demselben Zeitstempel wie die Felder, in einem eigenen Zweig - so
 * bleibt die Feldablage unberuehrt und der Zustand laesst sich jederzeit dazulesen.
 *
 * @param bisher gespeicherter Feldverlauf
 * @param zustand Zustand des Geraets (Status, Programm, Phase)
 * @param zeit Zeitpunkt der Messung in Millisekunden
 */
function zustandAufnehmen(bisher, zustand, zeit) {
    const verlauf = Object.assign({}, bisher);
    const reihe = (verlauf._zustand || []).slice();
    const letzter = reihe.length ? reihe[reihe.length - 1][1] : undefined;
    // Auch hier nur Wechsel: Eine Phase dauert Minuten, nicht Sekunden.
    if (JSON.stringify(letzter) !== JSON.stringify(zustand)) {
        reihe.push([zeit, zustand]);
        while (reihe.length > WECHSEL_JE_FELD) {
            reihe.shift();
        }
        verlauf._zustand = reihe;
    }
    return verlauf;
}

/**
 * Was war das Geraet zu diesem Zeitpunkt am Tun?
 *
 * Gesucht wird der letzte Zustandswechsel VOR dem Zeitpunkt - das ist der, der dann galt.
 *
 * @param verlauf gespeicherter Feldverlauf
 * @param zeit Zeitpunkt in Millisekunden
 */
function zustandBei(verlauf, zeit) {
    const reihe = (verlauf && verlauf._zustand) || [];
    let treffer = null;
    for (const [t, z] of reihe) {
        if (t <= zeit) {
            treffer = z;
        } else {
            break;
        }
    }
    return treffer;
}

module.exports = { WECHSEL_JE_FELD, aufnehmen, bewegt, umfang, zustandAufnehmen, zustandBei };

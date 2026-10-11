'use strict';

const felder = require('./felder');
const leafnamen = require('./leafnamen');
const datenpunkte = require('./datenpunkte');

/*
 * Die gesammelten Datensaetze als CSV.
 *
 * WOZU. Die Sammlung liegt als JSON in einem Datenpunkt - gut fuer den Adapter, unbrauchbar fuer
 * eine Tabelle. Wer die Felder selbst auswertet (und genau dafuer ist die Sammlung da), musste
 * die Zahlen bisher von Hand herausschreiben. Diese Datei baut daraus eine Tabelle, die sich
 * ohne Zwischenschritt oeffnen laesst.
 *
 * WARUM SEMIKOLON UND KOMMA. Die Datei wird in Tabellenkalkulationen mit deutscher Einstellung
 * geoeffnet; dort ist das Semikolon das Trennzeichen und das Komma das Dezimalzeichen. Mit Punkt
 * und Komma-Trennung landet jede Zahl als Text in der Zelle. Das BOM am Anfang sorgt dafuer, dass
 * Umlaute richtig ankommen - ohne es liest Excel die Datei als Latin-1.
 *
 * WELCHE SPALTEN. Erst die festen Angaben (Geraet, Zeiten, Programm, Vergleichswerte), dann je
 * Rohfeld eine Spalte. Welche Rohfelder vorkommen, entscheidet die Sammlung - deshalb werden die
 * Feldspalten aus allen Datensaetzen zusammengetragen und nach Nummer sortiert. Die Ueberschrift
 * traegt den Namen aus lib/felder.js, sofern bekannt: "Feld 21 (totalImpulses)".
 */

/** Das Leaf, aus dem die Rohfelder stammen - fuer die Namen in den Ueberschriften. */
const FELD_LEAF = '2/6195';

const FESTE_SPALTEN = [
    // Name und Seriennummer getrennt: Der Name ist frei vergeben und aendert sich, die
    // Seriennummer nicht. Nur mit ihr lassen sich zwei Ausdrucke sicher zusammenfuehren.
    ['geraet', 'Appliance'],
    ['seriennummer', 'Serial number'],
    ['start', 'Start'],
    ['ende', 'End'],
    ['programm', 'Program'],
    ['programmArt', 'Program type'],
    ['programmId', 'Program number'],
    ['dauerMin', 'Duration (min)'],
    ['temperatur', 'Temperature (°C)'],
    ['gemessenWh', 'Measured (Wh)'],
    ['cloudEnergyKwh', 'Cloud energy (kWh)'],
    ['cloudWaterL', 'Cloud water (l)'],
    ['manuellEnergyKwh', 'Read energy (kWh)'],
    ['manuellWaterL', 'Read water (l)'],
    ['unvollstaendig', 'Incomplete'],
    ['modell', 'Model'],
    ['xkm', 'Communication module'],
    // Woraus der Ausdruck stammt - sonst weiss man in drei Monaten nicht mehr, welche
    // Feldbedeutungen damals galten.
    ['adapterVersion', 'Adapter version'],
];

/**
 * Zeitstempel in Ortszeit, Sekunden genau: "15.09.2026 06:12:44".
 *
 * @param ms Zeitpunkt in Millisekunden seit 1970
 */
function zeit(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
        return '';
    }
    const d = new Date(ms);
    const z = n => String(n).padStart(2, '0');
    return (
        `${z(d.getDate())}.${z(d.getMonth() + 1)}.${d.getFullYear()} ` +
        `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`
    );
}

/**
 * Ein Wert als Zelle: Zahlen mit Komma, Text mit Anfuehrungszeichen, wo noetig.
 *
 * Semikolon, Anfuehrungszeichen und Zeilenumbruch wuerden die Tabelle zerreissen - deshalb wird
 * eine solche Zelle in Anfuehrungszeichen gesetzt und die enthaltenen verdoppelt, wie es RFC 4180
 * vorsieht.
 *
 * @param wert Zahl, Text, Wahrheitswert oder leer
 */
function zelle(wert) {
    if (wert == null) {
        return '';
    }
    if (typeof wert === 'number') {
        if (!Number.isFinite(wert)) {
            return '';
        }
        return String(wert).replace('.', ',');
    }
    if (typeof wert === 'boolean') {
        return wert ? 'yes' : 'no';
    }
    const s = String(wert);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Alle Leaf-Spalten, die in der Sammlung vorkommen.
 *
 * WOZU EINE ZWEITE SORTE SPALTEN. Die Feldspalten oben zeigen das Eco-Leaf, und das gibt es
 * nicht auf jedem Geraet: Die Spuelmaschine dieses Haushalts beantwortet 2/6195 ueberhaupt
 * nicht, dafuer neunzehn andere Adressen. Seit 0.3.37 traegt jeder Datensatz die Schlussstaende
 * ALLER antwortenden Leafs (siehe lib/sammler.js, leafsNachtragen) - hier werden sie zu Spalten.
 *
 * Die Ueberschrift nennt Adresse, Feldnummer und, wo bekannt, den Namen aus den oeffentlichen
 * Projekten: "2/119.1 hoursOfOperation". Sortiert wird nach Unit, Attribut und Feldnummer,
 * damit zusammengehoerige Spalten beieinanderstehen.
 *
 * @param saetze gesammelte Datensaetze eines Geraets
 * @returns {Array<{leaf: string, pfad: string, titel: string}>} eine Spalte je Leaf-Feld mit Pfad und Ueberschrift
 */
function leafSpalten(saetze) {
    const alle = new Map();
    for (const s of saetze) {
        // Start- und Endstand zusammen: Ein Leaf, das nur beim Start antwortete, faellt sonst
        // aus der Tabelle und mit ihm die halbe Differenz.
        const beides = Object.assign({}, (s && s.leafsStart) || {}, (s && s.leafs) || {});
        for (const [leaf, felderDesLeafs] of Object.entries(beides)) {
            for (const pfad of Object.keys(felderDesLeafs || {})) {
                const schluessel = `${leaf}.${pfad}`;
                if (alle.has(schluessel)) {
                    continue;
                }
                const struktur = leafnamen.strukturVon(leaf);
                // Bei "6.4" benennt die letzte Zahl das Feld IN der Unterstruktur; deren Name
                // steht nicht in der Leaf-Tabelle. Dann bleibt es beim Pfad - eine erfundene
                // Ueberschrift waere schlechter als eine nackte Nummer.
                const name = struktur && pfad.indexOf('.') < 0 ? leafnamen.feldNameIn(struktur, pfad) : null;
                alle.set(schluessel, {
                    leaf,
                    pfad,
                    titel: name ? `${leaf}.${pfad} ${name}` : `${leaf}.${pfad}`,
                });
            }
        }
    }
    const zahl = s =>
        s
            .split(/[/.]/)
            .map(Number)
            .map(n => (Number.isFinite(n) ? n : 0));
    return [...alle.values()].sort((a, b) => {
        const x = zahl(`${a.leaf}.${a.pfad}`);
        const y = zahl(`${b.leaf}.${b.pfad}`);
        for (let i = 0; i < Math.max(x.length, y.length); i++) {
            if ((x[i] || 0) !== (y[i] || 0)) {
                return (x[i] || 0) - (y[i] || 0);
            }
        }
        return 0;
    });
}

/**
 * Was an einem Datensatz fehlt, in einem Satz.
 *
 * Bis 0.3.37 blieben die Zeitspalten der Altbestaende einfach leer; das sah wie ein Fehler des
 * Ausdrucks aus. Jetzt steht der Grund daneben.
 *
 * @param s der Datensatz
 * @param unv Felder, deren Wert unvollstaendig ist, mit Grund
 */
function hinweise(s, unv) {
    const teile = Object.entries(unv || {}).map(([k, v]) => `${k}: ${v}`);
    if (typeof s.start !== 'number' || !s.start) {
        teile.push('collected before 0.3.37, no timestamp');
    }
    if (!s.leafsStart && s.leafs) {
        teile.push('no leaf start reading, final values only');
    }
    return teile.length ? teile.join(', ') : null;
}

/**
 * Die Ueberschrift eines Rohfelds: Nummer, Name, und wo bekannt Teiler und Einheit.
 *
 * @param n Feldnummer
 */
function feldTitel(n) {
    const name = felder.feldName(FELD_LEAF, n);
    const extra = datenpunkte.BESONDERS[`Process.${n}`] || {};
    let titel = name ? `Field ${n} (${name})` : `Field ${n}`;
    // Der Teiler erspart das Nachschlagen: "Feld 21 (totalImpulses) /200 -> l" sagt sofort,
    // dass 1000 im Rohwert fuenf Liter sind.
    if (extra.teiler) {
        titel += ` /${extra.teiler}`;
    }
    if (extra.einheit) {
        titel += ` -> ${extra.einheit}`;
    }
    return titel;
}

/**
 * Alle vorkommenden Feldnummern, aufsteigend - jede wird eine Spalte.
 *
 * @param saetze gesammelte Datensaetze
 */
function feldNummern(saetze) {
    const alle = new Set();
    for (const s of saetze) {
        for (const k of Object.keys((s && s.felder) || {})) {
            alle.add(Number(k));
        }
    }
    return [...alle].filter(n => Number.isFinite(n)).sort((a, b) => a - b);
}

/**
 * Die festen Angaben eines Datensatzes, flach.
 *
 * @param geraet Geraete-ID
 * @param s der Datensatz
 * @param seriennummer Seriennummer des Geraets
 * @param version Adapterversion fuer die Herkunftsspalte
 */
function festeWerte(geraet, s, seriennummer, version) {
    const p = s.programm || {};
    const m = s.modell || {};
    const c = s.cloud || {};
    const man = s.manuell || {};
    const unv = s.unvollstaendig || {};
    return {
        geraet,
        seriennummer: seriennummer || null,
        adapterVersion: version || null,
        start: zeit(s.start),
        ende: zeit(s.ende),
        programm: p.text || null,
        programmArt: p.artText || null,
        programmId: p.id,
        dauerMin: p.dauerMin,
        temperatur: p.temperatur,
        gemessenWh: s.gemessenWh,
        cloudEnergyKwh: c.energyKwh,
        cloudWaterL: c.waterL,
        manuellEnergyKwh: man.energyKwh,
        manuellWaterL: man.waterL,
        // Welche Groesse kein Endwert ist - leer heisst: alles vollstaendig.
        unvollstaendig: hinweise(s, unv),
        modell: [m.techType, m.matNumber].filter(Boolean).join(' / ') || null,
        xkm: [m.xkmType, m.xkmVersion].filter(Boolean).join(' ') || null,
    };
}

/**
 * Die Sammlung aller Geraete als CSV-Text.
 *
 * @param {Array<{id: string, name?: string, saetze: Array}>} geraete alle Geraete mit ihren gesammelten Datensaetzen
 * @param version Adapterversion fuer die Herkunftsspalte
 * @returns {string} CSV mit BOM; leer bleibt die Datei nie - ohne Datensaetze kommt nur die Kopfzeile
 */
function csvBauen(geraete, version) {
    const liste = (geraete || []).filter(g => g && Array.isArray(g.saetze));
    const alleSaetze = liste.flatMap(g => g.saetze);
    const nummern = feldNummern(alleSaetze);
    const leafs = leafSpalten(alleSaetze);

    const kopf = FESTE_SPALTEN.map(([, titel]) => titel)
        .concat(nummern.map(feldTitel))
        // Drei Spalten je Leaf-Feld. Bei Lebenszaehlern wie hoursOfOperation ist allein die
        // Differenz ein Verbrauch; Start und Ende bleiben trotzdem sichtbar, damit man einen
        // Zaehlerueberlauf oder einen fehlenden Startwert erkennt.
        .concat(leafs.flatMap(sp => [`${sp.titel} Start`, `${sp.titel} End`, `${sp.titel} Δ`]));

    const zeilen = [kopf.map(zelle).join(';')];
    for (const g of liste) {
        for (const s of g.saetze) {
            if (!s) {
                continue;
            }
            const fest = festeWerte(g.name || g.id, s, g.id, version);
            const reihe = FESTE_SPALTEN.map(([k]) => zelle(fest[k]));
            for (const n of nummern) {
                const w = (s.felder || {})[n] ?? (s.felder || {})[String(n)];
                reihe.push(zelle(typeof w === 'number' ? w : w == null ? null : w));
            }
            for (const sp of leafs) {
                const a = ((s.leafsStart || {})[sp.leaf] || {})[sp.pfad];
                const b = ((s.leafs || {})[sp.leaf] || {})[sp.pfad];
                // Listen kommen als JSON in die Zelle - eine Programmliste mit zwanzig
                // Eintraegen in zwanzig Spalten zu zerlegen, machte die Tabelle unlesbar.
                reihe.push(zelle(Array.isArray(a) ? JSON.stringify(a) : a));
                reihe.push(zelle(Array.isArray(b) ? JSON.stringify(b) : b));
                // Die Differenz nur, wo beide Seiten Zahlen sind. Gerundet, weil sonst
                // Gleitkommareste wie 0,30000000000000004 in der Tabelle stehen.
                const diff = typeof a === 'number' && typeof b === 'number' ? Math.round((b - a) * 1000) / 1000 : null;
                reihe.push(zelle(diff));
            }
            zeilen.push(reihe.join(';'));
        }
    }
    // \r\n, weil Tabellenkalkulationen unter Windows sonst alles in eine Zeile legen.
    return `\ufeff${zeilen.join('\r\n')}\r\n`;
}

/*
 * Die zweite Tabelle: eine Zeile je Feld statt je Zyklus.
 *
 * WOZU. Die grosse Tabelle liefert die Rohdaten, aber die Frage dahinter lautet nicht "welche
 * Zahlen standen da", sondern "welches Feld ist das Wasser". Diese Antwort rechnet der Adapter
 * laengst aus - sie steht als Satz in sammlung.befund. Hier steht sie aufgeschluesselt: je Feld
 * und Groesse, wie gut es passt, mit welchem Teiler und woran es sonst scheitert. Damit muss
 * niemand mehr eine Korrelation von Hand in der Tabellenkalkulation bauen.
 */
const BEFUND_SPALTEN = [
    'Appliance',
    'Serial number',
    'Quantity',
    'Field',
    'Field name',
    'Divisor',
    'Ø deviation (%)',
    'Largest deviation (%)',
    'Cycles',
    'Empty cycles',
    'Constant',
    'Usable',
    'Remark',
    'Adapter version',
];

/** Die beiden Groessen, nach denen gesucht wird, mit ihrer Beschriftung. */
const GROESSEN = [
    ['energyKwh', 'Energy'],
    ['waterL', 'Water'],
];

/**
 * Die Auswertung aller Geraete als CSV-Text.
 *
 * @param {Array<{id: string, name?: string, saetze: Array}>} geraete alle Geraete mit ihren gesammelten Datensaetzen
 * @param {string} [version] Adapterversion fuer die Herkunftsspalte
 * @returns {string} CSV mit BOM
 */
function befundCsv(geraete, version) {
    const feldsuche = require('./feldsuche');
    const zeilen = [BEFUND_SPALTEN.map(zelle).join(';')];
    for (const g of geraete || []) {
        if (!g || !Array.isArray(g.saetze) || !g.saetze.length) {
            continue;
        }
        for (const [groesse, beschriftung] of GROESSEN) {
            let bewertet = [];
            try {
                bewertet = feldsuche.felderBewerten(g.saetze, groesse) || [];
            } catch {
                bewertet = [];
            }
            for (const b of bewertet) {
                const nr = Number(b.index);
                const name = Number.isFinite(nr) ? felder.feldName(FELD_LEAF, nr) : null;
                zeilen.push(
                    [
                        g.name || g.id,
                        g.id,
                        beschriftung,
                        b.index,
                        name || '',
                        b.teiler,
                        b.abweichung == null ? null : Math.round(b.abweichung * 1000) / 10,
                        b.groessteAbweichung == null ? null : Math.round(b.groessteAbweichung * 1000) / 10,
                        b.zyklen,
                        b.leer,
                        b.konstant,
                        b.taugt,
                        b.grund || (b.unentschieden ? 'not yet decidable' : ''),
                        version || null,
                    ]
                        .map(zelle)
                        .join(';'),
                );
            }
        }
    }
    return `\ufeff${zeilen.join('\r\n')}\r\n`;
}

/**
 * Zeitstempel fuer die Dateinamen: 2026-09-19-0837.
 *
 * @param jetzt Zeitpunkt der Ausgabe
 */
function stempel(jetzt) {
    const z = n => String(n).padStart(2, '0');
    return (
        `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}` +
        `-${z(jetzt.getHours())}${z(jetzt.getMinutes())}`
    );
}

/**
 * Dateiname mit Zeitpunkt, damit mehrere Ausgaben nebeneinander liegen koennen.
 *
 * @param jetzt Zeitpunkt der Ausgabe, Standard jetzt
 */
function befundDateiname(jetzt = new Date()) {
    return `finding-${stempel(jetzt)}.csv`;
}

/**
 * Dateiname des Ausdrucks mit Zeitpunkt: collection-2026-09-19-0837.csv (bis 0.3.44 sammlung-...).
 *
 * @param {Date} [jetzt]   Zeitpunkt (fuer Tests setzbar)
 * @returns {string} Dateiname
 */
function dateiname(jetzt = new Date()) {
    const z = n => String(n).padStart(2, '0');
    return (
        `collection-${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}` +
        `-${z(jetzt.getHours())}${z(jetzt.getMinutes())}.csv`
    );
}

module.exports = {
    csvBauen,
    befundCsv,
    dateiname,
    befundDateiname,
    zelle,
    zeit,
    feldNummern,
    leafSpalten,
    FESTE_SPALTEN,
};

'use strict';

/**
 * Auswertung der Programmhistorie: Kennzahlen je Zeitraum und je Programm.
 *
 * Bewusst fortlaufend gefuehrt und nicht bei Bedarf aus dem Ringpuffer gerechnet: der Puffer
 * fasst die letzten paar Dutzend Programme, eine Jahresauswertung braucht alle. Statt die
 * gesamte Historie vorzuhalten, wird jeder abgeschlossene Zyklus einmal in die Summen
 * eingerechnet.
 *
 * Beim Zeitraumwechsel rutscht "laufend" auf "vorher" - so steht der Vergleich mit dem
 * Vorzeitraum ohne weiteres Zutun bereit.
 */

/**
 * ISO-8601-Kalenderwoche als "2026-W34". Montag ist der erste Tag.
 *
 * @param d Datum
 */
function wocheVon(d) {
    // Auf Donnerstag derselben Woche schieben - dessen Jahr ist laut ISO das Wochenjahr.
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const wochentag = (t.getUTCDay() + 6) % 7; // Montag = 0
    t.setUTCDate(t.getUTCDate() - wochentag + 3);
    const jahr = t.getUTCFullYear();
    const ersterDonnerstag = new Date(Date.UTC(jahr, 0, 4));
    const versatz = (ersterDonnerstag.getUTCDay() + 6) % 7;
    ersterDonnerstag.setUTCDate(ersterDonnerstag.getUTCDate() - versatz + 3);
    const nr = 1 + Math.round((t - ersterDonnerstag) / (7 * 86400000));
    return `${jahr}-W${String(nr).padStart(2, '0')}`;
}

const monatVon = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const jahrVon = d => String(d.getFullYear());

const SCHLUESSEL = { week: wocheVon, month: monatVon, year: jahrVon };

/**
 * Auf drei Nachkommastellen - Wattstunden und Zehntelliter genuegen.
 *
 * @param n Zahl
 */
const rund = n => Math.round(n * 1000) / 1000;

function leererZeitraum() {
    return {
        key: null,
        cycles: 0,
        energy: 0,
        water: 0,
        runtimeS: 0,
        programs: {},
        prevKey: null,
        prevCycles: 0,
        prevEnergy: 0,
        prevWater: 0,
        prevRuntimeS: 0,
        prevPrograms: {},
    };
}

/**
 * Ein Programm in eine Programmtabelle einrechnen.
 *
 * @param tabelle Programmtabelle
 * @param name Programmname
 * @param kwh Energie in kWh
 * @param liter Wasser in Litern
 * @param dauer Dauer in Minuten
 */
function programmDazu(tabelle, name, kwh, liter, dauer) {
    const p = tabelle[name] || { cycles: 0, energy: 0, water: 0, runtimeS: 0 };
    tabelle[name] = {
        cycles: p.cycles + 1,
        energy: rund(p.energy + kwh),
        water: rund(p.water + liter),
        runtimeS: p.runtimeS + dauer,
    };
}

/** Leerer Ausgangszustand. */
function neuerStand() {
    return {
        week: leererZeitraum(),
        month: leererZeitraum(),
        year: leererZeitraum(),
        // Alle Monate und Jahre einzeln, damit sich in der Anzeige ein bestimmter Monat
        // auswaehlen laesst und nicht nur "laufend" und "davor" zur Verfuegung stehen.
        months: {}, // "2026-08" -> { cycles, energy, water, runtimeS, programs }
        years: {}, // "2026"    -> dito
        programs: {}, // Name -> { cycles, energy, water, runtimeS }
        total: { cycles: 0, energy: 0, water: 0, runtimeS: 0 },
    };
}

/** Wie viele Monate und Jahre aufgehoben werden - zwei Jahre plus Puffer. */
const MAX_MONATE = 26;
const MAX_JAHRE = 6;

/**
 * Aeltere Eintraege verwerfen; die Schluessel sind sortierbar (2026-08, 2026).
 *
 * @param tabelle Tabelle mit sortierbaren Schluesseln
 * @param hoechstens wie viele Eintraege bleiben
 */
function begrenzen(tabelle, hoechstens) {
    const keys = Object.keys(tabelle).sort();
    if (keys.length <= hoechstens) {
        return tabelle;
    }
    const raus = {};
    for (const k of keys.slice(-hoechstens)) {
        raus[k] = tabelle[k];
    }
    return raus;
}

/**
 * Einen Zyklus in einen Tabelleneintrag (Monat oder Jahr) einrechnen.
 *
 * @param tabelle Tabelle der Monate oder Jahre
 * @param key Schluessel, etwa "2026-08" oder "2026"
 * @param kwh Energie in kWh
 * @param liter Wasser in Litern
 * @param dauer Dauer in Minuten
 * @param programm Programmname
 */
function eintragDazu(tabelle, key, kwh, liter, dauer, programm) {
    const e = tabelle[key] || { cycles: 0, energy: 0, water: 0, runtimeS: 0, programs: {} };
    const programs = { ...(e.programs || {}) };
    if (programm) {
        programmDazu(programs, programm, kwh, liter, dauer);
    }
    tabelle[key] = {
        cycles: e.cycles + 1,
        energy: rund(e.energy + kwh),
        water: rund(e.water + liter),
        runtimeS: e.runtimeS + dauer,
        programs,
    };
}

/**
 * Verbucht einen abgeschlossenen Zyklus.
 *
 * @param {object|null} stand    bisheriger Zustand
 * @param {object} zyklus        { ende, dauerS, program, energyKwh, waterL }
 * @returns {object} neuer Zustand
 */
function verbuchen(stand, zyklus) {
    const s = stand ? { ...neuerStand(), ...stand } : neuerStand();
    for (const n of ['week', 'month', 'year']) {
        s[n] = { ...leererZeitraum(), ...(s[n] || {}) };
        s[n].programs = { ...(s[n].programs || {}) };
        s[n].prevPrograms = { ...(s[n].prevPrograms || {}) };
    }
    s.programs = { ...(s.programs || {}) };
    s.months = { ...(s.months || {}) };
    s.years = { ...(s.years || {}) };
    s.total = { ...neuerStand().total, ...(s.total || {}) };

    const wann = new Date(zyklus.ende || Date.now());
    const kwh = typeof zyklus.energyKwh === 'number' ? zyklus.energyKwh : 0;
    const liter = typeof zyklus.waterL === 'number' ? zyklus.waterL : 0;
    const dauer = typeof zyklus.dauerS === 'number' ? zyklus.dauerS : 0;

    for (const [name, fn] of Object.entries(SCHLUESSEL)) {
        const key = fn(wann);
        const z = s[name];
        if (z.key !== key) {
            // Zeitraumwechsel: der bisherige wird zum Vergleichswert. Uebersprungene Zeitraeume
            // (kein Programm gelaufen) tauchen nicht auf - "vorher" meint den letzten mit Daten.
            if (z.key !== null) {
                z.prevKey = z.key;
                z.prevCycles = z.cycles;
                z.prevEnergy = z.energy;
                z.prevWater = z.water;
                z.prevRuntimeS = z.runtimeS;
                z.prevPrograms = z.programs;
            }
            z.key = key;
            z.cycles = 0;
            z.energy = 0;
            z.water = 0;
            z.runtimeS = 0;
            z.programs = {};
        }
        z.cycles += 1;
        z.energy = rund(z.energy + kwh);
        z.water = rund(z.water + liter);
        z.runtimeS += dauer;
        if (zyklus.program) {
            programmDazu(z.programs, zyklus.program, kwh, liter, dauer);
        }
    }

    // Ohne Programmnamen keine eigene Zeile - sonst entstuende ein Sammeleintrag "null",
    // der in der Anteilsrechnung mitzaehlt, ohne etwas auszusagen.
    if (zyklus.program) {
        programmDazu(s.programs, zyklus.program, kwh, liter, dauer);
    }

    eintragDazu(s.months, monatVon(wann), kwh, liter, dauer, zyklus.program);
    eintragDazu(s.years, jahrVon(wann), kwh, liter, dauer, zyklus.program);
    s.months = begrenzen(s.months, MAX_MONATE);
    s.years = begrenzen(s.years, MAX_JAHRE);

    s.total = {
        cycles: s.total.cycles + 1,
        energy: rund(s.total.energy + kwh),
        water: rund(s.total.water + liter),
        runtimeS: s.total.runtimeS + dauer,
    };
    return s;
}

/**
 * Mittelwert je Programm, null wenn nichts gelaufen ist (0 waere eine Aussage).
 *
 * @param summe Summe
 * @param anzahl Anzahl der Programmlaeufe
 */
const je = (summe, anzahl) => (anzahl ? rund(summe / anzahl) : null);

/**
 * Programmtabelle als sortierte Liste mit Anteilen. [bezug] liefert die Summen, auf die sich
 * die Anteile beziehen - je Zeitraum der Zeitraum selbst, sonst die Gesamtsumme.
 *
 * @param tabelle Programmtabelle
 * @param bezug Summen, auf die sich die Anteile beziehen
 */
function programmListe(tabelle, bezug) {
    return Object.entries(tabelle || {})
        .map(([program, p]) => ({
            program,
            cycles: p.cycles,
            energy: p.energy,
            water: p.water,
            avgEnergy: je(p.energy, p.cycles),
            avgWater: je(p.water, p.cycles),
            shareCycles: bezug.cycles ? Math.round((p.cycles / bezug.cycles) * 1000) / 10 : 0,
            shareEnergy: bezug.energy ? Math.round((p.energy / bezug.energy) * 1000) / 10 : 0,
            shareWater: bezug.water ? Math.round((p.water / bezug.water) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.cycles - a.cycles || a.program.localeCompare(b.program));
}

/**
 * Aufbereitete Ausgabe: Kennzahlen je Zeitraum und die Programmliste, absteigend nach Haeufigkeit
 * und mit Anteil am Gesamtverbrauch - so wie die Herstellerauswertung sie zeigt.
 *
 * @param stand gespeicherter Stand der Statistik
 */
function ausgabe(stand) {
    const s = stand || neuerStand();
    const raus = {};
    for (const n of ['week', 'month', 'year']) {
        const z = { ...leererZeitraum(), ...(s[n] || {}) };
        raus[n] = {
            key: z.key,
            cycles: z.cycles,
            energy: z.energy,
            water: z.water,
            runtimeHours: rund(z.runtimeS / 3600),
            avgEnergy: je(z.energy, z.cycles),
            avgWater: je(z.water, z.cycles),
            prevKey: z.prevKey,
            prevCycles: z.prevCycles,
            prevEnergy: z.prevEnergy,
            prevWater: z.prevWater,
            prevAvgEnergy: je(z.prevEnergy, z.prevCycles),
            prevAvgWater: je(z.prevWater, z.prevCycles),
        };
    }
    const total = { ...neuerStand().total, ...(s.total || {}) };
    for (const n of ['week', 'month', 'year']) {
        const z = { ...leererZeitraum(), ...(s[n] || {}) };
        raus[n].programs = programmListe(z.programs, z);
        raus[n].prevPrograms = programmListe(z.prevPrograms, {
            cycles: z.prevCycles,
            energy: z.prevEnergy,
            water: z.prevWater,
        });
    }
    const programme = programmListe(s.programs, total);

    // Auswaehlbare Zeitraeume, neueste zuerst - die Anzeige braucht sie fuer die Auswahl.
    const tabelle = (roh, hoechstens) =>
        Object.keys(roh || {})
            .sort()
            .reverse()
            .slice(0, hoechstens)
            .map(key => {
                const e = roh[key];
                return {
                    key,
                    cycles: e.cycles,
                    energy: e.energy,
                    water: e.water,
                    runtimeHours: rund(e.runtimeS / 3600),
                    avgEnergy: je(e.energy, e.cycles),
                    avgWater: je(e.water, e.cycles),
                    programs: programmListe(e.programs, e),
                };
            });

    return {
        ...raus,
        months: tabelle(s.months, MAX_MONATE),
        years: tabelle(s.years, MAX_JAHRE),
        programs: programme,
        total: {
            cycles: total.cycles,
            energy: total.energy,
            water: total.water,
            runtimeHours: rund(total.runtimeS / 3600),
            avgEnergy: je(total.energy, total.cycles),
            avgWater: je(total.water, total.cycles),
        },
    };
}

module.exports = { neuerStand, verbuchen, ausgabe, wocheVon, monatVon, jahrVon, MAX_MONATE, MAX_JAHRE };

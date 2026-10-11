'use strict';

const { expect } = require('chai');
const csv = require('../lib/csv');

describe('CSV-Ausgabe der Sammlung', () => {
    const satz = {
        v: 1,
        start: new Date(2026, 8, 14, 17, 5, 3).getTime(),
        ende: new Date(2026, 8, 14, 18, 47, 9).getTime(),
        modell: { techType: 'WCR860', matNumber: '11434560', xkmType: 'EK037', xkmVersion: '4.3.5' },
        programm: { id: 27, text: 'Pflegeleicht', art: 1, artText: 'Normalbetrieb', dauerMin: 102, temperatur: 40 },
        felder: { 21: 13341, 25: 319, 65: 12 },
        gemessenWh: 583.1,
        cloud: { energyKwh: 0.6, waterL: 66 },
    };

    it('schreibt Kopfzeile, Zeiten und Werte', () => {
        const text = csv.csvBauen([{ id: 'WM', saetze: [satz] }]);
        const zeilen = text.replace(/^﻿/, '').trim().split('\r\n');
        expect(zeilen).to.have.length(2);
        expect(zeilen[0]).to.contain('Appliance;Serial number;Start;End;Program');
        expect(zeilen[1]).to.contain('WM;WM;14.09.2026 17:05:03;14.09.2026 18:47:09;Pflegeleicht');
        expect(zeilen[1], 'gemessene Wh mit Komma').to.contain('583,1');
    });

    it('macht aus jedem vorkommenden Rohfeld eine Spalte, nach Nummer sortiert', () => {
        const zweiter = Object.assign({}, satz, { felder: { 15: 405, 21: 9000 } });
        const text = csv.csvBauen([{ id: 'WM', saetze: [satz, zweiter] }]);
        const kopf = text.replace(/^﻿/, '').split('\r\n')[0];
        const spalten = kopf.split(';').slice(csv.FESTE_SPALTEN.length);
        // Teiler und Einheit stehen in der Ueberschrift, wo sie belegt sind - das erspart
        // beim Auswerten das Nachschlagen in der Doku.
        expect(spalten).to.deep.equal([
            'Field 15 (fuTemperature) /10 -> °C',
            'Field 21 (totalImpulses) /200 -> l',
            'Field 25 (heatingEnergy) -> Wh',
            'Field 65 (tbKgResultIntegral110) /2 -> kg',
        ]);
        // Der zweite Satz kennt Feld 25 nicht - die Zelle bleibt leer, die Spalten verrutschen nicht.
        const zeile = text.replace(/^﻿/, '').split('\r\n')[2].split(';');
        expect(zeile).to.have.length(csv.FESTE_SPALTEN.length + 4);
        expect(zeile[csv.FESTE_SPALTEN.length + 2], 'Feld 25 fehlt im zweiten Satz').to.equal('');
    });

    it('nimmt mehrere Geraete in eine Datei', () => {
        const text = csv.csvBauen([
            { id: 'WM', saetze: [satz] },
            { id: 'SM', name: 'Spülmaschine', saetze: [Object.assign({}, satz, { felder: { 7: 60 } })] },
        ]);
        const zeilen = text.replace(/^﻿/, '').trim().split('\r\n');
        expect(zeilen).to.have.length(3);
        expect(zeilen[2].startsWith('Spülmaschine;')).to.equal(true);
    });

    it('bleibt bei leerer Sammlung eine gueltige Datei mit Kopfzeile', () => {
        const text = csv.csvBauen([{ id: 'WM', saetze: [] }]);
        expect(text.replace(/^﻿/, '').trim().split('\r\n')).to.have.length(1);
        expect(csv.csvBauen(null)).to.contain('Appliance');
    });

    it('zerreisst die Tabelle nicht, wenn ein Text Semikolon oder Anfuehrungszeichen enthaelt', () => {
        expect(csv.zelle('a;b')).to.equal('"a;b"');
        expect(csv.zelle('sagt "hallo"')).to.equal('"sagt ""hallo"""');
        expect(csv.zelle('zeile\nzwei')).to.equal('"zeile\nzwei"');
        expect(csv.zelle(null)).to.equal('');
        expect(csv.zelle(1.5)).to.equal('1,5');
    });

    it('laesst fehlende Zeitstempel leer, statt 1970 zu schreiben', () => {
        expect(csv.zeit(0)).to.equal('');
        expect(csv.zeit(null)).to.equal('');
        expect(csv.zeit(undefined)).to.equal('');
    });

    it('nennt die Datei nach dem Zeitpunkt', () => {
        expect(csv.dateiname(new Date(2026, 8, 15, 6, 7))).to.equal('collection-2026-09-15-0607.csv');
    });
});

/*
 * Die Leaf-Spalten - seit 0.3.37 traegt jeder Datensatz die Schlussstaende ALLER Leafs.
 *
 * Vorher enthielt die Sammlung nur das Eco-Leaf. Fuer die Spuelmaschine hiess das: nichts, denn
 * sie beantwortet 2/6195 gar nicht. Ihre neunzehn anderen Adressen standen nirgends.
 */
describe('CSV: Schlussstaende aller Leafs', () => {
    const satz = {
        v: 1,
        programm: { text: 'Eco' },
        leafs: {
            '2/256': { 7: 2640, 8: 12174 },
            '2/119': { 1: 439025 },
            '2/220': { 1: 0 },
            '2/1584': { 2: [1, 133, 3] },
        },
    };

    it('macht aus jedem Leaf-Feld eine Spalte, nach Adresse sortiert', () => {
        const text = csv.csvBauen([{ id: 'SM', saetze: [satz] }]);
        const kopf = text.replace(/^﻿/, '').split('\r\n')[0].split(';').slice(csv.FESTE_SPALTEN.length);
        expect(kopf).to.deep.equal([
            '2/119.1 hoursOfOperation Start', '2/119.1 hoursOfOperation End', '2/119.1 hoursOfOperation Δ',
            '2/220.1 Start', '2/220.1 End', '2/220.1 Δ',
            '2/256.7 remainingTime Start', '2/256.7 remainingTime End', '2/256.7 remainingTime Δ',
            '2/256.8 elapsedTimeRelative Start', '2/256.8 elapsedTimeRelative End', '2/256.8 elapsedTimeRelative Δ',
            '2/1584.2 programIds Start', '2/1584.2 programIds End', '2/1584.2 programIds Δ',
        ]);
    });

    it('schreibt eine Liste als JSON in die Zelle', () => {
        const zeile = csv.csvBauen([{ id: 'SM', saetze: [satz] }])
            .replace(/^﻿/, '').split('\r\n')[1];
        // Ohne Semikolon und Anfuehrungszeichen im Text braucht die Zelle keine Klammerung -
        // das Komma ist hier Listentrenner im JSON, nicht Spaltentrenner.
        expect(zeile).to.contain('[1,133,3]');
    });

    it('laesst die Zelle leer, wenn ein Satz das Leaf nicht hat', () => {
        const ohne = { v: 1, programm: { text: 'Intensiv' } };
        const zeilen = csv.csvBauen([{ id: 'SM', saetze: [satz, ohne] }])
            .replace(/^﻿/, '').trim().split('\r\n');
        const spalten = zeilen[2].split(';');
        expect(spalten).to.have.length(csv.FESTE_SPALTEN.length + 15);
        expect(spalten[csv.FESTE_SPALTEN.length]).to.equal('');
    });

    it('bleibt unveraendert, wenn kein Satz Leafs traegt', () => {
        const text = csv.csvBauen([{ id: 'WM', saetze: [{ v: 1, felder: { 21: 100 } }] }]);
        const kopf = text.replace(/^﻿/, '').split('\r\n')[0].split(';');
        expect(kopf).to.have.length(csv.FESTE_SPALTEN.length + 1);
    });
});

/*
 * Start- und Endstand der Leafs.
 *
 * Bis 0.3.37 stand nur der Schlussstand im Datensatz. Bei einem Lebenszaehler wie
 * hoursOfOperation sagt der ueber einen einzelnen Waschgang nichts - erst die Differenz ist
 * ein Verbrauch. Und genau diese Leafs sind der einzige Weg bei Geraeten, die 2/6195 nicht
 * beantworten.
 */
describe('CSV: Differenz zwischen Start und End', () => {
    const satz = {
        v: 1,
        start: new Date(2026, 8, 18, 9, 0, 0).getTime(),
        ende: new Date(2026, 8, 18, 11, 30, 0).getTime(),
        programm: { text: 'Eco' },
        leafsStart: { '2/119': { 1: 439000 }, '2/1584': { 2: [1, 2] } },
        leafs: { '2/119': { 1: 439025 }, '2/1584': { 2: [1, 2] } },
    };

    it('rechnet die Differenz aus Start und End', () => {
        const zeilen = csv.csvBauen([{ id: 'SM', saetze: [satz] }])
            .replace(/^﻿/, '').trim().split('\r\n');
        const kopf = zeilen[0].split(';');
        const werte = zeilen[1].split(';');
        const i = kopf.indexOf('2/119.1 hoursOfOperation Δ');
        expect(i, 'die Differenzspalte gibt es').to.be.greaterThan(-1);
        expect(werte[i - 2]).to.equal('439000');
        expect(werte[i - 1]).to.equal('439025');
        expect(werte[i]).to.equal('25');
    });

    it('laesst die Differenz leer, wo ein Wert fehlt oder keine Zahl ist', () => {
        const ohneStart = { v: 1, programm: { text: 'x' }, leafs: { '2/119': { 1: 5 } } };
        const zeilen = csv.csvBauen([{ id: 'SM', saetze: [ohneStart] }])
            .replace(/^﻿/, '').trim().split('\r\n');
        const i = zeilen[0].split(';').indexOf('2/119.1 hoursOfOperation Δ');
        expect(zeilen[1].split(';')[i]).to.equal('');
        // Listen haben keine Differenz, aber Start und Ende bleiben sichtbar.
        const j = csv.csvBauen([{ id: 'SM', saetze: [satz] }])
            .replace(/^﻿/, '').split('\r\n')[0].split(';').indexOf('2/1584.2 programIds Δ');
        expect(csv.csvBauen([{ id: 'SM', saetze: [satz] }])
            .replace(/^﻿/, '').split('\r\n')[1].split(';')[j]).to.equal('');
    });

    it('nimmt ein Leaf auf, das nur beim Start antwortete', () => {
        const nurStart = { v: 1, programm: { text: 'x' }, leafsStart: { '2/220': { 1: 7 } }, leafs: {} };
        const kopf = csv.csvBauen([{ id: 'SM', saetze: [nurStart] }])
            .replace(/^﻿/, '').split('\r\n')[0];
        expect(kopf).to.contain('2/220.1 Start');
    });

    it('vermerkt fehlende Zeitangabe und fehlenden Startstand als unvollstaendig', () => {
        const alt = { v: 1, programm: { text: 'x' }, leafs: { '2/119': { 1: 5 } } };
        const zeilen = csv.csvBauen([{ id: 'SM', saetze: [alt] }])
            .replace(/^﻿/, '').trim().split('\r\n');
        const i = zeilen[0].split(';').indexOf('Incomplete');
        const zelle = zeilen[1].split(';')[i];
        expect(zelle).to.contain('no timestamp');
        expect(zelle).to.contain('no leaf start reading');
    });

    it('traegt Seriennummer und Adapterversion getrennt ein', () => {
        const zeilen = csv.csvBauen([{ id: '000123', name: 'Waschmaschine', saetze: [satz] }], '0.3.37')
            .replace(/^﻿/, '').trim().split('\r\n');
        const kopf = zeilen[0].split(';');
        const werte = zeilen[1].split(';');
        expect(werte[kopf.indexOf('Appliance')]).to.equal('Waschmaschine');
        expect(werte[kopf.indexOf('Serial number')]).to.equal('000123');
        expect(werte[kopf.indexOf('Adapter version')]).to.equal('0.3.37');
    });
});

/*
 * Die Befund-Datei beantwortet die Frage, wegen der die Sammlung laeuft: welches Feld ist
 * das Wasser. Eine Zeile je Feld statt je Zyklus.
 */
describe('CSV: Auswertung je Feld', () => {
    // Feld 21 ist genau das Doppelte der Liter - Teiler 2 muss herauskommen.
    const saetze = [1, 2, 3, 4].map((i) => ({
        v: 1,
        programm: { text: `Lauf ${i}` },
        felder: { 21: i * 20, 99: 7 },
        manuell: { waterL: i * 10 },
    }));

    it('schreibt je Feld und Groesse eine Zeile mit Teiler und Abweichung', () => {
        const text = csv.befundCsv([{ id: 'WM', name: 'Waschmaschine', saetze }], '0.3.37');
        const zeilen = text.replace(/^﻿/, '').trim().split('\r\n');
        expect(zeilen[0]).to.contain('Quantity;Field;Field name;Divisor');
        const wasser = zeilen.filter(z => z.includes(';Water;'));
        expect(wasser.length, 'beide Felder bewertet').to.be.greaterThan(0);
        const treffer = wasser.find(z => z.split(';')[3] === '21');
        expect(treffer, 'Feld 21 kommt vor').to.be.a('string');
        expect(treffer).to.contain('totalImpulses');
    });

    it('bleibt bei leerer Sammlung eine gueltige Datei mit Kopfzeile', () => {
        expect(csv.befundCsv([], '0.3.37').replace(/^﻿/, '').trim().split('\r\n')).to.have.length(1);
        expect(csv.befundCsv(null)).to.contain('Field name');
    });

    it('nennt die Auswertungsdatei nach dem Zeitpunkt', () => {
        expect(csv.befundDateiname(new Date(2026, 8, 19, 8, 37))).to.equal('finding-2026-09-19-0837.csv');
    });
});

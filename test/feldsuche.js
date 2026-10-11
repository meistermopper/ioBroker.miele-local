'use strict';

const { expect } = require('chai');
const fs = require('../lib/feldsuche');

/*
 * Die Feldsuche an den Faellen pruefen, die es wirklich gab.
 *
 * Jeder dieser Tests bildet einen Fehlgriff nach, der im Betrieb passiert ist. Sie sind
 * damit keine erfundenen Beispiele, sondern die Belege dafuer, dass die Suche genau das
 * findet, was Monate lang niemandem aufgefallen ist.
 */

/** Ein Zyklus, wie ihn der Sammler ablegt. */
function zyklus(felder, cloud) {
    return { v: 1, modell: { techType: 'WCR860' }, programm: {}, felder, cloud };
}

describe('Feldsuche: Wasser', () => {
    /*
     * Der Fall vom 28.08.2026: Der Adapter las Feld 40, das konstant 95,3 l meldete - fuer
     * Seide (36 min) genauso wie fuer Baumwolle (214 min). Feld 26 traegt die Zehntelliter
     * und folgt der Cloud.
     */
    const saetze = [
        zyklus({ 26: 1160, 40: 953, 4: 109 }, { waterL: 116 }),
        zyklus({ 26: 370, 40: 953, 4: 109 }, { waterL: 37 }),
        zyklus({ 26: 540, 40: 953, 4: 122 }, { waterL: 54 }),
        zyklus({ 26: 890, 40: 953, 4: 118 }, { waterL: 89 }),
    ];

    it('findet das Feld, das der Cloud folgt', () => {
        const rang = fs.felderBewerten(saetze, 'waterL');
        expect(rang[0].index).to.equal('26');
        expect(rang[0].teiler).to.equal(10);
        expect(rang[0].taugt).to.be.true;
    });

    it('verwirft ein Feld, das konstant bleibt, waehrend der Vergleichswert schwankt', () => {
        // GENAU DER FEHLER VON FELD 40. Ohne diese Regel gaebe es keinen Hinweis darauf,
        // dass zehn Tage lang derselbe Wert gemeldet wurde.
        const vierzig = fs.felderBewerten(saetze, 'waterL').find(b => b.index === '40');
        expect(vierzig.taugt).to.be.false;
        expect(vierzig.konstant).to.be.true;
        expect(vierzig.grund).to.match(/stays at/);
    });

    it('nennt das eingestellte Feld, wenn es ein anderes ist als das gefundene', () => {
        const text = fs.befund(saetze, { wasser: 40 });
        expect(text).to.match(/field 26/);
        expect(text).to.match(/but field 40/);
    });

    it('haelt still, solange zu wenige Zyklen vorliegen', () => {
        // Zwei Zyklen koennen zufaellig zu jedem Feld passen - dazu sagt die Suche nichts.
        const text = fs.befund(saetze.slice(0, 2), {});
        expect(text).to.match(/at least 3/);
        expect(fs.felderBewerten(saetze.slice(0, 2), 'waterL')).to.be.empty;
    });
});

describe('Feldsuche: Energie', () => {
    /*
     * Der Fall vom 29.08.2026: F25 stand den ganzen Waschgang still (2,077 kWh, seit dem
     * Vorlauf unveraendert), waehrend die Cloud 2 kWh und der Shelly 1,884 kWh zeigten. Bei
     * gleichbleibendem Feld und schwankendem Vergleichswert darf kein Treffer herauskommen.
     */
    const saetze = [
        zyklus({ 25: 2077, 12: 1884 }, { energyKwh: 1.884 }),
        zyklus({ 25: 2077, 12: 96 }, { energyKwh: 0.096 }),
        zyklus({ 25: 2077, 12: 90 }, { energyKwh: 0.090 }),
        zyklus({ 25: 2077, 12: 94 }, { energyKwh: 0.094 }),
    ];

    it('erkennt ein stehendes Feld als untauglich', () => {
        const fuenfundzwanzig = fs.felderBewerten(saetze, 'energyKwh').find(b => b.index === '25');
        expect(fuenfundzwanzig.taugt).to.be.false;
        expect(fuenfundzwanzig.konstant).to.be.true;
    });

    it('findet stattdessen das mitlaufende Feld samt Teiler', () => {
        const rang = fs.felderBewerten(saetze, 'energyKwh');
        expect(rang[0].index).to.equal('12');
        expect(rang[0].teiler).to.equal(1000);
    });

    it('meldet ehrlich, wenn gar kein Feld passt', () => {
        // Der reale Zustand der WCR860: kein Feld folgt dem gemessenen Verbrauch. Dann darf
        // die Suche nichts vorschlagen - eine erfundene Zuordnung waere schlimmer als keine.
        const ohne = saetze.map(s => zyklus({ 25: s.felder['25'] }, s.cloud));
        const text = fs.befund(ohne, {});
        expect(text).to.match(/no field matches/);
    });
});

describe('Feldsuche: Vergleichsquellen', () => {
    it('nimmt die Cloud, wo es sie gibt', () => {
        const s = { felder: {}, cloud: { waterL: 50 }, manuell: { waterL: 52 } };
        expect(fs.vergleichswert(s, 'waterL')).to.deep.equal({ wert: 50, quelle: 'cloud' });
    });

    it('faellt auf die Ablesung aus der App zurueck', () => {
        // Genau der Fall, auf den es hinauslaeuft, sobald die Cloud abgeschaltet ist.
        const s = { felder: {}, manuell: { waterL: 52 } };
        expect(fs.vergleichswert(s, 'waterL')).to.deep.equal({ wert: 52, quelle: 'manuell' });
    });

    it('uebergeht Nullwerte - sie tragen keine Aussage', () => {
        expect(fs.vergleichswert({ felder: {}, cloud: { waterL: 0 } }, 'waterL')).to.be.null;
    });

    it('zaehlt, wie viele Zyklen ueberhaupt belegbar sind', () => {
        const liste = [
            { felder: { 1: 5 }, cloud: { waterL: 5 } },
            { felder: { 1: 6 } },
            { felder: { 1: 7 }, manuell: { waterL: 7 } },
        ];
        expect(fs.belegbar(liste, 'waterL')).to.equal(2);
    });
});

describe('Feldsuche: Robustheit', () => {
    it('verkraftet eine leere Sammlung', () => {
        expect(fs.felderBewerten([], 'waterL')).to.be.empty;
        expect(fs.befund([], {})).to.match(/0 cycles/);
    });

    it('verkraftet Datensaetze ohne Felder', () => {
        expect(() => fs.felderBewerten([{}, { felder: null }], 'waterL')).to.not.throw();
    });

    it('rechnet mit BigInt-Feldwerten', () => {
        // DOP2 liefert 8-Byte-Felder als BigInt - siehe lib/dop2.js, readInt.
        expect(fs.alsZahl(1160n)).to.equal(1160);
    });

    it('haelt ein konstantes Feld nicht fuer falsch, wenn auch der Sollwert konstant ist', () => {
        /*
         * Liefen dreimal dieselben Programme, ist ein gleichbleibendes Feld kein Widerspruch -
         * aber auch kein Beleg. Es ist unentschieden, und genau das soll dastehen: kein
         * "passt", kein "passt nicht". Sonst entsteht der Treffer, der Feld 60 der WCR860 mit
         * drei gleichen Zyklen zum Energiezaehler erklaerte.
         */
        const gleich = [
            zyklus({ 26: 500 }, { waterL: 50 }),
            zyklus({ 26: 500 }, { waterL: 50 }),
            zyklus({ 26: 500 }, { waterL: 50 }),
        ];
        const b = fs.felderBewerten(gleich, 'waterL')[0];
        expect(b.taugt).to.be.false;
        expect(b.unentschieden).to.be.true;
        expect(b.grund).to.not.match(/schwankt/);
    });

    it('erklaert ein Feld nicht zum Treffer, wenn nur gleiche Vergleichswerte vorliegen', () => {
        /*
         * Der Fall der WCR860 in Reinform: Feld 60 steht in fast allen Zyklen auf 0 und in
         * dreien auf 1 - und das sind genau die drei mit 0,1 kWh. Rechnerisch null Prozent
         * Abweichung, inhaltlich nichts.
         */
        const wieFeld60 = [
            zyklus({ 60: 0 }, { energyKwh: 1.4 }),
            zyklus({ 60: 0 }, { energyKwh: 2.0 }),
            zyklus({ 60: 0 }, { energyKwh: 0.8 }),
            zyklus({ 60: 1 }, { energyKwh: 0.1 }),
            zyklus({ 60: 1 }, { energyKwh: 0.1 }),
            zyklus({ 60: 1 }, { energyKwh: 0.1 }),
        ];
        const b = fs.felderBewerten(wieFeld60, 'energyKwh')[0];
        expect(b.taugt).to.be.false;
    });
});

describe('Feldsuche: Nullwerte', () => {
    /*
     * Am 04.09.2026 an der WCR860 nachgezaehlt: F25 und F26 standen in sieben von elf
     * Zyklen auf 0, obwohl die Cloud fuer denselben Lauf Werte hatte. Wer diese Nullen
     * mitrechnet, gibt jedem Feld 100 Prozent Abweichung - auch dem richtigen.
     */
    const saetze = [
        zyklus({ 26: 0, 9: 670 }, { waterL: 67 }),
        zyklus({ 26: 0, 9: 310 }, { waterL: 31 }),
        zyklus({ 26: 970, 9: 970 }, { waterL: 97 }),
        zyklus({ 26: 600, 9: 600 }, { waterL: 60 }),
        zyklus({ 26: 810, 9: 810 }, { waterL: 81 }),
    ];

    it('rechnet Nullwerte nicht als Messwerte mit', () => {
        const neun = fs.felderBewerten(saetze, 'waterL').find(b => b.index === '9');
        expect(neun.taugt).to.be.true;
        expect(neun.zyklen).to.equal(5);
        expect(neun.leer).to.equal(0);
    });

    it('weist aus, wie oft ein Feld leer blieb', () => {
        const sechsundzwanzig = fs.felderBewerten(saetze, 'waterL').find(b => b.index === '26');
        expect(sechsundzwanzig.leer).to.equal(2);
        expect(sechsundzwanzig.zyklen).to.equal(3);
    });

    it('vermerkt ein Feld, das fast immer leer ist, statt es zu verschweigen', () => {
        const meistLeer = [
            zyklus({ 7: 0 }, { waterL: 67 }),
            zyklus({ 7: 0 }, { waterL: 31 }),
            zyklus({ 7: 0 }, { waterL: 97 }),
            zyklus({ 7: 500 }, { waterL: 50 }),
        ];
        const b = fs.felderBewerten(meistLeer, 'waterL')[0];
        expect(b.taugt).to.be.false;
        expect(b.grund).to.match(/is 0 in/);
    });
});

describe('Feldsuche: starr gekoppelte Felder', () => {
    /*
     * Der Befund vom 04.09.2026: Feld 26 war exakt das 1,782-fache von Feld 25, ueber alle
     * Zyklen hinweg. Ein Feld, das starr am Energiefeld haengt, kann nicht das Wasser sein -
     * dieselben Zyklen brauchten 48,5 und 73,6 l/kWh.
     */
    const echt = [
        zyklus({ 25: 319, 26: 568 }, { energyKwh: 0.7, waterL: 67 }),
        zyklus({ 25: 386, 26: 688 }, {}),
        zyklus({ 25: 2071, 26: 3692 }, { energyKwh: 2, waterL: 97 }),
        zyklus({ 25: 1593, 26: 2840 }, { energyKwh: 1.4, waterL: 60 }),
        zyklus({ 25: 770, 26: 1372 }, { energyKwh: 1.1, waterL: 81 }),
    ];

    it('findet das feste Verhaeltnis zwischen Feld 25 und 26', () => {
        const paare = fs.starrGekoppelt(echt);
        expect(paare).to.have.lengthOf(1);
        expect(paare[0].a).to.equal('25');
        expect(paare[0].b).to.equal('26');
        expect(paare[0].verhaeltnis).to.be.closeTo(1.782, 0.002);
    });

    it('meldet nichts, wo kein festes Verhaeltnis besteht', () => {
        // Echte Wasser- und Energiewerte schwanken gegeneinander - genau daran erkennt man
        // zwei unabhaengige Messungen.
        const frei = [
            zyklus({ 1: 700, 2: 670 }, {}),
            zyklus({ 1: 2000, 2: 970 }, {}),
            zyklus({ 1: 1100, 2: 810 }, {}),
        ];
        expect(fs.starrGekoppelt(frei)).to.be.empty;
    });

    it('uebergeht Nullen - sie ergaeben ein Verhaeltnis von null', () => {
        const mitNull = [
            zyklus({ 1: 0, 2: 0 }, {}),
            zyklus({ 1: 100, 2: 178 }, {}),
            zyklus({ 1: 200, 2: 356 }, {}),
            zyklus({ 1: 300, 2: 534 }, {}),
        ];
        const paare = fs.starrGekoppelt(mitNull);
        expect(paare).to.have.lengthOf(1);
        expect(paare[0].zyklen).to.equal(3);
    });
});

describe('Feldsuche: Warnung im Befund', () => {
    it('warnt, wenn das eingestellte Feld nur eine Umrechnung ist', () => {
        // Der reale Zustand am 04.09.2026: Feld 26 war als Wasser eingestellt und ist das
        // 1,782-fache des Energiefelds 25.
        const echt = [
            zyklus({ 25: 319, 26: 568 }, { energyKwh: 0.7, waterL: 67 }),
            zyklus({ 25: 2071, 26: 3692 }, { energyKwh: 2, waterL: 97 }),
            zyklus({ 25: 1593, 26: 2840 }, { energyKwh: 1.4, waterL: 60 }),
            zyklus({ 25: 770, 26: 1372 }, { energyKwh: 1.1, waterL: 81 }),
        ];
        const text = fs.befund(echt, { energie: 25, wasser: 26 });
        expect(text).to.match(/Warning/);
        expect(text).to.match(/field 26 configured for water is in a fixed ratio to field 25/);
        expect(text).to.match(/no measurement of its own/);
    });

    it('warnt nicht, wo die Felder unabhaengig sind', () => {
        const frei = [
            zyklus({ 1: 700, 2: 670 }, { energyKwh: 0.7, waterL: 67 }),
            zyklus({ 1: 2000, 2: 970 }, { energyKwh: 2, waterL: 97 }),
            zyklus({ 1: 1100, 2: 810 }, { energyKwh: 1.1, waterL: 81 }),
        ];
        expect(fs.befund(frei, { energie: 1, wasser: 2 })).to.not.match(/Warning/);
    });
});

describe('Feldsuche: krumme Teiler', () => {
    /*
     * DER FALL, DER DIE FESTE TEILERLISTE ZU FALL BRACHTE.
     *
     * Feld 21 der WCR860 traegt den Wasserverbrauch mit dem Teiler 200 - fuenf Milliliter je
     * Zaehlschritt. Gegen 1/10/100/1000 geprueft kam es auf 80 Prozent Abweichung und galt
     * als untauglich. Mit dem aus den Daten geschaetzten Teiler trifft es auf unter einem
     * Prozent. Die Zahlen unten sind die echten Messwerte vom 28.08. bis 03.09.2026.
     */
    const echt = [
        zyklus({ 21: 13341 }, { waterL: 67 }),
        zyklus({ 21: 5177 }, { waterL: 26 }),
        zyklus({ 21: 19440 }, { waterL: 97 }),
        zyklus({ 21: 11982 }, { waterL: 60 }),
        zyklus({ 21: 5027 }, { waterL: 25 }),
        zyklus({ 21: 3330 }, { waterL: 17 }),
        zyklus({ 21: 16215 }, { waterL: 81 }),
        zyklus({ 21: 12401 }, { waterL: 62 }),
    ];

    it('findet den Teiler 200, den keine Zehnerliste enthaelt', () => {
        const b = fs.felderBewerten(echt, 'waterL')[0];
        expect(b.index).to.equal('21');
        expect(b.teiler).to.be.closeTo(200, 2);
        expect(b.taugt).to.be.true;
    });

    it('trifft damit auf unter einem Prozent genau', () => {
        const b = fs.felderBewerten(echt, 'waterL')[0];
        expect(b.abweichung).to.be.below(0.01);
    });

    it('nennt den Fund im Befund', () => {
        const text = fs.befund(echt, { wasser: 26 });
        expect(text).to.match(/field 21/);
        expect(text).to.match(/but field 26/);
    });

    it('bevorzugt weiter den glatten Teiler, wo er passt', () => {
        // Ein Feld in Zehntellitern soll "10" ergeben und nicht "9.98" - sonst laese sich
        // aus dem Befund keine Einstellung ablesen.
        const zehntel = [
            zyklus({ 3: 670 }, { waterL: 67 }),
            zyklus({ 3: 310 }, { waterL: 31 }),
            zyklus({ 3: 970 }, { waterL: 97 }),
        ];
        expect(fs.felderBewerten(zehntel, 'waterL')[0].teiler).to.equal(10);
    });
});

describe('Feldsuche: gemessener Verbrauch', () => {
    const sammlerModul = require('../lib/sammler');
    const suche = require('../lib/feldsuche');

    it('behaelt den Messwert der Steckdose im Datensatz', () => {
        // Der Fehler vom 11.09.2026: gemessenWh kam herein und fehlte im Satz.
        const satz = sammlerModul.datensatzBauen({ felder: { 25: 768 }, gemessenWh: 1325.1 });
        expect(satz.gemessenWh).to.equal(1325.1);
    });

    it('laesst leere oder unsinnige Messwerte weg', () => {
        expect(sammlerModul.datensatzBauen({ felder: {}, gemessenWh: 0 })).to.not.have.property('gemessenWh');
        expect(sammlerModul.datensatzBauen({ felder: {}, gemessenWh: null })).to.not.have.property('gemessenWh');
    });

    it('zieht fuer die Energie die Messung der gerundeten Cloud vor', () => {
        const v = suche.vergleichswert({ gemessenWh: 144.7, cloud: { energyKwh: 0.1 } }, 'energyKwh');
        expect(v.quelle).to.equal('gemessen');
        expect(v.wert).to.be.closeTo(0.1447, 1e-9);
    });

    it('nimmt fuer das Wasser weiterhin die Cloud - die Steckdose misst keine Liter', () => {
        const v = suche.vergleichswert({ gemessenWh: 144.7, cloud: { waterL: 31 } }, 'waterL');
        expect(v.quelle).to.equal('cloud');
    });
});


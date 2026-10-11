'use strict';

const { expect } = require('chai');
const ls = require('../lib/leafscan');

describe('Leaf-Scan: Adressen', () => {
    it('geht die Bereiche vollstaendig durch', () => {
        const a = ls.adressen([{ unit: 2, von: 10, bis: 13 }]);
        expect(a).to.deep.equal([
            { unit: 2, attr: 10 }, { unit: 2, attr: 11 },
            { unit: 2, attr: 12 }, { unit: 2, attr: 13 },
        ]);
    });

    it('schliesst die vier bekannten Leafs ein', () => {
        // 2/119 Betriebsstunden, 2/256 Zeiten, 2/1583 Benutzeranfrage, 2/6195 EcoFeedback.
        // Waeren sie nicht dabei, taugte der Scan nicht als Gegenprobe.
        const alle = new Set(ls.adressen().map(a => ls.schluessel(a.unit, a.attr)));
        for (const bekannt of ['2/119', '2/256', '2/1583', '2/6195']) {
            expect(alle.has(bekannt), bekannt).to.be.true;
        }
    });

    it('bleibt in einer Groessenordnung, die ein Geraet vertraegt', () => {
        // Bei 700 ms Pause sind 700 Adressen rund acht Minuten reine Wartezeit - vertretbar.
        // Ein Scan ueber alle 65535 Attribute waere es nicht.
        expect(ls.adressen().length).to.be.below(1000);
    });
});

describe('Leaf-Scan: Fortsetzen', () => {
    const bereiche = [{ unit: 2, von: 1, bis: 10 }];

    it('faengt vorn an, wenn noch nichts da ist', () => {
        const n = ls.naechste({}, 3, bereiche);
        expect(n).to.deep.equal([{ unit: 2, attr: 1 }, { unit: 2, attr: 2 }, { unit: 2, attr: 3 }]);
    });

    it('setzt hinter dem Geprueften fort', () => {
        /*
         * Der Kern der Schonung: Ein Scan darf jederzeit abbrechen - Adapterneustart,
         * Netzfehler, Geraet schlaeft ein - und kostet dann nichts. Beim naechsten Mal geht
         * es an derselben Stelle weiter statt von vorn.
         */
        let erg = {};
        for (let a = 1; a <= 4; a++) erg = ls.aufnehmen(erg, 2, a, { status: 500 });
        expect(ls.naechste(erg, 2, bereiche)).to.deep.equal([
            { unit: 2, attr: 5 }, { unit: 2, attr: 6 },
        ]);
    });

    it('liefert nichts mehr, wenn alles geprueft ist', () => {
        let erg = {};
        for (let a = 1; a <= 10; a++) erg = ls.aufnehmen(erg, 2, a, { status: 500 });
        expect(ls.naechste(erg, 5, bereiche)).to.be.empty;
        expect(ls.fortschritt(erg, bereiche).text).to.match(/done/);
    });
});

describe('Leaf-Scan: Ergebnisse', () => {
    it('merkt sich die Feldwerte, nicht nur die Anzahl', () => {
        // Ohne die Werte muesste jedes gefundene Leaf noch einmal von Hand angesehen werden.
        const erg = ls.aufnehmen({}, 2, 6195, { felder: { 21: 13341, 25: 319 } });
        expect(erg['2/6195'].felder['21']).to.equal(13341);
        expect(erg['2/6195'].anzahl).to.equal(2);
    });

    it('haelt eine Absage als Absage fest', () => {
        // Auch ein 500er ist ein Ergebnis - sonst wird die Adresse ewig neu gefragt.
        const erg = ls.aufnehmen({}, 2, 999, { status: 500 });
        expect(erg['2/999'].antwortet).to.be.false;
        expect(erg['2/999'].status).to.equal(500);
    });

    it('wertet ein leeres Leaf nicht als Treffer', () => {
        const erg = ls.aufnehmen({}, 2, 5, { felder: {} });
        expect(erg['2/5'].antwortet).to.be.false;
    });

    it('sortiert die Treffer nach Feldzahl', () => {
        let erg = {};
        erg = ls.aufnehmen(erg, 2, 100, { felder: { 1: 1 } });
        erg = ls.aufnehmen(erg, 2, 200, { felder: { 1: 1, 2: 2, 3: 3 } });
        erg = ls.aufnehmen(erg, 2, 300, { status: 500 });
        expect(ls.treffer(erg)).to.deep.equal([
            { leaf: '2/200', felder: 3 }, { leaf: '2/100', felder: 1 },
        ]);
    });
});

describe('Leaf-Scan: Unterschiede zwischen zwei Scans', () => {
    /*
     * DER EIGENTLICHE ZWECK. Ein Leaf mit vierzig Feldern sagt fuer sich nichts. Erst zwei
     * Scans - einer im Leerlauf, einer waehrend eines Programms - zeigen, welche Felder
     * sich mit der Maschine bewegen. Genau diese sind die Kandidaten fuer Energie, TwinDos
     * und alles andere, was noch fehlt.
     */
    const leerlauf = {
        '2/6195': { antwortet: true, felder: { 21: 0, 25: 0, 99: 7 }, anzahl: 3 },
        '2/300': { antwortet: true, felder: { 1: 'W1' }, anzahl: 1 },
    };
    const imLauf = {
        '2/6195': { antwortet: true, felder: { 21: 13341, 25: 319, 99: 7 }, anzahl: 3 },
        '2/300': { antwortet: true, felder: { 1: 'W1' }, anzahl: 1 },
    };

    it('findet genau die Felder, die sich bewegt haben', () => {
        const u = ls.unterschiede(leerlauf, imLauf);
        expect(u).to.have.lengthOf(2);
        expect(u.map(x => x.feld).sort()).to.deep.equal(['21', '25']);
    });

    it('nennt alten und neuen Wert', () => {
        const u = ls.unterschiede(leerlauf, imLauf).find(x => x.feld === '21');
        expect(u.von).to.equal(0);
        expect(u.bis).to.equal(13341);
        expect(u.leaf).to.equal('2/6195');
    });

    it('uebergeht, was gleich geblieben ist', () => {
        // Feld 99 und das ganze Leaf 2/300 - Konfiguration und Geraetebeschreibung.
        const felder = ls.unterschiede(leerlauf, imLauf).map(x => x.feld);
        expect(felder).to.not.include('99');
        expect(ls.unterschiede(leerlauf, imLauf).map(x => x.leaf)).to.not.include('2/300');
    });

    it('verkraftet ein Leaf, das nur in einem der beiden Scans antwortet', () => {
        // Ein schlafendes Geraet antwortet auf manches nicht - das ist kein Unterschied,
        // sondern eine Luecke, und darf nicht als Bewegung gezaehlt werden.
        const halb = { '2/6195': { antwortet: false, status: 500 } };
        expect(ls.unterschiede(halb, imLauf)).to.be.empty;
        expect(ls.unterschiede(leerlauf, halb)).to.be.empty;
    });

    it('verkraftet leere Eingaben', () => {
        expect(ls.unterschiede(null, null)).to.be.empty;
        expect(ls.unterschiede({}, imLauf)).to.be.empty;
    });
});

describe('Leaf-Scan: Ueberlastung erkennen', () => {
    /*
     * Am 04.09.2026 warf die Waschmaschine nach rund 170 Adressen ihre Verbindung ab -
     * lokal und zur Cloud, beide kamen von selbst nicht zurueck. Die Vorboten standen im
     * Ergebnis: 23 abgebrochene Sockets und ein Dutzend Zeitueberschreitungen zwischen
     * ansonsten sauberen Absagen mit Status 101.
     */
    it('erkennt einen abgebrochenen Socket als Stoerung', () => {
        expect(ls.ueberlastet({ status: 'Fehler: socket hang up' })).to.be.true;
    });

    it('erkennt eine Zeitueberschreitung als Stoerung', () => {
        expect(ls.ueberlastet({ status: 'Fehler: Timeout 192.168.10.127/Devices/…' })).to.be.true;
    });

    it('haelt eine saubere Absage NICHT fuer eine Stoerung', () => {
        // 101 ist die haeufigste Antwort des Moduls auf "gibt es nicht" - wer die als
        // Stoerung zaehlt, bricht den Scan nach der ersten Handvoll Adressen ab.
        expect(ls.ueberlastet({ status: 101 })).to.be.false;
        expect(ls.ueberlastet({ status: 500 })).to.be.false;
        expect(ls.ueberlastet({ status: 404 })).to.be.false;
    });

    it('haelt einen Treffer nicht fuer eine Stoerung', () => {
        expect(ls.ueberlastet({ felder: { 1: 5 } })).to.be.false;
        expect(ls.ueberlastet(null)).to.be.false;
    });

    it('gibt dem Geraet genug Luft zwischen zwei Anfragen', () => {
        // Zwei Sekunden - siehe den Vorfall oben. 400 ms waren zu wenig.
        expect(ls.PAUSE_MS).to.be.at.least(2000);
    });
});

describe('Leaf-Scan: Antwort gegen Stoerung', () => {
    /*
     * DER FEHLER, DER DEN ZWEITEN SCANLAUF WERTLOS MACHTE.
     *
     * Am 04.09.2026 lief er, waehrend die Maschine wusch. Von 239 unbeantworteten Adressen
     * kamen 132 mit HTTP 503 zurueck und 46 mit abgebrochener Verbindung. Alles wurde als
     * "geprueft" abgelegt - und damit Adressen abgehakt, die nie wirklich gefragt wurden.
     * Zwei Leafs, die im ersten Lauf Daten geliefert hatten (2/122 und 2/123), standen
     * danach als erledigt im Ergebnis.
     */
    it('haelt 503 nicht fuer eine Antwort', () => {
        expect(ls.beantwortet({ status: 503 })).to.be.false;
        expect(ls.ueberlastet({ status: 503 })).to.be.true;
    });

    it('haelt eine echte Absage fuer eine Antwort', () => {
        // 101 ist die normale "gibt es nicht"-Antwort des Moduls, 404 und 500 ebenso.
        for (const st of [101, 404, 500]) {
            expect(ls.beantwortet({ status: st }), String(st)).to.be.true;
            expect(ls.ueberlastet({ status: st }), String(st)).to.be.false;
        }
    });

    it('haelt einen abgebrochenen Socket nicht fuer eine Antwort', () => {
        expect(ls.beantwortet({ status: 'Fehler: socket hang up' })).to.be.false;
        expect(ls.beantwortet({ status: 'Fehler: connect ECONNREFUSED 192.168.10.127:80' })).to.be.false;
        expect(ls.beantwortet({ status: 'Fehler: Parse Error: Expected HTTP/' })).to.be.false;
    });

    it('haelt gelieferte Felder immer fuer eine Antwort', () => {
        expect(ls.beantwortet({ felder: { 1: 5 } })).to.be.true;
    });

    it('haelt gar nichts nicht fuer eine Antwort', () => {
        expect(ls.beantwortet(null)).to.be.false;
        expect(ls.beantwortet({})).to.be.false;
    });
});

describe('Leaf-Scan: Reihenfolge', () => {
    /*
     * WARUM DAS GEPRUEFT WIRD. Bis zum 05.09.2026 stand Unit 1 vorn, und der Scan kam nie
     * darueber hinaus: 20 von 882 Adressen geprueft, alle in einem Bereich, der nachweislich
     * nicht antwortet. Die Reihenfolge ist hier kein Schoenheitsfehler, sondern entscheidet,
     * ob der Scan je etwas findet.
     */
    it('faengt bei den bekannten Leafs an, nicht bei Unit 1', () => {
        const ersten = ls.adressen().slice(0, 40);
        expect(ersten.every(a => a.unit === 2), 'die ersten 40 Adressen liegen in Unit 2')
            .to.be.true;
    });

    it('erreicht das EcoFeedback im ERSTEN Durchgang', () => {
        const ersten = ls.naechste({}, ls.JE_DURCHGANG);
        const schluessel = ersten.map(a => ls.schluessel(a.unit, a.attr));
        expect(schluessel).to.include('2/6100');
    });

    it('gibt Unit 1 und 3 nicht auf, stellt sie nur zurueck', () => {
        const alle = new Set(ls.adressen().map(a => ls.schluessel(a.unit, a.attr)));
        expect(alle.has('1/1'), '1/1').to.be.true;
        expect(alle.has('3/1'), '3/1').to.be.true;
    });
});

describe('Leaf-Scan: Geduld statt Abbruch', () => {
    /*
     * WARUM DAS ZAEHLT. Am 05.09.2026 stand der Scan seit vier Wochen bei 23 von 882
     * Adressen. Der Grund war nicht das Geraet, sondern die Behandlung seiner Antwort:
     * Waehrend eines Programms sagt das Modul fast jede Anfrage mit 503 ab, und fuenf davon
     * in Folge beendeten den Durchgang. Ein 503 ist aber eine Antwort - das Modul hat gehoert
     * und bittet um Geduld.
     */
    it('haelt 503 fuer beschaeftigt, nicht fuer gestoert', () => {
        expect(ls.beschaeftigt({ status: 503 })).to.be.true;
        expect(ls.beschaeftigt({ status: '503' })).to.be.true;
    });

    it('haelt einen Verbindungsabbruch NICHT fuer blosse Beschaeftigung', () => {
        // Hier ist Abbrechen richtig - so kuendigte sich der Ausfall vom 04.09.2026 an.
        expect(ls.beschaeftigt({ status: 'Fehler: socket hang up' })).to.be.false;
        expect(ls.beschaeftigt({ status: 'Fehler: Timeout' })).to.be.false;
        expect(ls.beschaeftigt({ status: 101 })).to.be.false;
    });

    it('wartet nach jeder Absage laenger', () => {
        const zeiten = [1, 2, 3, 4].map(n => ls.wartezeitMs(n));
        for (let i = 1; i < zeiten.length; i++) {
            expect(zeiten[i], `${i}. Absage`).to.be.above(zeiten[i - 1]);
        }
    });

    it('wartet nie laenger als eine Minute', () => {
        // Sonst haengt ein Durchgang an einer einzigen Adresse fest.
        expect(ls.wartezeitMs(20)).to.be.at.most(60000);
    });

    it('gibt eine Adresse nach mehreren Anlaeufen frei', () => {
        // Sie bleibt offen und kommt im naechsten Durchgang wieder dran.
        expect(ls.ABSAGEN_JE_ADRESSE).to.be.within(3, 8);
    });

    it('haelt eine Absage weiterhin nicht fuer eine Antwort', () => {
        // Sonst waere die Adresse abgehakt, ohne je gefragt worden zu sein.
        expect(ls.beantwortet({ status: 503 })).to.be.false;
    });
});

describe('Leaf-Scan: Start beim Einschalten', () => {
    const lage = (x) => ({ an: true, vorher: 1, nachher: 7, schalter: false, geprueft: false, ...x });

    it('startet, wenn ein nie durchsuchtes Geraet eingeschaltet wird', () => {
        expect(ls.beimEinschaltenStarten(lage())).to.be.true;
    });

    it('startet nicht, wenn die Automatik aus ist', () => {
        expect(ls.beimEinschaltenStarten(lage({ an: false }))).to.be.false;
    });

    it('startet nicht beim Ausschalten', () => {
        expect(ls.beimEinschaltenStarten(lage({ vorher: 7, nachher: 1 }))).to.be.false;
    });

    it('startet nicht, wenn das Geraet schon an war', () => {
        // Ein Statuswechsel mitten im Betrieb ist kein Einschalten.
        expect(ls.beimEinschaltenStarten(lage({ vorher: 5, nachher: 7 }))).to.be.false;
    });

    it('startet auch ohne bekannten Vorzustand', () => {
        // Nach einem Adapterstart steht dort nichts - das darf nicht blockieren.
        expect(ls.beimEinschaltenStarten(lage({ vorher: null }))).to.be.true;
    });

    it('startet nicht, wenn die Suche schon laeuft', () => {
        expect(ls.beimEinschaltenStarten(lage({ schalter: true }))).to.be.false;
    });

    it('ueberstimmt keine Entscheidung des Nutzers', () => {
        // Wer abgeschaltet hat, hat schon Adressen im Ergebnis - dann bleibt es aus.
        expect(ls.beimEinschaltenStarten(lage({ geprueft: true }))).to.be.false;
    });
});

describe('Leaf-Scan: Kontrollfrage, die nie antwortet', () => {
    /*
     * Kennt ein Geraet den Adressbereich der Kontrolladresse nicht, antwortet es mit 500 - von
     * "beschaeftigt" nicht zu unterscheiden. Ohne Rueckfall wuerde es nie gescannt.
     */
    it('wartet, solange die Grenze nicht erreicht ist', () => {
        expect(ls.trotzdemVersuchen({ kennt: false, taub: 3, grenze: 10 })).to.be.false;
    });

    it('wagt es nach der Grenze', () => {
        expect(ls.trotzdemVersuchen({ kennt: false, taub: 10, grenze: 10 })).to.be.true;
    });

    it('wagt nichts bei einem Geraet, das die Adresse kennt', () => {
        // Dort heisst ein 500 wirklich "gerade nicht" - das ist zu respektieren.
        expect(ls.trotzdemVersuchen({ kennt: true, taub: 99, grenze: 10 })).to.be.false;
    });
});

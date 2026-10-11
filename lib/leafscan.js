'use strict';

/*
 * Systematisch durchsuchen, welche DOP2-Leafs ein Geraet ueberhaupt beantwortet.
 *
 * WOZU
 * Der Adapter kennt bis 0.3.15 genau vier Leafs: 2/119 (Betriebsstunden), 2/256 (Rest- und
 * Laufzeit), 2/1583 (Benutzeranfrage) und 2/6195 (EcoFeedback). Woher die stammen, ist
 * nicht dokumentiert - sie wurden aus fremden Projekten uebernommen und am Geraet
 * bestaetigt. Was daneben noch antwortet, weiss niemand.
 *
 * Am 04.09.2026 wurde das zum Problem: In 2/6195 traegt KEIN Feld die verbrauchte Energie.
 * Geprueft wurden alle 47 Felder, in vier Ableitungen (Endwert, Differenz, Maximum,
 * Spanne), gegen die Shelly-Messung ueber neun Waschgaenge - das beste Feld lag 51 Prozent
 * daneben. Wenn die Zahl irgendwo im Geraet steht, dann in einem anderen Leaf.
 *
 * SCHONEND, WEIL DAS GERAET EMPFINDLICH IST
 * Ein Miele-Modul beantwortet immer nur EINE Verbindung; zwei gleichzeitige Anfragen
 * bringen es aus dem Tritt (deshalb die Warteschlange in lib/api.js). Ein Scan ueber
 * hunderte Adressen ist deshalb kein Sprint: Zwischen den Anfragen liegt eine Pause, der
 * Fortschritt wird nach jedem Schritt gesichert, und ein Abbruch kostet nichts - beim
 * naechsten Mal geht es an derselben Stelle weiter.
 *
 * WAS NICHT GESCANNT WIRD: nichts Schreibendes. Der Scan liest ausschliesslich; eine
 * unbekannte Adresse zu BESCHREIBEN koennte ein Geraet verstellen, und das waere ein sehr
 * teurer Weg, etwas herauszufinden.
 */

/**
 * Wo gesucht wird.
 *
 * Die Bereiche sind nicht geraten, sondern um die vier bekannten Adressen herum gelegt:
 * DOP2-Leafs treten in Gruppen auf, und was neben 119, 256, 1583 und 6195 liegt, gehoert
 * meist zur selben Funktionsgruppe. Unit 1 und 3 kommen dazu, weil dort bei anderen
 * Miele-Baureihen die Geraete- und Konfigurationsdaten liegen.
 */
const BEREICHE = [
    /*
     * DIE REIHENFOLGE IST DIE AUSSICHT AUF ERFOLG, nicht die Nummer.
     *
     * Bis zum 05.09.2026 stand Unit 1 vorn - und der Scan kam nie darueber hinaus: Nach vier
     * Wochen standen 20 von 882 Adressen als geprueft, alle aus Unit 1, alle ohne Antwort.
     * Ein Durchgang umfasst 40 Adressen und laeuft nur, wenn die Maschine wach ist; wer die
     * ersten 80 davon auf einen Bereich verwendet, der nachweislich schweigt, kommt nie an
     * die Stelle, an der etwas zu holen waere.
     *
     * Deshalb zuerst die Umgebung der vier bekannten Leafs (alle in Unit 2), dann der Rest.
     * Unit 1 und 3 bleiben hinten - sie werden nicht aufgegeben, nur zurueckgestellt.
     */
    { unit: 2, von: 6100, bis: 6300, was: 'around the EcoFeedback' },
    { unit: 2, von: 1500, bis: 1700, was: 'around the user request' },
    { unit: 2, von: 1, bis: 400, was: 'state and times' },
    { unit: 1, von: 1, bis: 40, was: 'device data' },
    { unit: 3, von: 1, bis: 40, was: 'configuration' },
    /*
     * UNIT 14 - die Programmlisten der Gargeraete.
     *
     * AM 15.09.2026 DAZUGEKOMMEN, und zwar aus einem konkreten Anlass: Der Backofen H2469BP
     * dieses Haushalts beantwortete ALLE 882 bis dahin gescannten Adressen mit 404. Kein
     * einziges Leaf, in drei Units. Das sah nach einem Geraet aus, das lokal nichts hergibt.
     *
     * `ha-miele-at-lan` nennt aber zwei Adressen, die in keiner der drei Units liegen:
     * 14/1570 (Programmliste des Backofens, alte Anordnung) und 14/1571 (Optionsliste zum
     * gewaehlten Programm). Ein Geraet, das an der falschen Stelle gefragt wird, schweigt
     * nicht aus Unvermoegen.
     *
     * Der Bereich ist bewusst eng: 1560 bis 1600 sind vierzig Adressen, also ein Durchgang.
     * Weiter zu suchen, waere Raten - und Raten kostet bei fuenf Sekunden je Adresse Zeit,
     * die das Modul fuer seine eigene Arbeit braucht.
     */
    { unit: 14, von: 1560, bis: 1600, was: 'program lists of cooking appliances' },
];

/**
 * Pause zwischen zwei Anfragen.
 *
 * WARUM SO LANG. Am 04.09.2026 mit 400 ms gefahren - nach rund 170 Adressen warf das
 * WLAN-Modul der Waschmaschine die Verbindung ab, lokal UND zur Cloud. Der Waschgang lief
 * weiter (das Modul haengt nicht am Programm), aber beide Anbindungen waren weg und kamen
 * von selbst nicht zurueck. Vorboten standen im Ergebnis: 23 "socket hang up" und ein
 * Dutzend Timeouts, waehrend die uebrigen Adressen sauber mit 101 absagten.
 *
 * Zwei Sekunden sind fuer einen Scan ueber 882 Adressen viel - rund eine halbe Stunde. Das
 * ist der Preis dafuer, dass ein Geraet, das nur eine Verbindung bedient, nebenher noch
 * seine eigentliche Arbeit tun kann.
 *
 * AM 07.09.2026 AUF FUENF SEKUNDEN ERHOEHT. Waehrend beide Maschinen liefen, brach jeder
 * Durchgang nach wenigen Adressen mit Verbindungsstoerungen ab - und die Waschmaschine
 * beantwortete daraufhin nicht einmal mehr ihr eigenes Eco-Leaf. Entscheidend ist die
 * Dichte der Anfragen, nicht ihre Gesamtzahl: Nach etwa einer Minute Ruhe ist das Modul
 * wieder ansprechbar, unter Dauerfeuer bleibt es stumm. Ein langsamer Scan, der durchlaeuft,
 * ist besser als ein schneller, der abbricht und von vorn anfaengt.
 */
const PAUSE_MS = 5000;

/**
 * Wann der Scan von selbst aufhoert.
 *
 * Ein Modul, das an seine Grenze kommt, sagt nicht "genug" - es bricht Verbindungen ab.
 * Genau daran wird es hier erkannt: Haeufen sich Abbrueche und Zeitueberschreitungen,
 * endet der Durchgang, statt weiter zu druecken. Der Fortschritt ist gesichert; beim
 * naechsten Anstossen geht es weiter, wenn sich das Geraet erholt hat.
 */
const ABBRUCH_FEHLER = 5;

/**
 * Zeitlimit je Scan-Anfrage - kuerzer als im Regelbetrieb.
 *
 * Am 04.09.2026 gemessen: Mit den acht Sekunden des Regelbetriebs brauchte ein Durchgang
 * ueber 60 Adressen mehr als fuenf Minuten, der ganze Scan waere auf zwei Stunden
 * hinausgelaufen. Die allermeisten Adressen existieren nicht, und eine Adresse, die es
 * gibt, antwortet schnell - wer nach drei Sekunden nichts gehoert hat, hoert auch nach
 * acht nichts.
 */
const SCAN_TIMEOUT_MS = 3000;

/** So viele Adressen je Durchgang, damit ein Scan den Adapter nicht auf Stunden bindet. */
const JE_DURCHGANG = 40;

/**
 * Nach so vielen Adressen wird zwischengespeichert.
 *
 * Ohne das ginge bei jedem Abbruch der ganze Durchgang verloren - und Abbrueche sind hier
 * die Regel, nicht die Ausnahme: Der Adapter startet neu, das Geraet schlaeft ein, das
 * Programm endet. Zehn Adressen sind rund eine halbe Minute Arbeit; mehr als das soll
 * niemand zweimal machen muessen.
 */
const SICHERN_ALLE = 10;

/**
 * Alle Adressen der Bereiche, in der Reihenfolge des Scans.
 *
 * @param bereiche die zu durchsuchenden Adressbereiche
 */
function adressen(bereiche = BEREICHE) {
    const liste = [];
    for (const b of bereiche) {
        for (let a = b.von; a <= b.bis; a++) {
            liste.push({ unit: b.unit, attr: a });
        }
    }
    return liste;
}

/**
 * Der Schluessel eines Leafs im Ergebnis - "2/6195".
 *
 * @param unit DOP2-Unit
 * @param attr DOP2-Attribut
 */
function schluessel(unit, attr) {
    return `${unit}/${attr}`;
}

/**
 * Wo geht es weiter?
 *
 * @param {object} bisher  bisheriges Ergebnis {"2/119": {...}, ...}
 * @param {number} anzahl  wie viele Adressen dieser Durchgang umfasst
 * @param bereiche die zu durchsuchenden Adressbereiche
 * @returns {Array} die naechsten Adressen
 */
function naechste(bisher, anzahl = JE_DURCHGANG, bereiche = BEREICHE) {
    const fertig = new Set(Object.keys(bisher || {}));
    const offen = [];
    for (const a of adressen(bereiche)) {
        if (fertig.has(schluessel(a.unit, a.attr))) {
            continue;
        }
        offen.push(a);
        if (offen.length >= anzahl) {
            break;
        }
    }
    return offen;
}

/**
 * Ein Ergebnis aufnehmen.
 *
 * @param {object} bisher bisheriges Ergebnis
 * @param {number} unit DOP2-Unit
 * @param {number} attr DOP2-Attribut
 * @param {object} was  {status, felder} bei Erfolg, {status} bei Absage
 */
function aufnehmen(bisher, unit, attr, was) {
    const erg = Object.assign({}, bisher);
    const k = schluessel(unit, attr);
    if (was && was.felder && Object.keys(was.felder).length) {
        /*
         * Die Werte werden mitgeschrieben, nicht nur die Feldzahl.
         *
         * Ein Leaf, das antwortet, sagt fuer sich noch nichts - erst der Vergleich zweier
         * Zeitpunkte zeigt, welches Feld sich mit dem Programm bewegt. Ohne die Werte
         * muesste man jedes gefundene Leaf noch einmal von Hand ansehen.
         */
        erg[k] = { antwortet: true, felder: was.felder, anzahl: Object.keys(was.felder).length };
    } else {
        erg[k] = { antwortet: false, status: (was && was.status) || null };
    }
    return erg;
}

/**
 * Sieht dieses Ergebnis nach einem ueberlasteten Modul aus?
 *
 * Eine saubere Absage ("es gibt diese Adresse nicht") kommt als HTTP-Status - beim
 * Miele-Modul meist 101. Ein abgebrochener Socket oder eine Zeitueberschreitung ist etwas
 * anderes: Da hat das Modul nicht geantwortet, weil es nicht konnte.
 *
 * @param ergebnis Ergebnis einer Abfrage
 */
function ueberlastet(ergebnis) {
    const st = ergebnis && ergebnis.status;
    // 503 heisst "gerade nicht" - das Geraet ist beschaeftigt, nicht die Adresse leer.
    if (st === 503 || st === '503') {
        return true;
    }
    return typeof st === 'string' && /hang up|Timeout|ECONNRESET|ECONNREFUSED|EPIPE|socket|Parse Error/i.test(st);
}

/**
 * Ist das Geraet nur BESCHAEFTIGT - oder wirklich am Ende?
 *
 * DER UNTERSCHIED ENTSCHEIDET, OB DER SCAN JE FERTIG WIRD. Beides galt bisher gleich viel:
 * Fuenf davon in Folge, und der Durchgang brach ab. Waehrend die Waschmaschine laeuft, kommt
 * aber fast jede Antwort als 503 - der Scan kam am 05.09.2026 in vier Wochen ueber 23 von
 * 882 Adressen nicht hinaus.
 *
 * Ein 503 ist eine HOEFLICHE ABSAGE: Das Modul hat die Frage gehoert und antwortet, es sei
 * gerade beschaeftigt. Darauf gehoert Geduld, kein Rueckzug - man wartet laenger und fragt
 * erneut.
 *
 * Ein abgebrochener Socket oder eine Zeitueberschreitung ist etwas anderes: Da hat das Modul
 * nicht geantwortet, WEIL ES NICHT KONNTE. Genau daran kuendigte sich am 04.09.2026 der
 * Ausfall an, bei dem es lokal und zur Cloud die Verbindung verlor. Dabei bleibt es beim
 * Abbruch.
 *
 * @param ergebnis Ergebnis einer Abfrage
 */
function beschaeftigt(ergebnis) {
    const st = ergebnis && ergebnis.status;
    return st === 503 || st === '503';
}

/**
 * Wie lange nach einer Absage gewartet wird, bevor dieselbe Adresse erneut drankommt.
 *
 * Verdoppelt sich mit jeder Absage in Folge und ist bei einer Minute gedeckelt: Wer waehrend
 * eines Waschgangs scannt, soll nicht im Sekundentakt anklopfen, aber auch nicht eine
 * Viertelstunde blind warten. Nach der ersten Antwort faengt die Zaehlung wieder bei null an.
 */
/**
 * Wie oft dieselbe Adresse hoechstens neu gefragt wird, wenn das Geraet beschaeftigt ist.
 *
 * Fuenf Anlaeufe sind mit der Verdopplung rund zwei Minuten Geduld je Adresse. Danach zieht
 * der Scan weiter - die Adresse bleibt offen und kommt im naechsten Durchgang wieder dran.
 * Ewig zu warten hiesse, einen Durchgang an einer einzigen Adresse aufzuhaengen.
 */
const ABSAGEN_JE_ADRESSE = 5;

/**
 * Wartezeit vor dem naechsten Scanversuch - verdoppelt sich je Absage, hoechstens eine Minute.
 *
 * @param {number} absagenInFolge   wie oft das Geraet nacheinander abgelehnt hat
 * @returns {number} Wartezeit in Millisekunden
 */
function wartezeitMs(absagenInFolge) {
    return Math.min(PAUSE_MS * Math.pow(2, absagenInFolge), 60000);
}

/**
 * War das eine ANTWORT auf die Frage - oder nur ein "gerade nicht"?
 *
 * DAS IST DER UNTERSCHIED, AN DEM DER ZWEITE SCANLAUF GESCHEITERT IST. Am 04.09.2026 lief
 * er, waehrend die Maschine wusch: Von 239 unbeantworteten Adressen kamen 132 mit HTTP 503
 * zurueck, dazu 46 abgebrochene Verbindungen. Der Code hat all das als "geprueft"
 * abgelegt - und damit Adressen abgehakt, die nie wirklich gefragt wurden. Zwei Leafs, die
 * im ersten Lauf noch Daten geliefert hatten (2/122 und 2/123), standen danach als
 * erledigt im Ergebnis und waeren nie wieder an die Reihe gekommen.
 *
 * Eine Absage ist nur dann eine Absage, wenn das Geraet sie ausgesprochen hat: 101 ("gibt
 * es nicht"), 404, 500. Alles andere bleibt offen.
 *
 * @param ergebnis Ergebnis einer Abfrage
 */
function beantwortet(ergebnis) {
    if (ergebnis && ergebnis.felder && Object.keys(ergebnis.felder).length) {
        return true;
    }
    const st = ergebnis && ergebnis.status;
    if (st == null) {
        return false;
    }
    if (ueberlastet(ergebnis)) {
        return false;
    }
    return typeof st === 'number' || /^\d+$/.test(String(st));
}

/**
 * Wie weit ist der Scan?
 *
 * @param bisher bisheriges Ergebnis
 * @param bereiche die zu durchsuchenden Adressbereiche
 */
function fortschritt(bisher, bereiche = BEREICHE) {
    const alle = adressen(bereiche).length;
    const fertig = Object.keys(bisher || {}).length;
    const gefunden = Object.values(bisher || {}).filter(x => x.antwortet).length;
    return {
        alle,
        fertig,
        offen: alle - fertig,
        gefunden,
        text: `${fertig} of ${alle} addresses checked, ${gefunden} answering${
            fertig < alle ? ` - ${alle - fertig} still open` : ' - done'
        }`,
    };
}

/**
 * Nur die Leafs, die geantwortet haben - nach Feldzahl sortiert.
 *
 * @param bisher bisheriges Ergebnis
 */
function treffer(bisher) {
    return Object.entries(bisher || {})
        .filter(([, v]) => v.antwortet)
        .map(([k, v]) => ({ leaf: k, felder: v.anzahl }))
        .sort((a, b) => b.felder - a.felder);
}

/**
 * Was hat sich seit dem letzten Scan bewegt?
 *
 * DAS IST DER EIGENTLICHE ZWECK. Ein Leaf mit vierzig Feldern ist nur dann interessant,
 * wenn sich darin etwas aendert, waehrend die Maschine laeuft. Zwei Scans - einer im
 * Leerlauf, einer waehrend eines Programms - und die Felder, die dazwischen anders sind,
 * sind die Kandidaten. Alles andere ist Konfiguration und Geraetebeschreibung.
 *
 * @param vorher Ergebnis des vorigen Scans
 * @param nachher Ergebnis des aktuellen Scans
 */
function unterschiede(vorher, nachher) {
    const raus = [];
    for (const [leaf, neu] of Object.entries(nachher || {})) {
        const alt = (vorher || {})[leaf];
        if (!alt || !alt.antwortet || !neu.antwortet) {
            continue;
        }
        for (const [idx, wert] of Object.entries(neu.felder || {})) {
            const vorWert = (alt.felder || {})[idx];
            if (vorWert === undefined) {
                continue;
            }
            if (JSON.stringify(vorWert) !== JSON.stringify(wert)) {
                raus.push({ leaf, feld: idx, von: vorWert, bis: wert });
            }
        }
    }
    return raus;
}

/**
 * Soll die Suche anspringen, weil ein Geraet eingeschaltet wurde?
 *
 * Ein Geraet, das die meiste Zeit aus ist, wird sonst nie durchsucht - der Scan braucht ein
 * waches Modul, und wer soll den Schalter genau dann umlegen? Beim Backofen ist das der
 * Regelfall.
 *
 * Die Automatik greift nur beim Uebergang aus dem Aus-Zustand und nur bei einem Geraet, dessen
 * Suche noch nie gelaufen ist. Damit kann sie keine Entscheidung ueberstimmen: Wer den Schalter
 * bewusst ausmacht, hat dann schon Adressen im Ergebnis.
 *
 * @param {object} lage  {an, vorher, nachher, schalter, geprueft}
 * @param lage.an ob die automatische Suche eingeschaltet ist
 * @param lage.vorher vorheriger Statuswert des Geraets (1 = aus)
 * @param lage.nachher neuer Statuswert des Geraets
 * @param lage.schalter ob die Suche gerade laeuft (Schalter an)
 * @param lage.geprueft ob die Suche fuer das Geraet schon einmal gelaufen ist
 * @returns {boolean} true, wenn die Suche jetzt starten soll
 */
function beimEinschaltenStarten({ an, vorher, nachher, schalter, geprueft }) {
    if (!an) {
        return false;
    }
    if (Number(nachher) === 1) {
        return false;
    } // wird gerade ausgeschaltet
    if (vorher != null && Number(vorher) !== 1) {
        return false;
    } // war schon an
    if (schalter === true) {
        return false;
    } // laeuft bereits
    return !geprueft; // schon einmal gelaufen: Finger weg
}

/**
 * Darf trotz stummer Kontrollfrage gescannt werden?
 *
 * Die Kontrollfrage setzt voraus, dass das Geraet den Adressbereich der Kontrolladresse kennt -
 * sonst antwortet es mit 500 statt mit 404, und das ist von "gerade beschaeftigt" nicht zu
 * unterscheiden. Ein solches Geraet wuerde nie gescannt.
 *
 * Deshalb: Hat es die Kontrollfrage noch NIE beantwortet, wird nach `grenze` Anlaeufen trotzdem
 * ein Durchgang gewagt. Sobald sie einmal geantwortet hat, gilt sie fuer dieses Geraet.
 *
 * @param {object} lage  {kennt, taub, grenze}
 * @param lage.kennt ob die Kontrollfrage frueher schon beantwortet wurde
 * @param lage.taub wie oft sie zuletzt unbeantwortet blieb
 * @param lage.grenze erlaubte Zahl unbeantworteter Kontrollfragen
 * @returns {boolean} true, wenn trotzdem gescannt werden darf
 */
function trotzdemVersuchen({ kennt, taub, grenze }) {
    if (kennt) {
        return false;
    }
    return (taub || 0) >= grenze;
}

module.exports = {
    BEREICHE,
    PAUSE_MS,
    SCAN_TIMEOUT_MS,
    JE_DURCHGANG,
    SICHERN_ALLE,
    ABBRUCH_FEHLER,
    ABSAGEN_JE_ADRESSE,
    ueberlastet,
    beantwortet,
    beschaeftigt,
    wartezeitMs,
    adressen,
    schluessel,
    naechste,
    aufnehmen,
    fortschritt,
    treffer,
    unterschiede,
    beimEinschaltenStarten,
    trotzdemVersuchen,
};

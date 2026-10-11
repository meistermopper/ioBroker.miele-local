'use strict';

/*
 * Aus einem gelesenen Leaf-Feld einen ioBroker-Datenpunkt machen - oder eben keinen.
 *
 * WOZU
 * Die Namenstabelle (lib/leafnamen.js) sagt, WIE ein Feld heisst. Sie sagt nicht, ob das eigene
 * Geraet es fuehrt: Sie stammt von fremden Geraeten, und ein Backofen kennt die Felder einer
 * Waschmaschine nicht. Wer alle Namen blind anlegt, bekommt hunderte Datenpunkte, die auf 0
 * stehen und in der Anzeige nicht von einer echten Null zu unterscheiden sind.
 *
 * DESHALB DIE REGEL: Ein Datenpunkt entsteht erst, wenn das Geraet das Feld tatsaechlich
 * geliefert hat - mit dem Typ, den der gelieferte Wert hat. Liefert es das Feld nicht, gibt es
 * den Punkt nicht. Das kostet einen Programmlauf Geduld und erspart einen Baum voller Nullen.
 *
 * EINHEITEN NUR, WO SIE GEMESSEN SIND
 * Ein Name wie "currentPowerConsumption" sagt, WAS gezaehlt wird, nicht in welchen Schritten.
 * Hier steht ein Teiler nur dort, wo er an einem echten Geraet gegen eine unabhaengige Quelle
 * geprueft wurde (siehe lib/felder.js, EINHEITEN). Fuer alles andere steht der Rohwert da -
 * lieber eine nackte Zahl als eine falsch skalierte.
 */

const leafnamen = require('./leafnamen');
const dop2 = require('./dop2');
const namen = require('./names');

/**
 * Unter welchem Kanal die Felder einer Struktur stehen.
 *
 * Der Kanal ist bewusst nicht die Leaf-Nummer: "detail.process.heatingEnergy" ist zu lesen,
 * "detail.2_6195.25" nicht. Strukturen ohne Eintrag landen unter ihrer Adresse - sie sind
 * selten, und eine erfundene Uebersetzung waere schlechter als die Nummer.
 */
const KANAELE = {
    Process: 'process',
    ActuatorData: 'actuators',
    Sensor: 'sensors',
    CSHoursOfOperation: 'operatingTime',
    DeviceState: 'deviceState',
    DeviceCombiState: 'combinedState',
    DeviceContext: 'context',
    DeviceAttributesDWTDWM: 'ecoFeedback',
    DeviceAttributesCCA: 'ecoFeedback',
    ProgramList: 'programList',
    XkmStateInfo: 'module',
    XkmIdent: 'module',
    SoftwareBuild: 'software',
    Failure: 'failure',
    FailureList: 'failure',
    FeatureList: 'features',
    PSAttributesCCA: 'programState',
    PSContext: 'programState',
    CSContext: 'programState',
    // Ersatzteil-Kennzeichnung, die die Spuelmaschine unter 2/173 und 2/174 fuehrt
    // ("1 EPWX ID" und ein Barcode). Kein Messwert, aber im Servicefall die Auskunft,
    // welches Bauteil verbaut ist - deshalb ein eigener Kanal statt der nackten Adresse.
    PartName: 'service',
    CSBarcode: 'service',
};

/**
 * Strukturen, aus denen KEIN Datenpunkt entsteht.
 *
 * DeviceIdentStrings (2/145) traegt Seriennummer, Modell und Materialnummer - und alle drei
 * stehen laengst im Baum: `info.fabNumber` (Rolle info.serial), `info.techType`,
 * `info.matNumber`, gefuellt aus der Geraetekennung. Ein zweiter Satz derselben Angaben unter
 * `detail` waere kein Gewinn, sondern eine zweite Wahrheit, die beim naechsten Umbau von der
 * ersten abweicht.
 *
 * Der Datenschutz spielt hier NICHT hinein: Der Objektbaum bleibt in der eigenen Instanz. Die
 * Seriennummer wegzulassen ist eine Regel der DATENSAMMLUNG, weil die weitergegeben wird -
 * siehe lib/sammler.js.
 *
 * Die Dateisystem- und Uebertragungsstrukturen sind Protokollinnenleben und fuer niemanden ein
 * Messwert.
 */
const NICHT_ANLEGEN = new Set([
    'DeviceIdentStrings',
    'FileList',
    'FileInfo',
    'FileWrite',
    'FileTransfer',
    'RsaKey',
    'HeisluftPlus',
    'NotificationAcknowledge',
    'UserRequest',
    'XkmRequest',
]);

/**
 * Was ueber einzelne Felder mehr bekannt ist als ihr Name.
 *
 * Schluessel ist "Struktur.Feldnummer". `teiler` und `einheit` stehen nur dort, wo beides
 * nachgemessen ist; die Belege stehen in lib/felder.js. `rolle` steuert nur die Anzeige.
 */
const BESONDERS = {
    // Belegt an der WCR860 (siehe lib/felder.js, EINHEITEN).
    'Process.15': { teiler: 10, einheit: '°C', rolle: 'value.temperature' },
    // Rolle 'value' statt 'value.volume': Letztere kennt der ioBroker-Rollenkatalog nicht,
    // der Pruefer meldet sie als E1008. Gleiche Entscheidung wie in main.js und objects.js.
    'Process.21': { teiler: 200, einheit: 'l', rolle: 'value' },
    'Process.65': { teiler: 2, einheit: 'kg', rolle: 'value' },
    // Belegt ueber 19 Laeufe: F26/F25 = 1,7825 = 3600 s/h / 2020 W (siehe docs/Messungen).
    'Process.25': { einheit: 'Wh', rolle: 'value.power.consumption' },
    'Process.26': { einheit: 's', rolle: 'value.interval' },
    // Ohne Teiler: am 15.09.2026 stand dort 40 bei einem 40-Grad-Programm, also ganze Grad.
    'Process.24': { einheit: '°C', rolle: 'value.temperature' },
    'Process.4': { einheit: 'min', rolle: 'value.interval' },
    'Process.27': { einheit: 'rpm', rolle: 'value' },
    'Sensor.3': { einheit: 'rpm', rolle: 'value' },
    // 2/119 zaehlt in Minuten - am laufenden Geraet nachgemessen, siehe lib/felder.js.
    'CSHoursOfOperation.1': { teiler: 60, einheit: 'h', rolle: 'value.interval' },
    'CSHoursOfOperation.2': { teiler: 60, einheit: 'h', rolle: 'value.interval' },
    'CSHoursOfOperation.3': { teiler: 60, einheit: 'h', rolle: 'value.interval' },
    'CSHoursOfOperation.4': { teiler: 60, einheit: 'h', rolle: 'value.interval' },
    'CSHoursOfOperation.5': { teiler: 60, einheit: 'h', rolle: 'value.interval' },
    'DeviceState.7': { einheit: 's', rolle: 'value.interval' },
    'DeviceState.8': { einheit: 's', rolle: 'value.interval' },
};

/**
 * Deutsche Beschriftungen fuer die Felder, die jemand wirklich ansieht.
 *
 * Ohne Eintrag bleibt der englische Name aus der Reverse-Engineering-Arbeit stehen. Das ist
 * Absicht: Ein erfundener deutscher Name fuer ein Feld, dessen Bedeutung niemand geprueft hat,
 * taeuscht Wissen vor, das nicht da ist.
 */
const DEUTSCH = {
    'Process.4': 'Restzeit',
    'Process.5': 'Programmphase',
    'Process.8': 'Heizrelais',
    'Process.15': 'Temperatur am Frequenzumrichter',
    'Process.21': 'Wasser (Durchflusszähler)',
    'Process.24': 'Zieltemperatur der Heizung',
    'Process.25': 'Heizenergie',
    'Process.26': 'Heizzeit',
    'Process.27': 'Trommeldrehzahl',
    'Process.65': 'Beladung',
    'ActuatorData.1': 'Heizung 1',
    'ActuatorData.7': 'Heizung 2',
    'ActuatorData.2': 'Laugenpumpe',
    'ActuatorData.3': 'Intensivpumpe',
    'Sensor.1': 'Wasserstand',
    'Sensor.3': 'Schleuderdrehzahl',
    'Sensor.4': 'Türschalter',
    'Sensor.5': 'Türverriegelung',
    'CSHoursOfOperation.1': 'Betriebszeit gesamt',
    'CSHoursOfOperation.2': 'Betriebszeit vor dem Austausch',
    'CSHoursOfOperation.3': 'Betriebszeit seit der letzten Wartung',
    'DeviceState.7': 'Restzeit',
    'DeviceState.8': 'Laufzeit',
    'DeviceCombiState.1': 'Gerätezustand',
    'DeviceCombiState.2': 'Betriebszustand',
    'DeviceCombiState.3': 'Prozesszustand',
};

/**
 * Aus den geparsten Feldern eines Leafs die ISTWERTE holen - auch aus Unterstrukturen.
 *
 * DREI FAELLE, und sie sehen im Abzug gleich aus:
 *
 *   1. Ein Messwert in seiner Huelle:  Feld 25 = [Maske, 2020, Deutung]   -> 2020
 *   2. Eine Liste:                     Feld 2  = [1, 133, 3, ...]         -> die Liste
 *   3. Eine weitere Struktur:          2/1585 Feld 6 = die EcoFeedback-Werte des Geraets
 *
 * Fall 3 laesst sich nicht an den Daten erkennen, nur an der Namenstabelle: Sie sagt, hinter
 * welchem Feld eine benannte Unterstruktur steckt (lib/leafnamen.js, UNTERSTRUKTUR). Genau da
 * liegen die Zahlen, die Miele in der App anzeigt - deshalb ist der Fall die Muehe wert.
 *
 * @param {string} leaf   "2/1585"
 * @param {object} fields wie parseLeaf sie liefert: {idx: {type, value}}
 * @returns {Array} [{struktur, idx, wert, pfad}] - pfad ist "6.4" bei Unterstrukturen
 */
function istwerte(leaf, fields) {
    const struktur = leafnamen.strukturVon(leaf);
    if (!struktur) {
        return [];
    }
    return ausStruktur(struktur, fields, '');
}

function ausStruktur(struktur, fields, praefix) {
    const aus = [];
    const unter = leafnamen.UNTERSTRUKTUR[struktur] || {};
    for (const [idx, f] of Object.entries(fields || {})) {
        if (!f) {
            continue;
        }
        const nr = Number(idx);
        const kind = unter[nr];
        if (kind && f.type === dop2.TYP_STRUKTUR && Array.isArray(f.value)) {
            /*
             * Eine benannte Unterstruktur - ihre Felder tragen eigene Nummern.
             *
             * Die Nummern sind lueckenhaft: 2/1585 Feld 6 (die EcoFeedback-Werte) zaehlt
             * 1, 3, 4, 5 ... 36. Deshalb wird jedes Feld ueber SEINE Nummer zugeordnet und
             * nicht ueber seine Stelle. Ein Abzug ohne Nummern - so entstanden alle vor dem
             * 15.09.2026 - wird uebersprungen statt falsch gedeutet.
             */
            const innen = {};
            for (const e of f.value) {
                if (e && typeof e === 'object' && typeof e.id === 'number') {
                    innen[e.id] = e;
                }
            }
            if (Object.keys(innen).length) {
                for (const u of ausStruktur(kind, innen, `${praefix}${nr}.`)) {
                    aus.push(u);
                }
                continue;
            }
        }
        const wert =
            f.type === dop2.TYP_STRUKTUR && Array.isArray(f.value)
                ? dop2.reinerWert(dop2.wertAusStruktur(f.value))
                : dop2.reinerWert(f.value);
        if (wert === undefined || wert === null) {
            continue;
        }
        aus.push({ struktur, idx: nr, wert, pfad: `${praefix}${nr}` });
    }
    return aus;
}

/**
 * Der Kanal einer Struktur.
 *
 * EINE UNTERSTRUKTUR GEHOERT ZU IHREM LEAF, nicht in einen eigenen Zweig. Am 19.09.2026 an
 * der Spuelmaschine gesehen: Feld 2 von 2/256 ist die Struktur "RemoteEnable" mit den vier
 * Freigaben fuer Fernbedienung. Sie steht in keiner Kanaltabelle, und so landeten ihre Felder
 * unter "leaf2_256", waehrend die uebrigen elf Felder desselben Leaf unter "deviceState"
 * standen - derselbe Abruf, zwei Kanaele, und der eine mit einer Nummer als Namen.
 *
 * Deshalb faellt der Kanal der Reihe nach zurueck: eigener Eintrag, sonst der des Leaf, und
 * erst wenn auch der fehlt, die Adresse.
 *
 * @param {string} struktur  Name der Struktur, in der das Feld steht
 * @param {string} leaf      "2/256"
 */
function kanalFuer(struktur, leaf) {
    if (KANAELE[struktur]) {
        return KANAELE[struktur];
    }
    const traeger = leafnamen.strukturVon(leaf);
    if (traeger && KANAELE[traeger]) {
        return KANAELE[traeger];
    }
    return `leaf${String(leaf || struktur).replace(/[^0-9A-Za-z]+/g, '_')}`;
}

/**
 * Was ein gelieferter Wert fuer ein ioBroker-Objekt bedeutet.
 *
 * Der Typ kommt aus dem WERT, nicht aus der Namenstabelle: Ein Feld, das die Tabelle als Zahl
 * fuehrt, kann auf einem anderen Geraet ein Wahrheitswert sein. Listen werden als JSON
 * abgelegt - ein Datenpunkt je Listenelement waere bei einer Programmliste mit zwanzig
 * Eintraegen ein Baum ohne Nutzen.
 *
 * @param wert vom Geraet gelieferter Wert
 */
function typVon(wert) {
    if (typeof wert === 'boolean') {
        return { type: 'boolean', role: 'indicator', def: false };
    }
    if (typeof wert === 'number') {
        return { type: 'number', role: 'value', def: 0 };
    }
    if (typeof wert === 'string') {
        return { type: 'string', role: 'text', def: '' };
    }
    if (Array.isArray(wert)) {
        return { type: 'string', role: 'json', def: '' };
    }
    return null;
}

/**
 * Die Definition eines Datenpunkts fuer ein geliefertes Feld - oder null.
 *
 * @param {string} leaf       "2/6195"
 * @param {string} struktur    Name der Struktur, in der das Feld steht
 * @param {number|string} idx  Feldnummer INNERHALB dieser Struktur
 * @param {unknown} wert       der Wert, den das Geraet geliefert hat
 * @param {boolean} deutsch    deutsche Beschriftungen
 * @returns {{kanal: string, sub: string, common: object, wert: unknown}|null} Kanal, Name, common-Teil und Wert des Datenpunkts; null, wenn keiner angelegt wird
 */
function definition(leaf, struktur, idx, wert, deutsch) {
    if (!struktur || NICHT_ANLEGEN.has(struktur)) {
        return null;
    }
    const name = leafnamen.feldNameIn(struktur, idx);
    // Ohne Namen kein Datenpunkt: Eine Zahl namens "42" hilft niemandem, und der Rohwert steht
    // ohnehin im Verlauf und in der CSV.
    if (!name) {
        return null;
    }
    const typ = typVon(wert);
    if (!typ) {
        return null;
    }

    const schluessel = `${struktur}.${Number(idx)}`;
    const extra = BESONDERS[schluessel] || {};
    let val = wert;
    if (typ.type === 'string' && typ.role === 'json') {
        val = JSON.stringify(wert);
    }
    if (typ.type === 'number' && extra.teiler) {
        val = Math.round((Number(wert) / extra.teiler) * 100) / 100;
    }

    const beschriftung = DEUTSCH[schluessel] ? namen.text(DEUTSCH[schluessel], name, deutsch) : name;
    const common = {
        name: beschriftung,
        role: (typ.type === 'number' && extra.rolle) || typ.role,
        type: typ.type,
        read: true,
        write: false,
        def: typ.def,
    };
    if (extra.einheit && typ.type === 'number') {
        common.unit = extra.einheit;
    }
    return { kanal: kanalFuer(struktur, leaf), sub: name, common, wert: val };
}

/**
 * Alle Datenpunkte, die ein gelesenes Leaf hergibt.
 *
 * @param {string} leaf    "2/6195"
 * @param {object} fields  wie parseLeaf sie liefert: {idx: {type, value}}
 * @param {boolean} deutsch deutsche Beschriftungen
 * @returns {Array} Definitionen, moeglicherweise leer
 */
function fuerLeaf(leaf, fields, deutsch) {
    const aus = [];
    for (const w of istwerte(leaf, fields)) {
        const d = definition(leaf, w.struktur, w.idx, w.wert, deutsch);
        if (d) {
            aus.push(d);
        }
    }
    return aus;
}

/**
 * Die Kanaele in beiden Sprachen - deutsch als Schluessel, wie ueberall im Adapter.
 *
 * Als eigene Tabelle und nicht im Funktionsrumpf, damit der Uebersetzungstest sie findet:
 * Er sucht die deutschen Namen im Quelltext und prueft, ob lib/names.js alle elf Sprachen
 * dafuer fuehrt. Ein Name, der nur in einer Funktion steht, faellt ihm durch.
 */
const KANAL_NAMEN = {
    process: ['Prozessdaten', 'Process data'],
    actuators: ['Aktoren', 'Actuators'],
    sensors: ['Sensoren', 'Sensors'],
    operatingTime: ['Betriebszeit', 'Operating time'],
    deviceState: ['Gerätezustand', 'Device state'],
    combinedState: ['Zustand (kombiniert)', 'Combined state'],
    context: ['Gerätekontext', 'Device context'],
    ecoFeedback: ['EcoFeedback des Geräts', 'Device EcoFeedback'],
    programList: ['Programmliste', 'Program list'],
    module: ['Kommunikationsmodul', 'Communication module'],
    software: ['Software', 'Software'],
    failure: ['Störungen', 'Failures'],
    features: ['Fähigkeiten', 'Features'],
    programState: ['Programmzustand', 'Program state'],
    service: ['Kundendienst', 'Service'],
};

/**
 * Der Anzeigename eines Kanals.
 *
 * @param kanal Kennung des Kanals
 * @param deutsch deutsche Beschriftungen
 */
function kanalName(kanal, deutsch) {
    const t = KANAL_NAMEN[kanal];
    return t ? namen.text(t[0], t[1], deutsch) : kanal;
}

module.exports = {
    KANAELE,
    KANAL_NAMEN,
    NICHT_ANLEGEN,
    BESONDERS,
    DEUTSCH,
    definition,
    fuerLeaf,
    istwerte,
    kanalFuer,
    kanalName,
    typVon,
};

'use strict';

/**
 * Was die einzelnen Felder der DOP2-Leafs bedeuten.
 *
 * WOHER DIE NAMEN STAMMEN. Aus der Reverse-Engineering-Arbeit von `MieleRESTServer` (akappner),
 * dort `dop2rs/src/payloader/device/washer/{process,actuator,sensor}.rs`, und aus
 * `ha-miele-at-lan` (tiehfood) fuer 2/119 und 2/1585. Miele selbst veroeffentlicht nichts davon.
 * Uebernommen wird nur die BENENNUNG - die Werte liest dieser Adapter selbst, und wo sich Name und
 * Messung widersprechen, zaehlt die Messung (siehe unten "energyConsumed").
 *
 * WOZU. Bis 0.3.36 standen die Rohfelder als blosse Nummern im Verlauf: "25: 319, 26: 568". Wer
 * ein Feld zuordnen wollte, musste raten. Mit den Namen ist sofort zu sehen, dass 25 die
 * HEIZenergie und 26 die HEIZzeit ist - und damit auch, warum 26 stets das 1,782-fache von 25 war
 * und beide nie zum Gesamtverbrauch passten (siehe README, Feldsuche).
 *
 * DIE NAMEN SIND NICHT GEPRUEFT, sondern eine Lesehilfe. Die Zuordnung stammt von anderen Geraeten
 * und anderen Modulen; ob sie fuer das eigene Geraet stimmt, entscheidet weiterhin die
 * Datensammlung mit ihrem Vergleich gegen Cloud und Messsteckdose.
 */

/** 2/6195 - Prozessdaten der Waschmaschine ("Process"). */
const PROCESS = {
    1: 'blockNumber',
    2: 'blockStep',
    3: 'loadLevel',
    4: 'remainingTimeInMinutes',
    5: 'programPhase',
    6: 'spinProfileNumber',
    7: 'currentLevel',
    8: 'heaterRelay',
    9: 'lyePump',
    10: 'circulationPump',
    11: 'coldWaterValve',
    12: 'hotWaterValve',
    13: 'waterDistributorCurrentPosition',
    14: 'waterDistributorTargetPosition',
    15: 'fuTemperature',
    16: 'energyConsumed',
    17: 'waterConsumedInLitres',
    18: 'washBlock',
    19: 'washBlockIndex',
    20: 'hygieneCounter',
    21: 'totalImpulses',
    22: 'waterInletSuctionTime1',
    23: 'waterInletSuctionTime2',
    24: 'heatingTargetTemperature',
    25: 'heatingEnergy',
    26: 'heatingTime',
    27: 'rpmCurrent',
    28: 'currentUnbalanceMass',
    29: 'steamReleaseResult',
    30: 'sewFlowState',
    31: 'sewActive',
    32: 'sewLoadQuantity',
    33: 'sewLoadLevel',
    34: 'sewTotalFilledQuantity',
    36: 'sewHeatingTime',
    39: 'sewMtvMomentOfInertiaX10000',
    40: 'sewCorrectionFactorPMeasurementNew',
    41: 'gsProgramNumber',
    58: 'stepAdvanceSwitching',
    59: 'throttleTemperature',
    60: 'abortError',
    61: 'unbalanceMode',
    62: 'tbKgResultBss1200',
    63: 'tbKgResultBss600',
    64: 'tbKgResultBss800',
    65: 'tbKgResultIntegral110',
    66: 'tbKgResultIntegral95',
};

/** 2/6192 - Schaltzustaende der Aktoren. */
const AKTOREN = {
    1: 'heater1',
    2: 'lyePump',
    3: 'intensiveFlowPump',
    4: 'valve1',
    5: 'valve2',
    6: 'waterDistributorMotor',
    7: 'heater2',
    8: 'twinDosPump1',
    9: 'twinDosPump2',
    10: 'steamHeater',
    11: 'steamPump',
    12: 'dosRel1',
    13: 'dosRel2',
    14: 'dosRel3',
    15: 'dosRel4',
    16: 'dosRel5',
    17: 'dosRel6',
    18: 'actCoinerEnd',
    19: 'actCoinerOperation',
    20: 'sensPeakLoad',
};

/** 2/6193 - Sensoren. */
const SENSOREN = {
    1: 'waterLevel',
    2: 'waterInletWay',
    3: 'spinSpeed',
    4: 'doorSwitch',
    5: 'doorLockSwitch',
    6: 'wpsSwitch',
    7: 'twinDosSwitchContainer1',
    8: 'twinDosSwitchContainer2',
    9: 'ntcTemperature1',
    10: 'ntcTemperature2',
    11: 'lanceContact',
    12: 'peakLoadSignal',
    13: 'detectedCap',
    14: 'dispenserDrawerSwitch',
    15: 'steamUnitTemperature',
    16: 'sensCoinerPayment',
};

/*
 * 2/119 - Betriebszeit. ALLE FUENF WERTE SIND MINUTEN, nicht Stunden (ha-miele-at-lan).
 *
 * AM LAUFENDEN GERAET NACHGEMESSEN (11.09.2026). Der Leaf-Verlauf der Spuelmaschine enthaelt 60
 * Messpunkte ueber zwei Tage: Solange das Geraet laeuft, steigt der Zaehler mit GENAU einer
 * Einheit je Minute (20:42 -> 20:45: +3 in 3 min; 21:30 -> 21:39: +9 in 9 min). Ueber den ganzen
 * Zeitraum sind es nur 0,17 Einheiten je Minute - der Zaehler laeuft also ausschliesslich waehrend
 * des Betriebs, nicht im Standby. Sekunden waeren das Sechzigfache, Stunden ein Sechzigstel;
 * beides ist damit ausgeschlossen.
 *
 * Der Anlass: Die Spuelmaschine meldete 439713 - als Stunden waeren das 50 Jahre Dauerbetrieb,
 * als Minuten 7329 Stunden. Siehe [MINUTEN_JE_STUNDE] und stundenAusLeaf().
 */
const BETRIEBSZEIT = {
    1: 'hoursOfOperation',
    2: 'hoursOfOperationBeforeReplacement',
    3: 'hoursOfOperationSinceLastMaintenance',
    4: 'hoursOfOperationMode1',
    5: 'hoursOfOperationMode2',
};

/*
 * 2/1585 - GLOBAL_DeviceContext. NICHT bei allen Modulen vorhanden.
 *
 * ha-miele-at-lan liest dieses Leaf fuer Waesche-Geraete; laut MieleRESTServer stehen unter Feld 6
 * die EcoFeedback-Werte, die dieser Adapter lokal vergeblich sucht (Energie des letzten Programms,
 * aktuelle Leistungsaufnahme). Alle drei Geraete dieses Haushalts (XKM EK037/EK057) antworten
 * darauf mit HTTP 404 - fuer sie gibt es das Leaf nicht. Die Namen stehen hier trotzdem, weil
 * andere Module es fuehren koennen und der Leaf-Scan sie dann sofort verwendet.
 */
const GERAETEKONTEXT = {
    1: 'deviceState',
    5: 'program',
    6: 'deviceAttributesDWTDWM',
    16: 'wash2DryState',
};

/** 2/1585 Feld 6 - Geraeteattribute Waschmaschine/Trockner (nur zur Einordnung). */
const GERAETEATTRIBUTE = {
    1: 'doorState',
    3: 'ecoFeedbackEnergyConsumptionLastProg',
    4: 'ecoFeedbackWaterConsumptionLastProg',
    5: 'ecoFeedbackTotalEnergyConsumption',
    6: 'ecoFeedbackTotalWaterConsumption',
    7: 'dosContainerInfo',
    8: 'saltContainer',
    9: 'rinseAid',
    10: 'tabs',
    11: 'ecoFeedbackFilterState',
    12: 'ecoFeedbackFilterStateValid',
    14: 'motoePosition',
    15: 'doorOpeningFromExternAllowed',
    16: 'cartridgeDetected',
    20: 'ecoFeedbackTotalEnergyCosts',
    21: 'ecoFeedbackTotalWaterCosts',
    22: 'ecoFeedbackEnergyCostsLastProg',
    23: 'ecoFeedbackWaterCostsLastProg',
    24: 'currentTemperature',
    25: 'interiorLightOn',
    26: 'heatingOn',
    27: 'hygieneLevel',
    28: 'currentSpinSpeed',
    29: 'currentPowerConsumption',
    30: 'currentWaterLevel',
    31: 'currentWaterVolume',
    32: 'currentResidualMoisture',
    33: 'showSaltDeficit',
};

/*
 * Rohwerte, die eine bekannte Einheit tragen - je Leaf und Feld.
 *
 * Die Namen aus der Reverse-Engineering-Arbeit sagen, WAS ein Feld ist, nicht in welcher Einheit
 * es zaehlt. Diese Tabelle haelt fest, was an den eigenen Geraeten nachgemessen wurde. Jeder
 * Eintrag nennt deshalb seinen Beleg - wer den Teiler spaeter aendern will, sieht sofort, wogegen
 * er gepruefen muss.
 *
 * NICHT UEBERNEHMEN OHNE PRUEFUNG: Die Werte stammen von einer WCR860. Ein anderes Modell kann
 * dieselben Felder in anderen Schritten zaehlen - genau dafuer gibt es die Datensammlung, die den
 * Teiler aus gesammelten Programmen schaetzt (lib/feldsuche.js).
 */
const EINHEITEN = {
    '2/6195': {
        // Temperatur am Frequenzumrichter. Belegt am 11.09.2026 ueber 29 Programme: 24,7 bis
        // 122,5 Grad, und die hohen Werte stehen bei den 60-Grad-Programmen.
        15: { teiler: 10, einheit: '°C', was: 'fuTemperature' },
        // Durchflusszaehler, 5 ml je Impuls. Gegen die Cloud auf 0,5 % genau (siehe README).
        21: { teiler: 200, einheit: 'l', was: 'totalImpulses' },
        /*
         * Ergebnis der Beladungsmessung, in halben Kilogramm.
         *
         * Belegt am 11.09.2026 an 29 Programmen: Der hoechste je gemessene Rohwert ist 16 und
         * ergibt damit genau 8,0 kg - die Nennlast der WCR860. Fuenf von sieben Gaengen mit
         * Seide oder Feinwaesche stehen auf 0; einer davon waren Stuetzstruempfe von wenigen
         * Gramm (Angabe des Nutzers). Beides passt zu einer Waage, zu einem Zaehler nicht.
         *
         * DIE WASSERMENGE TAUGT NICHT ALS GEGENPROBE. Ueber 24 Programme gemessen: Der Verbrauch
         * haengt an der PROGRAMMDAUER (r = +0,83), nicht an der Beladung (r = +0,32; rechnet man
         * die Dauer heraus, bleibt r = +0,17). Der Grund sind die Zusatzoptionen des Geraets:
         * weiterer Spuelgang, AllergoWash, Vorwaesche und Wasser Plus (Angabe des Nutzers). Sie
         * verlaengern das Programm und schlagen jeweils mit rund zwanzig Litern zu Buche - bei
         * "Pflegeleicht" zwischen 31 l in 103 min und 83 l in 171 min, bei gleicher Beladung. Wer den Beladungswert
         * pruefen will, braucht die tatsaechliche Waeschemenge, nicht den Wasserzaehler.
         *
         * Deshalb steht der Wert als Diagnosewert hier und nicht als eigener Datenpunkt.
         */
        65: { teiler: 2, einheit: 'kg', was: 'tbKgResultIntegral110' },
    },
};

const LEAFS = {
    '2/119': BETRIEBSZEIT,
    '2/1585': GERAETEKONTEXT,
    '2/6192': AKTOREN,
    '2/6193': SENSOREN,
    '2/6195': PROCESS,
};

/** Minuten je Stunde - der Umrechnungsfaktor fuer 2/119, siehe [BETRIEBSZEIT]. */
const MINUTEN_JE_STUNDE = 60;

/**
 * Der Name eines Feldes, oder null.
 *
 * @param {string} leaf  "2/6195"
 * @param {number|string} idx  Feldnummer
 */
function feldName(leaf, idx) {
    const tabelle = LEAFS[leaf];
    return (tabelle && tabelle[Number(idx)]) || null;
}

/**
 * Der umgerechnete Wert eines Rohfelds, oder null - siehe [EINHEITEN].
 *
 * @param {string} leaf  "2/6195"
 * @param {number|string} idx  Feldnummer
 * @param {number} rohwert Rohwert des Feldes
 * @returns {{wert: number, einheit: string}|null} umgerechneter Wert mit Einheit, null ohne bekannte Umrechnung
 */
function umrechnen(leaf, idx, rohwert) {
    const e = (EINHEITEN[leaf] || {})[Number(idx)];
    if (!e || typeof rohwert !== 'number' || !Number.isFinite(rohwert)) {
        return null;
    }
    // Zwei Nachkommastellen reichen fuer jede der bekannten Einheiten und halten die Zahl lesbar.
    return { wert: Math.round((rohwert / e.teiler) * 100) / 100, einheit: e.einheit };
}

/**
 * Eine Feldliste um ihre Namen ergaenzen: "25" wird zu "25 heatingEnergy".
 *
 * Wo die Einheit bekannt ist, steht der umgerechnete Wert dahinter: "21 totalImpulses" traegt
 * dann nicht nur 13341, sondern "13341 (66.71 l)". Der Rohwert bleibt stehen - er ist das, was
 * das Geraet gemeldet hat, und jede Auswertung muss auf ihn zurueckgreifen koennen.
 *
 * @param leaf Leaf-Schluessel, etwa "2/6195"
 * @param felder Feldnummern als Liste
 */
function benennen(leaf, felder) {
    const aus = {};
    for (const [idx, wert] of Object.entries(felder || {})) {
        const name = feldName(leaf, idx);
        const um = umrechnen(leaf, idx, wert);
        aus[name ? `${idx} ${name}` : idx] = um ? `${wert} (${um.wert} ${um.einheit})` : wert;
    }
    return aus;
}

/**
 * Betriebsstunden aus dem Rohwert von 2/119 - der Wert steht in MINUTEN.
 *
 * Gerundet auf eine Nachkommastelle: Die Zahl steht in der Geraeteuebersicht, und sechs Stellen
 * hinter dem Komma taeuschen eine Genauigkeit vor, die eine Minutenaufloesung nicht hat.
 *
 * @param {number} rohMinuten Rohwert in Minuten
 * @returns {number|null} Betriebsstunden, null bei unbrauchbarem Rohwert
 */
function stundenAusLeaf(rohMinuten) {
    if (typeof rohMinuten !== 'number' || !Number.isFinite(rohMinuten) || rohMinuten <= 0) {
        return null;
    }
    return Math.round((rohMinuten / MINUTEN_JE_STUNDE) * 10) / 10;
}

module.exports = {
    LEAFS,
    EINHEITEN,
    umrechnen,
    PROCESS,
    AKTOREN,
    SENSOREN,
    BETRIEBSZEIT,
    GERAETEKONTEXT,
    GERAETEATTRIBUTE,
    MINUTEN_JE_STUNDE,
    feldName,
    benennen,
    stundenAusLeaf,
};

'use strict';

const namen = require('./names');

/**
 * Deklaratives Objektmodell: /State- und /Ident-Felder → ioBroker-States.
 * Enthält Rollen, Typen, Einheiten und Dekodierfunktionen.
 */

const enums = require('./enums');
const de = require('./enums_de');

const TEMP_SENTINEL = -32768; // "nicht verfügbar"

/**
 * [h, min] → Gesamtminuten (null bei fehlend).
 *
 * @param arr
 */
function timeToMinutes(arr) {
    if (!Array.isArray(arr) || arr.length < 2) {
        return null;
    }
    return arr[0] * 60 + arr[1];
}

/**
 * [h, min] → "H:MM"-String (wie mielecloudservice), null bei fehlend.
 *
 * @param arr
 */
function timeToHHMM(arr) {
    if (!Array.isArray(arr) || arr.length < 2) {
        return null;
    }
    return `${arr[0]}:${String(arr[1]).padStart(2, '0')}`;
}

// Deutsch mit englischem Fallback
function statusTextDe(v) {
    return de.statusDe(v) || enums.statusText(v);
}
function programTypeTextDe(v) {
    const eigen = de.programTypeDe(v);
    return eigen != null ? eigen : enums.programTypeText(v);
}
function dryingStepTextDe(v) {
    const eigen = de.dryingStepDe(v);
    return eigen != null ? eigen : enums.dryingStepText(v);
}
/**
 * Text fuer einen Rohwert, den keine Tabelle kennt.
 *
 * Ohne Ersatz lieferte die Uebersetzung null, der Datenpunkt wurde dann gar nicht beschrieben -
 * und der Text des VORIGEN Programms blieb stehen. So meldete ein G7771 fuer sein Programm 201
 * "Eco" (Issue #13): nicht falsch zugeordnet, sondern veraltet. "Programm 201" ist ehrlich und
 * nennt gleich die Nummer, die in einem Fehlerbericht gebraucht wird.
 *
 * @param {string|null} text  uebersetzter Text oder null
 * @param {string} art        "Programm" oder "Phase"
 * @param {number} v          Rohwert
 * @returns {string|null} Text, Ersatztext oder null ohne Rohwert
 */
function mitErsatz(text, art, v) {
    if (text != null) {
        return text;
    }
    return v === undefined || v === null ? null : `${art} ${v}`;
}
/**
 * Programmname auf Deutsch.
 *
 * Wie bei den Phasen (siehe phaseTextDe) sind "kein Programm" und "keine Uebersetzung" mit ||
 * nicht zu unterscheiden: no_program ist bewusst auf einen leeren Text abgebildet, der aber als
 * falsy gilt. Die App zeigte deshalb den Rohwert "no_program" an.
 *
 * @param dt
 * @param v
 */
function programTextDe(dt, v) {
    const en = enums.programText(dt, v);
    const eigen = de.programNameDe(en);
    return eigen != null ? eigen : lesbar(en);
}

/**
 * Englischen Enum-Wert lesbar machen, wenn es keine deutsche Fassung gibt.
 *
 * Die 410 Rezeptprogramme des Dampfgarers mit Mikrowelle (seit 0.3.41) haben keine deutschen
 * Namen; roh stuende dort "artichokes_small". "Artichokes small" ist nicht Deutsch, aber lesbar.
 *
 * @param {string|null} en  Enum-Wert
 * @returns {string|null} lesbarer Text
 */
function lesbar(en) {
    if (!en) {
        return en;
    }
    const t = String(en).replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
}
// Phase: erst numerische DE-Tabelle (Waschen/Spülen/Backofen), dann englisch-basierte DE-Map
// (deckt alle uebrigen Gerätetypen ab), sonst englischer Klartext.
/**
 * Phasentext auf Deutsch.
 *
 * Die Faelle "kein Programm" und "keine Uebersetzung vorhanden" sehen mit || gleich aus: die
 * Tabelle bildet not_running bewusst auf einen leeren Text ab, der ist aber falsy und liess den
 * Rohwert "not_running" durchschlagen. Deshalb hier ausdruecklich auf null pruefen.
 *
 * @param dt
 * @param v
 */
function phaseTextDe(dt, v) {
    const eigen = de.phaseDe(dt, v);
    if (eigen != null) {
        return eigen;
    }
    const en = enums.phaseText(dt, v);
    const uebersetzt = de.phaseNameDe(en);
    if (uebersetzt != null) {
        return uebersetzt;
    }
    return lesbar(en);
}

/**
 * Miele-Temperatur (Hundertstel °C) → °C, Sentinel → null.
 *
 * @param v
 */
function temp(v) {
    if (v == null || v === TEMP_SENTINEL) {
        return null;
    }
    return v / 100;
}

/**
 * Zustands-Kanäle (Rohwert + optionaler Klartext) je /State-Feld.
 * decode(value, ctx) → { states: [{sub, val}] }
 * ctx = { deviceType }
 */
const STATE_FIELDS = {
    Status: {
        states: [
            { sub: 'status', role: 'value', type: 'number', def: 0, name: 'Status (raw)' },
            { sub: 'statusText', role: 'text', type: 'string', def: '', name: 'Status' },
        ],
        decode: v => [
            { sub: 'status', val: v },
            { sub: 'statusText', val: statusTextDe(v) },
        ],
    },
    ProgramType: {
        states: [
            { sub: 'programType', role: 'value', type: 'number', def: 0, name: 'Program type (raw)' },
            { sub: 'programTypeText', role: 'text', type: 'string', def: '', name: 'Program type' },
        ],
        decode: v => [
            { sub: 'programType', val: v },
            { sub: 'programTypeText', val: programTypeTextDe(v) },
        ],
    },
    ProgramID: {
        states: [
            { sub: 'programId', role: 'value', type: 'number', def: 0, name: 'Program (raw)' },
            { sub: 'programText', role: 'text', type: 'string', def: '', name: 'Program' },
        ],
        decode: (v, ctx) => [
            { sub: 'programId', val: v },
            { sub: 'programText', val: mitErsatz(programTextDe(ctx.deviceType, v), 'Programm', v) },
        ],
    },
    ProgramPhase: {
        states: [
            { sub: 'programPhase', role: 'value', type: 'number', def: 0, name: 'Phase (raw)' },
            { sub: 'programPhaseText', role: 'text', type: 'string', def: '', name: 'Phase' },
        ],
        decode: (v, ctx) => [
            { sub: 'programPhase', val: v },
            { sub: 'programPhaseText', val: mitErsatz(phaseTextDe(ctx.deviceType, v), 'Phase', v) },
        ],
    },
    RemainingTime: {
        states: [
            {
                sub: 'remainingMinutes',
                role: 'value.interval',
                type: 'number',
                unit: 'min',
                def: 0,
                name: 'Remaining time',
            },
            { sub: 'remainingHHMM', role: 'text', type: 'string', def: '', name: 'Remaining time (H:MM)' },
            // Voraussichtliches Programmende (wie mielecloudservice.estimatedEndTime). Der Wert wird
            // NICHT hier dekodiert (die Rohantwort kennt keine Uhrzeit), sondern in main.js aus
            // "jetzt + Restzeit" berechnet - hier nur die Objektanlage.
            { sub: 'estimatedEndTime', role: 'date', type: 'number', def: 0, name: 'Estimated end time' },
            { sub: 'estimatedEndTimeText', role: 'text', type: 'string', def: '', name: 'Estimated end time (HH:MM)' },
        ],
        decode: v => [
            { sub: 'remainingMinutes', val: timeToMinutes(v) },
            { sub: 'remainingHHMM', val: timeToHHMM(v) },
        ],
    },
    ElapsedTime: {
        states: [
            {
                sub: 'elapsedMinutes',
                role: 'value.interval',
                type: 'number',
                unit: 'min',
                def: 0,
                name: 'Elapsed time',
            },
            { sub: 'elapsedHHMM', role: 'text', type: 'string', def: '', name: 'Elapsed time (H:MM)' },
        ],
        decode: v => [
            { sub: 'elapsedMinutes', val: timeToMinutes(v) },
            { sub: 'elapsedHHMM', val: timeToHHMM(v) },
        ],
    },
    StartTime: {
        states: [
            { sub: 'startInMinutes', role: 'value.interval', type: 'number', unit: 'min', def: 0, name: 'Start delay' },
            { sub: 'startHHMM', role: 'text', type: 'string', def: '', name: 'Start delay (H:MM)' },
        ],
        decode: v => [
            { sub: 'startInMinutes', val: timeToMinutes(v) },
            { sub: 'startHHMM', val: timeToHHMM(v) },
        ],
    },
    TargetTemperature: {
        states: [
            {
                sub: 'targetTemperature',
                role: 'value.temperature',
                type: 'number',
                unit: '°C',
                def: 0,
                name: 'Target temperature',
            },
            {
                sub: 'targetTemperatureZone2',
                role: 'value.temperature',
                type: 'number',
                unit: '°C',
                def: 0,
                name: 'Target temperature zone 2',
            },
            {
                sub: 'targetTemperatureZone3',
                role: 'value.temperature',
                type: 'number',
                unit: '°C',
                def: 0,
                name: 'Target temperature zone 3',
            },
        ],
        decode: v => [
            { sub: 'targetTemperature', val: temp(v && v[0]) },
            { sub: 'targetTemperatureZone2', val: temp(v && v[1]) },
            { sub: 'targetTemperatureZone3', val: temp(v && v[2]) },
        ],
    },
    Temperature: {
        states: [
            { sub: 'temperature', role: 'value.temperature', type: 'number', unit: '°C', def: 0, name: 'Temperature' },
            {
                sub: 'temperatureZone2',
                role: 'value.temperature',
                type: 'number',
                unit: '°C',
                def: 0,
                name: 'Temperature zone 2',
            },
            {
                sub: 'temperatureZone3',
                role: 'value.temperature',
                type: 'number',
                unit: '°C',
                def: 0,
                name: 'Temperature zone 3',
            },
        ],
        decode: v => [
            { sub: 'temperature', val: temp(v && v[0]) },
            { sub: 'temperatureZone2', val: temp(v && v[1]) },
            { sub: 'temperatureZone3', val: temp(v && v[2]) },
        ],
    },
    SignalInfo: {
        states: [{ sub: 'signalInfo', role: 'indicator', type: 'boolean', def: false, name: 'Info signal' }],
        decode: v => [{ sub: 'signalInfo', val: !!v }],
    },
    SignalFailure: {
        states: [
            {
                sub: 'signalFailure',
                role: 'indicator.maintenance',
                type: 'boolean',
                def: false,
                name: 'Failure signal',
            },
        ],
        decode: v => [{ sub: 'signalFailure', val: !!v }],
    },
    SignalDoor: {
        states: [{ sub: 'signalDoor', role: 'sensor.door', type: 'boolean', def: false, name: 'Door open' }],
        decode: v => [{ sub: 'signalDoor', val: !!v }],
    },
    RemoteEnable: {
        states: [
            { sub: 'mobileStart', role: 'indicator', type: 'boolean', def: false, name: 'MobileStart enabled' },
            { sub: 'remoteEnableRaw', role: 'json', type: 'string', def: '[]', name: 'RemoteEnable (raw)' },
        ],
        // Element[1] = MobileStart-Freigabe (0/1). Steuerung nur möglich, wenn 1.
        decode: v => [
            { sub: 'mobileStart', val: Array.isArray(v) ? !!v[1] : false },
            { sub: 'remoteEnableRaw', val: JSON.stringify(v) },
        ],
    },
    ProcessAction: {
        states: [{ sub: 'processAction', role: 'value', type: 'number', def: 0, name: 'Process action' }],
        decode: v => [{ sub: 'processAction', val: v }],
    },
    DeviceAction: {
        states: [{ sub: 'deviceAction', role: 'value', type: 'number', def: 0, name: 'Device action' }],
        decode: v => [{ sub: 'deviceAction', val: v }],
    },
    Light: {
        // sensor.light statt switch.light: der Datenpunkt zeigt nur an, geschaltet wird ueber
        // control.lightOn/lightOff. "switch.*" setzt laut Rollenkatalog common.write voraus.
        states: [{ sub: 'light', role: 'sensor.light', type: 'boolean', def: false, name: 'Light on' }],
        // Light: 0 = kein Licht/aus, 1 = an, 2 = aus (gerätespezifisch); >0 && !=2 → an
        decode: v => [{ sub: 'light', val: v === 1 }],
    },
    StandbyState: {
        states: [{ sub: 'standbyState', role: 'value', type: 'number', def: 0, name: 'Standby state' }],
        decode: v => [{ sub: 'standbyState', val: v }],
    },
    SpinningSpeed: {
        states: [{ sub: 'spinningSpeed', role: 'value', type: 'number', unit: 'rpm', def: 0, name: 'Spin speed' }],
        decode: v => [{ sub: 'spinningSpeed', val: v }],
    },
    DryingStep: {
        states: [
            { sub: 'dryingStep', role: 'value', type: 'number', def: 0, name: 'Drying step (raw)' },
            { sub: 'dryingStepText', role: 'text', type: 'string', def: '', name: 'Drying step' },
        ],
        decode: v => [
            { sub: 'dryingStep', val: v },
            { sub: 'dryingStepText', val: dryingStepTextDe(v) },
        ],
    },
    SyncState: {
        states: [{ sub: 'syncState', role: 'value', type: 'number', def: 0, name: 'Sync state' }],
        decode: v => [{ sub: 'syncState', val: v }],
    },
    InternalState: {
        states: [{ sub: 'internalState', role: 'value', type: 'number', def: 0, name: 'Internal state' }],
        decode: v => [{ sub: 'internalState', val: v }],
    },
};

/** Ident-Felder → info-States (statisch). */
const IDENT_FIELDS = [
    { sub: 'connected', role: 'indicator.reachable', type: 'boolean', def: false, name: 'Connected / reachable' },
    {
        sub: 'techType',
        role: 'info.name',
        type: 'string',
        def: '',
        name: 'Model / TechType',
        path: ['DeviceIdentLabel', 'TechType'],
    },
    {
        sub: 'fabNumber',
        role: 'info.serial',
        type: 'string',
        def: '',
        name: 'Serial number',
        path: ['DeviceIdentLabel', 'FabNumber'],
    },
    {
        sub: 'matNumber',
        role: 'text',
        type: 'string',
        def: '',
        name: 'Material number',
        path: ['DeviceIdentLabel', 'MatNumber'],
    },
    { sub: 'deviceType', role: 'value', type: 'number', def: 0, name: 'Device type', path: ['DeviceType'] },
    {
        sub: 'xkmType',
        role: 'text',
        type: 'string',
        def: '',
        name: 'WiFi module type',
        path: ['XKMIdentLabel', 'TechType'],
    },
    {
        sub: 'xkmVersion',
        role: 'info.firmware',
        type: 'string',
        def: '',
        name: 'WiFi module firmware',
        path: ['XKMIdentLabel', 'ReleaseVersion'],
    },
    {
        sub: 'protocolVersion',
        role: 'value',
        type: 'number',
        def: 0,
        name: 'Protocol version',
        path: ['ProtocolVersion'],
    },
];

/** Steuer-States (beschreibbar, per Opcode). Nur angelegt, wenn allowControl. */
const CONTROL_STATES = [
    { sub: 'start', role: 'button.start', type: 'boolean', def: false, name: 'Start program', opcode: 0x01 },
    { sub: 'stop', role: 'button.stop', type: 'boolean', def: false, name: 'Stop program', opcode: 0x37 },
    { sub: 'pause', role: 'button.pause', type: 'boolean', def: false, name: 'Pause program', opcode: 0x03 },
    { sub: 'powerOn', role: 'button', type: 'boolean', def: false, name: 'Switch on', opcode: 0x10 },
    { sub: 'powerOff', role: 'button', type: 'boolean', def: false, name: 'Switch off', opcode: 0x13 },
    { sub: 'lightOn', role: 'button', type: 'boolean', def: false, name: 'Light on', opcode: 0x0d },
    { sub: 'lightOff', role: 'button', type: 'boolean', def: false, name: 'Light off', opcode: 0x0e },
];

// Geräteart je DeviceType (für den Objektnamen).
const DEVICE_CATEGORY = {
    1: 'Waschmaschine',
    2: 'Trockner',
    24: 'Waschtrockner',
    7: 'Spülmaschine',
    12: 'Backofen',
    13: 'Backofen mit Mikrowelle',
    15: 'Dampfgarer',
    16: 'Dampfbackofen',
    17: 'Kaffeevollautomat',
    18: 'Kühlschrank',
    19: 'Gefrierschrank',
    20: 'Kühl-Gefrier-Kombination',
    21: 'Weinkühlschrank',
    23: 'Dunstabzug',
    25: 'Kochfeld',
    27: 'Mikrowelle',
    67: 'Wärmeschublade',
    68: 'Wärmeschublade',
};

/**
 * Die Kategorie einer Geraeteart (Waschen, Spuelen, Kochen …).
 *
 * @param {number} deviceType   Geraeteart aus dem Ident-Zweig
 * @returns {string|null} Kategorie oder null, wenn unbekannt
 */
function deviceCategory(deviceType) {
    return DEVICE_CATEGORY[deviceType] || null;
}

/**
 * Klartext-Zuordnung eines Rohwerts als common.states.
 *
 * WOZU. Der Adapter legt zu jedem Rohwert einen zweiten Datenpunkt mit dem Text an
 * (status/statusText). Das verdoppelt die Eintraege im Objektbaum, obwohl ioBroker den Fall
 * kennt: common.states bildet Zahl auf Text ab, der Wert bleibt die Zahl, die Oberflaeche
 * zeigt den Text, und Auswahllisten in VIS entstehen von selbst. Die *Text-Datenpunkte
 * bleiben trotzdem bestehen - sie zu entfernen wuerde bestehende Aufbauten zerschlagen.
 *
 * WARUM AUS DENSELBEN FUNKTIONEN. Die Texte kommen aus statusTextDe/programTypeTextDe/
 * phaseTextDe, also genau dort her, wo auch die *Text-Datenpunkte herkommen. Damit koennen
 * Liste und Text nicht auseinanderlaufen.
 *
 * WARUM EINE OBERGRENZE. Die Programmtabelle des Backofens hat 168 Eintraege; die gehoeren
 * nicht in jedes Objekt. Bis 64 Eintraege ist die Liste ein Gewinn, darueber Ballast.
 *
 * @param {string} sub      "status", "programType", "programPhase", "programId"
 * @param {number} deviceType
 * @param {boolean} german
 * @returns {object|undefined}
 */
/** Die Rohbezeichner, die in den Tabellen absichtlich ohne Text stehen. */
const LEERTEXTE = {
    no_program: { de: 'kein Programm', en: 'no program' },
    not_running: { de: 'läuft nicht', en: 'not running' },
};
const STATES_MAX = 64;
/**
 * Die Klartexttabelle zu einem Zustandsdatenpunkt - fuer die Auswahl im Admin.
 *
 * @param {string} sub          Name des Datenpunkts (status, programType, …)
 * @param {number} deviceType   Geraeteart
 * @param {boolean} german      deutsche statt englischer Texte
 * @returns {object|null} Tabelle Rohwert -> Text
 */
function zustandsTexte(sub, deviceType, german) {
    let tabelle = null;
    let text = null;
    if (sub === 'status') {
        tabelle = enums.TABLES.StateStatus;
        text = k => (german ? statusTextDe(k) : enums.statusText(k));
    } else if (sub === 'programType') {
        tabelle = enums.TABLES.StateProgramType;
        text = k => (german ? programTypeTextDe(k) : enums.programTypeText(k));
    } else if (sub === 'programPhase') {
        const name = enums.BY_TYPE[deviceType] && enums.BY_TYPE[deviceType].phase;
        tabelle = name && enums.TABLES[name];
        text = k => (german ? phaseTextDe(deviceType, k) : enums.phaseText(deviceType, k));
    } else if (sub === 'programId') {
        const name = enums.BY_TYPE[deviceType] && enums.BY_TYPE[deviceType].program;
        tabelle = name && enums.TABLES[name];
        text = k => (german ? programTextDe(deviceType, k) : enums.programText(deviceType, k));
    }
    if (!tabelle) {
        return undefined;
    }
    const schluessel = Object.keys(tabelle);
    if (!schluessel.length || schluessel.length > STATES_MAX) {
        return undefined;
    }
    const aus = {};
    for (const k of schluessel) {
        // no_program und not_running sind in den Tabellen bewusst auf einen leeren Text
        // abgebildet (siehe phaseTextDe). In einer Auswahlliste waere eine leere Zeile
        // unbrauchbar und der nackte Bezeichner haesslich - deshalb hier ausgeschrieben.
        const roh = String(tabelle[k] == null ? '' : tabelle[k]);
        const t = text(Number(k));
        // t === roh heisst: es gab keine Uebersetzung, durchgereicht wurde der Bezeichner.
        // Das gilt auch auf Englisch, wo "not_running" sonst so in der Liste stuende.
        if (t && t !== roh) {
            aus[k] = t;
            continue;
        }
        aus[k] = LEERTEXTE[roh] ? LEERTEXTE[roh][german ? 'de' : 'en'] : roh.replace(/_/g, ' ');
    }
    return aus;
}

// Gerätespezifische STATE_FIELDS nur beim passenden Gerätetyp anlegen/schreiben - sonst stünde z. B.
// die Schleuderdrehzahl auch bei Spülmaschine und Backofen (sinnlos). Key = STATE_FIELDS-Schlüssel,
// Wert = erlaubte deviceTypes. Nicht gelistete Felder gelten für ALLE Geräte (Status, Programm, …).
const FIELD_DEVICE_TYPES = {
    SpinningSpeed: [1, 3, 5, 24], // Schleuderdrehzahl: Waschmaschinen (auch Semi-Prof/Prof), Waschtrockner
    DryingStep: [2, 4, 6, 24], // Trockenstufe: Trockner (auch Semi-Prof/Prof), Waschtrockner
};

/**
 * true, wenn das STATE_FIELDS-Feld [key] für [deviceType] angelegt/geschrieben werden soll.
 *
 * @param key
 * @param deviceType
 */
function fieldAllowed(key, deviceType) {
    const allowed = FIELD_DEVICE_TYPES[key];
    return !allowed || allowed.includes(deviceType);
}

// Deutsche Datenpunkt-Namen (überlappende Punkte an mielecloudservice angelehnt).
const DE_NAMES = {
    state: {
        status: 'Status (Rohwert)',
        statusText: 'Status',
        programType: 'Programmart (Rohwert)',
        programTypeText: 'Programmart',
        programId: 'Programmbezeichnung (Rohwert)',
        programText: 'Programmbezeichnung',
        programPhase: 'Programmphase (Rohwert)',
        programPhaseText: 'Programmphase',
        remainingMinutes: 'Restzeit (Minuten)',
        remainingHHMM: 'Restzeit',
        estimatedEndTime: 'Voraussichtliches Ende',
        estimatedEndTimeText: 'Voraussichtliches Ende (Uhrzeit)',
        elapsedMinutes: 'Verstrichene Zeit (Minuten)',
        elapsedHHMM: 'Verstrichene Zeit',
        startInMinutes: 'Startvorwahl (Minuten)',
        startHHMM: 'Startvorwahl',
        targetTemperature: 'Zieltemperatur',
        targetTemperatureZone2: 'Zieltemperatur Zone 2',
        targetTemperatureZone3: 'Zieltemperatur Zone 3',
        temperature: 'Temperatur',
        temperatureZone2: 'Temperatur Zone 2',
        temperatureZone3: 'Temperatur Zone 3',
        signalInfo: 'Info-Signal',
        signalFailure: 'Störungssignal',
        signalDoor: 'Tür offen',
        mobileStart: 'MobileStart verfügbar',
        remoteEnableRaw: 'Fernsteuer-Freigabe (Rohwert)',
        processAction: 'Prozess-Aktion',
        deviceAction: 'Geräte-Aktion',
        light: 'Licht',
        standbyState: 'Standby-Zustand',
        spinningSpeed: 'Schleuderdrehzahl',
        dryingStep: 'Trockenstufe (Rohwert)',
        dryingStepText: 'Trockenstufe',
        syncState: 'Sync-Zustand',
        internalState: 'Interner Zustand',
    },
    info: {
        connected: 'Verbunden / Erreichbar',
        techType: 'Gerätetyp (Technik)',
        fabNumber: 'Seriennummer',
        matNumber: 'Materialnummer',
        deviceType: 'Gerätetyp',
        xkmType: 'Kommunikationsmodul-Typ',
        xkmVersion: 'Kommunikationsmodul-Firmware',
        protocolVersion: 'Protokollversion',
    },
    control: {
        start: 'Programm starten',
        stop: 'Programm stoppen',
        pause: 'Programm pausieren',
        powerOn: 'Einschalten',
        powerOff: 'Ausschalten',
        lightOn: 'Licht an',
        lightOff: 'Licht aus',
    },
};

/**
 * common.name für einen Datenpunkt als i18n-Objekt.
 *
 * Geliefert werden alle Sprachen, für die eine Übersetzung vorliegt - ioBroker empfiehlt elf.
 * Zuvor standen hier nur {en, de}, was die Repository-Pruefung mit 145 W1001-Warnungen
 * quittierte (eine je Datenpunkt). Fehlt zu einem Datenpunkt eine Uebersetzung, bleibt es beim
 * Vorhandenen statt eine Luecke zu erfinden.
 *
 * Bei german=false wird weiterhin nur Englisch verwendet - diese Einstellung ist ausdruecklich
 * dafuer da, alle Namen einsprachig zu halten.
 *
 * @param channel
 * @param sub
 * @param en
 * @param german
 */
function nameFor(channel, sub, en, german) {
    if (!german) {
        return en;
    }
    const de = DE_NAMES[channel] && DE_NAMES[channel][sub];
    if (!de) {
        return en;
    }
    const weitere = (namen.SPRACHNAMEN[channel] || {})[sub];
    return Object.assign({ en, de }, weitere || {});
}

/**
 * Einen verschachtelten Wert ueber seinen Pfad holen, ohne an fehlenden Zweigen zu scheitern.
 *
 * @param {object} obj      Ausgangsobjekt
 * @param {string[]} path   Schluessel der Reihe nach
 * @returns {*} gefundener Wert oder undefined
 */
function pathGet(obj, path) {
    let cur = obj;
    for (const p of path) {
        if (cur == null) {
            return undefined;
        }
        cur = cur[p];
    }
    return cur;
}

/**
 * Die EcoFeedback-Datenpunkte - Name, Rolle und Einheit an EINER Stelle.
 *
 * WARUM ZENTRAL. Bis 0.3.10 standen sie zweimal im Code: einmal in `ensureEcoObjects`
 * (legt sie an, sobald ein Geraet Werte liefert) und einmal in `aktualisiereEcoNamen`
 * (zieht sie beim Start nach, weil ein stehendes Geraet kein EcoFeedback liefert und die
 * erste Stelle dann nie durchlaeuft). Die beiden liefen auseinander: Die Umbenennung von
 * "Energieverbrauch" auf "Energie (Erwartung des Geraets)" wurde nur in der zweiten
 * gemacht. Beim Adapterstart stand danach der neue Name da - und sobald ein Programm lief,
 * setzte die erste Stelle den alten wieder ein. Am 04.09.2026 am laufenden Adapter
 * nachgesehen: Dort stand "Energieverbrauch", die Umbenennung war wirkungslos.
 *
 * Zwei Tabellen fuer dieselben drei Datenpunkte koennen nur auseinanderlaufen. Deshalb gibt
 * es jetzt diese eine, und test/eco.js prueft, dass beide Aufrufer daraus lesen.
 *
 * WAS DER ENERGIEWERT WIRKLICH IST - am 03.09.2026 an einem laufenden Baumwollprogramm der
 * WCR860 gemessen:
 *
 *     Uhrzeit   eco.energyWh   Shelly am Netzstecker
 *     08:29         770 Wh              0 Wh   (Beginn der Messung)
 *     09:29         770 Wh            529 Wh
 *     10:29         770 Wh            674 Wh
 *     11:09         770 Wh            847 Wh
 *
 * Der Wert steht von der ersten Minute an fest und bewegt sich nicht - er ist die ERWARTUNG
 * des Geraets fuer dieses Programm, keine Messung. Ueber den ganzen Lauf zeigte der Shelly
 * 1158 Wh, also die Haelfte mehr. Kein anderes Feld des Eco-Leaf folgt dem gemessenen
 * Verbrauch; geprueft wurden alle neunzehn Felder, die sich waehrend des Programms
 * ueberhaupt aendern. Der Wert bleibt trotzdem stehen: Er ist die Angabe des Geraets und
 * fuer eine Schaetzung vor dem Start brauchbar - der Name sagt jetzt, was er ist.
 *
 * Beim Wasser ist es umgekehrt: Am 02.09.2026 stimmte der Wert auf den Liter mit der
 * Miele-App ueberein. Eine zweite Quelle zum Nachpruefen gibt es dort nicht - eine
 * Wasseruhr am Zulauf hat die Maschine nicht.
 *
 * ZUR ROLLE DES WASSERWERTS: `value` und nicht `value.volume` - letzteres beanstandet der
 * Repository-Pruefer.
 *
 * @param {boolean} german  Deutsche Namen? (Adapteroption `germanNames`)
 * @returns {object} Unterpfad -> gemeinsame common-Felder
 */
function ecoCommon(german) {
    return {
        // "EcoFeedback" ist Mieles eigener Begriff und bleibt in jeder Sprache gleich - das
        // i18n-Objekt macht ihn trotzdem vollstaendig, damit die Pruefung nicht warnt.
        eco: { name: namen.SPRACHEN.reduce((o, sp) => ((o[sp] = 'EcoFeedback'), o), {}) },
        'eco.energy': {
            name: namen.text('Energie (Erwartung des Geräts)', 'Energy (appliance estimate)', german),
            role: 'value.power.consumption',
            unit: 'kWh',
        },
        'eco.energyWh': {
            name: namen.text(
                'Energie in Wh (Erwartung, keine Messung)',
                'Energy in Wh (estimate, not measured)',
                german,
            ),
            role: 'value.power.consumption',
            unit: 'Wh',
        },
        'eco.water': {
            name: namen.text('Wasserverbrauch', 'Water consumption', german),
            role: 'value',
            unit: 'l',
        },
        /*
         * WOHER die beiden Zahlen daneben stammen.
         *
         * Es gibt zwei Quellen, und sie sind unterschiedlich viel wert: Entweder das Geraet
         * fuehrt selbst ein EcoFeedback (DOP2 2/1585) - dann steht dort, was auch die
         * Miele-App anzeigt. Oder es fuehrt keines, und der Adapter zaehlt die Impulse des
         * Durchflusszaehlers (Feld 21 des Eco-Leaf, 5 ml je Impuls).
         *
         * Ohne diesen Hinweis liesse sich am Datenpunkt nicht erkennen, welcher Fall vorliegt -
         * und das ist der Unterschied zwischen einer Herstellerangabe und einer Hilfsrechnung.
         */
        'eco.quelle': {
            name: namen.text('Woher die Werte stammen', 'Source of these values', german),
            role: 'text',
        },
    };
}

/**
 * Dieselben Punkte, aber als Anlege-Liste - mit Typ und Vorgabewert.
 *
 * `ensureEcoObjects` braucht mehr als [ecoCommon] liefert: Ein Objekt, das erst entsteht,
 * muss auch Typ, Lese-/Schreibrecht und einen Vorgabewert mitbringen. Name, Rolle und
 * Einheit kommen aber aus derselben Quelle - genau darum geht es.
 *
 * @param {boolean} german      Deutsche Namen?
 * @param {boolean} rohfelder   Zusaetzlichen Diagnose-Datenpunkt anlegen?
 */
function ecoStates(german, rohfelder) {
    const gemeinsam = ecoCommon(german);
    const liste = ['energy', 'energyWh', 'water'].map(sub => ({
        sub,
        common: { ...gemeinsam[`eco.${sub}`], type: 'number', read: true, write: false, def: 0 },
    }));
    liste.push({
        sub: 'quelle',
        common: { ...gemeinsam['eco.quelle'], type: 'string', read: true, write: false, def: '' },
    });
    // Der Rohfeld-Datenpunkt entsteht nur, wenn die Option gesetzt ist - sonst stuende bei
    // jedem Anwender ein leeres Diagnosefeld im Baum, das niemand braucht.
    if (rohfelder) {
        liste.push({
            sub: 'felderJson',
            common: {
                name: namen.text('Alle Eco-Rohfelder (Fehlersuche)', 'All raw eco fields (diagnostics)', german),
                role: 'json',
                type: 'string',
                read: true,
                write: false,
                def: '',
            },
        });
    }
    return liste;
}

module.exports = {
    STATE_FIELDS,
    zustandsTexte,
    IDENT_FIELDS,
    CONTROL_STATES,
    DE_NAMES,
    DEVICE_CATEGORY,
    deviceCategory,
    FIELD_DEVICE_TYPES,
    fieldAllowed,
    nameFor,
    timeToMinutes,
    temp,
    pathGet,
    TEMP_SENTINEL,
    ecoCommon,
    ecoStates,
};

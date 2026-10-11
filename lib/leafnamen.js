'use strict';

/*
 * Wie die DOP2-Leafs und ihre Felder heissen - vollstaendig, fuer alle Geraeteklassen.
 *
 * WOHER. Erzeugt aus der Reverse-Engineering-Arbeit von `MieleRESTServer` (akappner,
 * `dop2rs/src/payloader/**`) und ergaenzt um die Leafs, die `ha-miele-at-lan` (tiehfood)
 * zusaetzlich kennt. Beide Projekte sind oeffentlich; Miele selbst veroeffentlicht nichts davon.
 * Uebernommen wird ausschliesslich die BENENNUNG - die Werte liest dieser Adapter selbst.
 *
 * WOZU DIE VOLLSTAENDIGKEIT. Bis 0.3.36 kannte der Adapter fuenf Tabellen, und alle fuenf
 * beschrieben eine Waschmaschine. Ein Backofen, eine Kaffeemaschine oder ein Dunstabzug liefert
 * voellig andere Leafs - wer eines davon anschliesst, sah nur Nummern. Hier stehen jetzt alle
 * Strukturen, die die beiden Projekte kennen, samt der verschachtelten Unterstrukturen.
 *
 * DIE NAMEN SIND NICHT GEPRUEFT, sondern eine Lesehilfe: Sie stammen von anderen Geraeten und
 * anderen Firmware-Staenden. Ob sie fuer das eigene Geraet stimmen, entscheidet die Messung.
 * Wo sich Name und Messung widersprechen, zaehlt die Messung - siehe lib/felder.js, EINHEITEN.
 *
 * NICHTS DAVON WIRD BLIND ANGELEGT. Ein Datenpunkt entsteht nur, wenn das Geraet das Feld
 * tatsaechlich liefert (siehe lib/datenpunkte.js und main.js, geraeteWerteSchreiben).
 */

/**
 * Wie ein Wert in einer Unterstruktur verpackt ist.
 *
 * AM LAUFENDEN GERAET BELEGT (15.09.2026, WCR860). Jedes Feld der Prozess-, Aktor- und
 * Sensor-Leafs ist eine kleine Struktur, und es gibt genau zwei Bauarten:
 *
 *   "Annotated"  [Anforderungsmaske 8, WERT, Deutung]                      - 3 Eintraege
 *   "Generic"    [Anforderungsmaske 9, min, max, ISTWERT, Schrittweite, .] - 6 Eintraege
 *
 * Das ist keine Vermutung: Feld 24 des Eco-Leaf (heatingTargetTemperature, Generic) stand im
 * Abzug mit [9, 0, 0, 40, 0, 0], waehrend die Maschine ein 40-Grad-Programm fuhr. Der Adapter
 * las bis dahin den zweiten Eintrag - also das Minimum, also immer 0. Betroffen waren alle
 * Generic-Felder: blockNumber, blockStep, loadLevel, washBlock, washBlockIndex,
 * heatingTargetTemperature und stepAdvanceSwitching.
 */
const WERT_INDEX = { annotated: 1, generic: 3 };

/* ---------- Ergaenzungen, die nicht aus dop2rs stammen ---------- */

/*
 * 2/145 - Geraetekennung. AM EIGENEN GERAET ABGELESEN (15.09.2026, G5840).
 *
 * MieleRESTServer kennt dieses Leaf nicht. Die Spuelmaschine beantwortet es mit vier
 * Zeichenketten, deren Bedeutung sich aus dem Vergleich mit der Anmeldung ergibt: Feld 1 ist
 * dieselbe Seriennummer, unter der das Geraet im Netz auftritt, Feld 3 die Modellbezeichnung
 * und Feld 4 die Materialnummer. Feld 2 traegt "65" und ist ungedeutet.
 *
 * ACHTUNG SERIENNUMMER: Feld 1 identifiziert ein einzelnes Geraet. Es wird deshalb NICHT in die
 * Sammlung uebernommen (siehe lib/sammler.js, Datenschutz) und bekommt keinen Datenpunkt.
 */
const DeviceIdentStrings = {
    1: 'fabNumber',
    3: 'techType',
    4: 'matNumber',
};

/*
 * Leafs, die `ha-miele-at-lan` zusaetzlich kennt - ohne Feldtabelle, aber mit Adresse.
 *
 * WARUM SIE HIER STEHEN, OBWOHL NICHTS DRIN STEHT. Der Leaf-Scan dieses Adapters durchsucht bis
 * 0.3.36 nur die Units 1, 2 und 3. Die beiden Programmlisten des Backofens liegen aber in
 * UNIT 14 - ein Backofen, der auf alle 882 gescannten Adressen mit 404 antwortet (H2469BP,
 * 15.09.2026), ist damit nicht stumm, sondern wurde nur an der falschen Stelle gefragt.
 * Der Scan nimmt diese Adressen jetzt mit; siehe lib/leafscan.js, BEREICHE.
 */
const WEITERE_LEAFS = {
    '1/17': 'allgemeine Faehigkeiten (402 B, ha-miele-at-lan)',
    '2/138': 'Zyklenzaehler / Quittierung von Meldungen',
    '2/1577': 'ungedeutet, 278 B',
    '14/1570': 'Programmliste Backofen (alte Anordnung)',
    '14/1571': 'Optionsliste zum gewaehlten Programm',
};

/* ---------- Feldtabellen je Struktur ---------- */

/** ActuatorData - Waschen/Trocknen. */
const ActuatorData = {
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

/** BeanContainerInfo - Kaffee/Garen. */
const BeanContainerInfo = {
    1: 'compartmentOne',
    2: 'compartmentTwo',
    3: 'compartmentThree',
};

/** CSContext - alle Geraete. */
const CSContext = {
    1: 'programId',
    2: 'contextWasher',
    3: 'contextOven',
};

/** CSContextParametersOven - Backofen. */
const CSContextParametersOven = {
    1: 'open',
    2: 'lock',
    3: 'on',
    4: 'level',
};

/** CSContextParametersWasher - Waschen/Trocknen. */
const CSContextParametersWasher = {
    1: 'onOff',
    2: 'waterLevel',
    3: 'waterInletWay',
    4: 'speed',
    5: 'actuatorLevel',
    6: 'residualMoistureResistance',
    7: 'rssCalibration',
    8: 'userInterface',
};

/** CSHoursOfOperation - alle Geraete. */
const CSHoursOfOperation = {
    1: 'hoursOfOperation',
    2: 'hoursOfOperationBeforeReplacement',
    3: 'hoursOfOperationSinceLastMaintenance',
    4: 'hoursOfOperationMode1',
    5: 'hoursOfOperationMode2',
};

/** DateTimeInfo - Kommunikationsmodul. */
const DateTimeInfo = {
    1: 'utcTime',
    2: 'utcOffset',
};

/** DeviceAttributesCCA - Kaffee/Garen. */
const DeviceAttributesCCA = {
    2: 'milkCleaningCntr',
    3: 'brewUnitDegreasingCntr',
    4: 'manualDescalingCntr',
    5: 'drinksTillDescaling',
    6: 'drinksTillBrewUnitDegrease',
    7: 'stateDescalingCartridge',
    8: 'stateCleaningCartridge',
    9: 'stateBeanContainer',
    11: 'doorLock',
    12: 'programsTillDescaling',
    13: 'minutesOfHeating',
    14: 'minutesOfHeatingDescalingThreshold',
    15: 'levelWaterTank',
    16: 'freshWaterTankState',
    17: 'frontPanelState',
    18: 'sabbatActive',
    19: 'descalingRequired',
    20: 'cleaningRequired',
    21: 'traideFairModeActive',
    22: 'supportedProgramGroups',
    23: 'descalingCartridgeLevel',
    24: 'cleaningCartridgeLevel',
    25: 'daysTillMilkCleaning',
    26: 'objectDataChanged',
    27: 'pushToTalk',
    28: 'initialGrinding',
    29: 'opLastInstanceChanged',
    30: 'opLastInstanceChangedCounter',
};

/** DeviceAttributesDWTDWM - Waschen/Trocknen. */
const DeviceAttributesDWTDWM = {
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
    34: 'showRinseAidDeficit',
    35: 'hygieneCounter',
    36: 'maxReachedTemperature',
};

/** DeviceCombiState - alle Geraete. */
const DeviceCombiState = {
    1: 'applianceState',
    2: 'operationState',
    3: 'processState',
};

/** DeviceContext - alle Geraete. */
const DeviceContext = {
    1: 'state',
    6: 'deviceAttributesDwtdwm',
    7: 'prog',
    8: 'deviceAttributes',
    11: 'mobileStartActive',
    12: 'showMeHowId',
    13: 'requestTimeSync',
};

/** DeviceIdent - alle Geraete. */
const DeviceIdent = {
    1: 'deviceType',
    2: 'protocolType',
    5: 'supportedApps',
    9: 'rfVariant',
};

/** DeviceNotifications - alle Geraete. */
const DeviceNotifications = {
    2: 'messages',
    3: 'errors',
};

/** DeviceState - alle Geraete. */
const DeviceState = {
    1: 'mainState',
    2: 'remoteEnable',
    3: 'programType',
    4: 'programId',
    5: 'programPhase',
    6: 'startTimeRelative',
    7: 'remainingTime',
    8: 'elapsedTimeRelative',
    9: 'processTemperatureSet',
    10: 'processTemperatureCurrent',
    11: 'coreTemperatureSet',
    12: 'coreTemperatureCurrent',
    13: 'signalDoor',
    14: 'signalInfo',
    15: 'spinningSpeed',
    16: 'dryingStep',
    17: 'lightState',
    18: 'standbyState',
    19: 'field19',
    20: 'field20',
    21: 'field21',
};

/** ErrorInfo - alle Geraete. */
const ErrorInfo = {
    1: 'id',
    2: 'ackOptions',
};

/** Failure - alle Geraete. */
const Failure = {
    1: 'failureCode',
    2: 'active',
    3: 'occurrenceFrequency',
    4: 'occurrenceTime',
    5: 'operationSeconds',
    6: 'progId',
    7: 'blockNumber',
};

/** FailureList - alle Geraete. */
const FailureList = {
    1: 'items',
};

/** FailureListItem - alle Geraete. */
const FailureListItem = {
    1: 'failureCode',
    2: 'presentNow',
};

/** FeatureList - alle Geraete. */
const FeatureList = {
    1: 'deviceId',
    2: 'deviceClass',
    3: 'deviceSubClass',
    5: 'hasSearch',
    6: 'hasCamera',
    7: 'deviceIdSubType',
    131: 'featureListOven',
};

/** FeatureListOven - Backofen. */
const FeatureListOven = {
    1: 'deviceId',
};

/** FileInfo - Dateisystem. */
const FileInfo = {
    1: 'filename',
    2: 'sha256',
    3: 'currentSize',
    4: 'maxSize',
};

/** FileList - Dateisystem. */
const FileList = {
    1: 'filename',
    2: 'sha256',
    3: 'description',
    4: 'fileAccessMode',
    5: 'size',
};

/** FileTransfer - Dateisystem. */
const FileTransfer = {
    1: 'fileName',
    2: 'fileOperation',
    3: 'fileOperationStatus',
    4: 'offset',
    5: 'fileSize',
    6: 'dataLength',
    7: 'data',
    8: 'dummy',
};

/** FileWrite - Dateisystem. */
const FileWrite = {
    1: 'fileOperation',
    2: 'fileName',
    3: 'address',
    4: 'size',
    5: 'data',
};

/** LastUpdateInfo - Kommunikationsmodul. */
const LastUpdateInfo = {
    1: 'filename',
};

/** MessageInfo - alle Geraete. */
const MessageInfo = {
    1: 'id',
    3: 'ackOptions',
};

/** PSAttributesCCA - Kaffee/Garen. */
const PSAttributesCCA = {
    1: 'progPhase',
    2: 'progSubPhase',
    3: 'progress',
    6: 'displayTemperature',
    7: 'displayCoreTemperature',
    21: 'temperatureSetpoint',
    22: 'moistureSetpoint',
    24: 'powerSetpoint',
    26: 'startTime',
    29: 'nextActionTime',
};

/** PSContext - alle Geraete. */
const PSContext = {
    4: 'contextOven',
    7: 'attributesOven',
};

/** PSContextParametersOven - Backofen. */
const PSContextParametersOven = {
    1: 'grillLevel',
    2: 'moisture',
    5: 'level',
    6: 'temperature',
};

/** PartName - alle Geraete. */
const PartName = {
    1: 'partName',
    2: 'code',
};

/** Process - Waschen/Trocknen. */
const Process = {
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
    34: 'sewTotalFilledQuantityU16',
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

/** ProgramGroupRange - alle Geraete. */
const ProgramGroupRange = {
    1: 'firstProgramId',
    2: 'lastProgramId',
    3: 'flags',
    4: 'payload',
};

/** ProgramGroupsComplete - alle Geraete. */
const ProgramGroupsComplete = {
    1: 'low',
    2: 'high',
};

/** ProgramInstructionsCA - Backofen. */
const ProgramInstructionsCA = {
    1: 'infoId',
    2: 'messageId',
    3: 'value',
};

/** ProgramList - alle Geraete. */
const ProgramList = {
    1: 'valid',
    2: 'programIds',
    3: 'remainingTime',
    4: 'temperature',
    5: 'temperatureInfo',
};

/** RemoteEnable - alle Geraete. */
const RemoteEnable = {
    1: 'remoteControlSetting',
    2: 'actualControl',
    3: 'smartGridControl',
    4: 'mobileControl',
};

/** RsaKey - Dateisystem. */
const RsaKey = {
    1: 'key',
};

/** Sensor - Waschen/Trocknen. */
const Sensor = {
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

/** SfValue - alle Geraete. */
const SfValue = {
    1: 'sfId',
    2: 'validity',
    3: 'valueInterpretation',
    4: 'currentValue',
    5: 'min',
    6: 'max',
    7: 'default',
    8: 'listRef',
    9: 'stepSize',
    10: 'extValue',
    11: 'fineAdjusted',
};

/** SfValueList - alle Geraete. */
const SfValueList = {
    1: 'validCount',
    2: 'valid',
};

/** SoftwareBuild - Waschen/Trocknen. */
const SoftwareBuild = {
    1: 'date',
    2: 'time',
    3: 'id',
    4: 'version',
};

/** SuperVisionListConfig - Kommunikationsmodul. */
const SuperVisionListConfig = {
    1: 'active',
    2: 'onErrorOnly',
    3: 'isTimeMaster',
};

/** SuperVisionListItem - Kommunikationsmodul. */
const SuperVisionListItem = {
    1: 'deviceId',
    2: 'deviceIdEnum',
    3: 'deviceName',
    4: 'connectionState',
    5: 'displaySetting',
    6: 'signalSetting',
    7: 'superVisionActivate',
    8: 'superVisionDisplayScreenEnum',
    9: 'superVisionDisplayTextEnum',
    10: 'utcTime',
    11: 'timeOffset',
    12: 'processData',
    13: 'programType',
    14: 'programPhase',
    15: 'signalDoor',
    16: 'signalInfo',
    17: 'longAddress',
    18: 'remoteEnable',
    19: 'standbyState',
    20: 'field20',
    21: 'field21',
    22: 'field22',
    23: 'field23',
    24: 'programId',
};

/** SupportedApplications - alle Geraete. */
const SupportedApplications = {
    1: 'mieleAtHome',
    2: 'remoteVision',
    3: 'superVision',
    4: 'smartGrid',
    5: 'mobileControl',
    6: 'unknown1',
    7: 'unknown2',
    8: 'voiceControl',
    9: 'unknown3',
    10: 'featureList',
    11: 'washToDry',
};

/** UpdateContainerInformation - Kommunikationsmodul. */
const UpdateContainerInformation = {
    1: 'updateState',
    2: 'field2',
    3: 'field3',
    4: 'field4',
    5: 'field5',
    6: 'field6',
    7: 'field7',
    8: 'field8',
    9: 'field9',
    10: 'field10',
    11: 'crc32',
};

/** UpdateControl - Kommunikationsmodul. */
const UpdateControl = {
    1: 'updateState',
    2: 'filename',
    3: 'flashAccessible',
    4: 'progress',
};

/** UserRequest - alle Geraete. */
const UserRequest = {
    1: 'requestId',
    2: 'parameter0',
    3: 'parameter1',
};

/** XkmConfigIp - Kommunikationsmodul. */
const XkmConfigIp = {
    1: 'ipAuto',
    2: 'ipAddress',
    3: 'subnetMask',
    4: 'gatewayAddress',
    5: 'dnsServerAuto',
    6: 'dnsServer1',
    7: 'dnsServer2',
    8: 'wifiKey',
    9: 'wifiSsid',
    10: 'wifiSecurityType',
    11: 'wifiChannel',
};

/** XkmConfigSsidList - Kommunikationsmodul. */
const XkmConfigSsidList = {
    1: 'ssid',
    2: 'wlanSecurity',
    3: 'rssi',
    4: 'wifiChannel',
};

/** XkmIdent - Kommunikationsmodul. */
const XkmIdent = {
    2: 'applicationType',
    3: 'moduleType',
    4: 'softwareVersion',
    5: 'softwareId',
    6: 'macAddressWifi',
    7: 'applicationScope',
    8: 'macAddressLan',
};

/** XkmIdentLabel - Kommunikationsmodul. */
const XkmIdentLabel = {
    1: 'serialNumber',
    2: 'fabricationNumber',
    3: 'technicalType',
    4: 'materialNumber',
};

/** XkmStateInfo - Kommunikationsmodul. */
const XkmStateInfo = {
    1: 'state',
    2: 'signalQuality',
    3: 'systemState',
    4: 'requestActive',
    5: 'requestState',
    6: 'syncState',
    7: 'configState',
    8: 'cloudStatus',
    9: 'connectedClients',
    10: 'connectedSystemPeripherals',
    11: 'wifiFreqRange',
    12: 'wifiChannel',
    13: 'rssi',
    14: 'bssid',
    15: 'bluetoothState',
};

/*
 * Welches Leaf welche Struktur traegt.
 *
 * Der Schluessel ist "unit/attribut", wie ihn der Leaf-Scan schreibt. Ein Leaf, das hier fehlt,
 * ist damit nicht unbekannt - es ist nur unbenannt: Der Scan findet es, der Verlauf schreibt es
 * mit, und in der CSV steht es unter seiner Nummer.
 */
const LEAF_STRUKTUR = {
    '2/105': 'SfValue', // alle Geraete
    '2/110': 'XkmConfigSsidList', // Kommunikationsmodul
    '2/114': 'SfValueList', // alle Geraete
    '2/117': 'Failure', // alle Geraete
    '2/119': 'CSHoursOfOperation', // alle Geraete
    '2/122': 'DateTimeInfo', // Kommunikationsmodul
    '2/131': 'DeviceNotifications', // alle Geraete
    '2/144': 'DeviceIdent', // alle Geraete
    '2/145': 'DeviceIdentStrings', // alle Geraete - eigene Messung, siehe oben             // alle Geraete
    '2/148': 'FailureList', // alle Geraete
    '2/154': 'CSContext', // alle Geraete
    '2/170': 'UpdateControl', // Kommunikationsmodul
    '2/173': 'PartName', // alle Geraete
    '2/199': 'LastUpdateInfo', // Kommunikationsmodul
    '2/256': 'DeviceState', // alle Geraete
    '2/257': 'ProgramInstructionsCA', // Backofen
    '2/287': 'RsaKey', // Dateisystem
    '2/333': 'FileList', // Dateisystem
    '2/336': 'FileTransfer', // Dateisystem
    '2/348': 'FeatureList', // alle Geraete
    '2/391': 'DeviceContext', // alle Geraete
    '2/392': 'DeviceNotifications', // alle Geraete
    '2/397': 'UpdateContainerInformation', // Kommunikationsmodul
    '2/1565': 'XkmIdent', // Kommunikationsmodul
    '2/1566': 'XkmIdentLabel', // Kommunikationsmodul
    '2/1568': 'XkmStateInfo', // Kommunikationsmodul
    '2/1570': 'SuperVisionListConfig', // Kommunikationsmodul
    '2/1571': 'SuperVisionListItem', // Kommunikationsmodul
    '2/1573': 'XkmConfigIp', // Kommunikationsmodul
    '2/1574': 'PSContext', // alle Geraete
    '2/1583': 'UserRequest', // alle Geraete
    '2/1584': 'ProgramList', // alle Geraete
    '2/1585': 'DeviceContext', // alle Geraete
    '2/1586': 'DeviceCombiState', // alle Geraete
    '2/1588': 'FileInfo', // Dateisystem
    '2/1590': 'FileWrite', // Dateisystem
    '2/1599': 'ProgramGroupsComplete', // alle Geraete
    '2/6192': 'ActuatorData', // Waschen/Trocknen
    '2/6193': 'Sensor', // Waschen/Trocknen
    '2/6194': 'SoftwareBuild', // Waschen/Trocknen
    '2/6195': 'Process', // Waschen/Trocknen
};

/*
 * Felder, hinter denen eine weitere Struktur steckt.
 *
 * Beispiel 2/1585 Feld 6: dort liegen die EcoFeedback-Werte, die Miele in der App anzeigt.
 * Ohne diese Tabelle waere der Inhalt eine namenlose Liste von Listen.
 */
const UNTERSTRUKTUR = {
    CSContext: { 2: 'CSContextParametersWasher', 3: 'CSContextParametersOven' },
    DeviceAttributesCCA: { 9: 'BeanContainerInfo' },
    DeviceContext: {
        1: 'DeviceCombiState',
        6: 'DeviceAttributesDWTDWM',
        7: 'PSAttributesCCA',
        8: 'DeviceAttributesCCA',
    },
    DeviceIdent: { 5: 'SupportedApplications' },
    DeviceNotifications: { 2: 'MessageInfo', 3: 'ErrorInfo' },
    DeviceState: { 2: 'RemoteEnable' },
    FailureList: { 1: 'FailureListItem' },
    FeatureList: { 131: 'FeatureListOven' },
    PSContext: { 4: 'PSContextParametersOven', 7: 'PSAttributesCCA' },
    ProgramGroupsComplete: { 1: 'ProgramGroupRange', 2: 'ProgramGroupRange' },
};

/*
 * Welche Bauart ein Feld hat - "generic" heisst: der Istwert steht an vierter Stelle.
 *
 * Nur die Abweichler stehen hier. Alles andere ist "annotated", und das ist auch der Rueckfall
 * fuer jedes Feld, das diese Tabelle nicht kennt: Er trifft in der Ueberzahl der Faelle zu und
 * laesst sich an der Laenge der Struktur ohnehin gegenpruefen (siehe dop2.wertAusStruktur).
 */
const GENERIC = {
    CSContextParametersOven: [4],
    CSContextParametersWasher: [2, 3, 4, 5],
    DeviceAttributesDWTDWM: [3, 4, 5, 6, 27],
    PSContextParametersOven: [1, 2, 5, 6],
    Process: [1, 2, 3, 18, 19, 24, 58],
};

const TABELLEN = {
    DeviceIdentStrings,

    ActuatorData,
    BeanContainerInfo,
    CSContext,
    CSContextParametersOven,
    CSContextParametersWasher,
    CSHoursOfOperation,
    DateTimeInfo,
    DeviceAttributesCCA,
    DeviceAttributesDWTDWM,
    DeviceCombiState,
    DeviceContext,
    DeviceIdent,
    DeviceNotifications,
    DeviceState,
    ErrorInfo,
    Failure,
    FailureList,
    FailureListItem,
    FeatureList,
    FeatureListOven,
    FileInfo,
    FileList,
    FileTransfer,
    FileWrite,
    LastUpdateInfo,
    MessageInfo,
    PSAttributesCCA,
    PSContext,
    PSContextParametersOven,
    PartName,
    Process,
    ProgramGroupRange,
    ProgramGroupsComplete,
    ProgramInstructionsCA,
    ProgramList,
    RemoteEnable,
    RsaKey,
    Sensor,
    SfValue,
    SfValueList,
    SoftwareBuild,
    SuperVisionListConfig,
    SuperVisionListItem,
    SupportedApplications,
    UpdateContainerInformation,
    UpdateControl,
    UserRequest,
    XkmConfigIp,
    XkmConfigSsidList,
    XkmIdent,
    XkmIdentLabel,
    XkmStateInfo,
};

/**
 * Der Name eines Feldes in einer Struktur, oder null.
 *
 * @param struktur Name der Struktur
 * @param idx Feldnummer
 */
function feldNameIn(struktur, idx) {
    const t = TABELLEN[struktur];
    return (t && t[Number(idx)]) || null;
}

/**
 * Welche Struktur ein Leaf traegt ("2/6195" -> "Process"), oder null.
 *
 * @param leaf Leaf-Schluessel, etwa "2/6195"
 */
function strukturVon(leaf) {
    return LEAF_STRUKTUR[leaf] || null;
}

/**
 * Ist dieses Feld ein Generic-Wert (Istwert an vierter Stelle)?
 *
 * @param struktur Name der Struktur
 * @param idx Feldnummer
 */
function istGeneric(struktur, idx) {
    const liste = GENERIC[struktur];
    return !!(liste && liste.indexOf(Number(idx)) >= 0);
}

module.exports = {
    TABELLEN,
    LEAF_STRUKTUR,
    UNTERSTRUKTUR,
    GENERIC,
    WERT_INDEX,
    WEITERE_LEAFS,
    feldNameIn,
    strukturVon,
    istGeneric,
};

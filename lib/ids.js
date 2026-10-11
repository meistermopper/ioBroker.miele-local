'use strict';

/*
 * Die Objekt-IDs des Diagnosezweigs - und was aus den deutschen geworden ist.
 *
 * WOZU DIESE DATEI. Der Adapter benennt seine Objekte durchgaengig englisch. Bis 0.3.37 fiel
 * ein Kanal heraus: "sammlung" trug ausschliesslich deutsche IDs, dazu vier deutsche Namen
 * mitten im englischen Kanal "history" - zusammen 57 von 446 Objekten. Im Aufnahmeantrag
 * (ioBroker/ioBroker.repositories#6471) hat der Pruefer das am 11.09.2026 beanstandet: Ein
 * Abzug, der ueberfliegend gelesen wird, sieht dort nach von Hand angelegten
 * Skript-Datenpunkten aus statt nach Adapter-Objekten.
 *
 * SEIT 0.3.38 SIND SIE ENGLISCH. [ALT] haelt fest, wie sie vorher hiessen - nicht aus
 * Nostalgie, sondern weil bestehende Anlagen die alten Objekte samt Werten und Historie noch
 * haben. Der Umzug in main.js (idsUmziehen) liest diese Tabelle, traegt jeden Wert an seinem
 * neuen Ort ein und raeumt den alten weg. Einmal, beim ersten Start nach dem Update.
 *
 * WER SIE VON AUSSEN BENUTZT HAT, muss nachziehen. Vor der Umbenennung geprueft: Die
 * Smarthome-App des Betreibers liest keinen davon (sie nutzt state.*, history.energyKwh,
 * history.waterL und history.cyclesJson), und von 56 ioBroker-Skripten nennt keines einen.
 *
 * AUFBAU. Der Schluessel ist der bleibende Name, der Wert die tatsaechliche ID. Beides ist
 * jetzt gleich - die Zwischenschicht bleibt trotzdem stehen, damit eine kuenftige Aenderung
 * wieder ein Tausch von Werten ist und keine Suchaktion quer durch den Quelltext.
 */

/** Kanalnamen, die nicht englisch sind. */
const KANAL = {
    collection: 'collection',
};

/** Datenpunkte im Kanal der Datensammlung. */
const SAMMLUNG = {
    records: 'records',
    cycles: 'cycles',
    progress: 'progress',
    finding: 'finding',
    check: 'check',
    checkJson: 'checkJson',
    scan: 'scan',
    scanState: 'scanState',
    scanJson: 'scanJson',
    trendJson: 'trendJson',
    trendSize: 'trendSize',
    trendLeaf: 'trendLeaf',
    inputEnergy: 'inputEnergy',
    inputWater: 'inputWater',
};

/** Die vier deutschen Namen im sonst englischen Kanal "history". */
const HISTORY = {
    measuredLast: 'measuredLast',
    measuredTotal: 'measuredTotal',
    runningSince: 'runningSince',
    meterAtStart: 'meterAtStart',
};

/**
 * Voller Pfad eines Datenpunkts der Datensammlung.
 *
 * @param {string} deviceId Geraete-ID
 * @param {string} schluessel Schluessel aus SAMMLUNG, etwa "finding"
 * @returns {string} voller Pfad des Datenpunkts
 */
function s(deviceId, schluessel) {
    const id = SAMMLUNG[schluessel];
    if (!id) {
        throw new Error(`unknown collection state: ${schluessel}`);
    }
    return `${deviceId}.${KANAL.collection}.${id}`;
}

/**
 * Voller Pfad eines Verlaufs-Datenpunkts mit deutschem Namen.
 *
 * @param {string} deviceId Geraete-ID
 * @param {string} schluessel Schluessel aus HISTORY, etwa "runningSince"
 * @returns {string} voller Pfad des Datenpunkts
 */
function h(deviceId, schluessel) {
    const id = HISTORY[schluessel];
    if (!id) {
        throw new Error(`unknown history state: ${schluessel}`);
    }
    return `${deviceId}.history.${id}`;
}

/**
 * Der Kanal der Datensammlung selbst.
 *
 * @param deviceId Geraete-ID
 */
function kanal(deviceId) {
    return `${deviceId}.${KANAL.collection}`;
}

/*
 * Wie die Datenpunkte bis 0.3.37 hiessen.
 *
 * Schluessel ist der NEUE Name, Wert der alte. Der Umzug beim Start geht diese Tabelle durch;
 * steht am alten Ort noch etwas, wandert es an den neuen und der alte Punkt wird geloescht.
 * Eine Anlage, die frisch aufgesetzt wird, findet nichts davon und tut nichts.
 */
const ALT = {
    kanal: 'sammlung',
    sammlung: {
        records: 'datenJson',
        cycles: 'zyklen',
        progress: 'fortschritt',
        finding: 'befund',
        check: 'kontrolle',
        checkJson: 'kontrolleJson',
        scan: 'leafScan',
        scanState: 'leafScanStand',
        scanJson: 'leafScanJson',
        trendJson: 'leafVerlaufJson',
        trendSize: 'leafVerlaufStand',
        trendLeaf: 'leafVerlaufFein',
        inputEnergy: 'eingabeEnergie',
        inputWater: 'eingabeWasser',
    },
    history: {
        measuredLast: 'gemessenLetzter',
        measuredTotal: 'gemessenTotal',
        runningSince: 'laufendSeit',
        meterAtStart: 'zaehlerStart',
    },
    // 0.3.45: der letzte deutsche Name im Baum (Review-Vorbereitung 03.10.2026)
    eco: {
        source: 'quelle',
        fieldsJson: 'felderJson',
    },
};

/**
 * Deutsche Einstellungsnamen bis 0.3.44 und ihre englischen Nachfolger (Review 03.10.2026:
 * auch config-Schlüssel muessen englisch sein). Der Umzug laeuft einmal beim Start, siehe
 * konfigUmzug() und main.js onReady.
 */
const KONFIG_ALT = {
    sammlerAktiv: 'collectorActive',
    sammlerCloud: 'collectorCloud',
    sammlerCloudInstanz: 'collectorCloudInstance',
    leafDatenpunkte: 'leafStates',
    zaehler: 'energyMeters',
};

/**
 * Einstellungen auf die englischen Namen umziehen.
 *
 * Steht ein alter Schluessel noch in den Einstellungen, gilt SEIN Wert - der neue kann nur die
 * Vorgabe sein, die ioBroker beim Update aus io-package.json ergaenzt hat. Der alte Schluessel
 * wird entfernt, damit der Umzug genau einmal geschieht. In der Zaehlertabelle heisst die Spalte
 * "datenpunkt" jetzt "stateId".
 *
 * @param {object} native Einstellungen der Instanz (native)
 * @returns {{native: object, geaendert: boolean}} neue Einstellungen und ob sich etwas geaendert hat
 */
function konfigUmzug(native) {
    const neu = { ...(native || {}) };
    let geaendert = false;
    for (const [alt, neuName] of Object.entries(KONFIG_ALT)) {
        if (Object.prototype.hasOwnProperty.call(neu, alt)) {
            neu[neuName] = neu[alt];
            delete neu[alt];
            geaendert = true;
        }
    }
    if (Array.isArray(neu.energyMeters)) {
        const tabelle = neu.energyMeters.map(z =>
            z && Object.prototype.hasOwnProperty.call(z, 'datenpunkt')
                ? (({ datenpunkt, ...rest }) => ({ ...rest, stateId: datenpunkt }))(z)
                : z,
        );
        if (JSON.stringify(tabelle) !== JSON.stringify(neu.energyMeters)) {
            neu.energyMeters = tabelle;
            geaendert = true;
        }
    }
    return { native: neu, geaendert };
}

/**
 * Alle Umzuege eines Geraets: von welcher ID nach welcher.
 *
 * @param {string} deviceId Geraete-ID
 * @returns {Array<{alt: string, neu: string}>} leer, wenn nichts umzubenennen ist
 */
function umzuege(deviceId) {
    const aus = [];
    for (const [schluessel, alt] of Object.entries(ALT.sammlung)) {
        const neu = `${deviceId}.${KANAL.collection}.${SAMMLUNG[schluessel]}`;
        const vorher = `${deviceId}.${ALT.kanal}.${alt}`;
        if (vorher !== neu) {
            aus.push({ alt: vorher, neu });
        }
    }
    for (const [schluessel, alt] of Object.entries(ALT.history)) {
        const neu = `${deviceId}.history.${HISTORY[schluessel]}`;
        const vorher = `${deviceId}.history.${alt}`;
        if (vorher !== neu) {
            aus.push({ alt: vorher, neu });
        }
    }
    for (const [neuName, alt] of Object.entries(ALT.eco)) {
        aus.push({ alt: `${deviceId}.eco.${alt}`, neu: `${deviceId}.eco.${neuName}` });
    }
    return aus;
}

/**
 * Der alte Kanal der Datensammlung - nach dem Umzug zu entfernen.
 *
 * @param deviceId Geraete-ID
 */
function alterKanal(deviceId) {
    return `${deviceId}.${ALT.kanal}`;
}

module.exports = {
    KONFIG_ALT,
    konfigUmzug,
    KANAL,
    SAMMLUNG,
    HISTORY,
    ALT,
    s,
    h,
    kanal,
    umzuege,
    alterKanal,
};

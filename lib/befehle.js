'use strict';

/*
 * Steuerbefehle: ausfuehren oder sauber abschliessen (seit 0.3.47).
 *
 * Bis 0.3.46 blieb ein Befehl, der an der Freigabe, am Geraet oder an der Verbindung
 * scheiterte, mit ack=false stehen. Am 16.10.2026 stand so ein control.powerOn = true seit
 * 52 Tagen unbestaetigt da (gesetzt am 25.08., die Steuerung war damals aus). Wer den
 * Datenpunkt liest, haelt das fuer einen Befehl, der noch unterwegs ist.
 *
 * Jetzt endet jeder Befehl mit val=false und ack=true. Wurde er nicht ausgefuehrt, steht der
 * Grund im Kommentarfeld c, und die Qualitaet q ordnet ihn ein - sichtbar im Objektbrowser und
 * fuer Skripte lesbar. Ein spaeterer erfolgreicher Befehl setzt q wieder auf 0.
 */

/** ioBroker-Qualitaetscodes, die hier vorkommen. */
const Q = {
    INSTANZ: 0x11, // general problem by instance
    NICHT_VERBUNDEN: 0x42, // device not connected
    GERAETEFEHLER: 0x44, // device reports error
};

/**
 * Einen Befehl abschliessen, der nicht ausgefuehrt wurde.
 *
 * @param adapter Adapterinstanz (log, setStateAsync)
 * @param {string} id vollstaendige ID des Steuer-Datenpunkts
 * @param {string} sub Name des Befehls (fuers Log)
 * @param {string} grund Fehlermeldung, englisch
 * @param {number} q ioBroker-Qualitaetscode
 */
async function abschliessen(adapter, id, sub, grund, q) {
    adapter.log.warn(`Command '${sub}' not executed: ${grund}`);
    try {
        await adapter.setStateAsync(id, { val: false, ack: true, q, c: `not executed: ${grund}` });
    } catch (e) {
        adapter.log.debug(`${id}: could not acknowledge - ${e.message}`);
    }
}

/**
 * Einen Nutzerbefehl unter control.* verarbeiten.
 *
 * @param adapter Adapterinstanz (config, devices, log, setStateAsync, getObjectAsync)
 * @param {{id: string, deviceId: string, sub: string, val: unknown}} befehl der Befehl
 * @param {{senden: (dev: object, opcode: number) => Promise<number>, nachErfolg?: () => void}} wege
 *   senden schickt den Befehl und liefert den HTTP-Status; nachErfolg holt den neuen Zustand
 */
async function verarbeiten(adapter, befehl, wege) {
    const { id, deviceId, sub, val } = befehl;
    const dev = adapter.devices && adapter.devices[deviceId];
    if (!dev) {
        return abschliessen(adapter, id, sub, 'device not connected', Q.NICHT_VERBUNDEN);
    }
    if (!adapter.config.allowControl) {
        return abschliessen(adapter, id, sub, 'device control is disabled in the instance settings', Q.INSTANZ);
    }
    if (!val) {
        // false loest nichts aus - nur bestaetigen, damit nichts offen bleibt.
        await adapter.setStateAsync(id, { val: false, ack: true });
        return;
    }
    const obj = await adapter.getObjectAsync(id);
    const opcode = obj && obj.native ? obj.native.opcode : null;
    if (opcode == null) {
        return abschliessen(adapter, id, sub, 'unknown command', Q.INSTANZ);
    }
    let status;
    try {
        status = await wege.senden(dev, opcode);
    } catch (e) {
        return abschliessen(
            adapter,
            id,
            sub,
            `${deviceId} - ${e.message} (remote control might not be supported by the firmware)`,
            Q.NICHT_VERBUNDEN,
        );
    }
    if (status === 200 || status === 204) {
        adapter.log.info(`Command '${sub}' sent to ${deviceId} (opcode 0x${opcode.toString(16)}).`);
        await adapter.setStateAsync(id, { val: false, ack: true });
        if (wege.nachErfolg) {
            wege.nachErfolg();
        }
        return;
    }
    return abschliessen(
        adapter,
        id,
        sub,
        `HTTP ${status} from ${deviceId} (is MobileStart enabled on the device?)`,
        Q.GERAETEFEHLER,
    );
}

/**
 * Unbestaetigte Steuerbefehle beim Start schliessen - OHNE sie auszufuehren.
 *
 * Ein Befehl, der beim Start noch mit ack=false dasteht, stammt aus einer frueheren Laufzeit:
 * gesetzt, waehrend der Adapter aus war, oder unter 0.3.46 und frueher gescheitert, ohne
 * zurueckgesetzt zu werden. Ihn jetzt nachzuholen waere gefaehrlich - ein "Start" von vor
 * Wochen gehoert nicht an eine Maschine, die inzwischen anders beladen ist.
 *
 * @param adapter Adapterinstanz (getStatesAsync, setStateAsync, log)
 * @returns {Promise<number>} Zahl der geschlossenen Befehle
 */
async function offeneSchliessen(adapter) {
    let offen = {};
    try {
        offen = (await adapter.getStatesAsync('*.control.*')) || {};
    } catch (e) {
        adapter.log.debug(`Pending commands not checked: ${e.message}`);
        return 0;
    }
    let n = 0;
    for (const [id, st] of Object.entries(offen)) {
        if (!st || st.ack !== false) {
            continue;
        }
        const seit = st.ts ? new Date(st.ts).toISOString().slice(0, 10) : 'unknown';
        adapter.log.info(`${id}: unacknowledged command from ${seit} discarded, not sent to the device`);
        try {
            await adapter.setStateAsync(id, {
                val: false,
                ack: true,
                q: Q.INSTANZ,
                c: `not executed: still pending at adapter start (set ${seit})`,
            });
            n++;
        } catch (e) {
            adapter.log.debug(`${id}: could not acknowledge - ${e.message}`);
        }
    }
    return n;
}

module.exports = { Q, abschliessen, verarbeiten, offeneSchliessen };

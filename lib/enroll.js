'use strict';

/**
 * SuperVision-Enrollment: bringt ein Gerät dazu, Zustandsänderungen aktiv an
 * unseren Push-Listener zu senden.
 *
 * Ablauf pro Gerät (alles MieleH256-signiert, Body AES-verschlüsselt):
 *   1. PUT  /Devices/<route>/SuperVision/<ourFab>   {"Show":true,"Signal":true}
 *      → registriert uns als SuperVision-Peer (manche Basisgeräte: 404 → übersprungen).
 *   2. POST /Subscriptions   je Ressource
 *      Body {"Resource":"/Devices/<route><res>","Callback":"http://<ip>:<port>/Devices/<ourFab>/SuperVision/<route><res>"}
 *      → das Gerät POSTet künftig an unsere Callback-URL.
 *
 * Subscriptions laufen ab → periodisch erneuern (renew).
 */

const PUSH_RESOURCES = ['/State/', '/State/Light/', '/State/Status/', '/Ident/'];

/**
 * @param {import('./api').MieleDeviceApi} api Verbindung zum Geraet
 * @param {object} opts { route, ourFab, hostIp, port, log }
 * @returns {Promise<{supervisionOk:boolean, subscriptions:string[]}>} ob der SuperVision-Handshake gelang und welche Abos bestehen
 */
async function enrollDevice(api, opts) {
    const { route, ourFab, hostIp, port, log = console } = opts;
    let supervisionOk = false;

    // 1. SuperVision-Peer-Eintrag
    try {
        const body = JSON.stringify({ Show: true, Signal: true });
        const status = await api.put(`Devices/${route}/SuperVision/${ourFab}`, body);
        if (status >= 200 && status < 300) {
            supervisionOk = true;
            log.debug(`[${route}] SuperVision Show/Signal accepted (${status})`);
        } else if (status === 404) {
            log.debug(`[${route}] no /SuperVision endpoint - subscriptions only`);
        } else {
            log.debug(`[${route}] SuperVision PUT → ${status}`);
        }
    } catch (e) {
        log.debug(`[${route}] SuperVision PUT error: ${e.message}`);
    }

    // 2. Subscriptions je Ressource
    const subscriptions = [];
    for (const res of PUSH_RESOURCES) {
        const body = JSON.stringify({
            Resource: `/Devices/${route}${res}`,
            Callback: `http://${hostIp}:${port}/Devices/${ourFab}/SuperVision/${route}${res}`,
        });
        try {
            const { status } = await api.post('Subscriptions', body);
            if (status >= 200 && status < 300) {
                subscriptions.push(res);
                log.debug(`[${route}] Subscription ${res} → ${status}`);
            } else {
                log.debug(`[${route}] Subscription ${res} → ${status}`);
            }
        } catch (e) {
            log.debug(`[${route}] subscription ${res} error: ${e.message}`);
        }
    }

    return { supervisionOk, subscriptions };
}

module.exports = { enrollDevice, PUSH_RESOURCES };

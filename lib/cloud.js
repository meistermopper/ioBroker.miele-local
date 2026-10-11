'use strict';

/**
 * Miele MAP/Gigya-OAuth (PKCE) + Haushalts-GroupKey-Abruf.
 *
 * Ablauf ohne lokale Neu-Provisionierung (die Miele-App bleibt gekoppelt):
 *   1) build_authorize_url() → Nutzer öffnet URL im Browser, meldet sich an.
 *   2) Browser wird auf  miele://oauth2-code/?code=...&state=...  umgeleitet
 *      (blockiert) → Nutzer kopiert diese URL zurück.
 *   3) exchangeCode() tauscht code → {access_token, refresh_token}.
 *   4) fetchGroupKey() holt {groupId, groupKey, devices} von
 *      rest-<region>.domestic.miele-iot.com/V2/GroupKeyId/.
 */

const crypto = require('node:crypto');
const https = require('node:https');
const { URL, URLSearchParams } = require('node:url');

// Länderspezifische MAP-Consumer-client_ids (aus offizieller Android-APK).
const CONSUMER_CLIENT_IDS = {
    at: 'wNv9HJ3ZcFKH4bxvz0LExQuw',
    ch: 'V52nWiniHyVotglJKplSXnX8',
    cz: 'npoAzuJP6okjvJ0NqUq9i5Rv',
    de: 'UJgKOxacIul2BcPJAzrQE6p0',
    dk: 'xWgykqRQSa9THqOXWfzZbxsH',
    es: 'D0Q4NPBR9dwP2EjX4E0_CtHE',
    fr: 'SOiiE3R4tSD0VxYYBvB8Pi_J',
    gb: 'WigtLzKGJE1Wg6yeZUECV8-P',
    hr: 'HD4OUUQYAw_5DtVFSe4-rYzR',
    hu: '2mm2yscHPGJ4tJCVjd6mp-to',
    it: 'ARQyaYB0ZxLxJ1SJcjJgctuV',
    nl: '7ItTbQXQ1wthDOue9jvBQ7Iz',
    pl: 'jWbgLScpvIuqjUoYvf1jS-Is',
    pt: '5ZVD-CuJvpG4YpCO9pQhtrGQ',
    se: '3Mm7m1gD1eU_sUh8yxmShL6S',
    si: 'UTyhG21RchpI8FPbNeb1vFg1',
    sk: 'pGeafLwcC1_BCLr8DRTCVxSt',
    us: 'HpsWh2gzgKqRBduPpkZ4Yui9',
};
const REDIRECT_URI = 'miele://oauth2-code/';
const OAUTH_SCOPE = 'openid mcs bpdata zuora'; // `mcs` ist Pflicht für /V2/GroupKeyId/
const REST_HOST_BY_REGION = {
    EU: 'rest-eu.domestic.miele-iot.com',
    AS: 'rest-as.domestic.miele-iot.com',
    EU2: 'rest-eu2.domestic.miele-iot.com',
};

function b64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function httpsRequest(method, urlStr, { headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const req = https.request(
            { method, hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 20000 },
            res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf8'),
                    }),
                );
            },
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('HTTPS Timeout')));
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

/**
 * Autorisierungs-URL + PKCE-Challenge erzeugen.
 *
 * @param cc Laendercode des Miele-Kontos, etwa "de"
 */
function buildAuthorizeUrl(cc) {
    cc = String(cc).toLowerCase();
    const clientId = CONSUMER_CLIENT_IDS[cc];
    if (!clientId) {
        throw new Error(`Unknown country "${cc}". Supported: ${Object.keys(CONSUMER_CLIENT_IDS).join(', ')}`);
    }
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const nonce = b64url(crypto.randomBytes(16));
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: OAUTH_SCOPE,
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    });
    return {
        url: `https://prod.map.miele-iot.com/${cc}/authorize?${params}`,
        challenge: { verifier, state, nonce, cc, clientId },
    };
}

/**
 * `code` aus miele://oauth2-code/?code=...&state=... extrahieren (mit state-Prüfung).
 *
 * @param redirectUrl vollstaendige Weiterleitungs-URL aus dem Browser
 * @param expectedState state-Wert, der beim Erzeugen der Autorisierungs-URL vergeben wurde
 */
function parseRedirectUrl(redirectUrl, expectedState) {
    // miele:// ist kein von URL() parsebares Schema in allen Node-Versionen → manuell.
    const q = redirectUrl.includes('?') ? redirectUrl.slice(redirectUrl.indexOf('?') + 1) : '';
    const parsed = new URLSearchParams(q);
    if (parsed.get('error')) {
        throw new Error(`OAuth error: ${parsed.get('error')} ${parsed.get('error_description') || ''}`);
    }
    const code = parsed.get('code');
    if (!code) {
        throw new Error('No "code" in the pasted redirect URL.');
    }
    const state = parsed.get('state');
    if (expectedState && state !== expectedState) {
        throw new Error('state does not match (CSRF protection) - please create a new login URL.');
    }
    return code;
}

/**
 * code → Token.
 *
 * @param challenge PKCE-Daten aus buildAuthorizeUrl (clientId, verifier, cc)
 * @param code Autorisierungscode aus der Weiterleitung
 */
async function exchangeCode(challenge, code) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: challenge.clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: challenge.verifier,
    }).toString();
    const res = await httpsRequest('POST', `https://prod.map.miele-iot.com/${challenge.cc}/token`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
    });
    let tok;
    try {
        tok = JSON.parse(res.body);
    } catch {
        throw new Error(`Non-JSON token response: ${res.body.slice(0, 200)}`);
    }
    if (tok.error) {
        throw new Error(`Token-Endpoint: ${tok.error} ${tok.error_description || ''}`);
    }
    return tok;
}

/**
 * Access-Token erneuern (refresh_token kann rotieren).
 *
 * @param cc Laendercode des Miele-Kontos, etwa "de"
 * @param refreshToken bisheriger Refresh-Token
 */
async function refreshAccessToken(cc, refreshToken) {
    cc = String(cc).toLowerCase();
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CONSUMER_CLIENT_IDS[cc],
    }).toString();
    const res = await httpsRequest('POST', `https://prod.map.miele-iot.com/${cc}/token`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
    });
    const tok = JSON.parse(res.body);
    if (tok.error) {
        throw new Error(`Refresh failed: ${tok.error} ${tok.error_description || ''}`);
    }
    return tok;
}

/**
 * GET /V2/GroupKeyId/ → { groupId, groupKey, devices }.
 *
 * @param accessToken gueltiger Access-Token
 * @param region Cloud-Region: "EU", "EU2" oder "AS"
 */
async function fetchGroupKey(accessToken, region = 'EU') {
    const host = REST_HOST_BY_REGION[String(region).toUpperCase()];
    if (!host) {
        throw new Error(`Unknown region "${region}"`);
    }
    const res = await httpsRequest('GET', `https://${host}/V2/GroupKeyId/`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Accept-Language': 'de-DE',
            'User-Agent': 'Miele@mobile 2.3.3 Android',
        },
    });
    if (res.status === 403) {
        throw new Error(`GroupKeyId → 403 (token without mcs scope?). ${res.body.slice(0, 150)}`);
    }
    if (res.status !== 200) {
        throw new Error(`GroupKeyId → HTTP ${res.status}: ${res.body.slice(0, 150)}`);
    }
    const groups = JSON.parse(res.body);
    if (!groups || !groups.length) {
        throw new Error('No household returned - account without paired appliances?');
    }
    const g = groups[0];
    return { groupId: g.groupId, groupKey: g.groupKey, devices: g.devices || [] };
}

module.exports = {
    CONSUMER_CLIENT_IDS,
    REDIRECT_URI,
    OAUTH_SCOPE,
    REST_HOST_BY_REGION,
    buildAuthorizeUrl,
    parseRedirectUrl,
    exchangeCode,
    refreshAccessToken,
    fetchGroupKey,
};

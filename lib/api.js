'use strict';

const http = require('node:http');
const { MieleCrypto } = require('./crypto');

/**
 * Lokaler Miele-Geräte-Client: signierte GET-Reads (entschlüsselt JSON) und
 * signierte PUT-Writes (verschlüsselter Body) über HTTP Port 80.
 */
class MieleDeviceApi {
    /**
     * @param {string} host    Geräte-IP
     * @param {MieleCrypto} mc  Krypto-Provider (GroupID/GroupKey)
     * @param {object} [opts]   { timeout }
     */
    constructor(host, mc, opts = {}) {
        this.host = host;
        this.mc = mc;
        this.timeout = opts.timeout || 8000;
        // Siehe _request(): alle Anfragen an dieses Geraet laufen nacheinander.
        this._warteschlange = Promise.resolve();
    }

    /**
     * Anfragen an ein Geraet nacheinander stellen.
     *
     * Die XKM-Module bearbeiten immer nur eine Anfrage gleichzeitig. Der Adapter fragt aber aus
     * drei unabhaengigen Zeitgebern ab (Zustand, EcoFeedback, sekundengenaue Zeiten); fallen zwei
     * davon zusammen, laeuft eine ins Timeout. Sichtbar wurde das an der Waschmaschine: im
     * Ruhezustand 4-5 Zeitueberschreitungen je Stunde, waehrend eines laufenden Programms - wenn
     * das Modul ohnehin mehr zu tun hat - ueber 50. Das Geraet war dabei per Ping durchgehend
     * erreichbar, es kam schlicht nicht hinterher.
     *
     * @param method HTTP-Methode (GET, PUT oder POST)
     * @param resource Pfad der Ressource auf dem Geraet, etwa "Devices/<route>/State"
     * @param bodyPlain Klartext-Body, wird gepaddet und verschluesselt; null ohne Body
     * @param timeoutMs Zeitlimit dieser Anfrage in Millisekunden
     */
    _request(method, resource, bodyPlain, timeoutMs) {
        const starten = () => this._sendeAnfrage(method, resource, bodyPlain, timeoutMs);
        const ergebnis = this._warteschlange.then(starten, starten);
        // Die Warteschlange selbst darf nie im Fehlerzustand bleiben - sonst uebersprungen sie
        // den naechsten Eintrag, statt ihn zu starten.
        this._warteschlange = ergebnis.then(
            () => {},
            () => {},
        );
        return ergebnis;
    }

    /**
     * Eine signierte MieleH256-Anfrage stellen und die Antwort entschluesseln.
     *
     * @param {string} method        HTTP-Verb
     * @param {string} resource      Pfad unterhalb der Geraetewurzel
     * @param {Buffer|null} bodyPlain  unverschluesselter Rumpf, sonst null
     * @param {number} timeoutMs     Zeitgrenze
     * @returns {Promise<object>} Antwort des Geraets
     */
    _sendeAnfrage(method, resource, bodyPlain, timeoutMs) {
        return new Promise((resolve, reject) => {
            const bodyMethod = method === 'PUT' || method === 'POST';
            let body = Buffer.alloc(0);
            let signature;
            if (bodyMethod && bodyPlain != null) {
                body = MieleCrypto.padBody(bodyPlain);
            }
            const { headers, signature: sig } = this.mc.headers(method, this.host, resource, body);
            signature = sig;

            let sendBuf = null;
            if (bodyMethod && body.length > 0) {
                sendBuf = this.mc.encryptBody(body, signature);
                headers['Content-Length'] = sendBuf.length;
            }

            const req = http.request(
                {
                    host: this.host,
                    port: 80,
                    method,
                    path: `/${resource}`,
                    headers,
                    timeout: timeoutMs || this.timeout,
                },
                res => {
                    const chunks = [];
                    res.on('data', c => chunks.push(c));
                    res.on('end', () => {
                        resolve({
                            status: res.statusCode,
                            headers: res.headers,
                            body: Buffer.concat(chunks),
                        });
                    });
                },
            );
            req.on('error', reject);
            req.on('timeout', () => req.destroy(new Error(`Timeout ${this.host}/${resource}`)));
            if (sendBuf) {
                req.write(sendBuf);
            }
            req.end();
        });
    }

    /**
     * Signierter GET, entschlüsselt & als JSON geparst.
     *
     * @param resource Pfad der Ressource auf dem Geraet
     */
    async get(resource) {
        const res = await this._request('GET', resource);
        if (res.status === 204) {
            return null;
        }
        if (res.status !== 200) {
            const err = new Error(`GET /${resource} → HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        const xsig = res.headers['x-signature'];
        if (!xsig) {
            throw new Error(`GET /${resource}: no X-Signature header`);
        }
        const plain = this.mc.decryptResponse(xsig, res.body);
        const txt = plain.toString('utf8').replace(/[\x00\x20]+$/g, '');
        try {
            return JSON.parse(txt);
        } catch (e) {
            const err = new Error(`GET /${resource}: JSON error (${e.message})`);
            err.raw = txt;
            throw err;
        }
    }

    /**
     * Signierter PUT mit verschlüsseltem Body. Gibt Statuscode zurück.
     *
     * @param resource Pfad der Ressource auf dem Geraet
     * @param bodyPlain Klartext-Body (meist JSON)
     */
    async put(resource, bodyPlain) {
        const res = await this._request('PUT', resource, bodyPlain);
        return res.status;
    }

    /**
     * Signierter POST mit verschlüsseltem Body. Gibt {status, location} zurück.
     *
     * @param resource Pfad der Ressource auf dem Geraet
     * @param bodyPlain Klartext-Body (meist JSON)
     */
    async post(resource, bodyPlain) {
        const res = await this._request('POST', resource, bodyPlain);
        return { status: res.status, location: res.headers['location'] || '' };
    }

    // --- Convenience ---
    /**
     * Die Kennung eines Geraets lesen (Modell, Seriennummer, Firmware).
     *
     * @param {string} route   Geraetepfad in der DOP2-Struktur
     * @returns {Promise<object>} Ident-Zweig des Geraets
     */
    getIdent(route) {
        return this.get(`Devices/${route}/Ident`);
    }
    /**
     * Den Zustand eines Geraets lesen (Status, Programm, Restzeit).
     *
     * @param {string} route   Geraetepfad in der DOP2-Struktur
     * @returns {Promise<object>} State-Zweig des Geraets
     */
    getState(route) {
        return this.get(`Devices/${route}/State`);
    }
    /**
     * Ein DOP2-Leaf lesen.
     *
     * @param route Route des Geraets (Seriennummer)
     * @param unit DOP2-Unit, etwa 2
     * @param attr DOP2-Attribut, etwa 6195
     * @param idx1 erster Index, 0 fuer die meisten Leafs
     * @param idx2 zweiter Index, 0 fuer die meisten Leafs
     * @param {number} [timeoutMs] eigenes Zeitlimit fuer DIESE Anfrage.
     *
     * WOZU DAS EIGENE LIMIT: Der Regelbetrieb fragt bekannte Adressen ab, die antworten -
     * dort sind acht Sekunden richtig, weil eine beschaeftigte Maschine auch mal traege
     * ist. Der Leaf-Scan fragt hunderte UNBEKANNTE Adressen, von denen die meisten gar
     * nicht existieren; mit acht Sekunden je Fehlversuch dauert ein Durchlauf ueber zwei
     * Stunden. Eine Adresse, die es gibt, antwortet schnell - wer nach drei Sekunden nichts
     * gehoert hat, hoert auch nach acht nichts.
     */
    readDop2(route, unit, attr, idx1 = 0, idx2 = 0, timeoutMs = null) {
        return this._request('GET', `Devices/${route}/DOP2/${unit}/${attr}?idx1=${idx1}&idx2=${idx2}`, null, timeoutMs);
    }
}

module.exports = { MieleDeviceApi };

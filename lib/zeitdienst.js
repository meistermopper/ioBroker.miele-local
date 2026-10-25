'use strict';

/**
 * Miele-Zeitdienst: beantwortet die Zeitabfrage der Kommunikationsmodule.
 *
 * WARUM. Miele-Geraete stellen ihre Uhr NICHT per NTP. Das Modul loest `ntp.mcs2.miele.com`
 * auf und fragt per HTTP auf Port 80:
 *
 *     GET http://ntp.mcs2.miele.com/V2/NTP/ HTTP/1.1
 *     Host: ntp.mcs2.miele.com
 *     Accept: application/vnd.miele.v1+json
 *
 * Die Zeile enthaelt die ABSOLUTE Adresse (Proxy-Form), nicht nur den Pfad. Der Miele-Server
 * antwortet mit `{"time":<Unix-Sekunden>}`. Ohne Internet - IoT-Netz ohne Ausgang - bleibt die
 * Antwort aus, das Modul versucht es alle 30 s erneut und die Uhr des Geraets laeuft frei
 * (am 25.10.2026 stand ein Backofen noch auf Sommerzeit, zwei Module gingen 13-20 s vor).
 *
 * Dieser Dienst liefert dieselbe Antwort aus dem eigenen Netz. Erreichen muss ihn das Geraet
 * ueber eine Umleitung (DNAT am Router oder DNS-Umschreibung) - das Ziel ist im Modul fest
 * eingebaut. Die Zeitzone liefert der Dienst nicht; das Geraet rechnet sie selbst.
 *
 * Alles ausser GET auf /V2/NTP(/) beantwortet er mit 404.
 */

const http = require('node:http');

/** Was der Miele-Server heute (Oktober 2026) als Content-Type schickt. */
const CONTENT_TYPE = 'application/json';

/**
 * Ob eine Anfrage-Adresse die Zeitabfrage ist.
 *
 * Akzeptiert die Pfad-Form (`/V2/NTP/`) und die absolute Form
 * (`http://ntp.mcs2.miele.com/V2/NTP/`), mit oder ohne Schraegstrich am Ende, mit oder ohne
 * Abfrageteil. Gross-/Kleinschreibung des Pfads spielt keine Rolle.
 *
 * @param {string|undefined} adresse req.url, so wie Node sie aus der Anfragezeile liest
 * @returns {boolean} true fuer die Zeitabfrage
 */
function istZeitabfrage(adresse) {
    if (typeof adresse !== 'string' || !adresse) {
        return false;
    }
    let pfad;
    try {
        pfad = new URL(adresse, 'http://localhost').pathname;
    } catch {
        return false;
    }
    return /^\/v2\/ntp\/?$/i.test(pfad);
}

/**
 * Antwortrumpf der Zeitabfrage.
 *
 * @param {number} jetztMs aktuelle Zeit in Millisekunden
 * @returns {string} JSON mit ganzen Unix-Sekunden
 */
function zeitRumpf(jetztMs) {
    return JSON.stringify({ time: Math.floor(jetztMs / 1000) });
}

/**
 * Absenderadresse ohne IPv4-in-IPv6-Huelle.
 *
 * @param {string|undefined} adresse req.socket.remoteAddress
 * @returns {string} z. B. "192.168.30.80"
 */
function absender(adresse) {
    if (!adresse) {
        return 'unknown';
    }
    return adresse.startsWith('::ffff:') ? adresse.slice(7) : adresse;
}

/**
 * Der HTTP-Server des Zeitdienstes.
 */
class MieleZeitdienst {
    /**
     * @param {object} opts Einstellungen
     * @param {number} opts.port TCP-Port, auf dem der Dienst lauscht
     * @param {string} [opts.bind] Adresse, an die er sich bindet (leer = alle)
     * @param {{debug: (m: string) => void, warn: (m: string) => void, error: (m: string) => void}} opts.log Logger des Adapters
     * @param {(ip: string, zeitMs: number) => void} [opts.onAbruf] nach jeder beantworteten Zeitabfrage
     * @param {() => number} [opts.jetzt] Zeitquelle (fuer Tests), Vorgabe Date.now
     */
    constructor(opts) {
        this.port = opts.port;
        this.bind = (opts.bind || '').trim() || undefined;
        this.log = opts.log;
        this.onAbruf = opts.onAbruf || (() => {});
        this.jetzt = opts.jetzt || Date.now;
        /** Der laufende Server oder null. */
        this.server = null;
    }

    /**
     * Server starten.
     *
     * @returns {Promise<number>} der tatsaechlich belegte Port (wichtig bei Port 0 im Test)
     */
    start() {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => this.beantworte(req, res));
            // Module schicken eine kurze Anfrage und warten; offen gehaltene Verbindungen braucht es nicht.
            server.keepAliveTimeout = 2000;
            server.headersTimeout = 10000;
            server.requestTimeout = 10000;
            server.on('clientError', (err, socket) => {
                this.log.debug(`Time server: malformed request (${err.message})`);
                if (socket.writable) {
                    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
                } else {
                    socket.destroy();
                }
            });
            const beimFehler = err => {
                server.removeListener('listening', beimLauschen);
                reject(err);
            };
            const beimLauschen = () => {
                server.removeListener('error', beimFehler);
                server.on('error', err => this.log.error(`Time server: ${err.message}`));
                this.server = server;
                const adr = server.address();
                resolve(typeof adr === 'object' && adr ? adr.port : this.port);
            };
            server.once('error', beimFehler);
            server.once('listening', beimLauschen);
            server.listen(this.port, this.bind);
        });
    }

    /**
     * Eine Anfrage beantworten.
     *
     * @param {http.IncomingMessage} req Anfrage
     * @param {http.ServerResponse} res Antwort
     */
    beantworte(req, res) {
        const ip = absender(req.socket && req.socket.remoteAddress);
        // Rumpf (falls einer kommt) verwerfen, sonst bleibt die Verbindung haengen.
        req.resume();
        if ((req.method === 'GET' || req.method === 'HEAD') && istZeitabfrage(req.url)) {
            const jetzt = this.jetzt();
            const rumpf = zeitRumpf(jetzt);
            res.writeHead(200, {
                'Content-Type': CONTENT_TYPE,
                'Content-Length': Buffer.byteLength(rumpf),
                'Cache-Control': 'no-store',
            });
            res.end(req.method === 'HEAD' ? undefined : rumpf);
            this.log.debug(`Time server: ${req.method} ${req.url} from ${ip} -> ${rumpf}`);
            try {
                this.onAbruf(ip, jetzt);
            } catch (e) {
                this.log.warn(`Time server: could not record request from ${ip}: ${e.message}`);
            }
            return;
        }
        this.log.debug(`Time server: ${req.method} ${req.url} from ${ip} -> 404`);
        res.writeHead(404, { 'Content-Type': 'text/plain', 'Content-Length': 9 });
        res.end('Not Found');
    }

    /**
     * Server beenden, offene Verbindungen kappen.
     *
     * @returns {Promise<void>} erfuellt, sobald der Port frei ist
     */
    stop() {
        const server = this.server;
        this.server = null;
        if (!server) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            server.close(() => resolve());
            if (typeof server.closeAllConnections === 'function') {
                server.closeAllConnections();
            }
        });
    }
}

module.exports = { MieleZeitdienst, istZeitabfrage, zeitRumpf, absender, CONTENT_TYPE };

'use strict';

/*
 * ioBroker.miele-local
 * Verbindet moderne Miele@Home-Geräte lokal ohne Internet (MieleH256/DOP2).
 */

const utils = require('@iobroker/adapter-core');
// Nur fuer die Herkunftsspalte der CSV-Ausdrucke. package.json liegt in jedem npm-Paket bei,
// auch wenn files[] sie nicht auffuehrt.
const paket = require('./package.json');
const { MieleCrypto } = require('./lib/crypto');
const { MieleDeviceApi } = require('./lib/api');
const { discover, scanSubnet, istMiele } = require('./lib/discovery');
const cloud = require('./lib/cloud');
const objdef = require('./lib/objects');
const namen = require('./lib/names');
const ecoRegel = require('./lib/eco');
const sammler = require('./lib/sammler');
const feldsuche = require('./lib/feldsuche');
const kontrolle = require('./lib/kontrolle');
const leafscan = require('./lib/leafscan');
const leafverlauf = require('./lib/leafverlauf');
const ids = require('./lib/ids');
const felder = require('./lib/felder');
const csvBauer = require('./lib/csv');
const datenpunkte = require('./lib/datenpunkte');

/**
 * Verschnaufpause zwischen zwei Scan-Durchgaengen.
 *
 * Eine Minute. Ein Durchgang sind vierzig Anfragen am Stueck; danach gehoert das Modul wieder
 * sich selbst, bevor der naechste Schwung kommt.
 */
const PAUSE_ZWISCHEN_DURCHGAENGEN_MS = 60000;
/**
 * Nach einem Abbruch wegen Verbindungsstoerungen - siehe leafScanDauerlauf.
 *
 * EINE Minute - so lange braucht das Modul, um wieder ansprechbar zu sein, und keine Sekunde
 * laenger. Zwischenzeitlich standen hier zwanzig Minuten; das war zweimal falsch gedacht:
 * Erstens ist die eigentliche Stellschraube gegen Ueberlastung die Pause ZWISCHEN den
 * Anfragen (leafscan.PAUSE_MS, seit 07.09.2026 fuenf Sekunden), zweitens wartet ein Scan,
 * der bei jedem Aussetzer minutenlang blockiert, am Ende laenger als er scannt - und wird
 * ueber 882 Adressen nie fertig. Ein Modul, das wieder kann, soll auch wieder gefragt werden.
 */
const PAUSE_NACH_UEBERLASTUNG_MS = 60000;
const { MielePushListener } = require('./lib/push');
const enroll = require('./lib/enroll');
const dop2 = require('./lib/dop2');
const stats = require('./lib/stats');

/*
 * EcoFeedback: DOP2-Leaf 2/6195 (bislang nur Waschmaschinen liefern ihn).
 *
 * Die Feldindizes sind 1-basiert und modellabhängig; für die WCR860 wurden sie gegen den
 * Cloud-Adapter geprüft.
 *
 *   #25  Energie in Wh              2077 ≈ Cloud 1,9 kWh
 *   #26  Wasser in Hundertstellitern 3703 ≈ Cloud 34 l
 *
 * WIE DIESE ZUORDNUNG ZUSTANDE KAM - UND WARUM SIE ZWEIMAL FALSCH WAR
 *
 * Beide Felder wurden waehrend eines laufenden Programms gegen den Cloud-Adapter geprueft, der
 * denselben Verbrauch unabhaengig meldet. Davor standen zwei falsche Zuordnungen:
 *
 *   #40  Der urspruengliche Verdacht. Er stand ueber zehn Tage und drei voellig verschiedene
 *        Programme hinweg unveraendert auf 953 - als 95,3 l gelesen, was fuer einen Waschgang
 *        plausibel klang.
 *   #4   Der zweite Verdacht, an einem kurzen Programm gefasst: Feld 4 zeigte 17, die Cloud
 *        16 l. Es ist aber die LAUFZEIT IN MINUTEN. Bei einem Programm von 17 Minuten Laenge
 *        haben Minuten und Liter dieselbe Groessenordnung; bei einem langen faellt es sofort
 *        auf (130 Minuten gegen 34 Liter).
 *
 * Die Lehre: Ein einzelner Messpunkt beweist nichts. Erst der Verlauf ueber ein ganzes
 * Programm - und besser noch ueber verschieden lange Programme - trennt Zufall von Ursache.
 *
 * WAS NOCH OFFEN IST
 *
 * Die Bibliothek asyncmiele (droman42/asyncmiele) kennt fuer denselben Leaf zwei Groessen, die
 * hier bisher niemand gesucht hat: energy_wh_total und water_l_total, ausdruecklich als
 * LEBENSDAUER-Zaehler. Ihr Parser liest den Payload allerdings flach (u32 an Position 0, 4, 8),
 * waehrend dieses Geraet eine Feldstruktur mit Indizes liefert - beides gleichzeitig kann nicht
 * stimmen, vermutlich unterscheiden sich die Firmware-Generationen.
 *
 * In den Rohfeldern gibt es einen Kandidaten fuer einen solchen Absolutzaehler: Feld 5 stand
 * am 29.08.2026 auf 12007 und wuchs in vierzehn Stunden nur um 7 - das Verhalten eines
 * Gesamtzaehlers, nicht eines Programmwerts. Als Zehntel-Kilowattstunden gelesen waeren es
 * 1200 kWh Lebensverbrauch, was fuer eine Waschmaschine dieses Alters passt.
 *
 * Bestaetigt ist das nicht. Falls es sich bestaetigt, waere die Differenz zweier Staende der
 * verlaesslichere Weg zum Programmverbrauch als Feld 25 - ein Absolutzaehler kann nicht
 * versehentlich den Wert des Vorprogramms zeigen.
 *
 * ZUM WASSERFELD, WEIL DIE GESCHICHTE LEHRREICH IST
 *
 * Bis zum 28.08.2026 stand hier #40 als Wasser, gedeutet als Zehntelliter: Der Wert 953 wurde
 * zu 95,3 l, was für einen Waschgang plausibel klingt. Er stand allerdings über zehn Tage und
 * drei völlig verschiedene Programme hinweg unverändert da - Seide (36 min), Pflegeleicht
 * (162 min) und Baumwolle (214 min) meldeten alle exakt 95,3 l.
 *
 * Aufgeklärt hat es der Vergleich mit dem Cloud-Adapter während eines laufenden Programms:
 *
 *   Zeit    Feld 4   Feld 26   Feld 40   Cloud
 *   17:16        0      1593       953    ~6 l
 *   17:29        7      1593       953   ~11 l
 *   17:39       17      1593       953    16 l
 *
 * Nur #4 folgt dem Verbrauch, und zwar in ganzen Litern. #26 (15,93 bei /100) passte zufällig
 * zum Endwert und war eine verlockende Fährte - es bewegt sich aber nie. Woher #40 und #26
 * ihre Werte haben, ist weiterhin offen; sie sind jedenfalls nicht der Verbrauch dieses Laufs.
 *
 * Lehre daraus: Eine Zahl, die zufällig in der richtigen Größenordnung liegt, ist noch keine
 * Messung. Erst der Verlauf entscheidet.
 */
const ECO_LEAF = { unit: 2, attr: 6195 };
const ECO_ENERGY_IDX = 25; // Wh
const ECO_WATER_IDX = 26; // Hundertstelliter
const ECO_WATER_DIV = 200; // Teilungsfaktor Wasserfeld: Rohwert / Faktor = Liter (WCR860, Feld 21: 5 ml je Schritt)

/*
 * Das EcoFeedback, das MIELE SELBST fuehrt - DOP2-Leaf 2/1585, Feld 6.
 *
 * Was dort steht: der Energie- und Wasserverbrauch des zuletzt gelaufenen Programms und die
 * Summenzaehler - also genau die Zahlen, die die Miele-App anzeigt. Die Feldnamen stammen aus
 * MieleRESTServer (DeviceAttributesDWTDWM), ausgelesen werden sie ueber lib/datenpunkte.js.
 *
 * WARUM DER ADAPTER TROTZDEM SELBST ZAEHLT. Keines der drei Geraete dieses Haushalts kennt den
 * Leaf: XKM EK037 und EK057 antworten auf 2/1585 mit HTTP 404, bei allen dreien, auch mitten im
 * Programm. Fuer sie bleibt der Durchflusszaehler die einzige Quelle (Feld 21 des Eco-Leaf,
 * 5 ml je Impuls, gegen den Hauswasserzaehler auf 0,5 Prozent belegt).
 *
 * DIE REIHENFOLGE IST DAMIT: erst fragen, was das Geraet selbst sagt - und nur wenn es
 * schweigt, selbst zaehlen. Nicht umgekehrt: Der eigene Zaehler ist eine Hilfskonstruktion,
 * der Wert des Geraets ist die Auskunft des Herstellers.
 */
const ECO_KONTEXT_LEAF = { unit: 2, attr: 1585 };
/** Feld 6 von 2/1585 traegt die Geraeteattribute, darin Feld 4 das Wasser des letzten Programms. */
const ECO_KONTEXT_WASSER = '6.4';
/** ... und Feld 3 die Energie des letzten Programms. */
const ECO_KONTEXT_ENERGIE = '6.3';

// Sekundengenaue Zeiten aus DOP2-Leaf 2/256 (verifiziert: #7 Restzeit s, #8 Laufzeit s).
const SEC_LEAF = { unit: 2, attr: 256 };

/*
 * Betriebsstunden - DOP2-Leaf 2/119, Feld 1.
 *
 * Ein echter Lebensdauerzaehler: Am 29.08.2026 stand er bei einer WCR860 auf 6708 Stunden.
 * Anders als die Werte im Eco-Leaf faellt er nie zurueck und wird bei keinem Programmwechsel
 * genullt - er beantwortet damit die Frage, wie viel eine Maschine schon geleistet hat.
 *
 * Der Hinweis auf diesen Leaf stammt aus der Bibliothek asyncmiele (droman42/asyncmiele), die
 * ihn als HoursOfOperation fuehrt. Ihr Parser liest den Payload flach; hier kommt er als
 * Feldstruktur mit drei u32-Feldern, von denen nur das erste gefuellt ist.
 *
 * Das benachbarte Leaf 2/138 (CycleCounter, Programmzaehler) antwortet zwar, liefert bei
 * diesem Modell aber durchgehend Nullen - es wird deshalb nicht abgefragt.
 */
const HOURS_LEAF = { unit: 2, attr: 119 };
const HOURS_IDX = 1;
/** Wartezeit, bevor ein Programm als beendet gilt - gegen kurzzeitige Statusaussetzer. */
const CYCLE_END_GRACE_MS = 3 * 60000;
/**
 * Die groesste Verzoegerung, die setTimeout/setInterval verkraften (2^31-1 ms).
 *
 * Darueber feuert der Timer nicht spaeter, sondern SOFORT - siehe intervallMs.
 */
const TIMER_MAX_MS = 2147483647;
/** So viele Fehlschlaege in Folge drosseln die Feinaufzeichnung - siehe feinFehlschlag. */
const FEIN_FEHLSCHLAEGE_MAX = 5;
/** Der Anfangstakt der Feinaufzeichnung; bei Fehlschlaegen wird verdoppelt. */
const FEIN_TAKT_MS = 20000;
/** Darueber hinaus lohnt es nicht - die normale Runde laeuft ohnehin alle drei Minuten. */
const FEIN_TAKT_MAX_MS = 120000;
/**
 * Die Adresse fuer die Kontrollfrage vor jedem Scan-Durchgang - siehe gespraechsbereit.
 *
 * 2/1583 liegt in der Umgebung der Benutzeranfrage - dem einzigen Bereich, in dem BEIDE
 * bekannten Geraete ueberhaupt differenziert antworten: die Waschmaschine mit einem Treffer,
 * die Spuelmaschine mit 404. Beides heisst "ich gebe Auskunft".
 *
 * Zuerst stand hier 2/6196 (neben dem EcoFeedback). Das war ein Fehlgriff: Die Spuelmaschine
 * kennt den gesamten 6000er-Bereich nicht und beantwortet ihn ausnahmslos mit 500 - die
 * Kontrollfrage haette sie dauerhaft fuer ausgelastet gehalten und nie wieder gescannt. Eine
 * Kontrolladresse muss in einem Bereich liegen, den das Geraet kennt, sonst misst sie die
 * Adresse statt das Modul.
 */
const KONTROLL_ADRESSE = [2, 1583];

/*
 * Nach so vielen erfolglosen Kontrollfragen wird es trotzdem versucht.
 *
 * Die Kontrollfrage setzt voraus, dass das Geraet den Adressbereich der Kontrolladresse
 * ueberhaupt kennt - sonst antwortet es mit 500 statt mit 404, und das ist von "gerade
 * beschaeftigt" nicht zu unterscheiden. Bei der Spuelmaschine war 2/6196 aus genau diesem
 * Grund ein Fehlgriff. Ein Geraet, das die Adresse nicht kennt, wuerde also nie gescannt.
 *
 * Deshalb: Hat ein Geraet die Kontrollfrage noch NIE beantwortet und ist es eingeschaltet,
 * wird nach zehn Anlaeufen - rund zehn Minuten - trotzdem ein Durchgang gewagt. Der Durchgang
 * schuetzt sich selbst: Haeufen sich Abbrueche, endet er von allein und der Dauerlauf legt
 * eine lange Pause ein. Sobald die Kontrollfrage einmal geantwortet hat, gilt sie fuer dieses
 * Geraet und der Rueckfall entfaellt.
 */
const KONTROLLE_TAUB_MAX = 10;
const SEC_REMAINING_IDX = 7;
const SEC_ELAPSED_IDX = 8;

// DOP2 GLOBAL_USER_REQ (Steuerbefehle), Leaf 2/1583
const USER_REQ_PREFIX = Buffer.from('00100001062f00000000000100010700', 'hex');
const USER_REQ_UNIT = 2;
const USER_REQ_LEAF = 1583;
// Status-Werte, bei denen ein Gerät „aktiv" ist → schnelleres Polling
const ACTIVE_STATUSES = new Set([3, 4, 5, 6, 7, 9, 13, 14, 15]);

function buildUserRequest(opcode) {
    return Buffer.concat([USER_REQ_PREFIX, Buffer.from([opcode & 0xff]), Buffer.alloc(15, 0x20)]);
}

class MieleLocal extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: 'miele-local' });
        this.devices = {};
        this.pollTimer = null;
        this.push = null;
        this.oauth = {}; // messageId → challenge
        this.stopping = false;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Namen der Instanzobjekte nachziehen.
     *
     * instanceObjects aus der io-package.json legt der Installer nur beim ERSTEN Mal an. Bei
     * einem Update bleiben sie unveraendert - eine bestehende Installation behielte also die
     * alten, einsprachigen Namen von info, info.connection und info.discoveredDevices, und der
     * Objektexport zeigte sie weiterhin. Deshalb werden sie hier bei jedem Start abgeglichen.
     */
    async aktualisiereInstanzObjekte() {
        const t = (de, en) => namen.text(de, en, true);
        const soll = {
            info: t('Information', 'Information'),
            'info.connection': t('Gerät oder Dienst verbunden', 'Device or service connected'),
            'info.discoveredDevices': t('Gefundene Geräte (mDNS)', 'Discovered devices (mDNS)'),
        };
        for (const id of Object.keys(soll)) {
            try {
                await this.extendObjectAsync(id, { common: { name: soll[id] } });
            } catch (e) {
                this.log.debug(`Instance object ${id} not updated: ${e.message}`);
            }
        }
    }

    /**
     * Namen vorhandener EcoFeedback-Objekte abgleichen.
     *
     * Die eco-Punkte legt ensureEcoObjects an - aber nur, wenn ein Abruf gerade Werte liefert.
     * Das Eco-Leaf antwortet nur, solange das Geraet wach ist; eine ausgeschaltete Maschine
     * meldet HTTP 500. Zwischen zwei Programmen - und das sind die meisten Adapterstarts -
     * laeuft der Code also nie, und vorhandene Punkte aus frueheren Versionen behalten ihre
     * alten Namen. Geloescht werden sie bewusst nicht, weil ihre Historie erhalten bleiben
     * soll, also werden sie hier wenigstens im Namen nachgezogen.
     *
     * @param deviceId
     */
    async aktualisiereEcoNamen(deviceId) {
        const german = this.config.germanNames !== false;
        /*
         * Die Definition steht in lib/objects.js - siehe ecoCommon.
         *
         * Nicht nur der Name wird nachgezogen, sondern auch Rolle und Einheit: eco.water
         * trug bis 0.3.5 value.volume, was der Repository-Pruefer beanstandet. Ein Geraet,
         * das kein EcoFeedback mehr liefert, durchlaeuft ensureEcoObjects nie - dort waere
         * die Korrektur sonst haengen geblieben.
         */
        const soll = objdef.ecoCommon(german);
        for (const sub of Object.keys(soll)) {
            const id = `${deviceId}.${sub}`;
            try {
                if (!(await this.getObjectAsync(id))) {
                    continue;
                }
                await this.extendObjectAsync(id, { common: soll[sub] });
            } catch (e) {
                this.log.debug(`Eco object ${id} not updated: ${e.message}`);
            }
        }
    }

    async onReady() {
        await this.aktualisiereInstanzObjekte();
        await this.setStateAsync('info.connection', { val: false, ack: true });

        const groupId = this.config.groupId;
        const groupKey = this.config.groupKey;
        if (!groupId || !groupKey) {
            this.log.warn('No credentials found. Please sign in via the instance configuration to obtain a GroupKey.');
            return;
        }
        try {
            this.mc = new MieleCrypto(groupId, groupKey);
        } catch (e) {
            this.log.error(`Invalid GroupKey: ${e.message}`);
            return;
        }

        // Geräte ermitteln: Auto-Discovery und/oder manuelle IP-Liste
        await this.discoverDevices();

        if (!Object.keys(this.devices).length) {
            this.log.warn(
                'No Miele devices found (neither via mDNS nor manually configured). If the appliances are in ' +
                    'another subnet/VLAN, behind a firewall or multicast is blocked (e.g. Docker bridge network), ' +
                    "enter their IP addresses on the 'Appliances' tab.",
            );
        } else {
            await this.setStateAsync('info.connection', { val: true, ack: true });
        }

        // Periodisches Re-Discovery im Hintergrund (z. B. für Geräte, die aus dem Standby aufwachen)
        if (this.config.autoDiscover !== false) {
            const discInterval = MieleLocal.intervallMs(this.config.autoDiscoverInterval, 10, 1, 60000);
            this.discoveryTimer = this.setInterval(() => this.discoverDevices(), discInterval);
        }

        await this.subscribeStatesAsync('*.control.*');

        // Push-Listener + Enrollment
        if (this.config.usePush) {
            this.startPush();
            if (this.push) {
                await this.enrollAll();
                // Subscriptions laufen ab → periodisch erneuern
                this.enrollTimer = this.setInterval(() => this.enrollAll(), 4 * 60 * 1000);
            }
        }

        // Polling starten
        this.schedulePoll(true);

        // EcoFeedback (Energie/Wasser) per DOP2 – langsameres, separates Intervall
        if (this.config.ecoFeedback !== false) {
            this.pollEco();
            this.ecoTimer = this.setInterval(
                () => this.pollEco(),
                MieleLocal.intervallMs(this.config.ecoInterval, 60, 10),
            );
        }

        // Betriebsstunden: einmal beim Start, danach stuendlich - siehe pollHours().
        this.pollHours();
        this.hoursTimer = this.setInterval(() => this.pollHours(), 60 * 60 * 1000);

        /*
         * Den Werteverlauf der gefundenen Leafs mitschreiben.
         *
         * Alle drei Minuten, und nur bei Geraeten, die gerade etwas tun - siehe
         * leafVerlaufSchreiben. Waehrend eines Waschgangs entsteht so die Spur, an der sich
         * ablesen laesst, welches Feld welchen Verbrauch traegt; im Standby waere es dieselbe
         * Zahl in Endlosschleife.
         */
        this.verlaufTimer = this.setInterval(() => this.leafVerlaufRunde(), 3 * 60 * 1000);

        /*
         * Eine laufende Feinaufzeichnung nach einem Neustart fortsetzen.
         *
         * Der Timer dafuer entsteht in onStateChange - und den ruft niemand auf, wenn der
         * Adapter neu startet: Der Datenpunkt steht dann zwar noch auf seiner Leaf-Adresse,
         * gelesen wird aber nichts mehr. Am 06.09.2026 waehrend eines Waschgangs passiert,
         * ausgeloest von einer Konfigurationsaenderung, die den Adapter neu startete. Die
         * Aufzeichnung schwieg still weiter - im Log stand nichts, und der Datenpunkt sah
         * unveraendert richtig aus.
         */
        this.feinFortsetzen().catch(() => {});

        /*
         * Einen laufenden Leaf-Scan nach einem Neustart fortsetzen.
         *
         * Dieselbe Falle wie bei der Feinaufzeichnung, nur laenger unbemerkt: Der Dauerlauf
         * ist eine Schleife im Speicher, der Schalter `sammlung.leafScan` ein Datenpunkt auf
         * der Platte. Ein Neustart nimmt die Schleife mit und laesst den Schalter stehen -
         * der Scan liest sich danach als "laeuft", fragt aber nie wieder etwas.
         *
         * Am 06.09.2026 an der Spuelmaschine passiert: Der Scan kam ueber vier von 882
         * Adressen nicht hinaus, weil eine Konfigurationsaenderung (ein eingetragener
         * Energiezaehler) die Instanz neu startete. Im Log stand nichts, der Schalter stand
         * auf true, und der Fortschritt bewegte sich vierzehn Stunden lang nicht.
         */
        this.scanFortsetzen().catch(() => {});

        // Sekundengenaue Rest-/Laufzeit per DOP2 2/256 – schneller 10s-Poll
        if (this.config.secondsTime !== false) {
            this.pollSeconds();
            this.secTimer = this.setInterval(
                () => this.pollSeconds(),
                MieleLocal.intervallMs(this.config.secondsInterval, 30, 5),
            );
        }
    }

    async discoverDevices() {
        const groupId = this.config.groupId;
        if (!groupId || !this.mc) {
            return;
        }
        const found = [];
        const seenIp = new Set();
        if (this.config.autoDiscover !== false) {
            try {
                const list = await discover(6000, m => this.log.debug(m), this);
                for (const d of list) {
                    if (d.txt.group && d.txt.group.toUpperCase() !== groupId.toUpperCase()) {
                        continue;
                    }
                    found.push({ ip: d.ip, techType: d.techType, deviceType: Number(d.txt.devicetype) });
                    seenIp.add(d.ip);
                }
            } catch (e) {
                this.log.debug(`mDNS background discovery failed: ${e.message}`);
            }
        }
        const konfigurierte = [];
        for (const entry of this.config.devices || []) {
            const ip = typeof entry === 'string' ? entry : entry && entry.ip;
            if (ip && !seenIp.has(ip)) {
                found.push({ ip, techType: '', deviceType: null });
                seenIp.add(ip);
                konfigurierte.push(ip);
            }
        }

        /*
         * Ein konfiguriertes Geraet antwortet nicht - hat es die IP gewechselt?
         *
         * Die Geraete haengen am DHCP. Ohne feste Zuordnung im Router bekommt eines nach einem
         * Stromausfall oder langem Standby eine andere Adresse und ist damit verschwunden,
         * obwohl es eingeschaltet nebenan steht. Erst dann - und nur dann - wird das Subnetz
         * abgeklopft; im Normalbetrieb passiert hier nichts.
         *
         * Die Zuordnung danach macht nicht die IP, sondern die Seriennummer: initDevice() liest
         * sie signiert aus und legt das Geraet unter derselben ID wieder an. Objekte, Verlauf
         * und Statistik bleiben also dieselben, nur die Adresse ist neu.
         */
        if (this.config.ipFallbackScan !== false && konfigurierte.length) {
            const erreichbar = await Promise.all(konfigurierte.map(ip => istMiele(ip, 1500)));
            const vermisst = konfigurierte.filter((_, i) => !erreichbar[i]);
            /*
             * Hoechstens alle 30 Minuten.
             *
             * Ist ein Geraet schlicht ausgeschaltet - der Backofen ist es die meiste Zeit -,
             * bleibt es "vermisst", und ohne diese Sperre liefe bei jedem Discovery-Lauf ein
             * Subnetz-Scan, der nichts Neues findet.
             */
            const seitLetztem = Date.now() - (this.letzterScan || 0);
            if (vermisst.length && seitLetztem < 30 * 60 * 1000) {
                this.log.debug(
                    `${vermisst.length} Gerät(e) nicht erreichbar, letzter Subnetz-Scan ` +
                        `vor ${Math.round(seitLetztem / 60000)} min - warte noch`,
                );
            } else if (vermisst.length) {
                this.letzterScan = Date.now();
                this.log.info(
                    `${vermisst.length} konfigurierte(s) Gerät(e) antworten nicht ` +
                        `(${vermisst.join(', ')}) - suche im Subnetz nach der neuen Adresse`,
                );
                const imNetz = await scanSubnet(konfigurierte[0], m => this.log.info(m));
                for (const ip of imNetz) {
                    if (!seenIp.has(ip)) {
                        found.push({ ip, techType: '', deviceType: null });
                        seenIp.add(ip);
                        this.log.info(`Neue Adresse gefunden: ${ip}`);
                    }
                }
            }
        }

        if (found.length) {
            await this.setStateAsync('info.discoveredDevices', { val: JSON.stringify(found), ack: true });
        }

        for (const f of found) {
            const alreadyKnown = Object.values(this.devices).some(d => d.ip === f.ip);
            if (!alreadyKnown) {
                try {
                    await this.initDevice(f);
                    if (this.config.usePush && this.push) {
                        await this.enrollAll();
                    }
                } catch (e) {
                    this.log.debug(`Device at ${f.ip} could not be initialized: ${e.message}`);
                }
            }
        }
    }

    /**
     * Gerät initialisieren: Route (Seriennr.) ermitteln, Objektbaum anlegen, Ident lesen.
     *
     * @param f
     */
    async initDevice(f) {
        // 20 s statt 8: die Module antworten meist in 25 ms, waehrend eines laufenden Programms
        // aber auch mal erst nach 5-7 s. Mit dem knappen Zeitfenster fiel jede zehnte Abfrage aus,
        // obwohl das Geraet erreichbar war. Anfragen laufen ohnehin nacheinander (siehe api.js),
        // eine langsame Antwort blockiert also nichts ausser der eigenen Warteschlange.
        const api = new MieleDeviceApi(f.ip, this.mc, { timeout: 20000 });
        // Seriennummer(n) über signiertes /Devices/ ermitteln. Mehrere Versuche, weil ein
        // beschaeftigtes Geraet die erste Anfrage schon mal verfallen laesst - ohne
        // Wiederholung fiele es bis zur naechsten Hintergrundsuche komplett aus der Abfrage.
        let list = null;
        let letzterFehler = null;
        for (let versuch = 1; versuch <= 3; versuch++) {
            try {
                list = await api.get('Devices/');
                break;
            } catch (e) {
                letzterFehler = e;
                this.log.debug(`Device at ${f.ip}: attempt ${versuch}/3 failed (${e.message})`);
                if (versuch < 3) {
                    await new Promise(r => this.setTimeout(r, 2000));
                }
            }
        }
        if (!list) {
            throw letzterFehler || new Error('no answer');
        }
        const routes = Object.keys(list || {});
        if (!routes.length) {
            throw new Error('no device route found');
        }

        for (const route of routes) {
            const deviceId = route.replace(/[^a-zA-Z0-9_-]/g, '_'); // Objekt-ID = sanitierte Seriennummer
            let ident = null;
            try {
                ident = await api.getIdent(route);
            } catch (e) {
                this.log.debug(`Could not read Ident for ${route}: ${e.message}`);
            }
            const deviceType = ident ? Number(ident.DeviceType) : f.deviceType;
            const techType = ident ? objdef.pathGet(ident, ['DeviceIdentLabel', 'TechType']) : f.techType;

            await this.createDeviceTree(deviceId, techType, deviceType);
            // Vor allem anderen: was aus 0.3.37 noch unter deutschen IDs liegt, umziehen.
            await this.idsUmziehen(deviceId);

            this.devices[deviceId] = { ip: f.ip, route, deviceType, api, active: false };
            /*
             * Die Sammlungsobjekte schon beim Verbinden anlegen, nicht erst am Zyklusende.
             *
             * Sonst gibt es den Schalter fuer den Leaf-Scan erst, nachdem einmal ein
             * Programm gelaufen ist - und genau davor moechte man ihn druecken, um den
             * Leerlauf-Stand aufzunehmen.
             */
            if (this.config.sammlerAktiv) {
                await this.ensureSammlungObjects(deviceId).catch(e =>
                    this.log.debug(`${deviceId}: Sammlungsobjekte - ${e.message}`),
                );
            }
            await this.setStateAsync(`${deviceId}.info.connected`, { val: true, ack: true });
            if (ident) {
                await this.applyIdent(deviceId, ident);
            }
            const cat = objdef.deviceCategory(deviceType);
            this.log.info(`Device detected: ${cat ? `${cat} - ` : ''}${techType || 'unknown'} (${deviceId}) @ ${f.ip}`);
        }
    }

    /**
     * Die Datenpunkte aus 0.3.37 an ihre neuen, englischen IDs bringen.
     *
     * WARUM UMBENANNT WURDE. Der Adapter benannte seine Objekte durchgaengig englisch, bis auf
     * den Kanal "sammlung" und vier Namen im Kanal "history" - zusammen 57 von 446. Der
     * Pruefer des Aufnahmeantrags hielt sie deshalb fuer von Hand angelegte Skript-Objekte
     * und verlangte eine Erklaerung oder einen sauberen Abzug. Die Erklaerung waere gewesen:
     * "das ist historisch gewachsen". Das ist kein guter Grund, einen Baum halb in einer und
     * halb in einer anderen Sprache zu fuehren.
     *
     * WARUM UMZIEHEN UND NICHT NEU ANLEGEN. Ein blosses Umbenennen liesse die alten Objekte
     * samt ihren Werten stehen - in der Anlage des Betreibers liegen dort 67 gesammelte
     * Datensaetze, der Leaf-Scan aus 882 geprueften Adressen und die Verlaufsaufzeichnung.
     * Das ist wochenlange Sammelarbeit, die kein Neustart wiederbeschafft. Deshalb wandert
     * jeder Wert mit, und erst danach faellt der alte Punkt weg.
     *
     * WAS MIT DER HISTORIE PASSIERT. Sie haengt am Objekt und zieht nicht mit um. Betroffen
     * sind nur die vier Zahlen im Kanal "history"; die Sammlung selbst ist Text und wird nicht
     * historisiert. Wer die alten Reihen braucht, findet sie im History-Adapter unter der
     * alten ID - der Datenpunkt ist weg, die aufgezeichneten Werte sind es nicht.
     *
     * EINMAL, UND DANN NIE WIEDER. Gibt es den alten Punkt nicht, passiert nichts. Eine frisch
     * aufgesetzte Anlage laeuft hier ohne einen einzigen Schreibvorgang durch.
     *
     * @param deviceId
     */
    async idsUmziehen(deviceId) {
        let umgezogen = 0;
        for (const { alt, neu } of ids.umzuege(deviceId)) {
            let altesObjekt;
            try {
                altesObjekt = await this.getObjectAsync(alt);
            } catch {
                continue;
            }
            if (!altesObjekt) {
                continue;
            }
            try {
                /*
                 * Der Wert zuerst, das Loeschen zuletzt.
                 *
                 * Bricht der Adapter mittendrin ab, steht der Wert an beiden Orten - laestig,
                 * aber harmlos, und der naechste Start raeumt auf. Andersherum waere er weg.
                 */
                const wert = await this.getStateAsync(alt);
                await this.extendObjectAsync(neu, {
                    type: altesObjekt.type,
                    common: altesObjekt.common,
                    native: altesObjekt.native || {},
                });
                if (wert && wert.val !== null && wert.val !== undefined) {
                    await this.setStateAsync(neu, { val: wert.val, ack: true });
                }
                await this.delObjectAsync(alt);
                umgezogen++;
            } catch (e) {
                this.log.warn(`${deviceId}: ${alt} liess sich nicht nach ${neu} umziehen - ${e.message}`);
            }
        }
        if (!umgezogen) {
            return;
        }
        // Der leere alte Kanal zuletzt - er faellt nur weg, wenn auch sein Inhalt weg ist.
        try {
            await this.delObjectAsync(ids.alterKanal(deviceId));
        } catch {
            /* war nie da oder traegt noch etwas */
        }
        this.log.info(
            `${deviceId}: ${umgezogen} Datenpunkte auf englische IDs umgezogen ` +
                '(aus "sammlung" wurde "collection"). Die alten Punkte sind entfernt; ' +
                'aufgezeichnete Verlaeufe bleiben im History-Adapter unter der alten ID stehen.',
        );
    }

    async createDeviceTree(deviceId, techType, deviceType) {
        const cat = objdef.deviceCategory(deviceType);
        // Kategorie uebersetzt, Modell und Seriennummer unveraendert - siehe names.geraeteName.
        const label = namen.geraeteName(cat, techType, deviceId);
        await this.extendObjectAsync(deviceId, {
            type: 'device',
            common: { name: label },
            native: { serial: deviceId },
        });
        // Vorhandene EcoFeedback-Punkte im Namen nachziehen, auch wenn das Geraet sie nicht
        // mehr liefert - sonst bleiben sie fuer immer einsprachig.
        await this.aktualisiereEcoNamen(deviceId);

        /*
         * Verlauf und Statistik abgleichen, sofern sie schon existieren.
         *
         * Beide werden sonst erst angelegt, wenn ein Programm einen Zyklus abschliesst. Stehen
         * die Geraete - der Normalfall zwischen zwei Waschgaengen -, laeuft der Code nie, und
         * Aenderungen an Namen, Rollen oder Einheiten erreichen bestehende Installationen
         * nicht. Beim Wechsel von value.volume auf value blieben so 49 Objekte auf der alten,
         * vom Repository beanstandeten Rolle stehen.
         *
         * Angelegt wird hier nichts Neues: Nur wo der Kanal schon da ist, wird er aufgefrischt.
         */
        for (const [kanal, auffrischen] of [
            ['history', 'ensureHistoryObjects'],
            ['stats', 'ensureStatsObjects'],
        ]) {
            try {
                if (await this.getObjectAsync(`${deviceId}.${kanal}`)) {
                    await this[auffrischen](deviceId);
                }
            } catch (e) {
                this.log.debug(`${deviceId}.${kanal} not refreshed: ${e.message}`);
            }
        }
        // Kanäle
        for (const ch of ['info', 'state']) {
            // extendObject statt setObjectNotExists: Bestehende Installationen behalten sonst
            // ihre alten, einsprachigen Kanalnamen - genau die, die der Repository-Check
            // beanstandet hat.
            await this.extendObjectAsync(`${deviceId}.${ch}`, {
                type: 'channel',
                common: {
                    name:
                        ch === 'info'
                            ? namen.text('Information', 'Information', true)
                            : namen.text('Zustand', 'State', true),
                },
                native: {},
            });
        }
        const german = this.config.germanNames !== false;
        // Ident-States (extendObject → Namen aktualisieren sich beim Umschalten der Sprache)
        for (const f of objdef.IDENT_FIELDS) {
            await this.extendObjectAsync(`${deviceId}.info.${f.sub}`, {
                type: 'state',
                common: {
                    name: objdef.nameFor('info', f.sub, f.name, german),
                    role: f.role,
                    type: f.type,
                    read: true,
                    write: false,
                    def: f.def !== undefined ? f.def : f.type === 'number' ? 0 : f.type === 'boolean' ? false : '',
                },
                native: {},
            });
        }
        // State-States (gerätespezifische Felder nur beim passenden Gerätetyp, siehe fieldAllowed)
        for (const key of Object.keys(objdef.STATE_FIELDS)) {
            if (!objdef.fieldAllowed(key, deviceType)) {
                continue;
            }
            for (const s of objdef.STATE_FIELDS[key].states) {
                const common = {
                    name: objdef.nameFor('state', s.sub, s.name, german),
                    role: s.role,
                    type: s.type,
                    unit: s.unit,
                    read: true,
                    write: false,
                    def: s.def !== undefined ? s.def : s.type === 'number' ? 0 : s.type === 'boolean' ? false : '',
                };
                // Klartext direkt am Rohwert: Der Objektbrowser und VIS zeigen dann "In Betrieb"
                // statt 5, ohne dass man den *Text-Datenpunkt danebenlegen muss. Die gibt es
                // weiterhin - bestehende Aufbauten haengen daran.
                const liste = objdef.zustandsTexte(s.sub, deviceType, german);
                if (liste) {
                    common.states = liste;
                }
                const eigene = namen.beschreibung(`state.${s.sub}`, german);
                if (eigene) {
                    common.desc = eigene;
                }
                await this.extendObjectAsync(`${deviceId}.state.${s.sub}`, {
                    type: 'state',
                    common,
                    native: {},
                });
            }
        }
        // Steuer-States (nur wenn erlaubt)
        if (this.config.allowControl) {
            await this.extendObjectAsync(`${deviceId}.control`, {
                type: 'channel',
                common: { name: namen.text('Steuerung', 'Control', true) },
                native: {},
            });
            for (const c of objdef.CONTROL_STATES) {
                const common = {
                    name: objdef.nameFor('control', c.sub, c.name, german),
                    role: c.role,
                    type: 'boolean',
                    read: false,
                    write: true,
                    def: c.def !== undefined ? c.def : false,
                };
                // Was der Knopf tut und woran er scheitern kann - im Objektbrowser steht
                // sonst nur "Start program".
                const desc = namen.beschreibung(`control.${c.sub}`, german);
                if (desc) {
                    common.desc = desc;
                }
                await this.extendObjectAsync(`${deviceId}.control.${c.sub}`, {
                    type: 'state',
                    common,
                    native: { opcode: c.opcode },
                });
            }
        }
    }

    async applyIdent(deviceId, ident) {
        for (const f of objdef.IDENT_FIELDS) {
            // "connected" steht in derselben Liste, damit das Objekt angelegt wird, stammt aber
            // nicht aus dem Ident-Datensatz und hat deshalb keinen Pfad. Ohne diese Zeile wirft
            // pathGet "path is not iterable" - und weil das die erste Runde ist, blieben ALLE
            // Gerätedaten leer: Modell, Seriennummer, Firmware.
            if (!f.path) {
                continue;
            }
            const val = objdef.pathGet(ident, f.path);
            if (val !== undefined) {
                await this.setStateAsync(`${deviceId}.info.${f.sub}`, {
                    val: f.type === 'number' ? Number(val) : String(val),
                    ack: true,
                });
            }
        }
    }

    /** /State-Objekt in ioBroker-States übernehmen. */
    /**
     * Zustaende, aus denen ein Geraet nicht von einer Abfrage zur naechsten in "Aus" springt:
     * in Betrieb, Pause, Programm unterbrochen. Dazwischen liegt immer "Programm beendet" (7).
     */
    static get LAEUFT() {
        return [5, 6, 9];
    }

    /**
     * Faengt den unmoeglichen Sprung "laeuft" -> "Aus" ab.
     *
     * Beobachtet am 23.08.2026 an der laufenden Waschmaschine: Nach einem Verbindungsabriss
     * ("read ECONNRESET") liefert das XKM-Modul im naechsten Versuch eine formal gueltige
     * Antwort mit Status 1 (Aus) und elapsedTime 0 - die Maschine wusch dabei weiter, und die
     * naechste Abfrage 30 s spaeter meldete wieder Status 5. Der Aussetzer ist nicht harmlos:
     * nachgeschaltete Skripte werten ihn als Programmende und setzen ihre Zykluszaehlung
     * zurueck (der Stromzaehler-Startwert sprang dadurch mitten im Waschgang auf den aktuellen
     * Stand, aus rund 100 Wh wurden 10).
     *
     * Deshalb: Ein solcher Sprung wird beim ersten Mal verworfen. Bestaetigt ihn die naechste
     * Abfrage, wird er uebernommen - ein echtes Abschalten kommt damit hoechstens einen
     * Abfragetakt spaeter an.
     */
    /**
     * So lange wird ein "Aus" hoechstens verworfen. Danach gilt es, auch wenn noch Restzeit
     * gemeldet war - sonst haenge die Anzeige fest, wenn jemand das Geraet mitten im Programm
     * am Schalter ausmacht.
     */
    static get AUS_VERDACHT_MAX_MS() {
        return 5 * 60 * 1000;
    }

    async statusPlausibel(deviceId, neu) {
        this._statusVerdacht = this._statusVerdacht || {};
        if (neu !== 1) {
            delete this._statusVerdacht[deviceId];
            return true;
        }
        const vorher = ((await this.getStateAsync(`${deviceId}.state.status`)) || {}).val;
        if (!MieleLocal.LAEUFT.includes(vorher)) {
            return true;
        }

        // Ein echtes Programmende laeuft ueber Status 7 und eine abgelaufene Restzeit. Meldet das
        // Geraet mitten im Programm "Aus", waehrend noch Zeit uebrig ist, glaubt der Adapter das
        // nicht sofort - am 23.08.2026 kam das an der laufenden Waschmaschine mehrfach je Stunde
        // vor, teils auch zweimal hintereinander (Shelly mass dabei 2200 W Heizleistung).
        // remainingMinutes, NICHT remainingSeconds: letzteres ist nur die Sekundenkomponente der
        // Anzeige (bei "2:01" steht dort 0), nicht die Gesamtrestzeit.
        const restMin = ((await this.getStateAsync(`${deviceId}.state.remainingMinutes`)) || {}).val || 0;
        const seit = this._statusVerdacht[deviceId] || Date.now();
        this._statusVerdacht[deviceId] = seit;
        const verstrichen = Date.now() - seit;
        if (restMin > 2 && verstrichen < MieleLocal.AUS_VERDACHT_MAX_MS) {
            this.log.info(
                `${deviceId}: Status ${vorher} (laeuft) -> 1 (Aus) bei ${restMin} min ` +
                    `Restzeit - verworfen (seit ${Math.round(verstrichen / 1000)} s)`,
            );
            return false;
        }
        delete this._statusVerdacht[deviceId];
        if (restMin > 2) {
            this.log.warn(
                `${deviceId}: meldet seit ${Math.round(verstrichen / 1000)} s "Aus", obwohl noch ` +
                    `${restMin} min Restzeit gemeldet waren - wird jetzt uebernommen`,
            );
        }
        return true;
    }

    async applyState(deviceId, state) {
        const dev = this.devices[deviceId];
        const ctx = { deviceType: dev ? dev.deviceType : null };
        // Unmoegliche Sprünge nach "Aus" gar nicht erst in die Datenpunkte lassen - sonst
        // schreiben Status, Restzeit und Laufzeit gemeinsam Unsinn (siehe statusPlausibel).
        if ('Status' in state && !(await this.statusPlausibel(deviceId, state.Status))) {
            return;
        }
        // Fuer die Einschalt-Erkennung: was stand vorher da?
        const statusVorher =
            'Status' in state ? ((await this.getStateAsync(`${deviceId}.state.status`)) || {}).val : null;
        let statusVal = null;
        for (const [key, def] of Object.entries(objdef.STATE_FIELDS)) {
            if (!(key in state)) {
                continue;
            }
            if (!objdef.fieldAllowed(key, ctx.deviceType)) {
                continue;
            }
            const pairs = def.decode(state[key], ctx);
            for (const p of pairs) {
                // Liefert das Gerät nichts (Temperatur-Sentinel, abgeschaltete Zone), wird der
                // Datenpunkt NICHT beschrieben. Frueher stand dann null drin - der
                // Objektstruktur-Pruefer des ioBroker-Repos beanstandet das (E3005: val muss zu
                // common.type passen), und eine 0 waere schlimmer: 0 Grad ist ein plausibler
                // Messwert, "kein Wert" ist keiner. So bleibt der Vorgabewert bzw. der zuletzt
                // echte Stand erhalten.
                if (p.val === undefined || p.val === null) {
                    continue;
                }
                await this.setStateAsync(`${deviceId}.state.${p.sub}`, { val: p.val, ack: true });
            }
            if (key === 'Status') {
                statusVal = state.Status;
            }
        }
        if (statusVal != null) {
            await this.leafScanBeimEinschalten(deviceId, statusVorher, statusVal);
        }

        // Zeitvorwahl: das Geraet meldet nur die Restdauer bis zum Start ([7,20] = in 7:20).
        // Sie wird vor dem Programmende ausgewertet, denn wartet das Geraet noch, faengt die
        // Restzeit erst beim Start an zu laufen - das Ende liegt dann um die Vorwahl spaeter.
        //
        // Nur im Wartezustand: das Feld bleibt auch im laufenden Programm gefuellt (die
        // Waschmaschine meldete "in 0:17", waehrend sie spuelte). Ungeprueft uebernommen ergaebe
        // das eine Startzeit fuer ein laengst gestartetes Programm und ein um die Vorwahl zu
        // spaetes Ende. WARTEND = 3 (programmiert) und 4 (warten auf Start).
        let startMin = 0;
        if ('StartTime' in state) {
            const status =
                statusVal != null ? statusVal : ((await this.getStateAsync(`${deviceId}.state.status`)) || {}).val;
            const wartend = status === 3 || status === 4;
            startMin = wartend ? objdef.timeToMinutes(state.StartTime) || 0 : 0;
            await this.ensureStartObjects(deviceId);
            if (startMin > 0) {
                const start = new Date(Date.now() + startMin * 60000);
                const hh = String(start.getHours()).padStart(2, '0');
                const mm = String(start.getMinutes()).padStart(2, '0');
                await this.setStateAsync(`${deviceId}.state.startTime`, { val: start.getTime(), ack: true });
                await this.setStateAsync(`${deviceId}.state.startTimeText`, { val: `${hh}:${mm}`, ack: true });
            } else {
                await this.setStateAsync(`${deviceId}.state.startTime`, { val: 0, ack: true });
                await this.setStateAsync(`${deviceId}.state.startTimeText`, { val: '', ack: true });
            }
        }
        // Voraussichtliches Programmende (wie mielecloudservice.estimatedEndTime): jetzt + Vorwahl
        // + Restzeit. Nur wenn eine Restzeit > 0 vorliegt; sonst leeren (kein laufendes Programm).
        // Rohantwort kennt keine Uhrzeit, daher hier berechnet. Minutengenau, das genuegt fuers Ende.
        if ('RemainingTime' in state) {
            const remMin = objdef.timeToMinutes(state.RemainingTime);
            if (remMin && remMin > 0) {
                const end = new Date(Date.now() + (startMin + remMin) * 60000);
                await this.setStateAsync(`${deviceId}.state.estimatedEndTime`, { val: end.getTime(), ack: true });
                const hh = String(end.getHours()).padStart(2, '0');
                const mm = String(end.getMinutes()).padStart(2, '0');
                await this.setStateAsync(`${deviceId}.state.estimatedEndTimeText`, { val: `${hh}:${mm}`, ack: true });
            } else {
                // 0 statt null: der Datenpunkt ist als number deklariert, und "kein laufendes
                // Programm" muss hier ausdrueckbar bleiben - anders als bei den Temperaturen
                // waere ein stehengebliebenes altes Programmende irrefuehrend.
                await this.setStateAsync(`${deviceId}.state.estimatedEndTime`, { val: 0, ack: true });
                await this.setStateAsync(`${deviceId}.state.estimatedEndTimeText`, { val: '', ack: true });
            }
        }

        if (dev && statusVal != null) {
            await this.trackCycle(deviceId, statusVal);
            dev.active = ACTIVE_STATUSES.has(statusVal);
            // Endet ein Programm, laeuft die Eco-Abfrage noch eine Weile nach - der
            // Schlussstand steht oft erst nach dem Statuswechsel fest.
            const laeuftJetzt = statusVal === 5 || statusVal === 6;
            // Naehert sich das Programm dem Ende, wird engmaschiger abgelesen - siehe
            // ecoEndspurtPruefen. Das ist die einzige Stelle, an der der Schlussstand
            // ueberhaupt noch zu holen ist.
            if (this.config.ecoFeedback) {
                await this.ecoEndspurtPruefen(deviceId, statusVal);
            }
            if (dev.ecoLaeuft && !laeuftJetzt) {
                dev.ecoNachlaufBis = Date.now() + ecoRegel.NACHLAUF_MS;
                dev.ecoStabil = 0;
                this.log.debug(
                    `Eco ${deviceId}: Programm beendet, Nachlauf bis ` +
                        `${new Date(dev.ecoNachlaufBis).toLocaleTimeString('de-DE')}`,
                );
                this.ecoSchlussstandHolen(deviceId);
            }
            dev.ecoLaeuft = laeuftJetzt;
        }
    }

    /**
     * Zyklushistorie fuehren.
     *
     * Das Geraet selbst hebt abgeschlossene Programme nicht auf - der Zyklenzaehler in DOP2
     * 2/138 liefert bei den hier geprueften XKM-Modulen durchgaengig 0, und 2/119 laesst sich
     * keiner Einheit zuordnen (Waschmaschine 6688, Spuelmaschine 434006). Der Adapter zaehlt
     * deshalb selbst: ab dem Start eines Programms wird gemerkt, was laeuft, und beim Uebergang
     * in einen Endzustand ein Eintrag geschrieben. Genau dann stehen auch die Eco-Werte final
     * da - waehrend des Programms meldet die Waschmaschine dort 0.
     *
     * @param deviceId
     * @param statusVal
     */
    async trackCycle(deviceId, statusVal) {
        if (this.config.cycleHistory === false) {
            return;
        }
        if (!this._cycles) {
            this._cycles = {};
        }
        const laeuft = statusVal === 5 || statusVal === 6;
        let offen = this._cycles[deviceId];

        // Nach einem Neustart ist der offene Zyklus weg, das Programm laeuft aber weiter. Ohne
        // Wiederaufnahme begann die Zaehlung von vorn: am 22.08.2026 stand im Verlauf
        // "1 Minute, 1,854 kWh" - erfasst war nur die letzte Minute eines mehrstuendigen
        // Waschgangs, weil der Adapter zwischendurch neu gestartet war.
        //
        // Der Startzeitpunkt kommt aus zwei Quellen: bevorzugt aus der Laufzeit, die das Geraet
        // selbst meldet (die stimmt auch, wenn der Adapter waehrend des Programms erst gestartet
        // wurde), ersatzweise aus dem gemerkten Datenpunkt.
        if (laeuft && !offen) {
            let start = null;
            const gelaufen = await this.getStateAsync(`${deviceId}.state.elapsedMinutes`);
            if (gelaufen && typeof gelaufen.val === 'number' && gelaufen.val > 0) {
                start = Date.now() - gelaufen.val * 60000;
            } else {
                const gemerkt = await this.getStateAsync(ids.h(deviceId, 'runningSince'));
                if (gemerkt && typeof gemerkt.val === 'number' && gemerkt.val > 0) {
                    start = gemerkt.val;
                }
            }
            if (start) {
                /*
                 * Auch den Zaehlerstand vom Programmstart zurueckholen.
                 *
                 * Er lebte frueher nur in this._cycles, also im Speicher. Ein Neustart
                 * mitten im Programm nahm ihn mit, und am Ende gab gemessenerVerbrauch
                 * mangels Startwert null zurueck - der gemessene Verbrauch blieb 0, ohne
                 * dass irgendwo ein Fehler stand. Am 06.09.2026 genau so passiert.
                 */
                const gemerkterZaehler = await this.getStateAsync(ids.h(deviceId, 'meterAtStart'));
                let zaehlerStart =
                    gemerkterZaehler && typeof gemerkterZaehler.val === 'number' && gemerkterZaehler.val > 0
                        ? gemerkterZaehler.val
                        : null;
                /*
                 * Kein gemerkter Stand, aber das Programm hat gerade erst begonnen? Dann ist
                 * der aktuelle Stand der richtige. Das ist der Normalfall eines neuen Laufs -
                 * dieser Zweig faengt ihn mit ab, weil das Geraet nach einer Minute bereits
                 * elapsedMinutes = 1 meldet und der Lauf damit wie eine Fortsetzung aussieht.
                 */
                if (zaehlerStart == null && Date.now() - start < 5 * 60000) {
                    zaehlerStart = await this.zaehlerStand(deviceId);
                }
                this._cycles[deviceId] = { start, zaehlerStart };
                offen = this._cycles[deviceId];
                await this.ensureHistoryObjects(deviceId);
                await this.setStateAsync(ids.h(deviceId, 'runningSince'), { val: start, ack: true });
                this.log.debug(
                    `Zyklus von ${deviceId} fortgesetzt ` + `(laeuft seit ${new Date(start).toLocaleString()})`,
                );
            }
        }

        if (laeuft) {
            if (!offen) {
                // Den Eco-Stand beim Start festhalten: Nur wenn er sich bis zum Ende aendert,
                // ist er eine Messung dieses Zyklus und keine Altlast (siehe finishCycle).
                const stand = async id => {
                    const v = await this.getStateAsync(id);
                    return v && typeof v.val === 'number' ? v.val : null;
                };
                this._cycles[deviceId] = {
                    start: Date.now(),
                    ecoEnergieStart: await stand(`${deviceId}.eco.energy`),
                    ecoWasserStart: await stand(`${deviceId}.eco.water`),
                    // Der Stand der Messsteckdose beim Start - siehe gemessenerVerbrauch.
                    zaehlerStart: await this.zaehlerStand(deviceId),
                };
                /*
                 * Den Stand aller Leafs beim Start holen - nebenher.
                 *
                 * Das Auslesen dauert je nach Geraet eine Minute (Pause zwischen den Adressen,
                 * siehe leafStaendeLesen). Es darf die Abfrage nicht aufhalten, deshalb laeuft
                 * es nebenher und traegt sich nach, wenn es fertig ist. Der Vergleich auf start
                 * verhindert, dass ein spaet eintreffendes Ergebnis in einen inzwischen
                 * begonnenen zweiten Zyklus faellt.
                 *
                 * Absichtlich NICHT in einem Datenpunkt gesichert: Ein Neustart mitten im
                 * Programm kostet dann die Differenz dieses einen Laufs, was der Datensatz als
                 * unvollstaendig vermerkt - das ist mir lieber als ein weiteres Objekt im Baum.
                 */
                if (this.config.sammlerAktiv) {
                    const meinStart = this._cycles[deviceId].start;
                    this.leafStaendeLesen(deviceId)
                        .then(l => {
                            const z = this._cycles[deviceId];
                            if (z && z.start === meinStart && Object.keys(l).length) {
                                z.leafsStart = l;
                            }
                        })
                        .catch(() => {
                            /* ohne Startstand bleibt es bei den Endwerten */
                        });
                }
                await this.ensureHistoryObjects(deviceId);
                await this.setStateAsync(ids.h(deviceId, 'runningSince'), {
                    val: this._cycles[deviceId].start,
                    ack: true,
                });
                // Damit ein Neustart mitten im Programm die Messung nicht verliert.
                await this.setStateAsync(ids.h(deviceId, 'meterAtStart'), {
                    val: this._cycles[deviceId].zaehlerStart,
                    ack: true,
                });
            } else if (offen.endeSeit) {
                // War nur ein Aussetzer - das Geraet meldete kurz "Aus" und laeuft weiter.
                delete offen.endeSeit;
            }
            // Programmtext erst merken, wenn er vorliegt - beim Start ist er oft noch leer.
            const p = await this.getStateAsync(`${deviceId}.state.programText`);
            const t = await this.getStateAsync(`${deviceId}.state.programTypeText`);
            if (p && p.val) {
                this._cycles[deviceId].program = p.val;
            }
            if (t && t.val) {
                this._cycles[deviceId].programType = t.val;
            }
            return;
        }

        if (!offen) {
            return;
        } // war schon vorher aus

        // Nicht beim ersten "nicht mehr in Betrieb" buchen: die Waschmaschine meldete am
        // 21.08.2026 mitten im Schleudern eine Minute lang "Aus" und lief danach weiter. Ohne
        // Karenzzeit waere daraus ein abgeschlossener plus ein neuer Zyklus geworden.
        if (!offen.endeSeit) {
            offen.endeSeit = Date.now();
            return;
        }
        if (Date.now() - offen.endeSeit < CYCLE_END_GRACE_MS) {
            return;
        }

        delete this._cycles[deviceId];
        await this.setStateAsync(ids.h(deviceId, 'runningSince'), { val: 0, ack: true });
        /*
         * Den Zaehlerstand mit wegraeumen - sonst erbt ihn das naechste Programm.
         *
         * Der Wiederaufnahme-Zweig in trackCycle greift auch bei einem frisch gestarteten
         * Programm: Nach einer Minute meldet das Geraet elapsedMinutes = 1, und der Adapter
         * haelt den neuen Lauf fuer die Fortsetzung eines Neustarts. Blieb hier der alte
         * Startstand stehen, rechnete er am Ende beide Laeufe zusammen. Am 07.09.2026 an der
         * Waschmaschine gesehen: Der zweite Waschgang des Tages startete mit dem
         * Zaehlerstand des ersten, was 1400 statt 2700 Wh ergeben haette.
         */
        await this.setStateAsync(ids.h(deviceId, 'meterAtStart'), { val: 0, ack: true });
        // Als Ende gilt der Zeitpunkt, an dem das Geraet zuerst nicht mehr lief - nicht das
        // Ende der Karenzzeit.
        const ende = offen.endeSeit;
        // Sehr kurze "Zyklen" sind meist ein Fehlstart oder ein Statusflackern beim Einschalten.
        const dauerS = Math.round((ende - offen.start) / 1000);
        if (dauerS < 60) {
            return;
        }

        // EcoFeedback nur uebernehmen, wenn es sich seit dem letzten Zyklus geaendert hat.
        //
        // Nicht jedes Geraet fuehrt die Werte waehrend des Programms nach: Die Waschmaschine
        // WCR860 beantwortet den Eco-Leaf mal mit HTTP 404, mal mit 500, und der zuletzt
        // gelesene Wert bleibt dann einfach stehen. Am 24.08.2026 standen deshalb zwei
        // voellig verschiedene Programme (Baumwolle 214 min, Pflegeleicht 162 min) mit
        // identischen 95,3 l in der Historie - der Wert stammte in Wahrheit aus einem
        // Waschgang funf Tage zuvor. Ein unveraenderter Wert ist keine Messung, sondern ein
        // Ueberbleibsel; er gehoert nicht in die Zyklusbilanz.
        const zahl = async id => {
            const v = await this.getStateAsync(id);
            return v && typeof v.val === 'number' ? v.val : null;
        };
        const frisch = async (id, vorher) => {
            const wert = await zahl(id);
            if (wert == null) {
                return null;
            }
            if (vorher != null && wert === vorher) {
                this.log.debug(
                    `${deviceId}: ${id.split('.').pop()} steht unveraendert auf ${wert} ` +
                        '- nicht als Zyklusverbrauch uebernommen',
                );
                return null;
            }
            return wert;
        };
        /*
         * DER GEMESSENE VERBRAUCH - aus der Messsteckdose, nicht aus dem Geraet.
         *
         * WARUM DAS NOETIG IST. Das Geraet nennt zwar eine Energie (eco.energyWh), aber die
         * ist eine ERWARTUNG fuer das Programm, gesetzt beim Start - keine Messung. Am
         * 03.09.2026 belegt: Der Wert stand 2:40 Stunden unveraendert auf 770 Wh, waehrend die
         * Steckdose von 0 auf 847 Wh stieg; ueber den ganzen Lauf mass sie 1158 Wh.
         *
         * Gesucht wurde die echte Zahl auch in den Feldern - vergeblich. Am 06.09.2026 wurden
         * die vier monoton steigenden Felder von 2/6195 gegen drei gemessene Waschgaenge
         * gehalten; kein Verhaeltnis war konstant (Feld 15 kam auf 0,86 / 1,30 / 1,71). Sie
         * steht in keinem Leaf, das dieses Geraet hergibt.
         *
         * Deshalb dieser Weg: Wer eine Messsteckdose davor hat, traegt ihren Zaehler in der
         * Konfiguration ein. Der Adapter merkt sich den Stand bei Programmstart und rechnet
         * am Ende die Differenz - das ist der einzige belastbare Wert, den es gibt.
         */
        const gemessen = await this.gemessenerVerbrauch(deviceId, offen.zaehlerStart);

        const eintrag = {
            start: offen.start,
            ende,
            dauerS,
            program: offen.program || null,
            programType: offen.programType || null,
            energyKwh: await frisch(`${deviceId}.eco.energy`, offen.ecoEnergieStart),
            waterL: await frisch(`${deviceId}.eco.water`, offen.ecoWasserStart),
            gemessenWh: gemessen,
        };

        /*
         * War die letzte Ablesung der Endstand - oder ein Zwischenstand?
         *
         * Der Zyklus wird dadurch NICHT verworfen. Er wandert nur mit einem Vermerk weiter:
         * Die Feldsuche laesst diese Groesse aus, die Kontrolle bucht sie als Luecke statt
         * als Abweichung. Alles andere am Zyklus - Programm, Dauer, Rohfelder, gemessene
         * Energie - bleibt unveraendert erhalten und zaehlt normal.
         *
         * Ein Zwischenstand ist kein Messfehler: Der Zaehler stand wirklich dort. Falsch
         * waere allein, ihn gegen einen Endwert zu rechnen. Siehe lib/eco.js.
         */
        const dev = this.devices && this.devices[deviceId];
        const bewertung = ecoRegel.ablesungBewerten({
            letzteAblesungMs: dev && dev.ecoWasserZuletztMs,
            endeMs: ende,
            wert: eintrag.waterL,
            vorletzterWert: dev ? dev.ecoWasserVorletzter : null,
        });
        if (!bewertung.vollstaendig) {
            eintrag.unvollstaendig = { waterL: bewertung.grund };
            this.log.info(
                `${deviceId}: Wasserwert ${eintrag.waterL} l wird nicht als Endwert ` + `gewertet - ${bewertung.grund}`,
            );
        }
        // Fuer den naechsten Lauf zuruecksetzen, sonst erbt er die Ablesung dieses Programms.
        if (dev) {
            dev.ecoWasserZuletztMs = null;
            dev.ecoWasserLetzter = null;
            dev.ecoWasserVorletzter = null;
        }

        await this.appendCycle(deviceId, eintrag);
        await this.sammlungAufnehmen(deviceId, eintrag);

        // Den gemessenen Verbrauch sichtbar machen - fuer die App und fuer die Auswertung.
        if (eintrag.gemessenWh != null) {
            await this.setStateAsync(ids.h(deviceId, 'measuredLast'), { val: eintrag.gemessenWh, ack: true });
            const bisher = await this.getStateAsync(ids.h(deviceId, 'measuredTotal'));
            const summe = ((bisher && bisher.val) || 0) + eintrag.gemessenWh / 1000;
            await this.setStateAsync(ids.h(deviceId, 'measuredTotal'), {
                val: Math.round(summe * 1000) / 1000,
                ack: true,
            });
            this.log.info(
                `${deviceId}: gemessener Verbrauch ${eintrag.gemessenWh} Wh ` + `(${eintrag.program || 'Programm'})`,
            );
        }
    }

    /**
     * Der Datenpunkt der Messsteckdose zu diesem Geraet - oder null.
     *
     * Zugeordnet wird ueber die Seriennummer, weil sie im Objektbaum ohnehin der
     * Geraeteschluessel ist. Fehlt der Eintrag, gibt es eben keinen gemessenen Verbrauch;
     * alles andere laeuft unveraendert weiter.
     *
     * @param deviceId
     */
    zaehlerDatenpunkt(deviceId) {
        const liste = this.config.zaehler || [];
        const treffer = liste.find(z => z && String(z.serial || '').trim() === String(deviceId));
        const dp = treffer && String(treffer.datenpunkt || '').trim();
        return dp || null;
    }

    /**
     * Den aktuellen Zaehlerstand lesen - null, wenn es keinen gibt.
     *
     * @param deviceId
     */
    async zaehlerStand(deviceId) {
        const dp = this.zaehlerDatenpunkt(deviceId);
        if (!dp) {
            return null;
        }
        try {
            const st = await this.getForeignStateAsync(dp);
            return st && typeof st.val === 'number' ? st.val : null;
        } catch (e) {
            this.log.debug(`${deviceId}: Zaehler ${dp} nicht lesbar - ${e.message}`);
            return null;
        }
    }

    /**
     * Was zwischen Programmstart und jetzt verbraucht wurde.
     *
     * Ein Zaehler laeuft immer aufwaerts; faellt er, wurde er zurueckgesetzt oder die
     * Steckdose getauscht. Dann ist die Differenz unbrauchbar und es gibt lieber keinen Wert
     * als einen falschen.
     *
     * @param deviceId
     * @param standBeimStart
     */
    async gemessenerVerbrauch(deviceId, standBeimStart) {
        if (standBeimStart == null) {
            return null;
        }
        const jetzt = await this.zaehlerStand(deviceId);
        if (jetzt == null || jetzt < standBeimStart) {
            return null;
        }
        return Math.round((jetzt - standBeimStart) * 10) / 10;
    }

    /**
     * Einen Datensatz fuer die Feldzuordnung mitschreiben - freiwillig, standardmaessig aus.
     *
     * Wozu: Die Feldindizes des Eco-Leaf unterscheiden sich je Baureihe. Wer ein anderes Modell
     * hat und mithelfen moechte, schaltet diese Sammlung ein; aus zehn Zyklen mit bekannten
     * Vergleichswerten laesst sich ablesen, welches Feld welche Groesse traegt.
     *
     * Datenschutz: Die Daten bleiben in der eigenen Instanz. Der Adapter versendet nichts und
     * wertet nichts aus. Die Seriennummer wird bewusst nicht mitgeschrieben - sie benennt einen
     * Haushalt, und fuer die Feldzuordnung genuegt das Modell. Siehe lib/sammler.js.
     *
     * @param deviceId
     * @param eintrag
     */
    async sammlungAufnehmen(deviceId, eintrag) {
        if (!this.config.sammlerAktiv) {
            return;
        }
        try {
            const lies = async pfad => {
                const s = await this.getStateAsync(`${deviceId}.${pfad}`);
                return s ? s.val : null;
            };
            let felder = {};
            try {
                felder = JSON.parse(await lies('eco.felderJson')) || {};
            } catch {
                /* leer */
            }

            let cloud = null;
            if (this.config.sammlerCloud) {
                cloud = await this.cloudWerteLesen(deviceId);
            }

            const satz = sammler.datensatzBauen({
                // Start und Ende des Programms - ohne sie liess sich ein Datensatz spaeter keinem
                // Waschgang zuordnen (15.09.2026).
                start: eintrag.start,
                ende: eintrag.ende,
                modell: {
                    techType: await lies('info.techType'),
                    matNumber: await lies('info.matNumber'),
                    xkmType: await lies('info.xkmType'),
                    xkmVersion: await lies('info.xkmVersion'),
                    protocolVersion: await lies('info.protocolVersion'),
                },
                programm: {
                    id: await lies('state.programId'),
                    text: eintrag.program,
                    art: await lies('state.programType'),
                    artText: eintrag.programType,
                    dauerMin: Math.round((eintrag.dauerS || 0) / 60),
                    temperatur: await lies('state.targetTemperature'),
                },
                felder,
                // Der Leaf-Stand vom Programmstart, falls er rechtzeitig kam.
                leafsStart: eintrag.leafsStart,
                cloud,
                // Der gemessene Verbrauch - die einzige belastbare Energiezahl, die es gibt.
                gemessenWh: eintrag.gemessenWh ?? null,
                unvollstaendig: eintrag.unvollstaendig || null,
            });

            let bisher = [];
            try {
                bisher = JSON.parse(await lies(`${ids.KANAL.collection}.${ids.SAMMLUNG.records}`)) || [];
            } catch {
                /* leer */
            }
            const neu = sammler.aufnehmen(bisher, satz);
            await this.setStateAsync(ids.s(deviceId, 'records'), { val: JSON.stringify(neu), ack: true });
            await this.setStateAsync(ids.s(deviceId, 'cycles'), { val: neu.length, ack: true });
            await this.setStateAsync(ids.s(deviceId, 'progress'), { val: sammler.fortschritt(neu), ack: true });

            /*
             * Die Schlussstaende aller Leafs nachtragen - im Hintergrund.
             *
             * Nicht abgewartet: Der Durchgang dauert je nach Geraet eine knappe Minute (fuenf
             * Sekunden Pause je Adresse, damit das Modul nebenher noch arbeiten kann). Der
             * Zyklusabschluss wuerde sonst genau so lange stehen, und daran haengen Statistik,
             * Verlauf und Push-Meldung.
             */
            this.leafsAbschlussNachtragen(deviceId).catch(e =>
                this.log.debug(`${deviceId}: Leaf-Schlussstand - ${e.message}`),
            );

            /*
             * Sammeln allein beantwortet nichts - deshalb gleich die Auswertung.
             *
             * Sie haelt jedes Feld gegen die Vergleichswerte und sagt, welches der
             * gesuchten Groesse folgt. Genau das haette den Fehler vom 28.08.2026 am Tag
             * seines Entstehens gezeigt: Feld 40 meldete zehn Tage lang konstant 95,3 l,
             * und ein Feld, das sich nie aendert, kann keine Groesse sein, die sich
             * aendert. Siehe lib/feldsuche.js.
             *
             * Uebernommen wird nichts von selbst. Der Befund ist ein Text zum Lesen; ob
             * eine Feldzuordnung geaendert wird, entscheidet der Mensch davor. Eine
             * Zuordnung, die sich unbemerkt selbst umstellt, waere genau die Art Aenderung,
             * die erst auffaellt, wenn die Jahresstatistik nicht mehr stimmt.
             */
            const befund = feldsuche.befund(neu, {
                energie: this.config.ecoEnergyIdx,
                wasser: this.config.ecoWaterIdx,
            });
            await this.setStateAsync(ids.s(deviceId, 'finding'), { val: befund, ack: true });

            /*
             * Die laufende Kontrolle - siehe lib/kontrolle.js.
             *
             * Sie fragt etwas anderes als die Feldsuche darueber: nicht "welches Feld
             * traegt die Groesse", sondern "liefert das eingestellte Feld weiterhin
             * richtige Werte". Am 04.09.2026 wurde Feld 21 als Wasserzaehler belegt
             * (0,49 % mittlere Abweichung ueber acht Zyklen) - ein Firmware-Update kann
             * die Feldreihenfolge verschieben, ohne dass es jemand ankuendigt, und dann
             * bleiben die Zahlen plausibel und sind trotzdem falsch.
             */
            const vergleich = kontrolle.vergleichen({
                zeit: Date.now(),
                programm: eintrag.program,
                lokal: { waterL: eintrag.waterL, energyKwh: eintrag.energyKwh },
                cloud,
                manuell: satz.manuell,
                unvollstaendig: eintrag.unvollstaendig || null,
            });
            if (vergleich) {
                let bisherK = [];
                try {
                    bisherK = JSON.parse(await lies(`${ids.KANAL.collection}.${ids.SAMMLUNG.checkJson}`)) || [];
                } catch {
                    /* leer */
                }
                const verlauf = kontrolle.aufnehmen(bisherK, vergleich);
                await this.setStateAsync(ids.s(deviceId, 'checkJson'), { val: JSON.stringify(verlauf), ack: true });
                const text = kontrolle.bericht(verlauf);
                await this.setStateAsync(ids.s(deviceId, 'check'), { val: text, ack: true });
                // Ins Log nur bei einer Reihe von Ausreissern - sonst stuende hier nach
                // jedem Waschgang dieselbe Zeile.
                for (const groesse of ['waterL', 'energyKwh']) {
                    if (kontrolle.stand(verlauf, groesse).warnt) {
                        this.log.warn(`${deviceId}: ${text}`);
                        break;
                    }
                }
            }

            this.log.info(`${deviceId}: Datensatz fuer die Feldzuordnung aufgenommen ` + `(${neu.length} gesammelt)`);
            // Ins Log nur, wenn die Suche der Einstellung widerspricht - sonst waere es
            // bei jedem Waschgang dieselbe Zeile.
            if (/eingestellt ist aber/.test(befund)) {
                this.log.warn(`${deviceId}: ${befund}`);
            }
        } catch (e) {
            // Die Sammlung darf den Zyklus nie stoeren - sie ist eine Zugabe, kein Kernstueck.
            this.log.warn(`${deviceId}: Datensatz konnte nicht aufgenommen werden - ${e.message}`);
        }
    }

    /**
     * Energie und Wasser aus dem Cloud-Adapter lesen, wenn der Nutzer den Vergleich einschaltet.
     *
     * Ohne einen Vergleichswert ist ein Datensatz wertlos: Man saehe zwar, welche Felder sich
     * bewegen, aber nicht, welches davon die Kilowattstunden sind. Die Cloud liefert ihn
     * automatisch; wer sie nicht angebunden hat, traegt die Werte von Hand aus der Miele-App
     * nach (sammlung.eingabeEnergie / eingabeWasser).
     *
     * Der Wert wird waehrend des Programms mitgefuehrt und beim Ende zurueckgesetzt - deshalb
     * der Hoechstwert der letzten Stunde und nicht der Augenblickswert.
     */
    /**
     * Nach einem Programm einmal ueber ALLE antwortenden Leafs gehen - schonend.
     *
     * DIE REIHENFOLGE IST ABSICHT: erst den Datensatz sichern, dann die Leafs lesen. Bricht
     * der Durchgang ab, weil das Geraet abgeschaltet wurde, fehlen ein paar Leafs - der
     * Datensatz selbst steht aber bereits vollstaendig da.
     *
     * SCHONEND HEISST: fuenf Sekunden zwischen zwei Anfragen, wie im Leaf-Scan. Am 04.09.2026
     * hatte ein Durchgang mit 400 ms das WLAN-Modul der Waschmaschine dazu gebracht, beide
     * Verbindungen abzuwerfen - die lokale und die zur Cloud. Lieber eine Minute laenger.
     *
     * Was dabei herauskommt, ist derselbe Satz Istwerte, den auch die Datenpunkte bekommen -
     * gedeutet, nicht roh. Der Rohverlauf steht daneben in sammlung.leafVerlaufJson.
     */
    /**
     * Den Stand aller antwortenden Leafs einmal auslesen.
     *
     * WOZU GETRENNT. Bis 0.3.37 geschah das nur am Programmende. Fuer das Eco-Leaf 2/6195
     * reicht das, weil dessen Felder je Programm zurueckgesetzt werden. Alle anderen Adressen
     * fuehren Lebenszaehler - eine Betriebsstundenzahl von 4711 sagt ueber einen einzelnen
     * Waschgang nichts. Verbrauch steht dort erst in der DIFFERENZ zwischen Anfang und Ende,
     * und genau diese Adressen sind der einzige Weg bei Geraeten, die 2/6195 nicht beantworten
     * (die Spuelmaschine dieses Haushalts etwa). Deshalb wird jetzt beides gelesen.
     *
     * @param {string} deviceId
     * @returns {Promise<object>} {"2/119": {"1": 4711, ...}, ...} - leer, wenn nichts zu holen war
     */
    async leafStaendeLesen(deviceId) {
        const dev = this.devices && this.devices[deviceId];
        if (!dev) {
            return {};
        }

        const stand = await this.getStateAsync(ids.s(deviceId, 'scanJson'));
        let gefunden = {};
        try {
            gefunden = JSON.parse((stand && stand.val) || '{}') || {};
        } catch {
            return {};
        }
        const liste = Object.entries(gefunden)
            .filter(([, v]) => v && v.antwortet)
            .map(([k]) => k);
        if (!liste.length) {
            return {};
        }

        const leafs = {};
        for (const schluessel of liste) {
            const [unit, attr] = schluessel.split('/').map(Number);
            if (!unit || !attr) {
                continue;
            }
            try {
                const res = await dev.api.readDop2(dev.route, unit, attr, 0, 0, leafscan.SCAN_TIMEOUT_MS);
                if (res.status === 200 && res.headers['x-signature']) {
                    const { fields } = this.leafLesen(res);
                    const werte = {};
                    for (const w of datenpunkte.istwerte(schluessel, fields)) {
                        werte[w.pfad] = w.wert;
                    }
                    /*
                     * Leafs ohne Namenstabelle bleiben nicht aussen vor.
                     *
                     * istwerte() kennt nur benannte Strukturen. Gerade die unbenannten sind aber
                     * die interessanten - bei der Spuelmaschine antworten elf Adressen, die kein
                     * oeffentliches Projekt kennt. Fuer sie wird der flache Rohwert genommen.
                     */
                    if (!Object.keys(werte).length) {
                        Object.assign(werte, this.leafLesen(res).werte);
                    }
                    if (Object.keys(werte).length) {
                        leafs[schluessel] = werte;
                    }
                }
            } catch {
                /* ein Fehlschlag beendet den Durchgang nicht */
            }
            await new Promise(r => this.setTimeout(r, leafscan.PAUSE_MS));
        }
        return leafs;
    }

    /**
     * Den Schlussstand der Leafs an den zuletzt gesammelten Datensatz haengen.
     *
     * @param deviceId
     */
    async leafsAbschlussNachtragen(deviceId) {
        if (!this.config.sammlerAktiv) {
            return;
        }
        const leafs = await this.leafStaendeLesen(deviceId);
        if (!Object.keys(leafs).length) {
            return;
        }

        const alt = await this.getStateAsync(ids.s(deviceId, 'records'));
        let bisher = [];
        try {
            bisher = JSON.parse((alt && alt.val) || '[]') || [];
        } catch {
            return;
        }
        const neu = sammler.leafsNachtragen(bisher, leafs);
        await this.setStateAsync(ids.s(deviceId, 'records'), { val: JSON.stringify(neu), ack: true });
        this.log.debug(`${deviceId}: Schlussstand von ${Object.keys(leafs).length} Leafs nachgetragen.`);
    }

    async cloudWerteLesen(deviceId) {
        const instanz = this.config.sammlerCloudInstanz || 'mielecloudservice.0';
        const holen = async feld => {
            const s = await this.getForeignStateAsync(`${instanz}.${deviceId}.EcoFeedback.${feld}`).catch(() => null);
            return s && typeof s.val === 'number' && s.val > 0 ? s.val : null;
        };
        const energyKwh = await holen('currentEnergyConsumption');
        const waterL = await holen('currentWaterConsumption');
        return energyKwh != null || waterL != null ? { energyKwh, waterL } : null;
    }

    /**
     * Haengt einen Zyklus an Ringpuffer und Summen an und schreibt ihn in die Historie.
     *
     * @param deviceId
     * @param eintrag
     */
    async appendCycle(deviceId, eintrag) {
        await this.ensureHistoryObjects(deviceId);

        const ring = Math.max(1, this.config.cycleRingSize || 50);
        const tage = Math.max(1, this.config.historyDays || 730);
        const grenze = Date.now() - tage * 86400000;

        let liste = [];
        const alt = await this.getStateAsync(`${deviceId}.history.cyclesJson`);
        try {
            liste = JSON.parse(alt && alt.val) || [];
        } catch {
            liste = [];
        }
        liste.unshift(eintrag);
        liste = liste.filter(e => e && e.ende >= grenze).slice(0, ring);
        await this.setStateAsync(`${deviceId}.history.cyclesJson`, { val: JSON.stringify(liste), ack: true });

        // Summen laufen unabhaengig vom Ringpuffer weiter - sie sollen nicht schrumpfen,
        // wenn alte Eintraege herausfallen.
        for (const [sub, wert] of [
            ['cycleCount', 1],
            ['energyTotal', eintrag.energyKwh || 0],
            ['waterTotal', eintrag.waterL || 0],
            ['runtimeHours', eintrag.dauerS / 3600],
        ]) {
            const v = await this.getStateAsync(`${deviceId}.history.${sub}`);
            const bisher = v && typeof v.val === 'number' ? v.val : 0;
            const neu = sub === 'cycleCount' ? bisher + 1 : Math.round((bisher + wert) * 1000) / 1000;
            await this.setStateAsync(`${deviceId}.history.${sub}`, { val: neu, ack: true });
        }

        // Zusaetzlich in history.0, damit sich spaeter Diagramme ueber beliebige Zeitraeume
        // bauen lassen, ohne dass der Ringpuffer alles tragen muss. Zeitstempel ist das
        // Zyklusende, nicht der Schreibzeitpunkt.
        const instanz = this.config.historyInstance || 'history.0';
        if (this.config.historyWrite !== false) {
            for (const [sub, wert] of [
                ['energyKwh', eintrag.energyKwh],
                ['waterL', eintrag.waterL],
                ['durationMin', Math.round(eintrag.dauerS / 60)],
            ]) {
                if (wert == null) {
                    continue;
                }
                this.sendTo(instanz, 'storeState', {
                    id: `${this.namespace}.${deviceId}.history.${sub}`,
                    state: { val: wert, ts: eintrag.ende, ack: true },
                });
            }
        }
        await this.updateStats(deviceId, eintrag);
        this.log.info(
            `Cycle recorded (${deviceId}): ${eintrag.program || 'unknown program'}, ` +
                `${Math.round(eintrag.dauerS / 60)} min, ${eintrag.energyKwh ?? '-'} kWh, ${eintrag.waterL ?? '-'} l`,
        );
    }

    /**
     * Kennzahlen je Zeitraum und Programm fortschreiben - dasselbe, was die Hersteller-App
     * zeigt: Verbrauch pro Programm, Programmnutzung und der Vergleich mit dem Vorzeitraum.
     * Der Zustand liegt im Geraeteobjekt, damit er einen Neustart uebersteht.
     *
     * @param deviceId
     * @param eintrag
     */
    async updateStats(deviceId, eintrag) {
        const obj = await this.getObjectAsync(deviceId);
        const vorher = obj && obj.native && obj.native.stats;
        const stand = stats.verbuchen(vorher, eintrag);
        await this.extendObjectAsync(deviceId, { native: { stats: stand } });

        const a = stats.ausgabe(stand);
        await this.ensureStatsObjects(deviceId);
        for (const zeitraum of ['week', 'month', 'year']) {
            const z = a[zeitraum];
            for (const [sub, wert] of Object.entries({
                cycles: z.cycles,
                energy: z.energy,
                water: z.water,
                runtimeHours: z.runtimeHours,
                avgEnergy: z.avgEnergy,
                avgWater: z.avgWater,
                prevCycles: z.prevCycles,
                prevEnergy: z.prevEnergy,
                prevWater: z.prevWater,
                prevAvgEnergy: z.prevAvgEnergy,
                prevAvgWater: z.prevAvgWater,
            })) {
                // null nur bei Mittelwerten ohne Grundlage - dann den Datenpunkt auslassen,
                // damit keine 0 als gemessener Wert erscheint.
                if (wert === null) {
                    continue;
                }
                await this.setStateAsync(`${deviceId}.stats.${zeitraum}.${sub}`, { val: wert, ack: true });
            }
            if (z.key) {
                await this.setStateAsync(`${deviceId}.stats.${zeitraum}.period`, { val: z.key, ack: true });
            }
            if (z.prevKey) {
                await this.setStateAsync(`${deviceId}.stats.${zeitraum}.prevPeriod`, { val: z.prevKey, ack: true });
            }
            // Je Zeitraum eine eigene Programmliste - sonst liesse sich in der Anzeige nicht
            // zwischen Monat und Jahr umschalten, ohne alles neu zu rechnen.
            await this.setStateAsync(`${deviceId}.stats.${zeitraum}.programsJson`, {
                val: JSON.stringify(z.programs || []),
                ack: true,
            });
        }
        await this.setStateAsync(`${deviceId}.stats.programsJson`, { val: JSON.stringify(a.programs), ack: true });
        // Alle Monate und Jahre einzeln - damit sich in der Anzeige ein bestimmter Zeitraum
        // waehlen laesst, nicht nur der laufende und der davor.
        await this.setStateAsync(`${deviceId}.stats.monthsJson`, { val: JSON.stringify(a.months), ack: true });
        await this.setStateAsync(`${deviceId}.stats.yearsJson`, { val: JSON.stringify(a.years), ack: true });
        for (const [sub, wert] of Object.entries(a.total)) {
            if (wert === null) {
                continue;
            }
            await this.setStateAsync(`${deviceId}.stats.total.${sub}`, { val: wert, ack: true });
        }
    }

    async ensureStartObjects(deviceId) {
        if (!this._startCreated) {
            this._startCreated = {};
        }
        if (this._startCreated[deviceId]) {
            return;
        }
        const de = this.config.germanNames !== false;
        await this.extendObjectAsync(`${deviceId}.state.startTime`, {
            type: 'state',
            common: {
                name: namen.text('Startzeit (Zeitstempel)', 'Start time (timestamp)', de),
                type: 'number',
                role: 'date',
                def: 0,
                read: true,
                write: false,
            },
            native: {},
        });
        await this.extendObjectAsync(`${deviceId}.state.startTimeText`, {
            type: 'state',
            common: {
                name: namen.text('Startzeit', 'Start time', de),
                type: 'string',
                role: 'text',
                def: '',
                read: true,
                write: false,
            },
            native: {},
        });
        this._startCreated[deviceId] = true;
    }

    /**
     * Datenpunkte fuer die Abfragestatistik.
     *
     * Die Poll-Fehler landeten bisher nur in log.debug - im Normalbetrieb also nirgends. Dass
     * die Waschmaschine zeitweise jede zweite Abfrage verwarf, liess sich deshalb nur mit einer
     * eigens laufenden Messung zeigen. Die Quote steht jetzt dauerhaft am Geraet.
     *
     * @param deviceId
     */
    async ensureDiagObjects(deviceId) {
        if (!this._diagCreated) {
            this._diagCreated = {};
        }
        if (this._diagCreated[deviceId]) {
            return;
        }
        const de = this.config.germanNames !== false;
        const felder = [
            [
                'pollErrorRate',
                namen.text('Fehlerquote der Abfragen', 'Polling error rate', de),
                'number',
                'value',
                '%',
                0,
            ],
            [
                'pollErrors',
                namen.text('Fehlerhafte Abfragen (1 h)', 'Failed polls (1 h)', de),
                'number',
                'value',
                '',
                0,
            ],
            ['pollTotal', namen.text('Abfragen (1 h)', 'Polls (1 h)', de), 'number', 'value', '', 0],
            [
                'pollRetries',
                namen.text('Erst im zweiten Versuch geglückt (1 h)', 'Succeeded on retry (1 h)', de),
                'number',
                'value',
                '',
                0,
            ],
            ['lastError', namen.text('Letzter Abfragefehler', 'Last polling error', de), 'string', 'text', '', ''],
        ];
        for (const [sub, name, type, role, unit, def] of felder) {
            await this.extendObjectAsync(`${deviceId}.info.${sub}`, {
                type: 'state',
                common: { name, type, role, unit: unit || undefined, def, read: true, write: false },
                native: {},
            });
        }
        this._diagCreated[deviceId] = true;
    }

    /**
     * Eine Abfrage verbuchen und die Quote fortschreiben.
     *
     * Gezaehlt wird ueber ein gleitendes Fenster von einer Stunde: eine Gesamtquote seit
     * Adapterstart wuerde eine laengst behobene Stoerung noch tagelang mitschleppen.
     */
    /**
     * Haelt fest, wie der Statusabruf ausgegangen ist - gleitendes Fenster ueber eine Stunde.
     *
     * [erholt] = erst der zweite Versuch hat geklappt. Das zaehlt bewusst NICHT als Fehler (die
     * Daten sind ja da), wird aber getrennt ausgewiesen: Nur so bleibt sichtbar, wie oft ein
     * Geraet zickt, ohne dass die Fehlerquote Alarm schlaegt, obwohl nichts fehlt.
     *
     * @param deviceId
     * @param fehler
     * @param erholt
     */
    async verbucheAbfrage(deviceId, fehler, erholt = false) {
        if (!this._diag) {
            this._diag = {};
        }
        const d = (this._diag[deviceId] = this._diag[deviceId] || { versuche: [] });
        const jetzt = Date.now();
        d.versuche.push({ ts: jetzt, fehler: fehler ? fehler.message : null, erholt });
        const grenze = jetzt - 3600000;
        while (d.versuche.length && d.versuche[0].ts < grenze) {
            d.versuche.shift();
        }

        const gesamt = d.versuche.length;
        const schlecht = d.versuche.filter(v => v.fehler).length;
        const erholte = d.versuche.filter(v => v.erholt).length;
        await this.ensureDiagObjects(deviceId);
        await this.setStateAsync(`${deviceId}.info.pollTotal`, { val: gesamt, ack: true });
        await this.setStateAsync(`${deviceId}.info.pollErrors`, { val: schlecht, ack: true });
        await this.setStateAsync(`${deviceId}.info.pollRetries`, { val: erholte, ack: true });
        await this.setStateAsync(`${deviceId}.info.pollErrorRate`, {
            val: gesamt ? Math.round((schlecht / gesamt) * 1000) / 10 : 0,
            ack: true,
        });
        if (fehler) {
            const t = new Date(jetzt);
            const hh = String(t.getHours()).padStart(2, '0');
            const mm = String(t.getMinutes()).padStart(2, '0');
            const ss = String(t.getSeconds()).padStart(2, '0');
            await this.setStateAsync(`${deviceId}.info.lastError`, {
                val: `${hh}:${mm}:${ss} ${fehler.message}`,
                ack: true,
            });
        }
    }

    async ensureStatsObjects(deviceId) {
        if (!this._statsCreated) {
            this._statsCreated = {};
        }
        if (this._statsCreated[deviceId]) {
            return;
        }
        const de = this.config.germanNames !== false;
        const NAME = {
            week: namen.text('Woche', 'Week', de),
            month: namen.text('Monat', 'Month', de),
            year: namen.text('Jahr', 'Year', de),
            total: namen.text('Gesamt', 'Total', de),
        };
        const FELD = {
            cycles: [namen.text('Programme', 'Cycles', de), '', 'value'],
            energy: [namen.text('Energie', 'Energy', de), 'kWh', 'value.power.consumption'],
            // Rolle 'value' statt 'value.volume': Letztere steht im ioBroker-Katalog
            // fuer die Lautstaerke, nicht fuer eine Wassermenge - die Repository-
            // Pruefung quittierte das 49-mal mit E1008. Eine eigene Rolle fuer
            // Verbrauchsmengen gibt es nicht: 'value.water' ist ein Prozent-Fuellstand,
            // 'value.fill' beschreibt einen Fuellstand statt eines Verbrauchs. Die
            // Adapter mielecloudservice und clage-dsx nehmen fuer dieselbe Groesse
            // ebenfalls 'value' mit Einheit 'l'.
            water: [namen.text('Wasser', 'Water', de), 'l', 'value'],
            runtimeHours: [namen.text('Laufzeit', 'Runtime', de), 'h', 'value.interval'],
            avgEnergy: [namen.text('Energie je Programm', 'Energy per cycle', de), 'kWh', 'value.power.consumption'],
            avgWater: [namen.text('Wasser je Programm', 'Water per cycle', de), 'l', 'value'],
            prevCycles: [namen.text('Programme (Vorzeitraum)', 'Cycles (previous)', de), '', 'value'],
            prevEnergy: [
                namen.text('Energie (Vorzeitraum)', 'Energy (previous)', de),
                'kWh',
                'value.power.consumption',
            ],
            prevWater: [namen.text('Wasser (Vorzeitraum)', 'Water (previous)', de), 'l', 'value'],
            prevAvgEnergy: [
                namen.text('Energie je Programm (Vorzeitraum)', 'Energy per cycle (previous)', de),
                'kWh',
                'value.power.consumption',
            ],
            prevAvgWater: [
                namen.text('Wasser je Programm (Vorzeitraum)', 'Water per cycle (previous)', de),
                'l',
                'value',
            ],
        };
        await this.extendObjectAsync(`${deviceId}.stats`, {
            type: 'channel',
            common: { name: namen.text('Auswertung', 'Statistics', de) },
            native: {},
        });
        for (const zeitraum of ['week', 'month', 'year', 'total']) {
            await this.extendObjectAsync(`${deviceId}.stats.${zeitraum}`, {
                type: 'channel',
                common: { name: NAME[zeitraum] },
                native: {},
            });
            const felder =
                zeitraum === 'total'
                    ? ['cycles', 'energy', 'water', 'runtimeHours', 'avgEnergy', 'avgWater']
                    : Object.keys(FELD);
            for (const sub of felder) {
                const [name, einheit, rolle] = FELD[sub];
                await this.extendObjectAsync(`${deviceId}.stats.${zeitraum}.${sub}`, {
                    type: 'state',
                    common: {
                        name,
                        type: 'number',
                        role: rolle,
                        unit: einheit || undefined,
                        def: 0,
                        read: true,
                        write: false,
                    },
                    native: {},
                });
            }
            if (zeitraum !== 'total') {
                await this.extendObjectAsync(`${deviceId}.stats.${zeitraum}.programsJson`, {
                    type: 'state',
                    common: {
                        name: namen.text('Verbrauch je Programm (JSON)', 'Consumption per program (JSON)', de),
                        type: 'string',
                        role: 'json',
                        def: '[]',
                        read: true,
                        write: false,
                    },
                    native: {},
                });
                for (const [sub, name] of [
                    ['period', namen.text('Zeitraum', 'Period', de)],
                    ['prevPeriod', namen.text('Vorzeitraum', 'Previous period', de)],
                ]) {
                    await this.extendObjectAsync(`${deviceId}.stats.${zeitraum}.${sub}`, {
                        type: 'state',
                        common: { name, type: 'string', role: 'text', def: '', read: true, write: false },
                        native: {},
                    });
                }
            }
        }
        await this.extendObjectAsync(`${deviceId}.stats.programsJson`, {
            type: 'state',
            common: {
                name: namen.text('Verbrauch je Programm (JSON)', 'Consumption per program (JSON)', de),
                type: 'string',
                role: 'json',
                def: '[]',
                read: true,
                write: false,
            },
            native: {},
        });
        for (const [sub, name] of [
            ['monthsJson', namen.text('Monate einzeln (JSON)', 'Individual months (JSON)', de)],
            ['yearsJson', namen.text('Jahre einzeln (JSON)', 'Individual years (JSON)', de)],
        ]) {
            await this.extendObjectAsync(`${deviceId}.stats.${sub}`, {
                type: 'state',
                common: { name, type: 'string', role: 'json', def: '[]', read: true, write: false },
                native: {},
            });
        }
        this._statsCreated[deviceId] = true;
    }

    async ensureHistoryObjects(deviceId) {
        if (!this._histCreated) {
            this._histCreated = {};
        }
        if (this._histCreated[deviceId]) {
            return;
        }
        /*
         * Die Sammlung gleich mit anlegen.
         *
         * Sie haengt nicht am Eco-Abruf: Der findet nur waehrend eines laufenden Programms
         * statt, und bis dahin gaebe es die Eingabefelder nicht - wer Werte aus der Miele-App
         * nachtragen will, faende nichts vor. Die Historie entsteht dagegen beim Start.
         */
        await this.ensureSammlungObjects(deviceId);
        const de = this.config.germanNames !== false;
        await this.extendObjectAsync(`${deviceId}.history`, {
            type: 'channel',
            common: { name: namen.text('Verlauf', 'History', de) },
            native: {},
        });
        const defs = [
            [
                'cyclesJson',
                namen.text('Letzte Programme (JSON)', 'Recent cycles (JSON)', de),
                'string',
                'json',
                '',
                '[]',
            ],
            ['cycleCount', namen.text('Programme gesamt', 'Cycles total', de), 'number', 'value', '', 0],
            ['runtimeHours', namen.text('Laufzeit gesamt', 'Runtime total', de), 'number', 'value.interval', 'h', 0],
            [
                'energyTotal',
                namen.text('Energie gesamt', 'Energy total', de),
                'number',
                'value.power.consumption',
                'kWh',
                0,
            ],
            /*
             * Der GEMESSENE Verbrauch - aus der Messsteckdose, nicht aus dem Geraet.
             *
             * Getrennt von 'energyTotal' gefuehrt, weil beide Zahlen verschiedene Dinge sind:
             * energyTotal summiert, was das Geraet meldet - und das ist seine Erwartung fuer
             * das Programm, keine Messung (am 03.09.2026 belegt: 770 Wh gemeldet, 1158 Wh
             * gemessen). Wer beides in einen Topf wuerfe, bekaeme eine Summe, die nichts mehr
             * bedeutet.
             *
             * Bleibt leer, solange kein Zaehler konfiguriert ist.
             */
            [
                ids.HISTORY.measuredLast,
                namen.text('Gemessener Verbrauch (letztes Programm)', 'Measured consumption (last cycle)', de),
                'number',
                'value.power.consumption',
                'Wh',
                0,
            ],
            [
                ids.HISTORY.measuredTotal,
                namen.text('Gemessener Verbrauch gesamt', 'Measured consumption total', de),
                'number',
                'value.power.consumption',
                'kWh',
                0,
            ],
            ['waterTotal', namen.text('Wasser gesamt', 'Water total', de), 'number', 'value', 'l', 0],
            [
                'energyKwh',
                namen.text('Energie je Programm', 'Energy per cycle', de),
                'number',
                'value.power.consumption',
                'kWh',
                0,
            ],
            ['waterL', namen.text('Wasser je Programm', 'Water per cycle', de), 'number', 'value', 'l', 0],
            [
                'durationMin',
                namen.text('Dauer je Programm', 'Duration per cycle', de),
                'number',
                'value.interval',
                'min',
                0,
            ],
            // Startzeitpunkt des laufenden Programms - er ueberlebt einen Neustart des Adapters,
            // damit die Zyklusdauer danach nicht von vorn zaehlt (siehe trackCycle).
            [
                ids.HISTORY.runningSince,
                namen.text('Laufendes Programm seit', 'Current cycle started', de),
                'number',
                'date',
                '',
                0,
            ], // Beschreibung siehe BESCHREIBUNGEN
            // Der Zaehlerstand der Messsteckdose beim Programmstart - aus demselben Grund
            // dauerhaft: Ohne ihn kann am Programmende kein Verbrauch gebildet werden.
            [
                ids.HISTORY.meterAtStart,
                namen.text('Zaehlerstand bei Programmstart', 'Meter reading at cycle start', de),
                'number',
                'value.power.consumption',
                'Wh',
                0,
            ],
        ];
        for (const [sub, name, typ, rolle, einheit, def] of defs) {
            const hDesc = namen.beschreibung(`history.${sub}`, de); // Schluessel = tatsaechliche ID
            await this.extendObjectAsync(`${deviceId}.history.${sub}`, {
                type: 'state',
                common: Object.assign(
                    { name, type: typ, role: rolle, unit: einheit || undefined, def, read: true, write: false },
                    hDesc ? { desc: hDesc } : {},
                ),
                native: {},
            });
        }
        /*
         * Den Namen der Betriebsstunden auch dann nachziehen, wenn das Geraet gerade keine meldet.
         *
         * Der Datenpunkt wird sonst nur beim Lesen der Stunden erweitert. Ein vorhandener behielt
         * so seinen alten, nur zweisprachigen Namen, bis das Geraet wieder lief - die Objektpruefung
         * des PR #6471 fand das am 11.09.2026 an der ausgeschalteten Spuelmaschine.
         */
        if (await this.getObjectAsync(`${deviceId}.info.operatingHours`)) {
            await this.extendObjectAsync(`${deviceId}.info.operatingHours`, {
                common: { name: namen.text('Betriebsstunden gesamt', 'Total operating hours', de) },
            });
        }
        this._histCreated[deviceId] = true;
    }

    schedulePoll(immediate = false) {
        if (this.pollTimer) {
            this.clearTimeout(this.pollTimer);
        }
        const anyActive = Object.values(this.devices).some(d => d.active);
        const interval = anyActive
            ? MieleLocal.intervallMs(this.config.activePollInterval, 5, 1)
            : MieleLocal.intervallMs(this.config.pollInterval, 15, 1);
        const run = async () => {
            if (this.stopping) {
                return;
            }
            await this.pollAll();
            this.schedulePoll(false);
        };
        const nextDelayMs = immediate ? 100 : interval;
        // Nach einem Schreibbefehl kurz pausieren (Gerät bearbeitet nur eine Anfrage,
        // und der neue Zustand steht erst nach kurzer Zeit im /State).
        const effective = Math.max(nextDelayMs, (this.pausePollUntil || 0) - Date.now());
        this.pollTimer = this.setTimeout(run, effective);
    }

    /**
     * Wie oft ein Gerät den Eco-Leaf verneinen muss, bevor der Adapter aufhört zu fragen.
     *
     * Vorher fragte er unbeirrt weiter: an einem Vormittag 651 Absagen vom Backofen (HTTP 404)
     * und 651 von der Spülmaschine (HTTP 500) - für Werte, die diese Modelle gar nicht führen.
     * Jede Anfrage belegt das XKM-Modul, das ohnehin nur eine gleichzeitig beantwortet.
     *
     * Mehrfach und nicht sofort, weil ein einzelner Fehlschlag auch am Zeitpunkt liegen kann.
     */
    static get ECO_ABSAGEN_MAX() {
        return 3;
    }

    /**
     * Siehe lib/eco.js - die Regel steht dort, damit sie ohne Adapter pruefbar ist.
     *
     * @param deviceId
     * @param dev
     */
    ecoAbfragenSinnvoll(deviceId, dev) {
        if (!this._ecoErkundet) {
            this._ecoErkundet = {};
        }
        return ecoRegel.abfragenSinnvoll(this._ecoErkundet[deviceId], dev);
    }

    /**
     * Sagt das Gerät "diesen Datenpunkt gibt es hier nicht"?
     *
     * Nur 404 (Leaf unbekannt) und 501 (nicht unterstützt) sind eine Aussage über das Modell.
     * 500 dagegen heißt "beim Lesen ist etwas schiefgegangen" - die Spülmaschine liefert das
     * im Aus-Zustand, im laufenden Betrieb kann derselbe Leaf antworten. Und Zeitüberschreitungen
     * oder Verbindungsfehler sagen über die Fähigkeiten des Geräts gar nichts.
     *
     * @param status
     */
    static kenntLeafNicht(status) {
        return status === 404 || status === 501;
    }

    /** EcoFeedback (Energie/Wasser) aus DOP2-Leaf 2/6195 lesen – nur wo verfügbar. */
    /**
     * Den Schlussstand direkt nach dem Programmende abholen.
     *
     * Der regulaere Eco-Takt reicht dafuer nicht. Er laeuft in ecoInterval-Abstaenden - hier
     * 600 Sekunden -, der Nachlauf dauert zehn Minuten: In das Fenster faellt hoechstens eine
     * Abfrage, und die kommt oft zu spaet. Die Maschine schaltet nach dem Programm ab, und ein
     * schlafendes Geraet beantwortet das Leaf gar nicht mehr (HTTP 500). Der Schlusswert war
     * damit regelmaessig nicht zu holen: Beim Waschgang vom 29.08.2026 stammte der letzte
     * Feldsatz von 09:15, das Programm endete um 09:20 - der Endstand wurde nie gelesen, und
     * in der Historie stand weiter das Ergebnis des Vorlaufs.
     *
     * Deshalb hier ein eigener, kurzer Takt, ausgeloest vom Statuswechsel selbst. Drei
     * Versuche in den ersten zwei Minuten, solange das Geraet sicher noch wach ist. Das sind
     * drei zusaetzliche Anfragen je Waschgang - die Stelle, an der sie den Unterschied machen.
     */
    /**
     * Engmaschig ablesen, solange die Restzeit zur Neige geht.
     *
     * WARUM DER REGULAERE TAKT NICHT REICHT. Er steht auf zehn Minuten. Bei einem langen
     * Programm faellt das nicht auf; bei einem kurzen entscheidet es ueber den Endwert. Am
     * 10.09.2026 an der WCR860 belegt: "Seide" lief von 17:10 bis 17:45, abgelesen wurde um
     * 17:16, 17:26 und 17:36. Die letzte Ablesung lag neun Minuten vor Schluss und stand bei
     * 20,77 l - gebraucht hatte das Programm 31 l. Um 17:46 war der Zaehler schon zurueck
     * auf 0.
     *
     * WARUM NICHT ecoSchlussstandHolen. Der greift erst nach dem Statuswechsel und ist damit
     * immer zu spaet: Zu diesem Zeitpunkt steht im Leaf die Null. Er bleibt als zweites Netz
     * fuer Geraete, die ihre Zaehler laenger halten - den Endwert holt aber nur dieser Takt.
     *
     * Er endet von selbst, sobald das Programm nicht mehr laeuft.
     */
    /**
     * Ein eingestelltes Intervall in Millisekunden - und niemals ausserhalb dessen, was
     * setTimeout/setInterval verkraften.
     *
     * WARUM DAS NOETIG IST. Node behandelt Verzoegerungen ueber 2.147.483.647 ms (rund 24,8
     * Tage) nicht etwa als "sehr lang", sondern laesst den Timer SOFORT feuern - aus einer
     * Einstellung, die "selten" heissen sollte, wird eine Dauerschleife. Die Eingabefelder im
     * Admin begrenzen die Werte zwar, aber diese Grenze ist nur die Oberflaeche: Wer die
     * Instanzeinstellungen ueber die Objektverwaltung oder die API schreibt, geht daran vorbei.
     * Eine Grenze, die nur in der Maske steht, ist keine.
     *
     * Nach unten gilt dasselbe in klein: Eine 0 aus einer halb ausgefuellten Konfiguration
     * wuerde den Adapter das Geraet in Endlosschleife fragen lassen.
     *
     * @param {number}  wert      Wert aus der Konfiguration, in Sekunden (oder [einheitMs])
     * @param {number}  vorgabe   Ersatz, wenn nichts Brauchbares eingestellt ist
     * @param {number}  minSek    Untergrenze in Sekunden
     * @param {number}  [einheitMs]  Umrechnung der Einheit, z. B. 60000 fuer Minuten
     */
    static intervallMs(wert, vorgabe, minSek, einheitMs = 1000) {
        const zahl = Number(wert);
        const sek = Number.isFinite(zahl) && zahl > 0 ? zahl : vorgabe;
        const begrenzt = Math.max(minSek, sek);
        return Math.min(begrenzt * einheitMs, TIMER_MAX_MS);
    }

    async ecoEndspurtPruefen(deviceId, statusVal) {
        const dev = this.devices && this.devices[deviceId];
        if (!dev) {
            return;
        }
        const rest = await this.getStateAsync(`${deviceId}.state.remainingMinutes`);
        const restMin = rest && typeof rest.val === 'number' ? rest.val : null;
        const soll = ecoRegel.imEndspurt(statusVal, restMin);

        if (soll && !dev.ecoEndspurtTimer) {
            this.log.debug(
                `Eco ${deviceId}: Endspurt - noch ${restMin} min, ` +
                    `Ablesung jetzt alle ${ecoRegel.ENDSPURT_TAKT_MS / 1000} s`,
            );
            dev.ecoEndspurtTimer = this.setInterval(() => {
                this.pollEco().catch(e =>
                    this.log.debug(`Eco ${deviceId}: Endspurt-Ablesung fehlgeschlagen - ${e.message}`),
                );
            }, ecoRegel.ENDSPURT_TAKT_MS);
        } else if (!soll && dev.ecoEndspurtTimer) {
            this.clearInterval(dev.ecoEndspurtTimer);
            dev.ecoEndspurtTimer = null;
            this.log.debug(`Eco ${deviceId}: Endspurt beendet`);
        }
    }

    ecoSchlussstandHolen(deviceId) {
        const dev = this.devices && this.devices[deviceId];
        if (!dev || dev.ecoSchlussLaeuft) {
            return;
        }
        dev.ecoSchlussLaeuft = true;
        const abstaende = [15000, 45000, 120000];
        abstaende.forEach((ms, i) => {
            this.setTimeout(() => {
                // Hat der Nachlauf inzwischen einen stabilen Wert gesehen, ist nichts mehr zu holen.
                if (!dev.ecoNachlaufBis) {
                    return;
                }
                this.log.debug(`Eco ${deviceId}: Schlussstand-Versuch ${i + 1} von ${abstaende.length}`);
                this.pollEco().catch(e => this.log.debug(`Eco ${deviceId}: Versuch fehlgeschlagen - ${e.message}`));
                if (i === abstaende.length - 1) {
                    dev.ecoSchlussLaeuft = false;
                }
            }, ms);
        });
    }

    /**
     * Das EcoFeedback des Geraets holen - falls es eines fuehrt.
     *
     * DREI ABSAGEN, DANN RUHE. Dieselbe Regel wie beim Eco-Leaf: Ein 404 heisst "dieses Modell
     * kennt den Leaf nicht", und das aendert sich nicht mehr. Der Zaehler lebt nur im
     * Arbeitsspeicher - nach einem Neustart wird erneut geprueft, falls inzwischen eine neue
     * Firmware auf dem Modul liegt.
     *
     * Die Felder selbst landen als Datenpunkte unter "detail.ecoFeedback" - dafuer ist hier
     * nichts zu tun, das erledigt geraeteWerteSchreiben aus demselben Abruf.
     *
     * @param deviceId
     * @param dev
     * @returns {{energieWh: number|null, wasserL: number|null}|null} null = kein EcoFeedback
     */
    async ecoKontextLesen(deviceId, dev) {
        if (!this._kontextAbsagen) {
            this._kontextAbsagen = {};
        }
        if ((this._kontextAbsagen[deviceId] || 0) >= MieleLocal.ECO_ABSAGEN_MAX) {
            return null;
        }
        let fields;
        try {
            const res = await dev.api.readDop2(dev.route, ECO_KONTEXT_LEAF.unit, ECO_KONTEXT_LEAF.attr);
            if (res.status !== 200 || !res.headers['x-signature']) {
                if (MieleLocal.kenntLeafNicht(res.status)) {
                    this._kontextAbsagen[deviceId] = (this._kontextAbsagen[deviceId] || 0) + 1;
                    if (this._kontextAbsagen[deviceId] >= MieleLocal.ECO_ABSAGEN_MAX) {
                        this.log.debug(
                            `Eco ${deviceId}: Dieses Modell fuehrt kein eigenes ` +
                                'EcoFeedback (2/1585), der Durchflusszaehler bleibt die Quelle.',
                        );
                    }
                }
                return null;
            }
            ({ fields } = dop2.parseLeaf(this.mc.decryptResponse(res.headers['x-signature'], res.body)));
        } catch (e) {
            this.log.debug(`Eco ${deviceId}: 2/1585 - ${e.message}`);
            return null;
        }
        this._kontextAbsagen[deviceId] = 0;
        const leaf = `${ECO_KONTEXT_LEAF.unit}/${ECO_KONTEXT_LEAF.attr}`;
        await this.geraeteWerteSchreiben(deviceId, leaf, fields);

        let werte;
        try {
            werte = datenpunkte.istwerte(leaf, fields);
        } catch {
            return null;
        }
        const hole = pfad => {
            const w = werte.find(x => x.pfad === pfad);
            return w && typeof w.wert === 'number' ? w.wert : null;
        };
        const energieWh = hole(ECO_KONTEXT_ENERGIE);
        const wasserL = hole(ECO_KONTEXT_WASSER);
        if (energieWh == null && wasserL == null) {
            return null;
        }
        return { energieWh, wasserL };
    }

    async pollEco() {
        if (!this._ecoAbsagen) {
            this._ecoAbsagen = {};
        }
        for (const [deviceId, dev] of Object.entries(this.devices)) {
            // Geräte ohne Eco-Leaf nicht endlos fragen. Der Zähler lebt nur im Arbeitsspeicher:
            // nach einem Neustart wird erneut geprüft, falls ein Gerät inzwischen mehr kann.
            if ((this._ecoAbsagen[deviceId] || 0) >= MieleLocal.ECO_ABSAGEN_MAX) {
                continue;
            }
            // Schlafende Geraete nicht behelligen - siehe ecoAbfragenSinnvoll.
            if (!this.ecoAbfragenSinnvoll(deviceId, dev)) {
                continue;
            }
            this._ecoErkundet[deviceId] = true;
            // Ein 500er sagt nichts über das Modell aus - die Spülmaschine antwortet so im
            // Aus-Zustand. Solche Geräte werden weiter gefragt, nur eben seltener.
            if (this._ecoSelten && this._ecoSelten[deviceId] && Date.now() < this._ecoSelten[deviceId]) {
                continue;
            }
            let plain;
            try {
                const res = await dev.api.readDop2(dev.route, ECO_LEAF.unit, ECO_LEAF.attr);
                if (res.status !== 200 || !res.headers['x-signature']) {
                    // Nur eine echte Absage des Geräts zählt mit; ein Lesefehler bleibt ein
                    // Lesefehler und darf die Abfrage nicht dauerhaft beenden.
                    let schluss = '';
                    if (MieleLocal.kenntLeafNicht(res.status)) {
                        this._ecoAbsagen[deviceId] = (this._ecoAbsagen[deviceId] || 0) + 1;
                        if (this._ecoAbsagen[deviceId] >= MieleLocal.ECO_ABSAGEN_MAX) {
                            schluss = ' - dieses Modell führt kein EcoFeedback, wird nicht mehr abgefragt';
                            await this.removeEcoObjects(deviceId);
                        }
                    }
                    // Ohne diese Meldung bricht die Eco-Abfrage lautlos ab, und man sucht die
                    // Ursache im Adapter statt beim Gerät. Nicht jedes Modell hat den Leaf.
                    if (!MieleLocal.kenntLeafNicht(res.status)) {
                        // Nicht ganz aufgeben, aber die nächsten fünf Minuten in Ruhe lassen.
                        if (!this._ecoSelten) {
                            this._ecoSelten = {};
                        }
                        this._ecoSelten[deviceId] = Date.now() + 5 * 60 * 1000;
                    }
                    this.log.debug(`Eco ${deviceId}: no eco leaf (HTTP ${res.status})${schluss}`);
                    continue;
                }
                plain = this.mc.decryptResponse(res.headers['x-signature'], res.body);
            } catch (e) {
                this.log.debug(`Eco ${deviceId}: ${e.message}`);
                continue;
            }
            let fields;
            try {
                ({ fields } = dop2.parseLeaf(plain));
            } catch (e) {
                this.log.debug(`Eco ${deviceId}: parse error ${e.message}`);
                continue;
            }
            // Auch die uebrigen Felder dieses Leaf sind Messwerte - sie kosten keinen weiteren
            // Abruf, weil der Leaf ohnehin gerade gelesen wurde.
            await this.geraeteWerteSchreiben(deviceId, `${ECO_LEAF.unit}/${ECO_LEAF.attr}`, fields);
            // Antwortet das Gerät wieder, zählt die Absagenreihe von vorn.
            this._ecoAbsagen[deviceId] = 0;
            if (this._ecoSelten) {
                delete this._ecoSelten[deviceId];
            }
            // Indizes und Teiler lassen sich je Anlage überschreiben - bei einem anderen
            // Modell sitzen die Felder woanders, und niemand soll dafür den Adapter ändern
            // müssen.
            const eco = dop2.ecoValues(
                fields,
                this.config.ecoEnergyIdx || ECO_ENERGY_IDX,
                this.config.ecoWaterIdx || ECO_WATER_IDX,
                Number(this.config.ecoWaterDiv) > 0 ? Number(this.config.ecoWaterDiv) : ECO_WATER_DIV,
            );
            /*
             * Was das Geraet selbst als EcoFeedback fuehrt, hat Vorrang.
             *
             * DER FALLBACK IST DER DURCHFLUSSZAEHLER, nicht umgekehrt. Sagt das Geraet, wie viel
             * Wasser das letzte Programm gebraucht hat, gilt seine Zahl; schweigt es, bleibt es
             * bei Feld 21 des Eco-Leaf geteilt durch 200 - der Impulszaehlung, die an 24 Laeufen
             * gegen den Hauswasserzaehler steht (Median 200,10 Impulse je Liter, Streuung 1,4 %).
             *
             * HOECHSTENS EINMAL JE MINUTE. Das Modul bedient nur eine Verbindung; wer den
             * Eco-Takt auf zehn Sekunden stellt, soll damit nicht auch diesen Abruf versechsfachen.
             */
            if (!this._kontextZuletzt) {
                this._kontextZuletzt = {};
            }
            if (Date.now() - (this._kontextZuletzt[deviceId] || 0) >= 60000) {
                this._kontextZuletzt[deviceId] = Date.now();
                const amtlich = await this.ecoKontextLesen(deviceId, dev);
                if (amtlich) {
                    if (amtlich.wasserL != null) {
                        eco.waterL = amtlich.wasserL;
                        dev.ecoAmtlich = true;
                    }
                    if (amtlich.energieWh != null) {
                        eco.energyWh = amtlich.energieWh;
                        eco.energyKwh = Math.round(amtlich.energieWh) / 1000;
                        dev.ecoAmtlich = true;
                    }
                }
            }
            if (eco.energyWh == null && eco.waterL == null) {
                continue;
            }

            await this.ensureEcoObjects(deviceId);
            await this.ensureSammlungObjects(deviceId);
            /*
             * Der Inhalt eines Datenpunkts ist ein Text, kein Sprachobjekt.
             *
             * namen.text() liefert bei deutscher Einstellung ein i18n-Objekt - richtig fuer
             * common.name, falsch fuer einen Wert: Im Datenpunkt staende dann "[object Object]".
             * Deshalb hier eine schlichte Fallunterscheidung.
             */
            const deutsch = this.config.germanNames !== false;
            await this.setStateChangedAsync(`${deviceId}.eco.quelle`, {
                val: dev.ecoAmtlich
                    ? deutsch
                        ? 'Gerät (EcoFeedback)'
                        : 'Appliance (EcoFeedback)'
                    : deutsch
                      ? 'Adapter (Durchflusszähler)'
                      : 'Adapter (flow meter)',
                ack: true,
            });

            /*
             * Hat das Geraet seine Zaehler schon zurueckgesetzt?
             *
             * "Laeuft" aus zwei Quellen: dev.ecoLaeuft wird erst gesetzt, wenn der Status
             * einmal gepollt wurde - nach einem Neustart oder einer Konfigurationsaenderung
             * steht dort zunaechst nichts. Die Festhalte-Regel griff dann faelschlich und liess
             * einen veralteten Wert stehen, obwohl das Geraet mitten im Programm war. Der
             * Statuscode aus dem Datenpunkt ist unabhaengig davon vorhanden (5 = in Betrieb,
             * 6 = Pause).
             *
             * Steht das Geraet und meldet das Wasserfeld 0, dann ist der Zaehler zurueckgesetzt
             * und diese Ablesung traegt den Verbrauch des Laufs nicht mehr.
             */
            const st = await this.getStateAsync(`${deviceId}.state.status`);
            const laeuftLautStatus = !!(st && (st.val === 5 || st.val === 6));
            const laeuft = !!(dev && dev.ecoLaeuft) || laeuftLautStatus;
            const zurueckgesetzt = !laeuft && eco.waterL === 0;
            /*
             * Rohfelder mitschreiben - freiwillig, standardmäßig aus.
             *
             * Warum es das gibt: Die Feldindizes des Eco-Leaf unterscheiden sich je Baureihe.
             * Bei der WCR860 stehen Energie auf 25 und Wasser auf 40; ob das bei anderen
             * Modellen ebenso ist, weiß niemand, der das Gerät nicht hat. Diese Waschmaschine
             * meldete über drei völlig verschiedene Programme hinweg denselben Wasserwert -
             * 95,3 l bei Seide (36 min), Pflegeleicht (162 min) und Baumwolle (214 min). Ein
             * Programmverbrauch ist das nicht; entweder steht in Feld 40 etwas anderes, oder
             * das Gerät schreibt es nicht fort.
             *
             * Nachsehen lässt sich das nur im laufenden Programm - im Standby beantwortet das
             * Gerät den Leaf gar nicht (HTTP 500). Mit dieser Option schreibt der Adapter bei
             * jedem Abruf alle Felder mit; nach einem Programmlauf ist ablesbar, welches Feld
             * mitsteigt und danach stehen bleibt.
             *
             * Datenschutz: Die Zahlen bleiben in der eigenen ioBroker-Instanz. Der Adapter
             * versendet nichts und wertet nichts aus. Wer sie teilen möchte, kopiert den
             * Datenpunkt selbst - deshalb ist die Option abschaltbar und aus, solange niemand
             * sie einschaltet.
             */
            if (this.config.ecoRawFields) {
                /*
                 * Dieselbe Halteregel wie fuer eco.water - und aus demselben Grund.
                 *
                 * Am 08.09.2026 an 25 gesammelten Zyklen der WCR860 nachgezaehlt: In vier davon
                 * stand das Wasser-Rohfeld auf 0, waehrend die Cloud fuer denselben Lauf 17 bis
                 * 31 Liter meldete. Es waren nicht alle Felder leer - die Beschreibungsfelder
                 * standen weiter da, nur die Verbrauchsfelder waren zurueckgesetzt. Der Abruf
                 * hatte das Programmende getroffen.
                 *
                 * eco.water war dagegen geschuetzt und stand richtig. Die Sammlung liest aber
                 * eco.felderJson, nicht eco.water - und bekam so vier Datensaetze der Form
                 * "Rohwert 0 gegen 31 Liter". Das sind achtzehn Prozent der eigenen Daten, und
                 * sie sind nicht nur wertlos, sondern schaedlich: Feld 60 der WCR860 ist genau
                 * in diesen vier Zyklen ungleich null und sah dadurch wie ein perfekter
                 * Energiezaehler aus (drei Zyklen, 0,0 Prozent). Es ist keiner.
                 */
                const vorherige = await this.getStateAsync(`${deviceId}.eco.felderJson`);
                const hatteWerte = !!(
                    vorherige &&
                    typeof vorherige.val === 'string' &&
                    vorherige.val.length > 2 &&
                    vorherige.val !== '{}'
                );
                if (zurueckgesetzt && hatteWerte) {
                    this.log.debug(
                        `Eco ${deviceId}: Rohfelder zurueckgesetzt, ` + 'die des letzten Programms bleiben stehen',
                    );
                } else {
                    const alleFelder = {};
                    for (const idx of Object.keys(fields)) {
                        const v = dop2.interpValue(fields, Number(idx));
                        if (v != null) {
                            alleFelder[idx] = Number(v);
                        }
                    }
                    await this.setStateAsync(`${deviceId}.eco.felderJson`, {
                        val: JSON.stringify(alleFelder),
                        ack: true,
                    });
                }
            }
            if (eco.energyWh != null) {
                await this.setStateAsync(`${deviceId}.eco.energyWh`, { val: eco.energyWh, ack: true });
                await this.setStateAsync(`${deviceId}.eco.energy`, { val: eco.energyKwh, ack: true });
            }
            /*
             * Den Wasserwert festhalten, wenn das Programm endet.
             *
             * Feld 4 traegt den Verbrauch des LAUFENDEN Programms und faellt beim Programmende
             * schlagartig auf 0 zurueck. Wer den Wert einfach durchschreibt, hat am Ende jedes
             * Waschgangs eine Null stehen - genau dann, wenn man wissen will, wie viel er
             * gebraucht hat. Am 28.08.2026 beobachtet: 17 l waehrend des Spuelens, 0 l zwei
             * Minuten spaeter.
             *
             * Deshalb wird eine Null nur uebernommen, wenn das Geraet auch wirklich laeuft.
             * Steht es, bleibt der letzte Wert groesser null stehen, bis das naechste Programm
             * beginnt und selbst hochzaehlt. Der Datenpunkt bedeutet damit: "Verbrauch des
             * laufenden oder zuletzt beendeten Programms" - dieselbe Lesart wie beim
             * Cloud-Adapter.
             */
            if (eco.waterL != null) {
                const bisher = await this.getStateAsync(`${deviceId}.eco.water`);
                const alterWert = bisher && typeof bisher.val === 'number' ? bisher.val : 0;
                const behalten = zurueckgesetzt && alterWert > 0;
                if (!behalten) {
                    /*
                     * Mitschreiben, WANN zuletzt ein echter Wert kam und was davor stand.
                     *
                     * Beides braucht der Zyklusabschluss, um zu erkennen, ob die letzte
                     * Ablesung der Endstand war oder ein Zwischenstand - siehe
                     * ecoRegel.ablesungBewerten. Nur hier, im Zweig ohne Halteregel: Ein
                     * gehaltener Wert ist keine neue Ablesung, und ihn mitzuzaehlen wuerde
                     * genau das verschleiern, worum es geht.
                     */
                    if (eco.waterL > 0) {
                        dev.ecoWasserVorletzter =
                            typeof dev.ecoWasserLetzter === 'number' ? dev.ecoWasserLetzter : null;
                        dev.ecoWasserLetzter = eco.waterL;
                        dev.ecoWasserZuletztMs = Date.now();
                    }
                    await this.setStateAsync(`${deviceId}.eco.water`, { val: eco.waterL, ack: true });
                } else {
                    this.log.debug(
                        `Eco ${deviceId}: Wasserfeld auf 0 zurueckgesetzt, ` +
                            `${alterWert} l des letzten Programms bleiben stehen`,
                    );
                }
            }

            // Im Nachlauf: Aendert sich nichts mehr, steht der Schlussstand fest.
            const vorher = dev.ecoNachlaufBis;
            Object.assign(dev, ecoRegel.nachlaufFortschreiben(dev, `${eco.energyWh}/${eco.waterL}`));
            if (vorher && !dev.ecoNachlaufBis) {
                this.log.debug(`Eco ${deviceId}: Schlussstand steht (${dev.ecoLetzter}), Nachlauf beendet`);
            }
        }
    }

    /**
     * Eco-Datenpunkte eines Geräts entfernen, das den Leaf nachweislich nicht kennt.
     *
     * Sie entstehen sonst einmalig und bleiben für immer auf 0 stehen - in der Anzeige nicht von
     * einem gemessenen "nichts verbraucht" zu unterscheiden. Entfernt wird nur, was der Adapter
     * selbst angelegt hat und was leer geblieben ist: hat ein Gerät je einen Wert geliefert,
     * bleiben die Punkte samt Historie erhalten.
     *
     * @param deviceId
     */
    async removeEcoObjects(deviceId) {
        if (!this._ecoRemoved) {
            this._ecoRemoved = {};
        }
        if (this._ecoRemoved[deviceId] || (this._ecoCreated && this._ecoCreated[deviceId])) {
            return;
        }
        this._ecoRemoved[deviceId] = true;
        for (const sub of ['energy', 'energyWh', 'water']) {
            const id = `${deviceId}.eco.${sub}`;
            try {
                const obj = await this.getObjectAsync(id);
                if (!obj) {
                    continue;
                }
                const state = await this.getStateAsync(id);
                // Ein Wert ungleich 0 heißt: das Gerät konnte es doch einmal. Dann nichts löschen.
                if (state && state.val) {
                    this.log.debug(`Eco ${deviceId}: ${sub} hat Werte, bleibt erhalten`);
                    continue;
                }
                await this.delObjectAsync(id);
                this.log.debug(`Eco ${deviceId}: leeren Datenpunkt ${sub} entfernt`);
            } catch (e) {
                this.log.debug(`Eco ${deviceId}: ${sub} nicht entfernt (${e.message})`);
            }
        }
        try {
            const rest = await this.getAdapterObjectsAsync();
            const kinder = Object.keys(rest).filter(id => id.includes(`${deviceId}.eco.`));
            if (!kinder.length) {
                await this.delObjectAsync(`${deviceId}.eco`);
            }
        } catch (e) {
            this.log.debug(`Eco ${deviceId}: Kanal nicht entfernt (${e.message})`);
        }
    }

    /**
     * Die Datenpunkte der Sammlung anlegen - nur, wenn sie eingeschaltet ist.
     *
     * Zwei davon sind beschreibbar: Wer keine Cloud angebunden hat, traegt Energie und Wasser
     * nach jedem Programm von Hand aus der Miele-App ein. Der Adapter uebernimmt sie in den
     * zuletzt aufgenommenen Datensatz, sobald sie gesetzt werden.
     */
    /**
     * Die Datenpunkte der Datensammlung anlegen.
     *
     * WARUM BEDINGT. Der Kanal bringt vierzehn Datenpunkte je Geraet mit, die ausschliesslich
     * der Feldsuche dienen. Wer den Adapter nur benutzt, um seine Waschmaschine zu sehen, hatte
     * sie bisher trotzdem im Objektbaum stehen - bei drei Geraeten 42 Objekte, die nichts
     * erklaeren. Seit 0.3.37 entstehen sie nur noch, wenn sie jemand braucht.
     *
     * WARUM ZWEI SCHALTER. Die Leaf-Suche haengt an `leafScanAuto` und laesst sich unabhaengig
     * von der Datensammlung einschalten. Stuende hier nur `sammlerAktiv`, liefe sie ins Leere:
     * Sie schreibt nach `sammlung.leafScan*`, und ein setState auf ein nicht vorhandenes Objekt
     * verpufft mit einer Warnung im Protokoll, die niemand liest.
     *
     * @param {string} deviceId
     * @param {boolean} [erzwingen] Von den Diagnosefunktionen selbst gesetzt: Sie schreiben in
     *   den Kanal und muessen ihn deshalb mitbringen duerfen, auch wenn beide Schalter aus sind
     *   (etwa beim von Hand gedrueckten Scan).
     */
    async ensureSammlungObjects(deviceId, erzwingen) {
        if (!erzwingen && !this.config.sammlerAktiv && !this.config.leafScanAuto) {
            return;
        }
        if (!this._sammlungCreated) {
            this._sammlungCreated = {};
        }
        if (this._sammlungCreated[deviceId]) {
            return;
        }
        const de = this.config.germanNames !== false;

        const kanalDesc = namen.beschreibung(ids.KANAL.collection, de);
        await this.extendObjectAsync(ids.kanal(deviceId), {
            type: 'channel',
            common: Object.assign(
                {
                    name: namen.text('Datensammlung (Feldzuordnung)', 'Data collection (field mapping)', de),
                },
                kanalDesc ? { desc: kanalDesc } : {},
            ),
            native: {},
        });
        const felder = [
            [
                ids.SAMMLUNG.records,
                'Gesammelte Datensaetze (JSON)',
                'Collected records (JSON)',
                'string',
                'json',
                '',
                false,
            ],
            [ids.SAMMLUNG.cycles, 'Anzahl gesammelter Zyklen', 'Collected cycles', 'number', 'value', '', false],
            [ids.SAMMLUNG.progress, 'Was noch fehlt', 'What is still missing', 'string', 'text', '', false],
            // Das Ergebnis der Auswertung im Klartext - siehe lib/feldsuche.js. Der einzige
            // Datenpunkt hier, den man wirklich lesen muss: Er sagt, ob die eingestellte
            // Feldzuordnung zu den Vergleichswerten passt.
            [
                ids.SAMMLUNG.finding,
                'Welches Feld passt (Auswertung)',
                'Which field matches (analysis)',
                'string',
                'text',
                '',
                false,
            ],
            // Die laufende Kontrolle der eingestellten Zuordnung - siehe lib/kontrolle.js.
            [
                ids.SAMMLUNG.check,
                'Stimmt die eingestellte Zuordnung noch?',
                'Is the configured mapping still correct?',
                'string',
                'text',
                '',
                false,
            ],
            [
                ids.SAMMLUNG.checkJson,
                'Vergleiche im Verlauf (JSON)',
                'Comparisons over time (JSON)',
                'string',
                'json',
                '',
                false,
            ],
            /*
             * Der Leaf-Scan - siehe lib/leafscan.js.
             *
             * ROLLE "switch", NICHT "button". Ein Knopf loest aus und faellt zurueck; dieser
             * Schalter BLEIBT stehen, solange die Suche laeuft, und der Dauerlauf fragt ihn bei
             * jedem Durchgang ab (leafScanDauerlauf). Umlegen heisst also "suchen, bis fertig",
             * nicht "einen Durchgang ausloesen".
             *
             * Die Objektpruefung des Aufnahmeantrags hat das am 19.09.2026 aufgedeckt: Ein
             * "button" darf nicht lesbar sein (E1010), und genau lesbar muss dieser Punkt sein -
             * sonst wuesste der Dauerlauf nicht, ob er weitermachen soll. Die Rolle war falsch,
             * nicht das Leserecht.
             */
            [
                ids.SAMMLUNG.scan,
                'Leafs durchsuchen (laeuft bis fertig)',
                'Scan leaves (until done)',
                'boolean',
                'switch',
                '',
                true,
            ],
            [ids.SAMMLUNG.scanState, 'Wie weit ist die Suche?', 'Scan progress', 'string', 'text', '', false],
            [
                ids.SAMMLUNG.trendJson,
                'Werteverlauf der gefundenen Leafs (JSON)',
                'Value history of found leaves (JSON)',
                'string',
                'json',
                '',
                false,
            ],
            [ids.SAMMLUNG.trendSize, 'Umfang des Verlaufs', 'History size', 'string', 'text', '', false],
            // Die Feinaufzeichnung - siehe leafVerlaufFeinRunde. Eintragen, was genau
            // beobachtet werden soll ("2/6192"); leer schaltet sie ab.
            [
                ids.SAMMLUNG.trendLeaf,
                'Ein Leaf engmaschig mitschreiben (z. B. 2/6192)',
                'Record one leaf closely (e.g. 2/6192)',
                'string',
                'text',
                '',
                true,
            ],
            [
                ids.SAMMLUNG.scanJson,
                'Gefundene Leafs mit Feldern (JSON)',
                'Found leaves with fields (JSON)',
                'string',
                'json',
                '',
                false,
            ],
            /*
             * Rolle "level", nicht value.*: Beide Felder sind EINGABEN des Nutzers und damit
             * beschreibbar. value.* verlangt write = false - die Objektpruefung des PR #6471
             * meldete das am 11.09.2026 als E1011, und "value.volume" gibt es im Rollenkatalog
             * gar nicht (E1008, am 24.08.2026 schon einmal an anderer Stelle entfernt).
             */
            [
                ids.SAMMLUNG.inputEnergy,
                'Energie aus der Miele-App (kWh)',
                'Energy from the Miele app (kWh)',
                'number',
                'level',
                'kWh',
                true,
            ],
            [
                ids.SAMMLUNG.inputWater,
                'Wasser aus der Miele-App (l)',
                'Water from the Miele app (l)',
                'number',
                'level',
                'l',
                true,
            ],
        ];
        for (const [k, nameDe, nameEn, typ, rolle, einheit, schreibbar] of felder) {
            // extendObject, nicht setObjectNotExists: Sonst erreicht eine korrigierte Rolle oder ein
            // uebersetzter Name nie eine Installation, auf der der Datenpunkt schon existiert.
            const common = {
                name: namen.text(nameDe, nameEn, de),
                type: typ,
                role: rolle,
                unit: einheit || undefined,
                read: true,
                write: schreibbar,
            };
            // Erklaerung im Objektbrowser. Ohne sie ist "Was noch fehlt" nicht zu deuten,
            // und bei leafVerlaufFein weiss niemand, was er eintragen soll.
            const desc = namen.beschreibung(`${ids.KANAL.collection}.${k}`, de);
            if (desc) {
                common.desc = desc;
            }
            await this.extendObjectAsync(`${ids.kanal(deviceId)}.${k}`, {
                type: 'state',
                common,
                native: {},
            });
        }
        // Die beiden Eingabefelder beobachten - sie sind der einzige Weg fuer alle, die keine
        // Cloud angebunden haben.
        this.subscribeStates(ids.s(deviceId, 'inputEnergy'));
        this.subscribeStates(ids.s(deviceId, 'inputWater'));
        // Ohne dieses Abonnement bleibt der Schalter wirkungslos: Er laesst sich druecken,
        // der Adapter erfaehrt es nur nie.
        this.subscribeStates(ids.s(deviceId, 'scan'));
        // Ohne dieses Abonnement bliebe die Feinaufzeichnung ein Feld, das niemand liest.
        this.subscribeStates(ids.s(deviceId, 'trendLeaf'));
        this._sammlungCreated[deviceId] = true;
    }

    /**
     * Handeingaben aus der Miele-App in den zuletzt gesammelten Datensatz uebernehmen.
     *
     * Aufgerufen aus onStateChange. Beide Felder koennen einzeln kommen - wer nur den
     * Wasserwert kennt, traegt eben nur den ein.
     *
     * @param deviceId
     * @param feld
     * @param wert
     */
    async sammlungHandeingabe(deviceId, feld, wert) {
        const s = await this.getStateAsync(ids.s(deviceId, 'records'));
        let liste = [];
        try {
            liste = JSON.parse(s && s.val) || [];
        } catch {
            return;
        }
        if (!liste.length) {
            this.log.warn(`${deviceId}: Handeingabe ohne Datensatz - erst ein Programm abwarten`);
            return;
        }
        const werte = feld === ids.SAMMLUNG.inputEnergy ? { energyKwh: wert } : { waterL: wert };
        const neu = sammler.manuellNachtragen(liste, werte);
        await this.setStateAsync(ids.s(deviceId, 'records'), { val: JSON.stringify(neu), ack: true });
        await this.setStateAsync(ids.s(deviceId, 'progress'), { val: sammler.fortschritt(neu), ack: true });
        this.log.info(`${deviceId}: Handeingabe uebernommen (${feld} = ${wert})`);
    }

    async ensureEcoObjects(deviceId) {
        if (!this._ecoCreated) {
            this._ecoCreated = {};
        }
        if (this._ecoCreated[deviceId]) {
            return;
        }
        const german = this.config.germanNames !== false;
        await this.extendObjectAsync(`${deviceId}.eco`, {
            type: 'channel',
            common: objdef.ecoCommon(german)['eco'],
            native: {},
        });
        // Dieselbe Quelle wie aktualisiereEcoNamen - siehe lib/objects.js, ecoStates.
        // Zwei getrennte Tabellen fuer dieselben Punkte waren bis 0.3.10 der Grund dafuer,
        // dass die Umbenennung der Energiefelder wirkungslos blieb: Diese Stelle setzte
        // beim naechsten laufenden Programm die alten Namen zurueck.
        const defs = objdef.ecoStates(german, this.config.ecoRawFields);
        for (const d of defs) {
            await this.extendObjectAsync(`${deviceId}.eco.${d.sub}`, {
                type: 'state',
                common: d.common,
                native: {},
            });
        }
        this._ecoCreated[deviceId] = true;
    }

    /** Sekundengenaue Rest-/Laufzeit aus DOP2 2/256 (#7 Rest s, #8 Lauf s) – nur wo verfügbar. */
    /**
     * Betriebsstunden lesen - selten, weil sie sich selten aendern.
     *
     * Einmal beim Start und danach stuendlich: Ein Zaehler, der pro Programm um ein paar
     * Stunden steigt, braucht keine engere Abfrage. Jede gesparte Anfrage kommt dem Geraet
     * zugute, das nur eine Verbindung gleichzeitig bedienen kann.
     */
    async pollHours() {
        for (const [deviceId, dev] of Object.entries(this.devices)) {
            if (this._hoursUnbekannt && this._hoursUnbekannt[deviceId]) {
                continue;
            }
            let fields;
            try {
                const res = await dev.api.readDop2(dev.route, HOURS_LEAF.unit, HOURS_LEAF.attr);
                if (res.status !== 200 || !res.headers['x-signature']) {
                    // Kennt das Geraet den Leaf nicht, wird er nicht wieder gefragt - anders als
                    // beim Eco-Leaf gibt es hier keinen Grund, es spaeter noch einmal zu
                    // versuchen: Ein Zaehler taucht nicht mit dem naechsten Programm auf.
                    if (MieleLocal.kenntLeafNicht(res.status)) {
                        if (!this._hoursUnbekannt) {
                            this._hoursUnbekannt = {};
                        }
                        this._hoursUnbekannt[deviceId] = true;
                        this.log.debug(
                            `Betriebsstunden ${deviceId}: Leaf 2/119 unbekannt ` +
                                `(HTTP ${res.status}), wird nicht mehr abgefragt`,
                        );
                    }
                    continue;
                }
                ({ fields } = dop2.parseLeaf(this.mc.decryptResponse(res.headers['x-signature'], res.body)));
            } catch (e) {
                this.log.debug(`Betriebsstunden ${deviceId}: ${e.message}`);
                continue;
            }
            await this.geraeteWerteSchreiben(deviceId, `${HOURS_LEAF.unit}/${HOURS_LEAF.attr}`, fields);
            const f = fields[HOURS_IDX];
            /*
             * DER ROHWERT STEHT IN MINUTEN, nicht in Stunden.
             *
             * Bis zum 11.09.2026 wurde er unveraendert als Stunden gespeichert. Die Spuelmaschine
             * meldete damit 439713 "Betriebsstunden" - 50 Jahre Dauerbetrieb. In Minuten sind es
             * 7329 Stunden, und das passt zu einem Geraet, das taeglich laeuft. ha-miele-at-lan
             * kommt unabhaengig zum selben Schluss (Leaf 2/119, alle fuenf Werte in Minuten).
             */
            const roh = f && typeof f.value === 'number' ? f.value : null;
            const stunden = felder.stundenAusLeaf(roh);
            // Null nicht uebernehmen: Ein Zaehler, der bei 0 steht, ist bei einem Geraet in
            // Betrieb kein Messwert, sondern ein Zeichen, dass dieses Modell ihn nicht fuehrt.
            if (stunden === null || stunden <= 0) {
                continue;
            }
            await this.extendObjectAsync(`${deviceId}.info.operatingHours`, {
                type: 'state',
                common: {
                    name: namen.text(
                        'Betriebsstunden gesamt',
                        'Total operating hours',
                        this.config.germanNames !== false,
                    ),
                    role: 'value.interval',
                    type: 'number',
                    unit: 'h',
                    read: true,
                    write: false,
                    def: 0,
                },
                native: {},
            });
            await this.setStateAsync(`${deviceId}.info.operatingHours`, { val: stunden, ack: true });
            this.log.debug(`Betriebsstunden ${deviceId}: ${roh} min = ${stunden} h`);
        }
    }

    async pollSeconds() {
        for (const [deviceId, dev] of Object.entries(this.devices)) {
            // Läuft kein Programm (Status ≠ In Betrieb/Pause), die Sekundenwerte auf 0 zurücksetzen -
            // sonst blieben nach Programmende die letzten Rest-/Laufzeiten stehen (z. B. 5100 s
            // „Restzeit" bei fertiger Maschine). Spart zugleich den DOP2-Call im Ruhezustand.
            const st = await this.getStateAsync(`${deviceId}.state.status`);
            const running = st && (st.val === 5 || st.val === 6);
            if (!running) {
                await this.ensureSecondsObjects(deviceId);
                await this.setStateAsync(`${deviceId}.state.remainingSeconds`, { val: 0, ack: true });
                await this.setStateAsync(`${deviceId}.state.elapsedSeconds`, { val: 0, ack: true });
                continue;
            }
            let fields;
            try {
                const res = await dev.api.readDop2(dev.route, SEC_LEAF.unit, SEC_LEAF.attr);
                if (res.status !== 200 || !res.headers['x-signature']) {
                    continue;
                }
                ({ fields } = dop2.parseLeaf(this.mc.decryptResponse(res.headers['x-signature'], res.body)));
            } catch {
                continue; // Gerät ohne 2/256 oder gerade beschäftigt
            }
            await this.geraeteWerteSchreiben(deviceId, `${SEC_LEAF.unit}/${SEC_LEAF.attr}`, fields);
            const rem =
                fields[SEC_REMAINING_IDX] && typeof fields[SEC_REMAINING_IDX].value === 'number'
                    ? fields[SEC_REMAINING_IDX].value
                    : null;
            const ela =
                fields[SEC_ELAPSED_IDX] && typeof fields[SEC_ELAPSED_IDX].value === 'number'
                    ? fields[SEC_ELAPSED_IDX].value
                    : null;
            if (rem == null && ela == null) {
                continue;
            }
            await this.ensureSecondsObjects(deviceId);
            // Nur echte Werte uebernehmen. Bei laufendem Programm liefert nicht jedes Geraet die
            // Sekunden: die Waschmaschine (WCR860) meldet in 2/256 durchgaengig 0, waehrend
            // /State parallel 11 Minuten Restzeit ausweist - die Spuelmaschine liefert dort
            // korrekte Werte. Eine 0 als "Rest" zu schreiben laesst die Anzeige auf 0:00:00
            // stehen, obwohl das Programm laeuft. Auf 0 zurueckgesetzt wird oben, wenn das
            // Programm wirklich endet.
            if (rem) {
                await this.setStateAsync(`${deviceId}.state.remainingSeconds`, { val: rem, ack: true });
            }
            if (ela) {
                await this.setStateAsync(`${deviceId}.state.elapsedSeconds`, { val: ela, ack: true });
            }
        }
    }

    async ensureSecondsObjects(deviceId) {
        if (!this._secCreated) {
            this._secCreated = {};
        }
        if (this._secCreated[deviceId]) {
            return;
        }
        const german = this.config.germanNames !== false;
        await this.extendObjectAsync(`${deviceId}.state.remainingSeconds`, {
            type: 'state',
            common: {
                name: namen.text('Restzeit (Sekunden)', 'Remaining time (seconds)', german),
                role: 'value.interval',
                type: 'number',
                unit: 's',
                def: 0,
                read: true,
                write: false,
            },
            native: {},
        });
        await this.extendObjectAsync(`${deviceId}.state.elapsedSeconds`, {
            type: 'state',
            common: {
                name: namen.text('Laufzeit (Sekunden)', 'Elapsed time (seconds)', german),
                role: 'value.interval',
                type: 'number',
                unit: 's',
                def: 0,
                read: true,
                write: false,
            },
            native: {},
        });
        this._secCreated[deviceId] = true;
    }

    /** SuperVision-Enrollment für alle Geräte (Push aktivieren). */
    async enrollAll() {
        if (!this.push) {
            return;
        }
        for (const [deviceId, dev] of Object.entries(this.devices)) {
            try {
                const r = await enroll.enrollDevice(dev.api, {
                    route: dev.route,
                    ourFab: this.push.ourFab,
                    hostIp: this.push.hostIp,
                    port: this.config.pushPort || 18082,
                    log: this.log,
                });
                this.log.info(
                    `Enrollment ${deviceId}: SuperVision=${r.supervisionOk}, Subscriptions=[${r.subscriptions.join(' ')}]`,
                );
            } catch (e) {
                this.log.warn(`Enrollment for ${deviceId} failed: ${e.message}`);
            }
        }
    }

    /**
     * Wie lange nach einem gescheiterten Statusabruf gewartet wird, bevor es der zweite Versuch
     * probiert. Kurz genug, um vor dem naechsten regulaeren Durchlauf fertig zu sein.
     */
    static get RETRY_PAUSE_MS() {
        return 1500;
    }

    async pollAll() {
        let ok = false;
        for (const [deviceId, dev] of Object.entries(this.devices)) {
            // Zweiter Anlauf, bevor ein Abruf als Fehler gilt. Das XKM-Modul der Geraete legt im
            // laufenden Betrieb sporadisch auf ("read ECONNRESET") oder antwortet kurz mit 404 -
            // am 23.08.2026 an der laufenden Waschmaschine mit 21 % der Abrufe gemessen, waehrend
            // die beiden anderen Geraete bei 0 % standen. Beim ersten Fehlversuch sofort
            // info.connected fallen zu lassen liess die Verbindung im Minutentakt flackern,
            // obwohl das Geraet die ganze Zeit erreichbar war.
            let fehler = null;
            let wiederholt = false;
            for (let versuch = 1; versuch <= 2; versuch++) {
                try {
                    const state = await dev.api.getState(dev.route);
                    if (state) {
                        await this.applyState(deviceId, state);
                        await this.setStateAsync(`${deviceId}.info.connected`, { val: true, ack: true });
                        ok = true;
                    }
                    fehler = null;
                    break;
                } catch (e) {
                    fehler = e;
                    if (versuch === 1) {
                        this.log.debug(`Polling ${deviceId} failed: ${e.message} - zweiter Versuch`);
                        wiederholt = true;
                        await new Promise(r => this.setTimeout(r, MieleLocal.RETRY_PAUSE_MS));
                    } else {
                        this.log.debug(`Polling ${deviceId} failed twice: ${e.message}`);
                    }
                }
            }
            if (fehler) {
                await this.setStateAsync(`${deviceId}.info.connected`, { val: false, ack: true });
            }
            await this.verbucheAbfrage(deviceId, fehler, wiederholt && !fehler);
        }
        await this.setStateAsync('info.connection', { val: ok, ack: true });
    }

    /**
     * Einen Durchgang des Leaf-Scans fahren.
     *
     * WARUM IN DURCHGAENGEN. Der volle Suchraum sind rund 700 Adressen; bei 700 ms Pause
     * waeren das acht Minuten am Stueck, in denen das Geraet nichts anderes tut. Ein
     * Durchgang nimmt sich deshalb nur ein Stueck vor und merkt sich, wo er stand - beim
     * naechsten Anstossen geht es dort weiter. Ein Abbruch mittendrin kostet nichts.
     *
     * WAS DABEI HERAUSKOMMT. Je Adresse wird festgehalten, ob sie antwortet und mit welchen
     * Feldern. Der Sinn liegt im VERGLEICH zweier Durchlaeufe: einer im Leerlauf, einer
     * waehrend eines Programms. Die Felder, die sich dazwischen bewegen, sind die
     * Kandidaten fuer alles, was heute noch fehlt - allen voran die verbrauchte Energie,
     * die im bekannten Leaf 2/6195 nachweislich nicht steht (04.09.2026, alle 47 Felder in
     * vier Ableitungen gegen die Shelly-Messung geprueft, bestes Feld 51 % daneben).
     */
    /**
     * Gibt das Modul ueberhaupt Auskunft? Eine einzige Frage klaert das.
     *
     * WARUM NICHT AM STATUS. Erst haben wir das am Geraetestatus festgemacht: nur scannen,
     * wenn "Standby". Das war zu grob - der Status sagt nichts darueber, ob das Modul gerade
     * Kapazitaet hat. Eine Spuelmaschine im Trocknen steht auf "In Betrieb" und tut dabei
     * nichts als warten (17 W); sie ist der beste Gespraechspartner, den es gibt. Umgekehrt
     * gibt es Geraete, die nach dem Programm sofort abschalten und nie einen Leerlauf zeigen,
     * in dem gescannt werden koennte.
     *
     * WIE ES STATTDESSEN GEHT. Gefragt wird eine Adresse, die es nicht gibt. Ein
     * gespraechsbereites Modul beantwortet sie mit 404 - "kenne ich nicht" ist eine Auskunft.
     * Ein ausgelastetes Modul antwortet auf ALLES mit 500 oder gar nicht. Damit ist die
     * Unterscheidung gemessen statt geraten, und zwar mit genau einer Anfrage je Durchgang.
     *
     * Antwortet die Adresse mit 200, existiert sie bei diesem Modell eben doch - auch das
     * heisst "gespraechsbereit". Nur 500 und Stoerungen sprechen dagegen.
     *
     * @param deviceId
     */
    async gespraechsbereit(deviceId) {
        const dev = this.devices && this.devices[deviceId];
        if (!dev) {
            return false;
        }
        this._kontrollTaub = this._kontrollTaub || {};
        this._kontrollKennt = this._kontrollKennt || {};
        const [unit, attr] = KONTROLL_ADRESSE;
        try {
            const res = await dev.api.readDop2(dev.route, unit, attr, 0, 0, leafscan.SCAN_TIMEOUT_MS);
            if (res.status !== 500) {
                // Das Geraet kennt den Bereich und gibt Auskunft.
                this._kontrollKennt[deviceId] = true;
                this._kontrollTaub[deviceId] = 0;
                return true;
            }
        } catch (e) {
            this.log.debug(`${deviceId}: Kontrollfrage ${unit}/${attr} - ${e.message}`);
        }

        // Ein Geraet, das die Kontrolladresse kennt, ist jetzt eben beschaeftigt.
        if (this._kontrollKennt[deviceId]) {
            return false;
        }

        this._kontrollTaub[deviceId] = (this._kontrollTaub[deviceId] || 0) + 1;
        if (
            !leafscan.trotzdemVersuchen({
                kennt: false,
                taub: this._kontrollTaub[deviceId],
                grenze: KONTROLLE_TAUB_MAX,
            })
        ) {
            return false;
        }

        if (this._kontrollTaub[deviceId] === KONTROLLE_TAUB_MAX) {
            this.log.info(
                `${deviceId}: Kontrolladresse ${unit}/${attr} blieb ${KONTROLLE_TAUB_MAX} mal ` +
                    'ohne Antwort - dieses Modell kennt den Bereich offenbar nicht. Der Scan wird ' +
                    'trotzdem versucht und bricht von selbst ab, wenn das Geraet nicht mag.',
            );
        }
        return true;
    }

    async leafScanDurchgang(deviceId) {
        const dev = this.devices && this.devices[deviceId];
        if (!dev) {
            this.log.warn(`Leaf-Scan: ${deviceId} ist nicht verbunden`);
            return;
        }
        // erzwingen: Der Scan ist selbst eine Diagnosefunktion und braucht den Kanal.
        await this.ensureSammlungObjects(deviceId, true);

        let bisher = {};
        try {
            const s = await this.getStateAsync(ids.s(deviceId, 'scanJson'));
            bisher = JSON.parse((s && s.val) || '{}') || {};
        } catch {
            bisher = {};
        }

        const offen = leafscan.naechste(bisher);
        if (!offen.length) {
            const f = leafscan.fortschritt(bisher);
            this.log.info(`${deviceId}: Leaf-Scan abgeschlossen - ${f.text}`);
            await this.setStateAsync(ids.s(deviceId, 'scanState'), { val: f.text, ack: true });
            return;
        }
        this.log.info(
            `${deviceId}: Leaf-Scan - ${offen.length} Adressen in diesem Durchgang ` +
                `(${leafscan.fortschritt(bisher).text})`,
        );
        let geprueft = 0;
        let stoerungen = 0;
        let absagen = 0;
        let ueberlastet = false;

        for (const { unit, attr } of offen) {
            let ergebnis = { status: null };
            try {
                const res = await dev.api.readDop2(dev.route, unit, attr, 0, 0, leafscan.SCAN_TIMEOUT_MS);
                if (res.status === 200 && res.headers['x-signature']) {
                    ergebnis = { felder: this.leafFelder(res) };
                } else {
                    ergebnis = { status: res.status };
                }
            } catch (e) {
                // Ein Lesefehler ist ein Ergebnis wie jedes andere: Die Adresse gilt als
                // geprueft, sonst haengt der Scan ewig an derselben Stelle.
                ergebnis = { status: `Fehler: ${e.message}`.slice(0, 60) };
            }
            /*
             * Nur festhalten, was das Geraet WIRKLICH beantwortet hat.
             *
             * Ein 503 oder ein abgebrochener Socket ist keine Auskunft ueber die Adresse,
             * sondern ueber den Zustand des Moduls. Wer ihn als Ergebnis ablegt, hakt eine
             * Adresse ab, die nie gefragt wurde - siehe leafscan.beantwortet.
             */
            if (leafscan.beantwortet(ergebnis)) {
                bisher = leafscan.aufnehmen(bisher, unit, attr, ergebnis);
            }

            /*
             * Aufhoeren, bevor das Modul aufgibt.
             *
             * Am 04.09.2026 warf die Waschmaschine nach rund 170 Adressen ihre Verbindung
             * ab - lokal und zur Cloud, und beide kamen von selbst nicht zurueck. Die
             * Vorboten standen im Ergebnis: abgebrochene Sockets und Zeitueberschreitungen
             * zwischen ansonsten sauberen Absagen. Genau die zaehlt dieser Zaehler.
             */
            if (leafscan.beschaeftigt(ergebnis)) {
                /*
                 * "Gerade nicht" ist keine Niederlage.
                 *
                 * Waehrend eines Programms beantwortet das Modul fast jede Frage mit 503 -
                 * frueher brach der Durchgang danach ab, und der Scan kam ueber 23 von 882
                 * Adressen nicht hinaus. Jetzt wird gewartet, immer laenger, und dieselbe
                 * Adresse noch einmal gefragt. Der Zaehler steht still: Ein beschaeftigtes
                 * Geraet ist kein ueberlastetes.
                 */
                if (++absagen <= leafscan.ABSAGEN_JE_ADRESSE) {
                    const warten = leafscan.wartezeitMs(absagen);
                    this.log.debug(
                        `${deviceId}: ${unit}/${attr} ist beschaeftigt - ` +
                            `${warten / 1000}s warten und erneut fragen`,
                    );
                    await new Promise(r => this.setTimeout(r, warten));
                    continue; // dieselbe Adresse noch einmal
                }
                // Nach mehreren Anlaeufen weiterziehen - die Adresse bleibt offen.
                this.log.info(`${deviceId}: ${unit}/${attr} bleibt beschaeftigt, ` + 'spaeter noch einmal');
                absagen = 0;
                stoerungen = 0;
                continue;
            }
            absagen = 0;

            if (leafscan.ueberlastet(ergebnis)) {
                if (++stoerungen >= leafscan.ABBRUCH_FEHLER) {
                    /*
                     * INFO, NICHT WARN. Ein ueberlastetes Modul ist hier der Normalfall, kein
                     * Fehler: Waehrend eines Programms kommt es mit den vielen Leaf-Anfragen nicht
                     * mit, und der Scan setzt spaeter ab dem gesicherten Fortschritt fort. Als
                     * Warnung stand diese Zeile vom 05. bis 11.09.2026 271-mal im Log, ohne dass
                     * je etwas zu tun gewesen waere - und verdeckte damit echte Warnungen.
                     */
                    this.log.info(
                        `${deviceId}: Leaf-Scan abgebrochen - ${stoerungen} ` +
                            'Verbindungsstoerungen in Folge. Das Geraet kommt nicht mit; ' +
                            'spaeter weitermachen, der Fortschritt ist gesichert.',
                    );
                    ueberlastet = true;
                    break;
                }
            } else {
                stoerungen = 0;
            }

            // Zwischenspeichern, damit ein Abbruch nicht den ganzen Durchgang kostet.
            if (++geprueft % leafscan.SICHERN_ALLE === 0) {
                await this.setStateAsync(ids.s(deviceId, 'scanJson'), { val: JSON.stringify(bisher), ack: true });
                await this.setStateAsync(ids.s(deviceId, 'scanState'), {
                    val: leafscan.fortschritt(bisher).text,
                    ack: true,
                });
            }
            // Dem Geraet Luft lassen - es bedient immer nur eine Verbindung.
            await new Promise(r => this.setTimeout(r, leafscan.PAUSE_MS));
        }

        await this.setStateAsync(ids.s(deviceId, 'scanJson'), { val: JSON.stringify(bisher), ack: true });
        const f = leafscan.fortschritt(bisher);
        await this.setStateAsync(ids.s(deviceId, 'scanState'), { val: f.text, ack: true });
        const t = leafscan
            .treffer(bisher)
            .slice(0, 12)
            .map(x => `${x.leaf} (${x.felder} Felder)`)
            .join(', ');
        this.log.info(`${deviceId}: Leaf-Scan - ${f.text}${t ? `. Bisher: ${t}` : ''}`);
        return { ueberlastet };
    }

    /**
     * Durchgang um Durchgang, bis der Scan fertig ist.
     *
     * WANN ER LAEUFT: solange der Schalter `sammlung.leafScan` steht. Der Nutzer legt ihn um,
     * wenn Zeit ist - typisch nach einem Programm, wenn das Geraet noch wach im Leerlauf steht
     * und stundenlang nichts anderes zu tun hat. Ein Adapterneustart beendet den Dauerlauf; der
     * Fortschritt ist gesichert, und ein erneutes Umlegen macht dort weiter, wo er stand.
     *
     * WARUM DIE PAUSE DAZWISCHEN so viel groesser ist als die zwischen zwei Adressen: Ein
     * Durchgang sind vierzig Anfragen am Stueck. Danach bekommt das Modul eine Minute fuer
     * sich - Zeit genug, um Cloud, App und die eigene Steuerung zu bedienen, bevor der naechste
     * Schwung kommt. Am 04.09.2026 hatte es ohne solche Pausen die Verbindung abgeworfen.
     */
    /**
     * Eine Runde ueber alle Geraete, die gerade arbeiten.
     *
     * Ein Geraet im Standby liefert dieselben Zahlen wie vor einer Stunde - es zu fragen kostet
     * nur Aufmerksamkeit, die es waehrend eines Programms nicht mehr hat. Die Statusnummern
     * stammen aus der Miele-Beschreibung: 1 ist "aus", 7 "Standby". Alles darueber heisst,
     * dass etwas laeuft.
     */
    async leafVerlaufRunde() {
        for (const deviceId of Object.keys(this.devices || {})) {
            const st = await this.getStateAsync(`${deviceId}.state.status`);
            const nr = st && Number(st.val);
            if (!nr || nr === 1 || nr === 7) {
                continue;
            }
            // Waehrend einer Feinaufzeichnung schweigt die normale Runde - beide zusammen
            // waeren die doppelte Last auf einem Modul, das nur eine Verbindung bedient.
            if (this.feinTimer && this.feinTimer[deviceId]) {
                continue;
            }
            try {
                await this.leafVerlaufSchreiben(deviceId);
            } catch (e) {
                this.log.debug(`${deviceId}: Verlauf nicht geschrieben - ${e.message}`);
            }
        }
    }

    /**
     * Die reinen Werte eines Leafs - ohne Typangaben.
     *
     * Der Typ interessiert bei der Auswertung nicht und blaeht jeden Datenpunkt auf. Grosse
     * Ganzzahlen kommen als BigInt und muessen fuer JSON umgewandelt werden; Zeichenketten
     * stehen als Puffer mit Nullen am Ende, die abgeschnitten gehoeren.
     *
     * Stand hier zweimal - im Scan und beim Verlaufschreiben. Eine Kopie haette bedeutet, dass
     * beide Ablagen bei der naechsten Aenderung auseinanderlaufen.
     *
     * @param res
     */
    leafFelder(res) {
        return this.leafLesen(res).werte;
    }

    /**
     * Ein gelesenes Leaf einmal auspacken - roh UND gedeutet.
     *
     * WARUM BEIDES. Der Verlauf braucht die ROHE Struktur: "[9, 0, 0, 40, 0, 0]" zeigt, dass
     * dort eine Wertehuelle steckt, und genau daran liess sich am 15.09.2026 nachweisen, dass
     * der Adapter bis dahin die falsche Stelle las. Die Datenpunkte brauchen den GEDEUTETEN
     * Wert - 40 Grad, nicht die Huelle.
     *
     * Und beides aus EINEM Abruf: Ein Miele-Modul bedient nur eine Verbindung; dasselbe Leaf
     * zweimal zu lesen, waere die doppelte Last fuer dieselbe Auskunft.
     *
     * @param res
     * @returns {{werte: object, fields: object}} werte = flach fuer den Verlauf,
     *          fields = wie parseLeaf sie liefert, fuer die Datenpunkte
     */
    leafLesen(res) {
        const plain = this.mc.decryptResponse(res.headers['x-signature'], res.body);
        const { fields } = dop2.parseLeaf(plain);
        const werte = {};
        for (const [idx, f] of Object.entries(fields || {})) {
            werte[idx] = MieleLocal.reinerWert(f && f.value);
        }
        return { werte, fields };
    }

    /**
     * Was ein gelesenes Leaf hergibt, als Datenpunkte anlegen und schreiben.
     *
     * DIE REGEL: ES GIBT NUR, WAS DAS GERAET LIEFERT.
     * Die Namenstabelle kennt ueber dreihundert Felder aus fremden Projekten - Waschmaschine,
     * Backofen, Kaffeemaschine, Kommunikationsmodul. Sie alle anzulegen, hiesse jedem Nutzer
     * einen Baum voller Nullen hinzustellen, in dem eine echte Null nicht mehr auffaellt.
     * Deshalb entsteht ein Datenpunkt in dem Augenblick, in dem das Geraet das Feld zum ersten
     * Mal beantwortet - und sonst nie.
     *
     * WAS ES AN ZUSAETZLICHER LAST KOSTET: nichts. Geschrieben wird aus Abrufen, die ohnehin
     * laufen (Verlauf, Feinaufzeichnung, Eco-Abfrage). Es kommt kein einziger Aufruf hinzu.
     *
     * @param {string} deviceId
     * @param {string} leaf    "2/6195"
     * @param {object} fields  wie parseLeaf sie liefert
     * @returns {number} wie viele Werte geschrieben wurden
     */
    async geraeteWerteSchreiben(deviceId, leaf, fields) {
        if (!this.config.leafDatenpunkte) {
            return 0;
        }
        const deutsch = this.config.germanNames !== false;
        let defs;
        try {
            defs = datenpunkte.fuerLeaf(leaf, fields, deutsch);
        } catch (e) {
            this.log.debug(`${deviceId}: ${leaf} nicht deutbar - ${e.message}`);
            return 0;
        }
        if (!defs.length) {
            return 0;
        }

        if (!this._dpAngelegt) {
            this._dpAngelegt = {};
        }
        const bekannt = this._dpAngelegt[deviceId] || (this._dpAngelegt[deviceId] = {});
        let geschrieben = 0;
        for (const d of defs) {
            const id = `${deviceId}.detail.${d.kanal}.${d.sub}`;
            if (!bekannt[id]) {
                // Der Kanal einmal je Geraet - extendObject ist genuegsam, aber nicht umsonst.
                if (!bekannt[`kanal:${d.kanal}`]) {
                    await this.extendObjectAsync(`${deviceId}.detail`, {
                        type: 'channel',
                        common: { name: namen.text('Geräteinterne Werte', 'Device internals', deutsch) },
                        native: {},
                    });
                    await this.extendObjectAsync(`${deviceId}.detail.${d.kanal}`, {
                        type: 'channel',
                        common: { name: datenpunkte.kanalName(d.kanal, deutsch) },
                        native: {},
                    });
                    bekannt[`kanal:${d.kanal}`] = true;
                }
                await this.extendObjectAsync(id, { type: 'state', common: d.common, native: { leaf } });
                bekannt[id] = true;
            }
            await this.setStateChangedAsync(id, { val: d.wert, ack: true });
            geschrieben++;
        }
        return geschrieben;
    }

    /**
     * Aus dem geparsten Feld den blossen Wert holen - notfalls durch mehrere Schichten.
     *
     * WARUM DAS NOETIG IST. dop2.parseLeaf liefert je Feld ein Paar aus Typ und Wert. Bei
     * einfachen Zahlen ist das harmlos, bei Listen aber nicht: Deren Wert ist selbst wieder
     * eine Liste solcher Paare. Wer nur die oberste Schicht abstreift, speichert am Ende
     * "[{'type':'u8','value':3},...]" statt "[3,...]".
     *
     * Am 05.09.2026 im Verlauf der Waschmaschine gesehen: Die aufgezeichneten Werte waren
     * unlesbar und damit fuer jede Auswertung wertlos - man konnte nicht einmal erkennen, ob
     * sich ein Feld ueberhaupt geaendert hatte oder nur die Reihenfolge im Objekt.
     *
     * BigInt wird zu Number, weil JSON es sonst nicht darstellen kann; Puffer werden zu Text
     * ohne die Nullen am Ende.
     *
     * @param v
     */
    static reinerWert(v) {
        // Die Umsetzung steht in lib/dop2.js - lib/datenpunkte.js braucht sie ebenso, und zwei
        // Kopien waeren beim naechsten Umbau auseinandergelaufen.
        return dop2.reinerWert(v);
    }

    /**
     * EIN Leaf engmaschig mitschreiben - fuer Vorgaenge, die schneller sind als drei Minuten.
     *
     * WARUM ES DAS BRAUCHT
     * Der normale Verlauf tastet alle drei Minuten alle gefundenen Leafs ab. Fuer die Frage,
     * welches Feld sich mit dem Programm bewegt, reicht das. Fuer schaltende Verbraucher
     * reicht es nicht: Am 06.09.2026 zeigte die Messsteckdose, dass das Heizelement der
     * Waschmaschine im Minutentakt zwischen 2337 W und Standby springt. Ein Feld, das diesen
     * Zustand traegt, ist bei Drei-Minuten-Abtastung nicht von Rauschen zu unterscheiden -
     * jede Messung faellt in einen zufaelligen Takt.
     *
     * WAS ES KOSTET: nichts zusaetzlich. Statt zehn Leafs alle drei Minuten wird eines alle
     * zwanzig Sekunden gelesen - dieselbe Anzahl Anfragen je Minute, aber neunfach feiner
     * aufgeloest. Die normale Runde setzt derweil fuer dieses Geraet aus (siehe
     * leafVerlaufRunde); ohne das waere es die doppelte Last.
     *
     * Sie laeuft nur, solange das Geraet arbeitet, und schaltet sich selbst ab, wenn das
     * Programm endet - eine vergessene Feinaufzeichnung wuerde das Modul sonst im Standby
     * mit einer Anfrage alle zwanzig Sekunden beschaeftigen.
     *
     * @param deviceId
     * @param schluessel
     */
    async leafVerlaufFeinRunde(deviceId, schluessel) {
        const dev = this.devices && this.devices[deviceId];
        if (!dev) {
            return;
        }
        const st = await this.getStateAsync(`${deviceId}.state.status`);
        const nr = st && Number(st.val);
        if (!nr || nr === 1 || nr === 7) {
            this.log.info(`${deviceId}: Feinaufzeichnung ${schluessel} beendet - Geraet im Ruhezustand`);
            await this.setStateAsync(ids.s(deviceId, 'trendLeaf'), { val: '', ack: true });
            this.feinAbschalten(deviceId);
            return;
        }

        const [unit, attr] = String(schluessel).split('/').map(Number);
        if (!unit || !attr) {
            return;
        }

        const alt = await this.getStateAsync(ids.s(deviceId, 'trendJson'));
        let verlauf = {};
        try {
            verlauf = JSON.parse((alt && alt.val) || '{}') || {};
        } catch {
            verlauf = {};
        }

        const jetzt = Date.now();
        const lies = async was => {
            const s2 = await this.getStateAsync(`${deviceId}.state.${was}`);
            return s2 ? s2.val : null;
        };
        verlauf = leafverlauf.zustandAufnehmen(
            verlauf,
            {
                programm: await lies('programText'),
                phase: await lies('programPhaseText'),
                status: await lies('statusText'),
                sollTemp: await lies('targetTemperature'),
                drehzahl: await lies('spinningSpeed'),
            },
            jetzt,
        );

        try {
            const res = await dev.api.readDop2(dev.route, unit, attr, 0, 0, leafscan.SCAN_TIMEOUT_MS);
            /*
             * Eine Absage zaehlt wie ein Fehlschlag.
             *
             * Ein 503 heisst "gerade beschaeftigt" und ist fuer sich harmlos - die naechste
             * Runde kommt ohnehin erst in zwanzig Sekunden. Kommt er aber dauerhaft, ist das
             * Geraet fuer diese Aufzeichnung nicht zu haben, und weiterzufragen kostet es nur
             * Aufmerksamkeit, die es fuer sein Programm braucht.
             */
            if (res.status !== 200) {
                await this.feinFehlschlag(deviceId, schluessel, `HTTP ${res.status}`);
            }
            if (res.status === 200 && res.headers['x-signature']) {
                const { werte: felder, fields } = this.leafLesen(res);
                if (felder && Object.keys(felder).length) {
                    if (this.feinFehler) {
                        this.feinFehler[deviceId] = 0;
                    }
                    await this.geraeteWerteSchreiben(deviceId, schluessel, fields);
                    verlauf = leafverlauf.aufnehmen(verlauf, schluessel, felder, jetzt);
                    await this.setStateAsync(ids.s(deviceId, 'trendJson'), { val: JSON.stringify(verlauf), ack: true });
                    const u = leafverlauf.umfang(verlauf);
                    await this.setStateAsync(ids.s(deviceId, 'trendSize'), {
                        val: `${u.leafs} Leafs, ${u.felder} Felder, ${u.wechsel} Wechsel`,
                        ack: true,
                    });
                }
            }
        } catch (e) {
            this.log.debug(`${deviceId}: Feinaufzeichnung ${schluessel} - ${e.message}`);
            await this.feinFehlschlag(deviceId, schluessel, e.message);
        }
    }

    /**
     * Nach mehreren Fehlschlaegen in Folge aufhoeren zu fragen.
     *
     * WARUM DAS NOETIG IST. Der Leaf-Scan kennt diese Bremse seit jeher (leafscan,
     * ABSAGEN_JE_ADRESSE) - die Feinaufzeichnung fragte stur weiter. Am 07.09.2026 waehrend
     * eines langen Baumwollprogramms beobachtet: Nach einem Adapterneustart beantwortete die
     * Waschmaschine die Abfrage auf 2/6192 nicht mehr, und alle zwanzig Sekunden lief eine
     * weitere in einen Timeout. Das Modul war mit dem laufenden Programm ausgelastet; jede
     * zusaetzliche Anfrage machte es schlimmer, und aufgezeichnet wurde ohnehin nichts mehr.
     *
     * Fuenf Fehlschlaege in Folge sind die Grenze - dieselbe wie beim Scan. Ein einzelner
     * Aussetzer kommt vor und darf die Aufzeichnung nicht beenden; fuenf hintereinander
     * heissen, dass das Geraet gerade nicht kann.
     *
     * Abgeschaltet wird sichtbar: Der Datenpunkt wird geleert, damit niemand eine
     * Aufzeichnung vermutet, die nicht laeuft - genau diese stille Taeuschung war der Fehler,
     * der in 0.3.26 und 0.3.27 dreimal auftrat.
     *
     * @param deviceId
     * @param schluessel
     * @param grund
     */
    async feinFehlschlag(deviceId, schluessel, grund) {
        if (!this.feinFehler) {
            this.feinFehler = {};
        }
        this.feinFehler[deviceId] = (this.feinFehler[deviceId] || 0) + 1;
        if (this.feinFehler[deviceId] < FEIN_FEHLSCHLAEGE_MAX) {
            return;
        }
        this.feinFehler[deviceId] = 0;

        /*
         * Langsamer werden, nicht aufgeben.
         *
         * Zuerst schaltete die Bremse die Aufzeichnung nach fuenf Fehlschlaegen ab. Das war zu
         * grob: Ein Modul, das den Zwanzig-Sekunden-Takt nicht mitmacht, schafft den
         * Vierzig-Sekunden-Takt oft muehelos - und eine gedehnte Aufzeichnung ist immer noch
         * feiner als die normale Runde alle drei Minuten. Erst wenn auch der laengste Takt
         * nichts liefert, wird abgeschaltet.
         */
        if (!this.feinTakt) {
            this.feinTakt = {};
        }
        const alt = this.feinTakt[deviceId] || FEIN_TAKT_MS;
        const neu = alt * 2;
        if (neu <= FEIN_TAKT_MAX_MS) {
            this.feinTakt[deviceId] = neu;
            this.log.info(
                `${deviceId}: Feinaufzeichnung ${schluessel} gedrosselt auf ` +
                    `${neu / 1000} Sekunden (zuletzt: ${grund}).`,
            );
            this.feinAbschalten(deviceId);
            this.feinTimer[deviceId] = this.setInterval(
                () => this.leafVerlaufFeinRunde(deviceId, schluessel).catch(() => {}),
                neu,
            );
            return;
        }
        this.log.warn(
            `${deviceId}: Feinaufzeichnung ${schluessel} beendet - auch im ` +
                `${alt / 1000}-Sekunden-Takt keine Antwort (zuletzt: ${grund}).`,
        );
        delete this.feinTakt[deviceId];
        await this.setStateAsync(ids.s(deviceId, 'trendLeaf'), { val: '', ack: true });
        this.feinAbschalten(deviceId);
    }

    /**
     * Nach einem Adapterstart die Feinaufzeichnung wieder anwerfen, wo eine eingetragen ist.
     *
     * Der Datenpunkt ueberlebt den Neustart, der Timer nicht - ohne das hier bleibt eine
     * Aufzeichnung stehen, die laut Datenpunkt laeuft.
     */
    async feinFortsetzen() {
        if (!this.feinTimer) {
            this.feinTimer = {};
        }
        for (const deviceId of Object.keys(this.devices || {})) {
            const st = await this.getStateAsync(ids.s(deviceId, 'trendLeaf'));
            const wunsch = String((st && st.val) || '').trim();
            if (!wunsch || this.feinTimer[deviceId]) {
                continue;
            }
            this.log.info(`${deviceId}: Feinaufzeichnung ${wunsch} nach Neustart fortgesetzt`);
            this.feinTimer[deviceId] = this.setInterval(
                () => this.leafVerlaufFeinRunde(deviceId, wunsch).catch(() => {}),
                20000,
            );
        }
    }

    /**
     * Nach einem Adapterstart die Leaf-Scans wieder anwerfen, deren Schalter noch steht.
     *
     * Der Schalter ueberlebt den Neustart, die Schleife nicht.
     */
    async scanFortsetzen() {
        for (const deviceId of Object.keys(this.devices || {})) {
            const st = await this.getStateAsync(ids.s(deviceId, 'scan'));
            if (!st || st.val !== true) {
                continue;
            }
            this.log.info(`${deviceId}: Leaf-Scan nach Neustart fortgesetzt`);
            this.leafScanDauerlauf(deviceId).catch(e =>
                this.log.warn(`${deviceId}: Leaf-Scan fehlgeschlagen - ${e.message}`),
            );
        }
    }

    /**
     * Die Feinaufzeichnung eines Geraets anhalten.
     *
     * @param deviceId
     */
    feinAbschalten(deviceId) {
        if (this.feinTimer && this.feinTimer[deviceId]) {
            this.clearInterval(this.feinTimer[deviceId]);
            delete this.feinTimer[deviceId];
        }
    }

    /**
     * Die gefundenen Leafs erneut lesen und jede Wertaenderung festhalten.
     *
     * WARUM DAS NOETIG IST
     * Der Scan sagt nur, WELCHE Adressen antworten. Ein Leaf mit siebenundvierzig Feldern ist
     * damit noch immer eine Wand aus Zahlen. Erst der Verlauf zeigt, welche davon sich mit der
     * Maschine bewegen - und nur solche Felder koennen eine Messung tragen. Die Energie, die
     * in 2/6195 nachweislich nicht steckt, koennte in einem der neu gefundenen Nachbarn liegen
     * (2/6192 und 2/6193, gefunden am 05.09.2026); sichtbar wird das nur, wenn man sie
     * waehrend eines Programms mitschreibt.
     *
     * WIE OFT: Alle paar Minuten, und nur solange etwas laeuft. Ein Geraet im Standby liefert
     * ohnehin dieselben Zahlen, und jede Anfrage dorthin ist eine, die es waehrend eines
     * Programms nicht beantworten kann.
     *
     * WAS ES KOSTET: eine Anfrage je gefundenem Leaf. Das sind derzeit sechs - deutlich
     * weniger als ein Scan-Durchgang, und mit derselben Pause dazwischen.
     *
     * @param deviceId
     */
    async leafVerlaufSchreiben(deviceId) {
        const dev = this.devices && this.devices[deviceId];
        if (!dev) {
            return;
        }
        // Die Datenpunkte anlegen, falls es sie noch nicht gibt - der Verlauf laeuft auch
        // ohne vorherigen Scan an, sobald Treffer gespeichert sind. erzwingen, weil die
        // Feinaufzeichnung sonst still ins Leere schriebe.
        await this.ensureSammlungObjects(deviceId, true);

        const stand = await this.getStateAsync(ids.s(deviceId, 'scanJson'));
        let gefunden = {};
        try {
            gefunden = JSON.parse((stand && stand.val) || '{}') || {};
        } catch {
            return;
        }
        const leafs = Object.entries(gefunden)
            .filter(([, v]) => v && v.antwortet)
            .map(([k]) => k);
        if (!leafs.length) {
            return;
        }

        const alt = await this.getStateAsync(ids.s(deviceId, 'trendJson'));
        let verlauf = {};
        try {
            verlauf = JSON.parse((alt && alt.val) || '{}') || {};
        } catch {
            verlauf = {};
        }

        const jetzt = Date.now();
        /*
         * Den Zustand mitschreiben - ohne ihn ist keine Zahlenreihe zu deuten.
         *
         * "608, 368, -378" wird erst zur Aussage, wenn danebensteht, ob die Maschine wusch,
         * spuelte oder schleuderte.
         */
        const lies = async was => {
            const st = await this.getStateAsync(`${deviceId}.state.${was}`);
            return st ? st.val : null;
        };
        verlauf = leafverlauf.zustandAufnehmen(
            verlauf,
            {
                programm: await lies('programText'),
                phase: await lies('programPhaseText'),
                status: await lies('statusText'),
                sollTemp: await lies('targetTemperature'),
                drehzahl: await lies('spinningSpeed'),
            },
            jetzt,
        );

        let gelesen = 0;
        for (const schluessel of leafs) {
            const [unit, attr] = schluessel.split('/').map(Number);
            if (!unit || !attr) {
                continue;
            }
            try {
                const res = await dev.api.readDop2(dev.route, unit, attr, 0, 0, leafscan.SCAN_TIMEOUT_MS);
                if (res.status !== 200 || !res.headers['x-signature']) {
                    continue;
                }
                const { werte: felder, fields } = this.leafLesen(res);
                if (felder && Object.keys(felder).length) {
                    await this.geraeteWerteSchreiben(deviceId, schluessel, fields);
                    verlauf = leafverlauf.aufnehmen(verlauf, schluessel, felder, jetzt);
                    gelesen++;
                }
            } catch {
                /* ein Fehlschlag beendet die Runde nicht */
            }
            await new Promise(r => this.setTimeout(r, leafscan.PAUSE_MS));
        }
        if (!gelesen) {
            return;
        }

        await this.setStateAsync(ids.s(deviceId, 'trendJson'), { val: JSON.stringify(verlauf), ack: true });
        const u = leafverlauf.umfang(verlauf);
        await this.setStateAsync(ids.s(deviceId, 'trendSize'), {
            val: `${u.leafs} Leafs, ${u.felder} Felder, ${u.wechsel} Wertwechsel`,
            ack: true,
        });
    }

    /**
     * Die Leaf-Suche anwerfen, sobald ein Geraet eingeschaltet wird.
     *
     * WOZU. Ein Geraet, das die meiste Zeit aus ist, wird sonst nie durchsucht: Der Scan
     * braucht ein waches Modul, und wer soll den Schalter genau dann umlegen? Beim Backofen
     * ist das der Regelfall - er stand am 08.09.2026 als einziges der drei Geraete mit einer
     * voellig leeren Suche da, waehrend Wasch- und Spuelmaschine laengst Treffer hatten.
     *
     * WANN. Beim Uebergang von "Aus" (Status 1) auf alles andere, und nur bei einem Geraet,
     * dessen Suche noch NIE gelaufen ist. Damit kann diese Automatik keine Entscheidung
     * ueberstimmen: Wer den Schalter bewusst ausmacht, hat dann schon Adressen im Ergebnis,
     * und es bleibt aus. Der Dauerlauf selbst parkt sich, sobald das Geraet wieder aus ist.
     *
     * WARUM ABSCHALTBAR UND AUS. Der Adapter laeuft auch bei anderen Leuten. Deren Geraete
     * ungefragt zu befragen, waere nicht in Ordnung - auch wenn der Scan nur liest.
     *
     * @param deviceId
     * @param vorher
     * @param nachher
     */
    async leafScanBeimEinschalten(deviceId, vorher, nachher) {
        if (!this.config.leafScanAuto) {
            return;
        }
        const schalter = await this.getStateAsync(ids.s(deviceId, 'scan'));
        const bisher = await this.getStateAsync(ids.s(deviceId, 'scanJson'));
        let stand = {};
        try {
            stand = JSON.parse((bisher && bisher.val) || '{}') || {};
        } catch {
            stand = {};
        }

        if (
            !leafscan.beimEinschaltenStarten({
                an: true,
                vorher,
                nachher,
                schalter: schalter && schalter.val,
                geprueft: Object.keys(stand).length > 0,
            })
        ) {
            return;
        }

        this.log.info(
            `${deviceId}: eingeschaltet - die Leaf-Suche wird gestartet ` +
                `(${leafscan.adressen().length} Adressen, laeuft ueber viele Durchgaenge).`,
        );
        await this.ensureSammlungObjects(deviceId, true);
        await this.setStateAsync(ids.s(deviceId, 'scan'), { val: true, ack: true });
        this.leafScanDauerlauf(deviceId).catch(e =>
            this.log.warn(`${deviceId}: Leaf-Scan fehlgeschlagen - ${e.message}`),
        );
    }

    async leafScanDauerlauf(deviceId) {
        for (;;) {
            const laeuft = await this.getStateAsync(ids.s(deviceId, 'scan'));
            if (!laeuft || laeuft.val !== true) {
                this.log.info(`${deviceId}: Leaf-Scan angehalten.`);
                return;
            }

            /*
             * Ein ausgeschaltetes Geraet nicht befragen - es antwortet auf ALLES mit 500.
             *
             * Das ist die teuerste Falle des ganzen Verfahrens: Diese 500er sehen aus wie
             * "gibt es nicht" und werden als geprueft abgelegt. Ein Scan, der am schlafenden
             * Geraet durchlaeuft, meldet danach "882 von 882 geprueft" und hat in Wahrheit
             * keine einzige Adresse ernsthaft gefragt.
             *
             * Am 06.09.2026 an der Spuelmaschine G5840 genau so geschehen: 875 Adressen mit
             * 500 abgehakt, ein einziger Treffer - waehrend die baugleich angebundene
             * Waschmaschine zehn Leafs lieferte.
             *
             * EIN LAUFENDES PROGRAMM IST GENAUSO SCHLECHT. Das war zuerst uebersehen: Am
             * 07.09.2026 lief der Scan an der arbeitenden Spuelmaschine und lieferte 102
             * Adressen, davon 102 mit 500 - ausnahmslos, ohne ein einziges 404 dazwischen.
             * Ein Geraet, das wirklich antwortet, unterscheidet (die Waschmaschine lieferte
             * 500er UND 404er UND Treffer). Zur selben Zeit beantwortete die ebenfalls
             * arbeitende Waschmaschine Anfragen auf ein Leaf, das sie nachweislich hat, nur
             * noch mit Timeouts. Waehrend eines Programms hat das Modul schlicht keine
             * Kapazitaet, und seine Absagen bedeuten nichts.
             *
             * Gescannt wird deshalb nur im Leerlauf: Status 7 heisst "Standby" und ist der
             * beste Zeitpunkt ueberhaupt, 1 heisst "aus". Alles dazwischen heisst, dass ein
             * Programm laeuft.
             */
            const zustand = await this.getStateAsync(`${deviceId}.state.status`);
            if (zustand && Number(zustand.val) === 1) {
                this.log.debug(`${deviceId}: Leaf-Scan wartet - Geraet ist aus`);
                await new Promise(r => this.setTimeout(r, PAUSE_ZWISCHEN_DURCHGAENGEN_MS));
                continue;
            }
            if (!(await this.gespraechsbereit(deviceId))) {
                this.log.debug(`${deviceId}: Leaf-Scan wartet - Modul gibt keine Auskunft`);
                await new Promise(r => this.setTimeout(r, PAUSE_ZWISCHEN_DURCHGAENGEN_MS));
                continue;
            }

            const vorher = await this.getStateAsync(ids.s(deviceId, 'scanJson'));
            let stand = {};
            try {
                stand = JSON.parse((vorher && vorher.val) || '{}') || {};
            } catch {
                stand = {};
            }
            if (!leafscan.naechste(stand, 1).length) {
                this.log.info(`${deviceId}: Leaf-Scan abgeschlossen - nichts mehr offen.`);
                await this.setStateAsync(ids.s(deviceId, 'scan'), { val: false, ack: true });
                return;
            }

            const lauf = await this.leafScanDurchgang(deviceId);
            /*
             * Nach einer Ueberlastung nicht nach einer Minute wieder anklopfen.
             *
             * Die Bremse im Durchgang beendet nur DIESEN Durchgang - der Dauerlauf startete
             * danach den naechsten nach der ueblichen Minute, und das Ganze von vorn: vierzig
             * Adressen, fuenf Stoerungen, Abbruch, eine Minute Pause. Am 07.09.2026 lief das
             * eine halbe Stunde so, waehrend beide Maschinen arbeiteten; die Waschmaschine
             * beantwortete daraufhin nicht einmal mehr ihr Eco-Leaf. Ein Geraet, das gerade
             * nicht kann, braucht Ruhe und keinen neuen Anlauf im Minutentakt.
             */
            const pause = lauf && lauf.ueberlastet ? PAUSE_NACH_UEBERLASTUNG_MS : PAUSE_ZWISCHEN_DURCHGAENGEN_MS;
            if (lauf && lauf.ueberlastet) {
                this.log.info(
                    `${deviceId}: Leaf-Scan pausiert ` + `${pause / 60000} Minuten - das Geraet braucht Ruhe.`,
                );
            }
            await new Promise(r => this.setTimeout(r, pause));
        }
    }

    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        } // nur echte Nutzerbefehle
        const parts = id.split('.'); // miele-local.0.<serial>.control.<sub>

        /*
         * Handeingaben der Datensammlung.
         *
         * Sie stehen unter "sammlung", nicht unter "control", und schalten nichts am Geraet -
         * deshalb vor der Steuerungspruefung und unabhaengig von allowControl. Wer Werte aus
         * der Miele-App nachtraegt, will nicht erst die Geraetesteuerung freischalten muessen.
         */
        /*
         * Den Leaf-Scan anstossen.
         *
         * Steht wie die Handeingaben unter "sammlung" und schaltet nichts am Geraet - der
         * Scan liest ausschliesslich. Ausgeloest wird er von Hand, nicht von selbst: Er
         * belegt das Geraet ueber Minuten, und wann das passt, weiss nur der Mensch davor.
         */
        const scanIdx = parts.indexOf('sammlung');

        /*
         * Die Feinaufzeichnung ein- und ausschalten.
         *
         * Eingetragen wird die Leaf-Adresse, die beobachtet werden soll ("2/6192"); ein leeres
         * Feld schaltet ab. Zwanzig Sekunden sind kein frei gewaehlter Wert: Sie sind die
         * Grenze, bis zu der die Last der normalen Runde entspricht (siehe
         * leafVerlaufFeinRunde).
         */
        if (scanIdx > 0 && parts[scanIdx + 1] === ids.SAMMLUNG.trendLeaf) {
            const geraet = parts[scanIdx - 1];
            const wunsch = String(state.val || '').trim();
            if (!this.feinTimer) {
                this.feinTimer = {};
            }
            this.feinAbschalten(geraet);
            await this.setStateAsync(id, { val: wunsch, ack: true });
            if (wunsch) {
                if (!this.feinFehler) {
                    this.feinFehler = {};
                }
                if (!this.feinTakt) {
                    this.feinTakt = {};
                }
                this.feinFehler[geraet] = 0;
                this.feinTakt[geraet] = FEIN_TAKT_MS;
                this.log.info(
                    `${geraet}: Feinaufzeichnung ${wunsch} laeuft, alle ` + `${FEIN_TAKT_MS / 1000} Sekunden`,
                );
                this.leafVerlaufFeinRunde(geraet, wunsch).catch(() => {});
                this.feinTimer[geraet] = this.setInterval(
                    () => this.leafVerlaufFeinRunde(geraet, wunsch).catch(() => {}),
                    FEIN_TAKT_MS,
                );
            } else {
                this.log.info(`${geraet}: Feinaufzeichnung abgeschaltet`);
            }
            return;
        }

        if (scanIdx > 0 && parts[scanIdx + 1] === ids.SAMMLUNG.scan) {
            const geraet = parts[scanIdx - 1];
            if (state.val === true) {
                /*
                 * DER SCHALTER BLEIBT STEHEN - er bedeutet "scanne, bis fertig".
                 *
                 * Frueher war er ein Knopf fuer EINEN Durchgang von 40 Adressen und wurde
                 * sofort zurueckgesetzt. Bei 882 Adressen und einem Geraet, das nur im
                 * Leerlauf antwortet, haette jemand zwei Dutzend Mal danebenstehen muessen -
                 * der Scan kam in vier Wochen ueber 23 Adressen nicht hinaus.
                 *
                 * Jetzt laeuft er weiter, Durchgang um Durchgang, bis nichts mehr offen ist
                 * oder der Schalter umgelegt wird. Zwischen den Durchgaengen liegt eine
                 * Verschnaufpause; wird das Geraet in dieser Zeit gebraucht, sagt es mit 503
                 * ab, und der Scan wartet geduldig (siehe leafscan.beschaeftigt).
                 */
                await this.setStateAsync(id, { val: true, ack: true });
                this.leafScanDauerlauf(geraet).catch(e =>
                    this.log.warn(`${geraet}: Leaf-Scan fehlgeschlagen - ${e.message}`),
                );
            } else {
                await this.setStateAsync(id, { val: false, ack: true });
            }
            return;
        }

        const sIdx = parts.indexOf('sammlung');
        if (sIdx > 0 && typeof state.val === 'number' && state.val > 0) {
            const feld = parts[sIdx + 1];
            if (feld === ids.SAMMLUNG.inputEnergy || feld === ids.SAMMLUNG.inputWater) {
                await this.sammlungHandeingabe(parts[sIdx - 1], feld, state.val).catch(e =>
                    this.log.warn(`Handeingabe fehlgeschlagen: ${e.message}`),
                );
                await this.setStateAsync(id, { val: state.val, ack: true });
            }
            return;
        }

        const idx = parts.indexOf('control');
        if (idx < 0) {
            return;
        }
        const deviceId = parts[idx - 1];
        const sub = parts[idx + 1];
        const dev = this.devices[deviceId];
        if (!dev) {
            return;
        }
        if (!this.config.allowControl) {
            this.log.warn('Device control is disabled in instance settings.');
            return;
        }
        if (!state.val) {
            return;
        } // nur bei true auslösen

        const obj = await this.getObjectAsync(id);
        const opcode = obj && obj.native ? obj.native.opcode : null;
        if (opcode == null) {
            return;
        }

        try {
            const payload = buildUserRequest(opcode);
            const status = await dev.api.put(
                `Devices/${dev.route}/DOP2/${USER_REQ_UNIT}/${USER_REQ_LEAF}?idx1=0&idx2=0`,
                payload,
            );
            if (status === 200 || status === 204) {
                this.log.info(`Command '${sub}' sent to ${deviceId} (opcode 0x${opcode.toString(16)}).`);
                await this.setStateAsync(id, { val: false, ack: true });
                // Polling kurz pausieren, dann gezielt den neuen Zustand holen.
                this.pausePollUntil = Date.now() + 2500;
                if (this.pollTimer) {
                    this.clearTimeout(this.pollTimer);
                }
                this.setTimeout(async () => {
                    await this.pollAll();
                    this.schedulePoll(false);
                }, 2600);
            } else {
                this.log.warn(`Command '${sub}' to ${deviceId}: HTTP ${status} (is MobileStart enabled on device?).`);
            }
        } catch (e) {
            this.log.warn(
                `Command '${sub}' to ${deviceId} failed: ${e.message} (remote control might not be supported by firmware).`,
            );
        }
    }

    startPush() {
        try {
            this.push = new MielePushListener({
                port: this.config.pushPort || 18082,
                crypto: this.mc,
                log: this.log,
                adapter: this,
                onEvent: async ev => {
                    // ev = { route, state }
                    const deviceId = ev.route.replace(/[^a-zA-Z0-9_-]/g, '_');
                    if (this.devices[deviceId] && ev.state) {
                        await this.applyState(deviceId, ev.state);
                        this.schedulePoll(false);
                    }
                },
            });
            this.push.start();
            this.log.info(`Push listener active on port ${this.config.pushPort || 18082}.`);
        } catch (e) {
            this.log.warn(`Failed to start push listener: ${e.message}. Polling fallback remains active.`);
        }
    }

    /**
     * Die gesammelten Datensaetze aller Geraete als CSV-Datei ablegen.
     *
     * WARUM ALS DATEI UND NICHT ALS TEXT. Der Admin kann eine Antwort nur anzeigen, nicht
     * speichern; eine Sammlung mit sechzig Zyklen und vierzig Rohfeldern will aber niemand aus
     * einem Meldungsfenster herauskopieren. Abgelegt wird sie deshalb im Dateibereich der
     * Instanz, und der Admin bekommt nur die Adresse - ein Klick, und die Tabelle liegt im
     * Download-Ordner.
     *
     * Das dafuer noetige meta-Objekt entsteht erst beim ersten Ausdruck. Wer die Diagnose nie
     * benutzt, bekommt dadurch auch kein zusaetzliches Objekt in seine Instanz.
     *
     * @returns {Promise<{url: string, datei: string, zeilen: number}>}
     */
    async sammlungAlsCsv() {
        const geraete = [];
        let zeilen = 0;
        for (const deviceId of Object.keys(this.devices || {})) {
            let saetze = [];
            try {
                const s = await this.getStateAsync(ids.s(deviceId, 'records'));
                saetze = JSON.parse((s && s.val) || '[]') || [];
            } catch (e) {
                this.log.debug(`CSV: ${deviceId} hat keine lesbare Sammlung (${e.message})`);
            }
            let name = deviceId;
            try {
                const o = await this.getObjectAsync(deviceId);
                const n = o && o.common && o.common.name;
                name = (typeof n === 'string' ? n : n && (n.de || n.en)) || deviceId;
            } catch {
                /* der Geraetename ist nur Beiwerk */
            }
            zeilen += saetze.length;
            geraete.push({ id: deviceId, name, saetze });
        }

        const version = (this.common && this.common.version) || paket.version || undefined;
        const jetzt = new Date();
        const text = csvBauer.csvBauen(geraete, version);
        const datei = csvBauer.dateiname(jetzt);
        // Der Dateibereich haengt an einem Objekt vom Typ meta - ohne das schlaegt writeFile fehl.
        await this.setForeignObjectNotExistsAsync(this.namespace, {
            type: 'meta',
            common: { name: 'Dateien', type: 'meta.user' },
            native: {},
        });
        await this.writeFileAsync(this.namespace, datei, text);

        /*
         * Die Auswertung als zweite Datei.
         *
         * Sie beantwortet die Frage, wegen der die Sammlung ueberhaupt laeuft - welches Feld
         * das Wasser ist -, und zwar je Feld eine Zeile statt je Zyklus. Ein Fehlschlag hier
         * darf den Hauptausdruck nicht mitreissen: Der ist auch allein brauchbar.
         */
        let befundDatei = null;
        try {
            befundDatei = csvBauer.befundDateiname(jetzt);
            await this.writeFileAsync(this.namespace, befundDatei, csvBauer.befundCsv(geraete, version));
        } catch (e) {
            befundDatei = null;
            this.log.warn(`CSV: die Auswertung liess sich nicht ablegen (${e.message})`);
        }

        this.log.info(
            `Sammlung als CSV abgelegt: ${datei} (${zeilen} Datensätze)${
                befundDatei ? `, Auswertung in ${befundDatei}` : ''
            }`,
        );
        return { url: `/files/${this.namespace}/${datei}`, datei, zeilen, befundDatei };
    }

    // --- Admin-Nachrichten (OAuth-Login) ---
    async onMessage(obj) {
        if (!obj || !obj.command) {
            return;
        }
        try {
            if (obj.command === 'getAuthUrl') {
                const cc = (obj.message && obj.message.country) || this.config.country || 'de';
                const { url, challenge } = cloud.buildAuthorizeUrl(cc);
                this.oauth[challenge.state] = challenge;
                this.log.info(`Login URL (open in browser): ${url}`);
                // `openUrl` lässt den Admin die Login-Seite im Browser öffnen.
                this.sendTo(obj.from, obj.command, { openUrl: url, state: challenge.state }, obj.callback);
                return;
            }
            if (obj.command === 'submitRedirect') {
                const redirectUrl = obj.message && obj.message.redirectUrl;
                const region = (obj.message && obj.message.region) || this.config.region || 'EU';
                if (!redirectUrl) {
                    throw new Error('No redirect URL provided.');
                }
                // passenden challenge über state finden
                let challenge = null;
                try {
                    const q = redirectUrl.slice(redirectUrl.indexOf('?') + 1);
                    const st = new URLSearchParams(q).get('state');
                    challenge = st ? this.oauth[st] : null;
                } catch {
                    /* ignore */
                }
                if (!challenge) {
                    challenge = Object.values(this.oauth).pop();
                }
                if (!challenge) {
                    throw new Error('No active login challenge. Please generate a new login URL.');
                }

                const code = cloud.parseRedirectUrl(redirectUrl, challenge.state);
                const tokens = await cloud.exchangeCode(challenge, code);
                const gk = await cloud.fetchGroupKey(tokens.access_token, region);
                delete this.oauth[challenge.state];
                this.sendTo(
                    obj.from,
                    obj.command,
                    {
                        native: {
                            groupId: gk.groupId,
                            groupKey: gk.groupKey,
                            refreshToken: tokens.refresh_token || '',
                            country: challenge.cc,
                            region,
                        },
                        saveConfig: true,
                        result: `${gk.devices.length} device(s) found in household. GroupKey saved.`,
                    },
                    obj.callback,
                );
                return;
            }
            if (obj.command === 'discover') {
                const list = await discover(6000, m => this.log.debug(m), this);
                this.sendTo(
                    obj.from,
                    obj.command,
                    {
                        devices: list.map(d => ({
                            ip: d.ip,
                            techType: d.techType,
                            deviceType: Number(d.txt.devicetype),
                            group: d.txt.group,
                        })),
                    },
                    obj.callback,
                );
                return;
            }
            if (obj.command === 'csvExport') {
                const { url, zeilen, datei, befundDatei } = await this.sammlungAlsCsv();
                this.sendTo(
                    obj.from,
                    obj.command,
                    {
                        openUrl: url,
                        // Nach dem Öffnen nicht die Konfiguration speichern - es wurde nichts geändert.
                        saveConfig: false,
                        result: `${zeilen} Datensätze in ${datei}${befundDatei ? ` · Auswertung: ${befundDatei}` : ''}`,
                    },
                    obj.callback,
                );
                return;
            }
        } catch (e) {
            this.sendTo(obj.from, obj.command, { error: e.message }, obj.callback);
        }
    }

    async onUnload(callback) {
        this.stopping = true;
        try {
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
            }
            if (this.discoveryTimer) {
                this.clearInterval(this.discoveryTimer);
            }
            if (this.enrollTimer) {
                this.clearInterval(this.enrollTimer);
            }
            if (this.ecoTimer) {
                this.clearInterval(this.ecoTimer);
            }
            if (this.hoursTimer) {
                this.clearInterval(this.hoursTimer);
            }
            if (this.verlaufTimer) {
                this.clearInterval(this.verlaufTimer);
            }
            if (this.secTimer) {
                this.clearInterval(this.secTimer);
            }
            if (this.push) {
                await this.push.stop();
            }
            await this.setStateAsync('info.connection', { val: false, ack: true });
            for (const deviceId of Object.keys(this.devices || {})) {
                await this.setStateAsync(`${deviceId}.info.connected`, { val: false, ack: true });
            }
        } catch {
            /* ignore */
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new MieleLocal(options);
} else {
    new MieleLocal();
}

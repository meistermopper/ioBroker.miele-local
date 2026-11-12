'use strict';

/*
 * Geraetekarten fuer den Device-Manager (Issue #22).
 *
 * Geprueft wird mit dem Objektbaum aus miele-local.0.json und einem nachgebauten Adapter.
 * Kein Test spricht ein Geraet an: Befehle landen in einer Attrappe, die den Abschluss von
 * lib/befehle.js nachspielt.
 */

const { expect } = require('chai');
const path = require('node:path');
const gm = require('../lib/geraetemanager');
const namen = require('../lib/names');

const NS = 'miele-local.0';
const BAUM = require(path.join(__dirname, '..', 'miele-local.0.json'));
const OFEN = '000133333333';
const WASCHMASCHINE = '000111111111';

/** Datenpunkte, die erst seit 0.5.0 angelegt werden - im Objektabzug fehlen sie noch. */
const NEU = ['control.canPowerOn', 'control.canPowerOff', 'control.canStart', 'control.canPause', 'control.canStop'];

function objekte({ neu = true } = {}) {
    const m = new Map();
    for (const [id, o] of Object.entries(BAUM)) {
        if (o.type === 'state' && id.startsWith(`${NS}.`)) {
            m.set(id.slice(NS.length + 1), o);
        }
    }
    if (neu) {
        for (const geraet of [OFEN, WASCHMASCHINE]) {
            for (const sub of NEU) {
                m.set(`${geraet}.${sub}`, { type: 'state', common: { name: sub, type: 'boolean' } });
            }
            m.set(`${geraet}.state.progress`, { type: 'state', common: { name: 'Progress', type: 'number', unit: '%' } });
        }
    }
    return m;
}

function karte(id, steuerung = true, deviceType = 12, neu = true) {
    return gm.karte({ ns: NS, id, obj: BAUM[`${NS}.${id}`], objekte: objekte({ neu }), deviceType, steuerung });
}

/** Die Zeilen einer Karte, Schluessel = Datenpunkt ohne Namensraum und Geraet. */
function zeilen(k, id) {
    const aus = {};
    for (const [schluessel, z] of Object.entries(k.customInfo.schema.items)) {
        aus[z.oid ? z.oid.replace(`${NS}.${id}.`, '') : schluessel] = z;
    }
    return aus;
}

/** Den hidden-Ausdruck einer Zeile so auswerten, wie es der Admin tut. */
function versteckt(z, states) {
    // eslint-disable-next-line no-new-func
    return !!new Function('_states', `return ${z.hidden}`)(states);
}

/** Adapter-Attrappe: Objekte aus dem Baum, Zustaende im Speicher, Befehle werden mitgeschrieben. */
function adapter({ allowControl = true, abschluss } = {}) {
    const zustaende = {};
    const geschrieben = [];
    const zeilen = typ =>
        Object.entries(BAUM)
            .filter(([id, o]) => o.type === typ && id.startsWith(`${NS}.`))
            .map(([id, o]) => ({ id, value: { ...o, _id: id } }));
    return {
        namespace: NS,
        config: { allowControl },
        log: { debug() {}, info() {}, warn() {}, error() {} },
        on() {},
        geschrieben,
        getObjectViewAsync: async (_d, typ) => ({ rows: zeilen(typ) }),
        getStateAsync: async id => zustaende[id] || (id.endsWith('info.deviceType') ? { val: 12 } : null),
        setStateAsync: async (id, st) => {
            geschrieben.push({ id, ...st });
            zustaende[id] = { ...st, ts: Date.now() };
            // lib/befehle.js schliesst jeden Befehl mit ack=true ab - hier nachgespielt.
            if (st.ack === false && abschluss) {
                setTimeout(() => (zustaende[id] = { ...abschluss, ack: true, ts: Date.now() }), 5);
            }
        },
        setTimeout: (f, ms) => setTimeout(f, ms),
    };
}

describe('Geräte-Manager', () => {
    it('jeder Text hat alle elf Sprachen und keine leeren Einträge', () => {
        for (const [k, t] of Object.entries(gm.TEXTE)) {
            expect(Object.keys(t), k).to.have.members(namen.SPRACHEN);
            for (const [sp, s] of Object.entries(t)) {
                expect(s, `${k}/${sp}`).to.be.a('string').and.not.equal('');
            }
        }
    });

    it('Platzhalter werden je Sprache eingesetzt', () => {
        const t = gm.text('confirm', { befehl: gm.TEXTE.start });
        expect(t.de).to.equal('„Start“ jetzt an das Gerät senden?');
        expect(t.fr).to.contain('Démarrer');
        expect(gm.text('failed', { grund: 'HTTP 403' }).en).to.equal('The command was not executed: HTTP 403');
    });

    it('Kopf ohne Doppeltes: Titel = Name + Modell, Seriennummer nur im Text, kein Hersteller', () => {
        const k = karte(OFEN);
        const roh = BAUM[`${NS}.${OFEN}`].common.name;
        expect(JSON.stringify(roh)).to.contain(`(${OFEN})`);
        expect(JSON.stringify(k.name)).to.not.contain(OFEN);
        expect(k.identifier).to.equal(OFEN);
        expect(k.manufacturer).to.equal(undefined);
        expect(k.model).to.equal(undefined);
        expect(gm.titel({ common: { name: 'Waschmaschine - WCR860 (000111111111)' } }, '000111111111')).to.equal(
            'Waschmaschine - WCR860',
        );
        expect(gm.titel({ common: { name: { de: 'Ofen (x1)', en: 'Oven (x1)' } } }, 'x1')).to.deep.equal({
            de: 'Ofen',
            en: 'Oven',
        });
        expect(gm.titel(undefined, 'x1')).to.equal('x1');
    });

    it('Karte zeigt den Betrieb: Erreichbarkeit, Status bis Programmende, Fortschrittsbalken', () => {
        const k = karte(OFEN);
        expect(k.status.connection.stateId).to.equal(`${NS}.${OFEN}.info.connected`);
        expect(k.status.connection.mapping).to.deep.equal({ true: 'connected', false: 'disconnected' });
        // laufender Betrieb als Datenpunkt-Zeilen auf der Karte (customInfo), keine info-Controls
        expect(k.controls).to.equal(undefined);
        const z = zeilen(k, OFEN);
        // Status, Programm und Phase haengen seit 0.5.1 am Rohwert (Wertetabelle in Systemsprache)
        expect(Object.keys(z)).to.include.members([
            'state.status',
            'state.programId',
            'state.programPhase',
            'state.remainingHHMM',
            'state.estimatedEndTimeText',
            '_state_progress',
        ]);
        for (const zeile of Object.values(z).filter(x => x.type === 'state')) {
            expect(zeile.readOnly).to.equal(true);
            expect(zeile.foreign).to.equal(true);
        }
        // Restzeit und Ende gross
        expect(z['state.remainingHHMM'].size).to.equal('large');
        expect(z['state.estimatedEndTimeText'].size).to.equal('large');
        expect(z['state.remainingHHMM'].label.de).to.equal('Restzeit');
        expect(z['state.estimatedEndTimeText'].label.de).to.equal('Ende um');
        expect(z['state.programId'].label.de).to.equal('Programm');
        expect(z['state.programPhase'].label.de).to.equal('Phase');
        // eigener Balken als HTML, Prozentzahl in derselben Zeile direkt am Balken
        const balken = z._state_progress;
        expect(balken.type).to.equal('staticText');
        expect(balken.format).to.equal('html');
        expect(balken.noTranslation).to.equal(true);
        // so wertet der Admin das Muster aus: als Template-Literal mit _states
        const html = new Function('_states', `return \`${balken.text}\``)({ v: { val: 37 } });
        expect(html).to.contain('width:37%');
        expect(html).to.match(/<span[^>]*>37\u00a0%<\/span><\/div>$/);
        expect(new Function('_states', `return \`${balken.text}\``)({ v: { val: 250 } })).to.contain('width:100%');
        expect(k.icon).to.match(/^data:image\/svg\+xml;base64,/);
        expect(k.hasDetails).to.equal(true);
        expect(k.group.key).to.equal('type12');
        expect(k.group.name.de).to.equal('Backofen');
        expect(k.group.name.en).to.equal('Oven');
    });

    it('leere Werte erscheinen nicht als leere Zeile', () => {
        const z = zeilen(karte(OFEN), OFEN);
        const mit = v => ({ v: { val: v } });
        // Programm 0 = "kein Programm", Phase 0 = "laeuft nicht": Zeile weg
        expect(versteckt(z['state.programId'], mit(0))).to.equal(true);
        expect(versteckt(z['state.programId'], mit(13))).to.equal(false);
        expect(versteckt(z['state.programPhase'], { v: null })).to.equal(true);
        expect(versteckt(z['state.programPhase'], mit(0))).to.equal(true);
        expect(versteckt(z['state.programPhase'], mit(3073))).to.equal(false);
        expect(versteckt(z['state.remainingHHMM'], mit('0:00'))).to.equal(true);
        expect(versteckt(z['state.remainingHHMM'], mit('1:25'))).to.equal(false);
        expect(versteckt(z['state.estimatedEndTimeText'], mit(''))).to.equal(true);
        expect(versteckt(z['state.estimatedEndTimeText'], mit('23:05'))).to.equal(false);
        expect(versteckt(z._state_progress, mit(0))).to.equal(true);
        expect(versteckt(z._state_progress, mit(37))).to.equal(false);
        // der Status steht immer da
        expect(z['state.status'].hidden).to.equal(undefined);
        // jede Bedingung haengt an ihrem eigenen Datenpunkt
        expect(z._state_progress.dependsOnStates).to.deep.equal({ v: `${NS}.${OFEN}.state.progress` });
    });

    it('Hinweise: Störung, Tür offen, Gerätehinweis - farbig, nur solange sie anstehen', () => {
        const z = zeilen(karte(OFEN), OFEN);
        for (const [sub, de] of [
            ['state.signalFailure', 'Störung – bitte am Gerät nachsehen'],
            ['state.signalDoor', 'Tür offen'],
        ]) {
            expect(z[sub].trueText.de).to.equal(de);
            expect(z[sub].trueTextStyle.color).to.match(/^#/);
            expect(versteckt(z[sub], { v: { val: true } })).to.equal(false);
            expect(versteckt(z[sub], { v: { val: false } })).to.equal(true);
        }
        expect(z['state.signalInfo'].trueText.de).to.contain('Hinweis');
        // Fernstart gesperrt: nur bereit/programmiert und ohne MobileStart
        const m = z._noMobileStart;
        expect(m.text.de).to.contain('MobileStart');
        expect(versteckt(m, { s: { val: 3 }, m: { val: false } })).to.equal(false);
        expect(versteckt(m, { s: { val: 3 }, m: { val: true } })).to.equal(true);
        expect(versteckt(m, { s: { val: 5 }, m: { val: false } })).to.equal(true);
        expect(versteckt(m, { s: { val: 1 }, m: { val: false } })).to.equal(true);
    });

    it('Knöpfe nach Zustand: Aus → Ein; bereit → Start, Aus; läuft → Pause, Stopp; pausiert → Start, Stopp', () => {
        const wm = (status, mobileStart = true) => gm.angebot({ deviceType: 1, status, mobileStart, verbunden: true });
        expect(wm(1)).to.deep.equal(['powerOn']);
        expect(wm(2)).to.deep.equal(['powerOff', 'start']);
        expect(wm(3)).to.deep.equal(['powerOff', 'start']);
        expect(wm(4)).to.deep.equal(['powerOff', 'start', 'stop']);
        expect(wm(5)).to.deep.equal(['pause', 'stop']);
        expect(wm(6)).to.deep.equal(['start', 'stop']);
        expect(wm(7)).to.deep.equal(['powerOff']);
        expect(wm(8)).to.deep.equal(['powerOff']);
        expect(wm(9)).to.deep.equal(['powerOff', 'stop']);
        expect(wm(10)).to.deep.equal(['powerOff']);
        expect(wm(11)).to.deep.equal(['start', 'stop']);
        for (const unklar of [0, 12, 13, 145, 147, 255, null, undefined]) {
            expect(wm(unklar), String(unklar)).to.deep.equal([]);
        }
    });

    it('Knöpfe nur, wenn das Gerät sie kann', () => {
        const a = (deviceType, status, mobileStart = true) =>
            gm.angebot({ deviceType, status, mobileStart, verbunden: true });
        // ohne MobileStart kein Start - das Geraet lehnte ihn ab
        expect(a(1, 3, false)).to.deep.equal(['powerOff']);
        expect(a(1, 6, false)).to.deep.equal(['stop']);
        // Spuelmaschine und Backofen pausieren nicht
        expect(a(7, 5)).to.deep.equal(['stop']);
        expect(a(12, 5)).to.deep.equal(['stop']);
        // Kuehlschrank und Kochfeld werden nicht geschaltet und haben keine Programme
        expect(a(19, 1)).to.deep.equal([]);
        expect(a(25, 1)).to.deep.equal([]);
        // Kaffeevollautomat: nur Ein/Aus
        expect(a(17, 1)).to.deep.equal(['powerOn']);
        expect(a(17, 3)).to.deep.equal(['powerOff']);
        // unbekannte Art: nichts
        expect(a(null, 1)).to.deep.equal([]);
        // nicht erreichbar: nichts
        expect(gm.angebot({ deviceType: 1, status: 5, mobileStart: true, verbunden: false })).to.deep.equal([]);
    });

    it('Knöpfe stehen in der Statuszeile und folgen live control.can<Befehl>', () => {
        expect(karte(OFEN, false).actions).to.equal(undefined);
        expect(karte(OFEN, false).indicators).to.equal(undefined);
        const k = karte(OFEN);
        // Backofen: kein Pause-Knopf, Licht als ein Umschalter
        expect(k.actions.map(a => a.id)).to.deep.equal(['powerOn', 'powerOff', 'start', 'stop', 'lightToggle']);
        for (const a of k.actions) {
            expect(a.icon).to.be.a('string');
            expect(a.description.de).to.be.a('string').and.not.equal('');
            // Eingriffe in den Betrieb werden bestaetigt, das Licht nicht.
            expect(!!a.confirmation, a.id).to.equal(a.id !== 'lightToggle');
        }
        expect(k.actions.find(a => a.id === 'start').confirmation.de).to.equal('„Programm starten“ jetzt an das Gerät senden?');
        // jeder Knopf ist eine Statusanzeige mit Beschriftung; die Aktion steht damit nicht noch im Fuss
        expect(k.indicators.map(i => i.actionId)).to.deep.equal(k.actions.map(a => a.id));
        for (const i of k.indicators.filter(x => x.actionId !== 'lightToggle')) {
            expect(i.value).to.deep.equal({ stateId: `${NS}.${OFEN}.control.${gm.KANN_ID[i.actionId]}` });
            expect(i.icon).to.equal(gm.KNOPFSYMBOL[i.actionId]);
            expect(i.text.de).to.be.a('string');
            expect(i.hideIfEmpty).to.not.equal(false);
        }
    });

    it('Licht: ein Umschalter, Symbol, Beschriftung und Tooltip zeigen den Zustand', () => {
        const licht = karte(OFEN).indicators.filter(i => i.actionId === 'lightToggle');
        expect(licht).to.have.length(1);
        const l = licht[0];
        expect(l.value).to.deep.equal({ stateId: `${NS}.${OFEN}.state.light` });
        // aus muss sichtbar bleiben
        expect(l.hideIfEmpty).to.equal(false);
        const an = l.levels.find(x => x.value === true);
        const aus = l.levels.find(x => x.value === false);
        expect(an.icon).to.equal(gm.KNOPFSYMBOL.lightOn);
        expect(an.text.de).to.equal('Licht an');
        expect(an.tooltip.de).to.equal('Garraumbeleuchtung ist an – klicken zum Ausschalten');
        expect(aus.icon).to.equal(gm.KNOPFSYMBOL.lightOff);
        expect(aus.text.de).to.equal('Licht aus');
        expect(aus.tooltip.de).to.equal('Garraumbeleuchtung ist aus – klicken zum Einschalten');
        // unbekannter Zustand (null): Auffangstufe = aus
        expect(l.levels[l.levels.length - 1].value).to.equal(undefined);
        expect(karte(OFEN, true, 23).indicators.find(i => i.actionId === 'lightToggle').levels[0].tooltip.de).to.contain(
            'Kochfeldbeleuchtung',
        );
    });

    it('Licht-Umschalter schaltet ins Gegenteil von state.light, ohne Rückfrage', async () => {
        for (const [zustand, erwartet] of [
            [true, 'lightOff'],
            [false, 'lightOn'],
            [null, 'lightOn'],
        ]) {
            const a = adapter({ abschluss: { val: false, q: 0 } });
            await a.setStateAsync(`${OFEN}.state.light`, { val: zustand, ack: true });
            a.geschrieben.length = 0;
            const mgr = new gm.MieleGeraeteManager(a);
            await mgr.befehl(OFEN, 'lightToggle', { showMessage: async () => {} }, { takt: 10 });
            expect(a.geschrieben[0], String(zustand)).to.include({ id: `${OFEN}.control.${erwartet}`, val: true, ack: false });
        }
    });

    it('ältere Objekte ohne control.can*: Knöpfe bleiben als Fussknöpfe', () => {
        const k = karte(OFEN, true, 12, false);
        expect(k.actions.map(a => a.id)).to.include('start');
        expect(k.indicators.map(i => i.actionId)).to.deep.equal(['lightToggle']);
    });

    it('Licht nur bei Geräten, die eines haben', () => {
        // Waschmaschine: Datenpunkt state.light gibt es, ein Licht nicht
        const ids = karte(WASCHMASCHINE, true, 1).actions.map(a => a.id);
        expect(ids).to.deep.equal(['powerOn', 'powerOff', 'start', 'pause', 'stop']);
    });

    it('Fortschritt: verstrichen / (verstrichen + Rest), nur im Lauf', () => {
        expect(gm.fortschritt(5, 30, 90)).to.equal(25);
        expect(gm.fortschritt(6, 60, 60)).to.equal(50);
        expect(gm.fortschritt(5, 1, 500)).to.equal(1);
        expect(gm.fortschritt(5, 500, 1)).to.equal(99);
        expect(gm.fortschritt(5, 0, 90)).to.equal(0);
        expect(gm.fortschritt(5, 30, 0)).to.equal(0);
        expect(gm.fortschritt(1, 78, 0)).to.equal(0);
        expect(gm.fortschritt(7, 30, 5)).to.equal(0);
        expect(gm.fortschritt(null, 30, 5)).to.equal(0);
    });

    it('keine Konfigurationsaktionen: keine Instanz-Aktionen, keine Such-/Koppel-/Löschknöpfe', () => {
        const mgr = new gm.MieleGeraeteManager(adapter());
        const inst = mgr.getInstanceInfo();
        expect(inst.apiVersion).to.equal('v3');
        expect(inst.actions).to.equal(undefined);
        const verboten = /discover|search|pair|delete|add|new|scan|settings|rename|edit/i;
        for (const id of [OFEN, WASCHMASCHINE]) {
            for (const a of karte(id).actions || []) {
                expect(a.id).to.not.match(verboten);
            }
        }
    });

    it('Aufklappfeld nennt nur vorhandene Werte, live aus den Datenpunkten', () => {
        const d = gm.details(OFEN, objekte());
        const items = Object.values(d.schema.items);
        expect(items.length).to.be.greaterThan(5);
        for (const i of items) {
            expect(i.type).to.equal('state');
            expect(objekte().has(i.oid), i.oid).to.equal(true);
        }
        expect(items.some(i => i.oid === `${OFEN}.state.targetTemperature` && i.unit === '°C')).to.equal(true);
    });

    it('loadDevices legt je Gerät eine Karte an', async () => {
        const mgr = new gm.MieleGeraeteManager(adapter());
        const karten = [];
        let gesamt = 0;
        await mgr.loadDevices({ addDevice: k => karten.push(k), setTotalDevices: n => (gesamt = n) });
        const erwartet = Object.values(BAUM).filter(o => o.type === 'device').length;
        expect(gesamt).to.equal(erwartet);
        expect(karten).to.have.length(erwartet);
        expect(karten.every(k => typeof k.actions[0].handler === 'function')).to.equal(true);
    });

    it('Knopf schreibt den Steuer-Datenpunkt mit ack=false und meldet Erfolg still', async () => {
        const a = adapter({ abschluss: { val: false, q: 0, c: 'done via 2/1586 (HTTP 204)' } });
        const mgr = new gm.MieleGeraeteManager(a);
        const meldungen = [];
        const erg = await mgr.befehl(OFEN, 'powerOn', { showMessage: async t => meldungen.push(t) }, { takt: 10 });
        expect(erg).to.deep.equal({ refresh: 'none' });
        expect(a.geschrieben[0]).to.include({ id: `${OFEN}.control.powerOn`, val: true, ack: false });
        expect(meldungen).to.deep.equal([]);
    });

    it('abgelehnter Befehl: Grund aus dem Kommentarfeld wird angezeigt', async () => {
        const a = adapter({ abschluss: { val: false, q: 0x44, c: 'not executed: HTTP 403 from x' } });
        const mgr = new gm.MieleGeraeteManager(a);
        const meldungen = [];
        await mgr.befehl(OFEN, 'start', { showMessage: async t => meldungen.push(t) }, { takt: 10 });
        expect(meldungen).to.have.length(1);
        expect(meldungen[0].de).to.equal('Der Befehl wurde nicht ausgeführt: HTTP 403 from x');
    });

    it('ohne Abschluss: Zeitüberschreitung wird gemeldet, nichts wiederholt', async () => {
        const a = adapter();
        const erg = await gm.befehlAusfuehren(a, `${OFEN}.control.stop`, { wartezeit: 40, takt: 10 });
        expect(erg).to.deep.equal({ zeitueberschreitung: true });
        expect(a.geschrieben).to.have.length(1);
    });
});

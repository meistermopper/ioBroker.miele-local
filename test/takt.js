'use strict';

/*
 * Abfragetakt je Geraet (lib/takt.js, seit 0.3.46).
 *
 * Simuliert eine Stunde mit drei Geraeten, von denen nur der Backofen laeuft, und zaehlt die
 * Abfragen. Bis 0.3.45 haetten alle drei im Betriebstakt gezaehlt - genau das darf nicht
 * wiederkommen.
 */

const { expect } = require('chai');
const takt = require('../lib/takt');

const AKTIV = 60_000;
const RUHE = 120_000;

/** Die Schleife des Adapters nachgestellt: wecken, faellige abfragen, Termine neu setzen. */
function simuliere(geraete, dauerMs, istAktiv = id => geraete[id].active) {
    const zaehler = Object.fromEntries(Object.keys(geraete).map(id => [id, 0]));
    let jetzt = 0;
    while (jetzt < dauerMs) {
        for (const [id, dev] of Object.entries(geraete)) {
            if (!takt.istFaellig(dev, jetzt)) continue;
            zaehler[id]++;
            dev.active = istAktiv(id, jetzt);          // wie applyState() nach der Abfrage
            dev.naechsteAbfrage = jetzt + takt.abstand(dev, AKTIV, RUHE);
        }
        jetzt += takt.weckAbstand(Object.values(geraete), jetzt, RUHE);
    }
    return zaehler;
}

describe('Abfragetakt je Geraet', () => {
    it('fragt nur das laufende Geraet im Betriebstakt, die anderen im Ruhetakt', () => {
        const z = simuliere({ ofen: { active: true }, wasch: { active: false }, spuel: { active: false } }, 3600_000);
        expect(z.ofen).to.equal(60);
        expect(z.wasch).to.equal(30);
        expect(z.spuel).to.equal(30);
    });

    it('ohne laufendes Geraet: alle im Ruhetakt', () => {
        const z = simuliere({ a: {}, b: {} }, 3600_000);
        expect(z).to.deep.equal({ a: 30, b: 30 });
    });

    it('ein neu gefundenes Geraet (ohne Termin) ist sofort dran', () => {
        expect(takt.istFaellig({}, 0)).to.equal(true);
        expect(takt.istFaellig({ naechsteAbfrage: 5000 }, 4999)).to.equal(false);
    });

    it('wechselt nach dem Einschalten in den Betriebstakt', () => {
        // Ofen geht nach 10 min an: bis dahin Ruhetakt, danach Betriebstakt.
        const z = simuliere({ ofen: {} }, 3600_000, (id, t) => t >= 600_000);
        // 0..600 s: Abfragen bei 0,120,...,600 (6, die bei 600 s erkennt den Betrieb), danach je 60 s bis 3540 s (49)
        expect(z.ofen).to.equal(55);
    });

    it('weckt nie oefter als einmal je Sekunde und ohne Geraete im Ruhetakt', () => {
        expect(takt.weckAbstand([{ naechsteAbfrage: 100 }], 0, RUHE)).to.equal(takt.MIN_WECKABSTAND_MS);
        expect(takt.weckAbstand([], 0, RUHE)).to.equal(RUHE);
        expect(takt.weckAbstand([{ naechsteAbfrage: 90_000 }, { naechsteAbfrage: 30_000 }], 0, RUHE)).to.equal(30_000);
    });
});

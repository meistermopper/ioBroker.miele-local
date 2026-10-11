'use strict';

const { expect } = require('chai');
const ids = require('../lib/ids');

/*
 * Die Umbenennung auf englische IDs - und der Umzug, der sie ueberlebbar macht.
 *
 * Bis 0.3.37 hiess der Diagnosekanal "sammlung" und trug ausschliesslich deutsche
 * Datenpunktnamen, dazu vier deutsche im sonst englischen Kanal "history". Der Pruefer des
 * Aufnahmeantrags hielt sie fuer von Hand angelegte Skript-Objekte. Seit 0.3.38 sind sie
 * englisch; die alten Werte zieht der Adapter beim ersten Start um.
 */
describe('Objekt-IDs', () => {

    it('fuehrt keine nicht-englische ID mehr', () => {
        const deutsch = /sammlung|zyklen|fortschritt|befund|kontrolle|eingabe|gemessen|laufend|zaehler|verlauf/i;
        const alle = [ids.KANAL.collection,
                      ...Object.values(ids.SAMMLUNG), ...Object.values(ids.HISTORY)];
        const uebrig = alle.filter(x => deutsch.test(x));
        expect(uebrig, `noch deutsch: ${uebrig.join(', ')}`).to.deep.equal([]);
    });

    it('baut die Pfade aus der Tabelle, nicht aus festen Zeichenketten', () => {
        expect(ids.s('000111111111', 'finding')).to.equal('000111111111.collection.finding');
        expect(ids.h('000111111111', 'runningSince')).to.equal('000111111111.history.runningSince');
        expect(ids.kanal('000111111111')).to.equal('000111111111.collection');
    });

    it('meldet einen unbekannten Schluessel, statt einen falschen Pfad zu bauen', () => {
        // Ein Tippfehler darf nicht als Datenpunkt "undefined" im Baum landen.
        expect(() => ids.s('X', 'gibtEsNicht')).to.throw(/gibtEsNicht/);
        expect(() => ids.h('X', 'gibtEsNicht')).to.throw(/gibtEsNicht/);
    });

    it('nennt fuer jeden alten Datenpunkt genau einen neuen', () => {
        const u = ids.umzuege('000111111111');
        expect(u).to.have.length(
            Object.keys(ids.ALT.sammlung).length + Object.keys(ids.ALT.history).length +
                Object.keys(ids.ALT.eco).length);
        // Keine zwei alten Punkte duerfen auf denselben neuen zeigen - das verlöre einen Wert.
        expect(new Set(u.map(x => x.neu)).size).to.equal(u.length);
        expect(new Set(u.map(x => x.alt)).size).to.equal(u.length);
    });

    it('nennt fuer jede alte ID einen Schluessel, den es noch gibt', () => {
        for (const k of Object.keys(ids.ALT.sammlung)) {
            expect(ids.SAMMLUNG[k], `SAMMLUNG.${k} fehlt`).to.be.a('string');
        }
        for (const k of Object.keys(ids.ALT.history)) {
            expect(ids.HISTORY[k], `HISTORY.${k} fehlt`).to.be.a('string');
        }
    });

    it('zieht nichts um, was schon am richtigen Ort liegt', () => {
        // Nach einer spaeteren Umbenennung, die einen Namen unveraendert laesst, darf dieser
        // Punkt nicht in der Liste stehen - sonst loescht der Umzug ihn nach dem Kopieren.
        for (const { alt, neu } of ids.umzuege('X')) {
            expect(alt, 'alt und neu duerfen nie gleich sein').to.not.equal(neu);
        }
    });

    it('zieht eco.quelle nach eco.source um (0.3.45, letzter deutscher Name im Baum)', () => {
        expect(ids.umzuege('X')).to.deep.include({ alt: 'X.eco.quelle', neu: 'X.eco.source' });
    });

    it('kennt den alten Kanal, um ihn nach dem Umzug zu entfernen', () => {
        expect(ids.alterKanal('000111111111')).to.equal('000111111111.sammlung');
    });
});

describe('Einstellungen auf englische Namen umziehen (0.3.45, Review 03.10.2026)', () => {
    it('übernimmt die alten Werte unter den neuen Namen und entfernt die alten', () => {
        const { native, geaendert } = ids.konfigUmzug({
            sammlerAktiv: true, sammlerCloud: true, sammlerCloudInstanz: 'mielecloudservice.1',
            leafDatenpunkte: false, pollInterval: 15,
            zaehler: [{ serial: '000111111111', datenpunkt: 'shelly.0.x.Energy' }],
        });
        expect(geaendert).to.be.true;
        expect(native).to.deep.equal({
            collectorActive: true, collectorCloud: true, collectorCloudInstance: 'mielecloudservice.1',
            leafStates: false, pollInterval: 15,
            energyMeters: [{ serial: '000111111111', stateId: 'shelly.0.x.Energy' }],
        });
    });

    it('der alte Wert gewinnt gegen die beim Update ergänzte Vorgabe', () => {
        // ioBroker ergänzt beim Update neue native-Schlüssel mit ihrer Vorgabe - die echte
        // Einstellung des Nutzers steht dann noch unter dem alten Namen.
        const { native } = ids.konfigUmzug({ sammlerAktiv: true, collectorActive: false });
        expect(native).to.deep.equal({ collectorActive: true });
    });

    it('läuft genau einmal - danach gibt es nichts mehr umzuziehen', () => {
        const erst = ids.konfigUmzug({ sammlerAktiv: true, zaehler: [{ serial: 'S', datenpunkt: 'D' }] }).native;
        expect(ids.konfigUmzug(erst).geaendert).to.be.false;
        expect(ids.konfigUmzug({ collectorActive: false, energyMeters: [] }).geaendert).to.be.false;
        expect(ids.konfigUmzug(undefined).geaendert).to.be.false;
    });

    it('zieht eco.felderJson nach eco.fieldsJson um', () => {
        expect(ids.umzuege('X')).to.deep.include({ alt: 'X.eco.felderJson', neu: 'X.eco.fieldsJson' });
    });
});

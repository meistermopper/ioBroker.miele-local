'use strict';

const { expect } = require('chai');
const { mussNachziehen } = require('../lib/objektabgleich');

describe('objektabgleich: mussNachziehen', () => {
    const soll = {
        type: 'state',
        common: {
            name: { en: 'Water total', de: 'Wasser gesamt' },
            type: 'number',
            role: 'value',
            unit: 'l',
            def: 0,
            read: true,
            write: false,
        },
        native: {},
    };

    it('legt ein fehlendes Objekt an', () => {
        expect(mussNachziehen(null, soll)).to.equal(true);
        expect(mussNachziehen(undefined, soll)).to.equal(true);
    });

    it('laesst ein unveraendertes Objekt in Ruhe - auch wenn custom dazugekommen ist', () => {
        const ist = {
            type: 'state',
            common: Object.assign({}, soll.common, { custom: { 'history.0': { enabled: true } }, smartName: false }),
            native: {},
        };
        expect(mussNachziehen(ist, soll)).to.equal(false);
    });

    it('zieht nach, wenn sich Name, Rolle oder Einheit geaendert haben', () => {
        const basis = { type: 'state', common: Object.assign({}, soll.common), native: {} };
        expect(mussNachziehen({ ...basis, common: { ...basis.common, unit: 'm3' } }, soll)).to.equal(true);
        expect(mussNachziehen({ ...basis, common: { ...basis.common, role: 'value.water' } }, soll)).to.equal(true);
        expect(mussNachziehen({ ...basis, common: { ...basis.common, name: 'Wasser gesamt' } }, soll)).to.equal(true);
        expect(mussNachziehen({ ...basis, type: 'channel' }, soll)).to.equal(true);
    });

    it('zieht nach, wenn ein neues Feld (z. B. desc) hinzukommt', () => {
        const ist = { type: 'state', common: Object.assign({}, soll.common), native: {} };
        expect(mussNachziehen(ist, { ...soll, common: { ...soll.common, desc: { en: 'x', de: 'x' } } })).to.equal(true);
    });

    it('ueberspringt undefined-Felder wie extendObject', () => {
        const ist = { type: 'state', common: Object.assign({}, soll.common), native: {} };
        delete ist.common.unit;
        expect(mussNachziehen(ist, { ...soll, common: { ...soll.common, unit: undefined } })).to.equal(false);
    });
});

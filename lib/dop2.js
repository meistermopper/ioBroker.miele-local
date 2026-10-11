'use strict';

/**
 * Minimaler DOP2-Binärparser (portiert aus akappner/MieleRESTServer MieleDop2.py).
 * Dekodiert einen Leaf in eine Map { feldindex(1-based) -> { type, value } }.
 * Struct-Werte sind Arrays von Sub-Attributen; Integer sind Big-Endian.
 */

// Feste Byte-Längen je Feldtyp
const FIXED = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 4, 9: 4, 10: 4, 11: 8, 12: 8, 13: 8, 14: 4, 15: 8 };
const SIGNED = new Set([3, 6, 9, 12]);
// Array-Elementtypen: type -> elementByteLength
const ARRAY_ELEM = { 17: 1, 20: 1, 21: 2, 22: 2, 23: 2, 25: 4, 27: 8 };

function readInt(buf, off, len, signed) {
    let v = 0n;
    for (let i = 0; i < len; i++) {
        v = (v << 8n) | BigInt(buf[off + i]);
    }
    if (signed) {
        const bits = BigInt(len * 8);
        if (v >= 1n << (bits - 1n)) {
            v -= 1n << bits;
        }
    }
    return len > 4 ? v : Number(v); // 8-Byte als BigInt, sonst Number
}

/**
 * Dekodiert EIN Feld ab off. Gibt { value, wireLength } zurück.
 *
 * @param type DOP2-Typkennung des Feldes
 * @param buf entschluesselte Leaf-Bytes
 * @param off Startposition des Feldes
 */
function decodeField(type, buf, off) {
    if (FIXED[type] != null) {
        const len = FIXED[type];
        if (type === 1) {
            return { value: buf[off] === 1, wireLength: 1 };
        }
        if (type === 14) {
            return { value: buf.readFloatBE(off), wireLength: 4 };
        }
        if (type === 15) {
            return { value: buf.readDoubleBE(off), wireLength: 8 };
        }
        return { value: readInt(buf, off, len, SIGNED.has(type)), wireLength: len };
    }
    if (type === 16) {
        return decodeStruct(buf, off);
    }
    if (type === 18 || type === 32) {
        const strLen = (buf[off] << 8) + buf[off + 1];
        return { value: buf.subarray(off + 2, off + 2 + strLen), wireLength: 2 + strLen };
    }
    if (ARRAY_ELEM[type] != null) {
        const n = (buf[off] << 8) + buf[off + 1];
        const el = ARRAY_ELEM[type];
        const vals = [];
        for (let i = 0; i < n; i++) {
            const p = off + 2 + i * el;
            vals.push(type === 17 ? buf[p] === 1 : readInt(buf, p, el, SIGNED.has(type - 10)));
        }
        return { value: vals, wireLength: 2 + n * el };
    }
    throw new Error(`Unknown DOP2 field type ${type} @${off}`);
}

/**
 * Struct: Header [byte0, numberOfFields, byte2], dann Felder [id, type, value] mit 0x00-Padding.
 *
 * @param buf entschluesselte Leaf-Bytes
 * @param off Startposition der Struktur
 */
function decodeStruct(buf, off) {
    const numberOfFields = buf[off + 1];
    if (numberOfFields === 0 || numberOfFields > 160) {
        throw new Error(`Implausible struct (${numberOfFields} fields)`);
    }
    let p = off + 3;
    let fieldLength = 0;
    const fields = [];
    while (true) {
        const dataType = buf[p + 1];
        const f = decodeField(dataType, buf, p + 2);
        const cur = f.wireLength + 2;
        fieldLength += cur;
        /*
         * Die Feldnummer wird MITGENOMMEN, nicht weggeworfen.
         *
         * Bis 0.3.36 stand hier nur Typ und Wert. Fuer die Wertehuellen genuegte das - dort
         * steht der Messwert immer an derselben Stelle. Fuer eine verschachtelte Struktur
         * genuegt es nicht: 2/1585 Feld 6 traegt die EcoFeedback-Werte des Geraets, und deren
         * Nummern sind lueckenhaft (1, 3, 4, 5, ... 36). Ohne Nummer liesse sich nur raten,
         * welcher Wert zu welchem Namen gehoert, und geraten wird hier nicht.
         */
        fields.push({ id: buf[p], type: dataType, value: f.value });
        if (fields.length === numberOfFields) {
            break;
        }
        p += cur;
        if (buf[p] === 0x00) {
            p += 1;
            fieldLength += 1;
        }
    }
    return { value: fields, wireLength: fieldLength + 3 };
}

/**
 * Parst einen ganzen DOP2-Leaf (entschlüsselte Bytes) → { unit, attr, fields{idx:{type,value}} }.
 *
 * @param buf entschluesselte Leaf-Bytes
 */
function parseLeaf(buf) {
    const payloadLength = (buf[0] << 8) + buf[1];
    const unit = (buf[2] << 8) + buf[3];
    const attr = (buf[4] << 8) + buf[5];
    const padding = buf.length - payloadLength - 2;
    const payload = buf.subarray(8, buf.length - (padding > 0 ? padding : 0));
    const fields = {};
    if (payload.length === 0) {
        return { unit, attr, fields };
    }
    const numberOfFields = payload[3] + (payload[4] << 8);
    let rem = payload.subarray(5);
    let count = 0;
    while (count < numberOfFields && rem.length >= 2) {
        const idx = rem[0];
        const type = rem[1];
        const f = decodeField(type, rem, 2);
        fields[idx] = { type, value: f.value };
        count++;
        rem = rem.subarray(3 + f.wireLength);
    }
    return { unit, attr, fields };
}

/**
 * Wert eines "interpretierten" Feldes (Struct [mask, value, interpretation]) → mittleres Sub-Feld.
 *
 * @param fields dekodierte Felder des Leafs
 * @param idx Feldnummer
 */
function interpValue(fields, idx) {
    const f = fields[idx];
    if (!f || !Array.isArray(f.value) || f.value.length < 2) {
        return null;
    }
    return wertAusStruktur(f.value);
}

/**
 * Den Istwert aus einer Wertstruktur holen - an der richtigen Stelle.
 *
 * WARUM DAS NICHT IMMER DIE ZWEITE STELLE IST. Miele verpackt jeden Messwert in eine kleine
 * Struktur, und es gibt zwei Bauarten (siehe lib/leafnamen.js, WERT_INDEX):
 *
 *     Annotated  [Maske 8, WERT, Deutung]                          - 3 Eintraege
 *     Generic    [Maske 9, min, max, ISTWERT, Schrittweite, ...]   - 5 oder mehr
 *
 * Bis 0.3.36 las diese Funktion immer die zweite Stelle. Bei Annotated ist das richtig, bei
 * Generic ist es das MINIMUM - und das steht bei allen beobachteten Feldern auf 0. Betroffen
 * waren sieben Felder des Eco-Leaf, darunter die Zieltemperatur.
 *
 * DER BELEG (15.09.2026, WCR860, 40-Grad-Programm): Feld 24 heatingTargetTemperature kam als
 * [9, 0, 0, 40, 0, 0] vom Geraet. Der Adapter meldete 0, das Geraet meinte 40.
 *
 * ERKANNT WIRD DIE BAUART AN DER LAENGE, nicht am Namen: Die Namenstabelle stammt von fremden
 * Geraeten, die Struktur liegt vor. Drei Eintraege heissen Annotated, fuenf oder mehr Generic.
 * Ein Sonderfall bleibt die Laenge 4 - sie ist bei keinem Geraet beobachtet worden; dort wird
 * wie bisher die zweite Stelle gelesen, weil eine Generic-Struktur nie so kurz ist.
 *
 * @param {Array} struktur  die Sub-Attribute eines Struct-Feldes
 * @returns {unknown} der Wert, oder null
 */
function wertAusStruktur(struktur) {
    if (!Array.isArray(struktur) || struktur.length < 2) {
        return null;
    }
    const generic = struktur.length >= 5;
    // Wo die Feldnummern vorliegen, entscheiden sie - die Stelle ist nur der Rueckfall fuer
    // Strukturen aus alten Abzuegen und aus den Tests.
    const gesucht = generic ? 4 : 2;
    const benannt = struktur.find(e => e && typeof e === 'object' && e.id === gesucht);
    if (benannt) {
        return benannt.value;
    }
    const e = struktur[generic ? 3 : 1];
    return e && typeof e === 'object' && 'value' in e ? e.value : null;
}

/**
/**
 * Eco-Werte aus einem ProcessData-Leaf.
 *
 * Als eigene Funktion, damit die Skalierung prüfbar ist und nicht verstreut im Adapter steht.
 * Feldindizes UND Teiler kommen von aussen: Beide sind modellabhängig, und ein falscher Teiler
 * fällt weniger auf als ein falscher Index - er liefert plausible Zahlen in der falschen
 * Groessenordnung.
 *
 * @param {object} fields    dekodierte Felder des Leaf
 * @param {number} energyIdx Feldindex der Energie
 * @param {number} waterIdx  Feldindex des Wassers
 * @param {number} [waterDiv] Teiler für das Wasserfeld: 1 bei ganzen Litern, 10 bei
 *                               Zehnteln, 100 bei Hundertsteln
 * @returns {{energyWh: number|null, energyKwh: number|null, waterL: number|null}} Energie in Wh und kWh, Wasser in Litern; null, wo das Feld fehlt
 */
function ecoValues(fields, energyIdx, waterIdx, waterDiv = 200) {
    const e = interpValue(fields, energyIdx);
    const w = interpValue(fields, waterIdx);
    const teiler = Number(waterDiv) > 0 ? Number(waterDiv) : 200;
    return {
        energyWh: e == null ? null : Number(e),
        energyKwh: e == null ? null : Math.round(Number(e)) / 1000,
        waterL: w == null ? null : Math.round((Number(w) * 100) / teiler) / 100,
    };
}

/**
 * Aus dem geparsten Feld den blossen Wert holen - notfalls durch mehrere Schichten.
 *
 * WARUM DAS NOETIG IST. parseLeaf liefert je Feld ein Paar aus Typ und Wert. Bei einfachen
 * Zahlen ist das harmlos, bei Listen nicht: Deren Wert ist selbst wieder eine Liste solcher
 * Paare. Wer nur die oberste Schicht abstreift, speichert am Ende
 * "[{'type':'u8','value':3},...]" statt "[3,...]".
 *
 * BigInt wird zu Number, weil JSON es sonst nicht darstellen kann; Puffer werden zu Text ohne
 * die Nullen am Ende.
 *
 * Stand bis 0.3.36 als statische Methode in main.js. Sie ist hierher gewandert, weil
 * lib/datenpunkte.js sie ebenso braucht und eine zweite Kopie beim naechsten Umbau
 * auseinandergelaufen waere.
 *
 * @param v geparstes Feld, auch verschachtelt
 */
function reinerWert(v) {
    if (typeof v === 'bigint') {
        return Number(v);
    }
    if (Buffer.isBuffer(v)) {
        return v.toString('latin1').replace(/\0+$/, '');
    }
    if (Array.isArray(v)) {
        return v.map(x => reinerWert(x));
    }
    // Ein Paar aus Typ und Wert - die Schale abstreifen und weitersuchen.
    if (v && typeof v === 'object' && 'value' in v) {
        return reinerWert(v.value);
    }
    return v;
}

/** Feldtyp einer verschachtelten Struktur - alles andere ist ein einfacher Wert oder eine Liste. */
const TYP_STRUKTUR = 16;

module.exports = { parseLeaf, interpValue, wertAusStruktur, reinerWert, TYP_STRUKTUR, decodeField, ecoValues };

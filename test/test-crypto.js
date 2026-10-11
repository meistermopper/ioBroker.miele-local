'use strict';

// Eigenständige Krypto-Tests (kein Gerät nötig). Prüft Signatur-Determinismus,
// AES-Roundtrip und Padding.

const assert = require('assert');
const { MieleCrypto } = require('../lib/crypto');

// Test-Schlüssel (keine echten Zugangsdaten)
const GROUP_ID = '0123456789ABCDEF';
const GROUP_KEY = 'AA'.repeat(64); // 64 Byte

let failed = 0;
function ok(name, fn) {
    try {
        fn();
        console.log('  ✓', name);
    } catch (e) {
        failed++;
        console.log('  ✗', name, '→', e.message);
    }
}

console.log('MieleCrypto-Tests:');

ok('GroupKey-Länge validiert', () => {
    assert.throws(() => new MieleCrypto(GROUP_ID, 'AA'), /64 bytes/);
});

const mc = new MieleCrypto(GROUP_ID, GROUP_KEY);

ok('Signatur ist deterministisch & Großbuchstaben-Hex', () => {
    const s1 = mc.sign('GET', '192.168.0.10', 'Devices/000/State');
    const s2 = mc.sign('GET', '192.168.0.10', 'Devices/000/State');
    assert.strictEqual(s1, s2);
    assert.match(s1, /^[0-9A-F]{64}$/);
});

ok('Authorization-Header korrekt aufgebaut', () => {
    const { headers } = mc.headers('GET', 'h', 'r');
    assert.ok(headers.Authorization.startsWith(`MieleH256 ${GROUP_ID}:`));
    assert.strictEqual(headers.Accept, 'application/vnd.miele.v1+json');
});

ok('signResponse → decryptWithSignature Roundtrip (JSON parsebar)', () => {
    const payload = JSON.stringify({ Content: { Status: 5, ProgramID: 69 } });
    const { body, signature } = mc.signResponse(200, 'Thu, 01 Jan 1970 00:00:00 GMT', payload);
    const sig = signature.split(':')[1];
    const back = mc.decryptWithSignature(sig, body).toString('utf8');
    const parsed = JSON.parse(back.replace(/[\x00\x20]+$/g, ''));
    assert.deepStrictEqual(parsed, { Content: { Status: 5, ProgramID: 69 } });
});

ok('PUT-Body-Padding ist 16-Byte-ausgerichtet', () => {
    const padded = MieleCrypto.padBody(Buffer.from('12345')); // 5 Byte
    assert.strictEqual(padded.length % 16, 0);
});

ok('IV = erste 16 Byte der Signatur', () => {
    const iv = MieleCrypto.ivFromSignature('00112233445566778899AABBCCDDEEFF0011');
    assert.strictEqual(iv.length, 16);
    assert.strictEqual(iv.toString('hex'), '00112233445566778899aabbccddeeff');
});

if (failed) {
    console.log(`\n${failed} Test(s) fehlgeschlagen.`);
    process.exit(1);
}
console.log('\nAlle Krypto-Tests bestanden.');

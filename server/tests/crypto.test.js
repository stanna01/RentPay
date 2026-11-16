import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, isEncrypted, needsReencrypt } from '../src/crypto.js';

test('encrypt/decrypt round-trips', () => {
  const secret = 'my-16-char-app-pw';
  const enc = encryptSecret(secret);
  assert.ok(isEncrypted(enc), 'output should be tagged as encrypted');
  assert.notEqual(enc, secret, 'ciphertext must differ from plaintext');
  assert.equal(decryptSecret(enc), secret);
});

test('empty input stays empty', () => {
  assert.equal(encryptSecret(''), '');
  assert.equal(decryptSecret(''), '');
});

test('legacy plaintext passes through decryptSecret', () => {
  // Values saved before encryption existed are not prefixed and must still work.
  assert.equal(decryptSecret('plain-old-password'), 'plain-old-password');
});

test('each encryption uses a fresh IV (ciphertexts differ)', () => {
  assert.notEqual(encryptSecret('same'), encryptSecret('same'));
});

test('tampered ciphertext fails closed (returns empty, no throw)', () => {
  const enc = encryptSecret('secret');
  const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'B' : 'A');
  assert.equal(decryptSecret(tampered), '');
});

test('with ENCRYPTION_KEY set: writes v2, still reads v1, and flags v1 for re-encryption', () => {
  const saved = process.env.ENCRYPTION_KEY;
  try {
    delete process.env.ENCRYPTION_KEY;
    const v1 = encryptSecret('smtp-pass');
    assert.ok(v1.startsWith('enc:v1:'));

    process.env.ENCRYPTION_KEY = 'a-separate-strong-key-for-tests-0123456789';
    const v2 = encryptSecret('smtp-pass');
    assert.ok(v2.startsWith('enc:v2:'));
    assert.equal(decryptSecret(v2), 'smtp-pass');
    assert.equal(decryptSecret(v1), 'smtp-pass', 'older v1 values must stay readable');
    assert.equal(needsReencrypt(v1), true);
    assert.equal(needsReencrypt(v2), false);
    assert.equal(needsReencrypt('plain'), true);

    process.env.ENCRYPTION_KEY = 'a-different-key-entirely-0123456789abcdef';
    assert.equal(decryptSecret(v2), '', 'wrong key fails closed');
  } finally {
    if (saved === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = saved;
  }
});

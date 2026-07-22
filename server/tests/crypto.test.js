import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, isEncrypted } from '../src/crypto.js';

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

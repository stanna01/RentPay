// Symmetric encryption for secrets stored in the database (the SMTP password).
// AES-256-GCM. Values are tagged with a version prefix so we can tell which
// key encrypted them and migrate transparently:
//
//   enc:v2:  key = ENCRYPTION_KEY (its own secret, separate from JWT_SECRET)
//   enc:v1:  key derived from JWT_SECRET (older values; still decrypted)
//   no tag:  legacy plaintext (still read, re-encrypted on next save)
//
// When ENCRYPTION_KEY is not set we keep writing v1 so nothing breaks, but the
// server warns at startup (and refuses to start in production).

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const V1 = 'enc:v1:';
const V2 = 'enc:v2:';

function v1Key() {
  const secret = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
  return crypto.createHash('sha256').update('rentreceipt-smtp::' + secret).digest(); // 32 bytes
}

function v2Key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update('rentreceipt-enc-v2::' + raw).digest();
}

export function hasEncryptionKey() {
  return !!process.env.ENCRYPTION_KEY;
}

/** Encrypt a UTF-8 string. Empty input returns empty (nothing to store). */
export function encryptSecret(plain) {
  if (!plain) return '';
  const k2 = v2Key();
  const [prefix, key] = k2 ? [V2, k2] : [V1, v1Key()];
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return prefix + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptWith(key, body) {
  const raw = Buffer.from(body, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Decrypt a value produced by encryptSecret. Legacy plaintext passes through. */
export function decryptSecret(stored) {
  if (!stored) return '';
  const s = String(stored);
  try {
    if (s.startsWith(V2)) {
      const k = v2Key();
      return k ? decryptWith(k, s.slice(V2.length)) : '';
    }
    if (s.startsWith(V1)) return decryptWith(v1Key(), s.slice(V1.length));
  } catch {
    // Wrong key (e.g. secret changed) or corrupt value — treat as empty.
    return '';
  }
  return s; // legacy plaintext value
}

export function isEncrypted(stored) {
  return typeof stored === 'string' && (stored.startsWith(V1) || stored.startsWith(V2));
}

/** True when a stored value should be re-encrypted with the current key. */
export function needsReencrypt(stored) {
  if (!stored) return false;
  return hasEncryptionKey() ? !String(stored).startsWith(V2) : !isEncrypted(stored);
}

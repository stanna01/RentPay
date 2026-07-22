// Symmetric encryption for secrets stored in the database (the SMTP password).
// AES-256-GCM with a key derived from JWT_SECRET. Values are tagged with a
// version prefix so we can tell encrypted values from legacy plaintext and
// migrate transparently.
//
// Note: the key is derived from JWT_SECRET, so if you change JWT_SECRET you will
// need to re-enter the SMTP password in Settings. That is an acceptable, rare
// operation and keeps the number of required secrets to one.

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function key() {
  const secret = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
  return crypto.createHash('sha256').update('rentreceipt-smtp::' + secret).digest(); // 32 bytes
}

/** Encrypt a UTF-8 string. Empty input returns empty (nothing to store). */
export function encryptSecret(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Decrypt a value produced by encryptSecret. Legacy plaintext passes through. */
export function decryptSecret(stored) {
  if (!stored) return '';
  if (!String(stored).startsWith(PREFIX)) return stored; // legacy plaintext value
  try {
    const raw = Buffer.from(String(stored).slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key (e.g. JWT_SECRET changed) or corrupt value — treat as empty.
    return '';
  }
}

export function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

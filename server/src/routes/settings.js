import { Router } from 'express';
import { prisma, ensureSettings } from '../db.js';
import { sendTestEmail } from '../email.js';
import { encryptSecret } from '../crypto.js';

const router = Router();

/** Never leak the SMTP password to the client; report whether one is set. */
function publicSettings(s) {
  const { smtpPass, ...rest } = s;
  return { ...rest, smtpPassSet: !!smtpPass };
}

/** GET /api/settings */
router.get('/', async (req, res) => {
  const s = await ensureSettings();
  res.json(publicSettings(s));
});

/** PUT /api/settings — update property + email/SMTP config. */
router.put('/', async (req, res) => {
  await ensureSettings();
  const b = req.body || {};
  const data = {};
  const strFields = [
    'propertyName',
    'propertyAddress',
    'landlordEmail',
    'smtpHost',
    'smtpUser',
    'smtpFromName',
    'smtpFromEmail',
  ];
  for (const f of strFields) if (b[f] != null) data[f] = String(b[f]).trim();
  if (b.smtpPort != null) data.smtpPort = Number(b.smtpPort) || 465;
  if (b.smtpSecure != null) data.smtpSecure = !!b.smtpSecure;
  // Only overwrite the password when a non-empty value is supplied; store it
  // encrypted at rest (AES-256-GCM) rather than as plaintext.
  if (b.smtpPass) data.smtpPass = encryptSecret(String(b.smtpPass));

  if (data.landlordEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.landlordEmail)) {
    return res.status(400).json({ error: 'Please enter a valid landlord email.' });
  }

  const s = await prisma.setting.update({ where: { id: 1 }, data });
  res.json(publicSettings(s));
});

/** POST /api/settings/test-email — send a test message (single connection). */
router.post('/test-email', async (req, res) => {
  const s = await ensureSettings();
  const to = (req.body?.to || s.landlordEmail || '').trim();
  if (!to) {
    return res
      .status(400)
      .json({ error: 'Add a landlord email (or a test address) before testing.' });
  }
  try {
    // sendTestEmail connects + authenticates + sends in one connection, so we
    // do NOT verify() separately (a second rapid connection can trip provider
    // throttling and time out — exactly the flaky retry behaviour to avoid).
    await sendTestEmail(to);
    res.json({ ok: true, sentTo: to });
  } catch (err) {
    const timedOut = /timeout|ETIMEDOUT|ESOCKET|ECONN/i.test(err.code || err.message || '');
    const hint = timedOut
      ? ' Could not reach the mail server — check the host/port, your internet connection, or try again in a moment.'
      : '';
    res.status(400).json({ error: `Email test failed: ${err.message}.${hint}` });
  }
});

export default router;

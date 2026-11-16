// Platform-wide email/SMTP settings (super admin only — see app.js).
// Property names and addresses live on each Property (routes/properties.js).

import { Router } from 'express';
import { prisma, ensureSettings } from '../db.js';
import { sendTestEmail } from '../email.js';
import { encryptSecret } from '../crypto.js';
import { audit } from '../audit.js';
import { parse, z, text } from '../validate.js';

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

/** PUT /api/settings — update email/SMTP config. */
router.put('/', async (req, res) => {
  const before = await ensureSettings();
  const optionalEmailField = (msg) => z.union([z.literal(''), z.string().trim().toLowerCase().email(msg)]).optional();
  const b = parse(
    z.object({
      landlordEmail: optionalEmailField('Please enter a valid contact email.'),
      smtpHost: text().optional(),
      smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
      smtpSecure: z.boolean().optional(),
      smtpUser: text().optional(),
      smtpPass: z.string().max(500).optional(),
      smtpFromName: text().optional(),
      smtpFromEmail: optionalEmailField('Please enter a valid "from" email.'),
    }),
    req.body
  );
  const { smtpPass, ...data } = b;
  // Only overwrite the password when a non-empty value is supplied; store it
  // encrypted at rest (AES-256-GCM) rather than as plaintext.
  if (smtpPass) data.smtpPass = encryptSecret(smtpPass);

  const s = await prisma.setting.update({ where: { id: 1 }, data });
  await audit(req, 'settings.update', {
    type: 'settings',
    id: 1,
    before: publicSettings(before),
    after: { ...publicSettings(s), smtpPassChanged: !!smtpPass },
  });
  res.json(publicSettings(s));
});

/** POST /api/settings/test-email — send a test message (single connection). */
router.post('/test-email', async (req, res) => {
  const s = await ensureSettings();
  const to = String(req.body?.to || s.landlordEmail || req.user.email || '').trim();
  if (!to) {
    return res.status(400).json({ error: 'Add a contact email (or a test address) before testing.' });
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

import { Router } from 'express';
import { prisma } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  issueCookie,
  clearCookie,
  requireAuth,
  makeResetToken,
  verifyResetToken,
} from '../auth.js';
import { isSmtpConfigured, sendPasswordResetEmail } from '../email.js';
import rateLimit from 'express-rate-limit';

const router = Router();

// Throttle brute-force and abuse on sensitive endpoints (per client IP).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a while and try again.' },
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Please enter your email and password.' });
  }
  const landlord = await prisma.landlord.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!landlord || !(await verifyPassword(password, landlord.passwordHash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  issueCookie(res, landlord);
  res.json({ email: landlord.email });
});

router.post('/logout', (req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ email: req.landlord.email });
});

// Start a password reset. Always responds the same way so an outsider can't
// learn whether an email is registered. When email is configured, a reset link
// is sent; either way the link is also printed to the server log so a
// self-hosting landlord without email can still recover.
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const { email } = req.body || {};
  const neutral = {
    ok: true,
    message:
      'If that email is registered, a reset link has been sent. ' +
      'If you have not set up email on this server, use the command-line reset (see the User Guide).',
  };
  if (!email) return res.json(neutral);

  const landlord = await prisma.landlord.findUnique({
    where: { email: String(email).toLowerCase() },
  });
  if (landlord) {
    const token = makeResetToken(landlord);
    const origin =
      req.headers.origin || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${origin}/reset?token=${encodeURIComponent(token)}`;
    // Always log it so a server operator can recover even without email.
    console.log(`[password reset] Reset link for ${landlord.email}:\n  ${link}`);
    if (await isSmtpConfigured()) {
      try {
        await sendPasswordResetEmail(landlord.email, link);
      } catch (e) {
        console.error('[password reset] email failed:', e.message);
      }
    }
  }
  res.json(neutral);
});

// Finish a password reset using the token from the link.
router.post('/reset-password', resetLimiter, async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Please choose a new password.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  let landlord;
  try {
    landlord = await verifyResetToken(token);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await prisma.landlord.update({
    where: { id: landlord.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Please fill in both password fields.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const ok = await verifyPassword(currentPassword, req.landlord.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Your current password is incorrect.' });
  await prisma.landlord.update({
    where: { id: req.landlord.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  res.json({ ok: true });
});

export default router;

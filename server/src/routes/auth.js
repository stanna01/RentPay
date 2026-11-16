import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  DUMMY_HASH,
  issueCookie,
  clearCookie,
  requireAuth,
  makeResetToken,
  verifyResetToken,
  isAdmin,
} from '../auth.js';
import { isSmtpConfigured, sendPasswordResetEmail, notifyInBackground } from '../email.js';
import {
  getLockRemainingMs,
  recordFailure,
  clearThrottle,
  lockMessage,
  normaliseEmail,
} from '../loginThrottle.js';
import { passwordProblem } from '../passwordPolicy.js';
import { audit } from '../audit.js';
import { appUrl } from '../config.js';

const router = Router();

// Per-IP limits (on top of the per-account lockout in loginThrottle.js).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  skipSuccessfulRequests: true, // only failed attempts count
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts from this network. Please wait 15 minutes and try again.' },
});
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a while and try again.' },
});

/** The current user as the client sees it. */
export async function publicUser(user) {
  const properties = await prisma.property.findMany({
    where: {
      archivedAt: null,
      ...(isAdmin(user) ? {} : { access: { some: { userId: user.id } } }),
    },
    select: { id: true, name: true, code: true, address: true },
    orderBy: { id: 'asc' },
  });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    properties,
  };
}

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Please enter your email and password.' });
  }
  const key = normaliseEmail(email);

  // Locked? Refuse before even checking the password.
  const lockedMs = await getLockRemainingMs(key);
  if (lockedMs > 0) {
    await audit(req, 'login.blocked', { type: 'email', id: key, userId: null });
    return res.status(423).json({ error: lockMessage(lockedMs), lockedForMs: lockedMs });
  }

  const user = await prisma.user.findUnique({ where: { email: key } });
  // Always run bcrypt so response time doesn't reveal whether the email exists.
  const ok = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);

  if (!user || !ok) {
    const { lockedNow, remainingMs } = await recordFailure(key);
    await audit(req, 'login.failed', { type: 'email', id: key, userId: user?.id ?? null });
    if (lockedNow) {
      await audit(req, 'login.locked', { type: 'email', id: key, userId: user?.id ?? null });
      if (user) {
        notifyInBackground(
          user.email,
          'RentReceipt: sign-in temporarily locked',
          'Your RentReceipt account was temporarily locked after several failed sign-in attempts.\n\n' +
            "If this wasn't you, reset your password now and tell your administrator."
        );
      }
      return res.status(423).json({ error: lockMessage(remainingMs), lockedForMs: remainingMs });
    }
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  if (!user.isActive) {
    await audit(req, 'login.disabled', { type: 'user', id: user.id, userId: user.id });
    return res.status(403).json({ error: 'This account has been disabled. Please contact your administrator.' });
  }

  await clearThrottle(key);
  const data = { lastLoginAt: new Date() };
  if (needsRehash(user.passwordHash)) data.passwordHash = await hashPassword(password);
  const fresh = await prisma.user.update({ where: { id: user.id }, data });
  issueCookie(res, fresh);
  await audit(req, 'login.success', { type: 'user', id: user.id, userId: user.id });
  res.json(await publicUser(fresh));
});

router.post('/logout', (req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

/** End every session for this user, on every device. */
router.post('/logout-all', requireAuth, async (req, res) => {
  await prisma.user.update({ where: { id: req.user.id }, data: { tokenVersion: { increment: 1 } } });
  await audit(req, 'session.revoke_all', { type: 'user', id: req.user.id });
  clearCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json(await publicUser(req.user));
});

// Start a password reset. Responds immediately and identically whether or not
// the email is registered; the lookup and email happen in the background so
// timing reveals nothing either.
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const email = normaliseEmail(req.body?.email);
  res.json({
    ok: true,
    message:
      'If that email is registered, a reset link has been sent. ' +
      'If email is not set up on this server, ask your administrator to reset your password.',
  });
  if (!email) return;

  setImmediate(async () => {
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) return;
      const token = makeResetToken(user);
      // The link is built ONLY from the configured APP_URL — never from request
      // headers, which an attacker controls (host-header poisoning).
      const link = `${appUrl()}/reset?token=${encodeURIComponent(token)}`;
      await audit(req, 'password.reset_requested', { type: 'user', id: user.id, userId: user.id });
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[password reset] (dev only) link for ${user.email}:\n  ${link}`);
      }
      if (await isSmtpConfigured()) await sendPasswordResetEmail(user.email, link);
    } catch (e) {
      console.error('[password reset] failed:', e.message);
    }
  });
});

/** Shared steps after any password change: revoke sessions, clear lockout, notify. */
async function applyNewPassword(req, user, newPassword, action) {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      tokenVersion: { increment: 1 }, // logs out every existing session
      mustChangePassword: false,
    },
  });
  await clearThrottle(user.email);
  await audit(req, action, { type: 'user', id: user.id, userId: user.id });
  notifyInBackground(
    user.email,
    'Your RentReceipt password was changed',
    `The password for your RentReceipt account (${user.email}) was just changed, and all other sessions were signed out.\n\n` +
      "If you didn't do this, reset your password immediately and contact your administrator."
  );
  return updated;
}

// Finish a password reset using the token from the link.
router.post('/reset-password', resetLimiter, async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Please choose a new password.' });
  }
  let user;
  try {
    user = await verifyResetToken(token);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const problem = passwordProblem(newPassword, { email: user.email, role: user.role });
  if (problem) return res.status(400).json({ error: problem });
  await applyNewPassword(req, user, newPassword, 'password.reset');
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Please fill in both password fields.' });
  }
  const ok = await verifyPassword(currentPassword, req.user.passwordHash);
  if (!ok) {
    await audit(req, 'password.change_failed', { type: 'user', id: req.user.id });
    return res.status(400).json({ error: 'Your current password is incorrect.' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'Please choose a password different from your current one.' });
  }
  const problem = passwordProblem(newPassword, { email: req.user.email, role: req.user.role });
  if (problem) return res.status(400).json({ error: problem });
  const updated = await applyNewPassword(req, req.user, newPassword, 'password.change');
  issueCookie(res, updated); // keep THIS device signed in with a fresh session
  res.json(await publicUser(updated));
});

export default router;

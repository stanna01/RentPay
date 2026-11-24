// /api/v1 — the phone app's API (mobile/src/api/http.ts). So far it covers
// sign-in with tokens and the landlord's dashboard; student and sponsor
// endpoints are added as those parts of the platform are built.
//
// Errors here use the shape { error: { message, code } }.

import { Router } from 'express';
import { requireAuth, requireRole, ROLES, issueMobileTokens, userFromRefreshToken } from '../auth.js';
import { accessiblePropertyIds } from '../access.js';
import { propertySummary } from '../billingService.js';
import { signInWithPassword, loginLimiter } from './auth.js';
import { forbidden, httpError } from '../httpError.js';

const router = Router();

// The rest of the server answers errors as { error: "message", code? }.
// Convert those to the v1 shape in one place.
router.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) =>
    json(
      body && typeof body.error === 'string'
        ? { error: { message: body.error, ...(body.code ? { code: body.code } : {}) } }
        : body
    );
  next();
});

const meView = (user) => ({
  id: String(user.id),
  name: user.name || user.email,
  email: user.email,
  role: user.role,
  organizationName: user.organization?.name,
});

router.post('/auth/login', loginLimiter, async (req, res) => {
  const user = await signInWithPassword(req, req.body?.email, req.body?.password);
  if (user.role !== ROLES.LANDLORD) {
    throw forbidden('This account can only be used on the RentReceipt website.');
  }
  if (user.mustChangePassword) {
    throw forbidden('Please sign in on the RentReceipt website first to choose your own password.');
  }
  res.json({ tokens: issueMobileTokens(user), me: meView(user) });
});

router.post('/auth/refresh', async (req, res) => {
  const user = await userFromRefreshToken(req.body?.refreshToken);
  if (!user) throw httpError(401, 'Your session has expired. Please sign in again.');
  res.json(issueMobileTokens(user));
});

// Tokens are not stored on the server, so signing out is done by the app
// discarding them. ("Sign out everywhere" on the website ends them for real.)
router.post('/auth/logout', (req, res) => res.status(204).end());

router.get('/me', requireAuth, (req, res) => res.json(meView(req.user)));

const landlord = [requireAuth, requireRole(ROLES.LANDLORD)];

router.get('/landlord/dashboard', ...landlord, async (req, res) => {
  // collected = received this month; outstanding = what current tenants owe now.
  const { periodLabel, totalBeds, occupiedBeds, collected, outstanding } = await propertySummary(await accessiblePropertyIds(req));
  res.json({
    periodLabel,
    totalBeds,
    occupiedBeds,
    collected,
    outstanding,
    pendingTransfers: 0, // bank-slip payments are not built yet
  });
});

// Bank-slip payments are not built yet, so there is never anything to check.
router.get('/landlord/transfers', ...landlord, (req, res) => res.json([]));

export default router;

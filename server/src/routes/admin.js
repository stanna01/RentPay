// Super admin only: landlord businesses, their sign-in accounts, and the
// platform-wide audit log. Mounted behind requireAuth + requirePasswordCurrent
// + requireRole('SUPER_ADMIN').

import { Router } from 'express';
import { prisma } from '../db.js';
import { hashPassword, ROLES } from '../auth.js';
import { clearThrottle, lockRemainingMs } from '../loginThrottle.js';
import { passwordProblem } from '../passwordPolicy.js';
import { audit } from '../audit.js';
import { auditPage } from './audit.js';
import { parse, z, email, text } from '../validate.js';
import { badRequest, notFound, httpError } from '../httpError.js';

const router = Router();

function userView(u, throttle) {
  const lockedMs = lockRemainingMs(throttle);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    lockedUntil: lockedMs > 0 ? throttle.lockedUntil : null,
  };
}

async function loadLandlord(rawId) {
  const oid = Number(rawId);
  const org = Number.isInteger(oid) ? await prisma.organization.findUnique({ where: { id: oid } }) : null;
  if (!org) throw notFound('Landlord not found.');
  return org;
}

/** A landlord's sign-in account (never a super admin's). */
async function loadLandlordUser(rawId) {
  const uid = Number(rawId);
  const user = Number.isInteger(uid) ? await prisma.user.findUnique({ where: { id: uid } }) : null;
  if (!user || user.role !== ROLES.LANDLORD) throw notFound('User not found.');
  return user;
}

const tempPasswordField = z.string({ error: 'Please set a temporary password.' });

// --- Landlords ----------------------------------------------------------------

/** Every landlord business with its sign-in account(s) and size. */
router.get('/landlords', async (req, res) => {
  const orgs = await prisma.organization.findMany({
    include: {
      users: { orderBy: { id: 'asc' } },
      properties: {
        where: { archivedAt: null },
        select: { rooms: { where: { archivedAt: null }, select: { bedCount: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });
  const emails = orgs.flatMap((o) => o.users.map((u) => u.email));
  const [throttles, occupied] = await Promise.all([
    prisma.loginThrottle.findMany({ where: { email: { in: emails } } }),
    prisma.tenancy.findMany({
      where: { moveOutDate: null, room: { archivedAt: null, property: { archivedAt: null } } },
      select: { room: { select: { property: { select: { organizationId: true } } } } },
    }),
  ]);
  const throttleBy = new Map(throttles.map((t) => [t.email, t]));
  const occupiedBy = new Map();
  for (const t of occupied) {
    const oid = t.room.property.organizationId;
    occupiedBy.set(oid, (occupiedBy.get(oid) || 0) + 1);
  }
  res.json(
    orgs.map((o) => ({
      id: o.id,
      name: o.name,
      isActive: o.isActive,
      createdAt: o.createdAt,
      propertyCount: o.properties.length,
      bedCount: o.properties.reduce((s, p) => s + p.rooms.reduce((n, r) => n + r.bedCount, 0), 0),
      occupiedBeds: occupiedBy.get(o.id) || 0,
      users: o.users.map((u) => userView(u, throttleBy.get(u.email))),
    }))
  );
});

/**
 * Create a landlord business and its sign-in account in one step.
 * Body: { name, ownerName?, ownerEmail, tempPassword }
 */
router.post('/landlords', async (req, res) => {
  const body = parse(
    z.object({
      name: text().min(1, 'Please enter the landlord or business name.'),
      ownerName: text().optional().default(''),
      ownerEmail: email(),
      tempPassword: tempPasswordField,
    }),
    req.body
  );
  const problem = passwordProblem(body.tempPassword, { email: body.ownerEmail, role: ROLES.LANDLORD });
  if (problem) throw badRequest(problem);
  if (await prisma.user.findUnique({ where: { email: body.ownerEmail } })) {
    throw httpError(409, 'A user with that email already exists.');
  }
  const org = await prisma.organization.create({
    data: {
      name: body.name,
      users: {
        create: {
          email: body.ownerEmail,
          name: body.ownerName,
          role: ROLES.LANDLORD,
          passwordHash: await hashPassword(body.tempPassword),
          mustChangePassword: true, // they must choose their own on first sign-in
        },
      },
    },
    include: { users: true },
  });
  await audit(req, 'landlord.create', {
    type: 'organization',
    id: org.id,
    organizationId: org.id,
    after: { name: org.name, ownerEmail: body.ownerEmail },
  });
  res.status(201).json({ id: org.id, name: org.name, isActive: org.isActive, users: org.users.map((u) => userView(u)) });
});

/** Rename, suspend or reactivate a landlord. Suspending signs its users out at once. */
router.patch('/landlords/:id', async (req, res) => {
  const org = await loadLandlord(req.params.id);
  const body = parse(
    z.object({ name: text().min(1, 'Please enter the landlord or business name.').optional(), isActive: z.boolean().optional() }),
    req.body
  );
  const updated = await prisma.organization.update({ where: { id: org.id }, data: body });
  const action = body.isActive === false && org.isActive ? 'landlord.suspend' : body.isActive && !org.isActive ? 'landlord.reactivate' : 'landlord.update';
  await audit(req, action, {
    type: 'organization',
    id: org.id,
    organizationId: org.id,
    before: { name: org.name, isActive: org.isActive },
    after: { name: updated.name, isActive: updated.isActive },
  });
  res.json({ id: updated.id, name: updated.name, isActive: updated.isActive });
});

// --- Landlord sign-in accounts ------------------------------------------------------

/** Set a temporary password; the user must change it at next sign-in. */
router.post('/users/:id/reset-password', async (req, res) => {
  const user = await loadLandlordUser(req.params.id);
  const { tempPassword } = parse(z.object({ tempPassword: tempPasswordField }), req.body);
  const problem = passwordProblem(tempPassword, { email: user.email, role: user.role });
  if (problem) throw badRequest(problem);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      tokenVersion: { increment: 1 },
    },
  });
  await clearThrottle(user.email);
  await audit(req, 'user.reset_password', { type: 'user', id: user.id, organizationId: user.organizationId });
  res.json({ ok: true });
});

router.post('/users/:id/unlock', async (req, res) => {
  const user = await loadLandlordUser(req.params.id);
  await clearThrottle(user.email);
  await audit(req, 'user.unlock', { type: 'user', id: user.id, organizationId: user.organizationId });
  res.json({ ok: true });
});

/** Sign a user out everywhere (e.g. a lost phone). */
router.post('/users/:id/revoke-sessions', async (req, res) => {
  const user = await loadLandlordUser(req.params.id);
  await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
  await audit(req, 'user.revoke_sessions', { type: 'user', id: user.id, organizationId: user.organizationId });
  res.json({ ok: true });
});

// --- Audit log (read-only, all landlords) -------------------------------------------

router.get('/audit', async (req, res) => {
  res.json(await auditPage(req.query));
});

export default router;

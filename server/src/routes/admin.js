// Admin-only: user accounts and the audit log. Mounted behind
// requireAuth + requirePasswordCurrent + requireRole('ADMIN').

import { Router } from 'express';
import { prisma } from '../db.js';
import { hashPassword, ROLES } from '../auth.js';
import { clearThrottle, lockRemainingMs } from '../loginThrottle.js';
import { passwordProblem } from '../passwordPolicy.js';
import { audit } from '../audit.js';
import { parse, z, email, text, id } from '../validate.js';
import { badRequest, notFound, httpError } from '../httpError.js';

const router = Router();

const role = z.enum([ROLES.ADMIN, ROLES.LANDLORD], { error: 'Choose a valid role.' });
const propertyIds = z.array(id()).max(500).optional();

function userView(u, throttle) {
  const lockedMs = lockRemainingMs(throttle);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    propertyIds: (u.propertyAccess || []).map((a) => a.propertyId),
    lockedUntil: lockedMs > 0 ? throttle.lockedUntil : null,
  };
}

async function loadUser(rawId) {
  const uid = Number(rawId);
  const user = Number.isInteger(uid)
    ? await prisma.user.findUnique({ where: { id: uid }, include: { propertyAccess: true } })
    : null;
  if (!user) throw notFound('User not found.');
  return user;
}

/** Refuse a change that would leave no active administrator. */
async function assertAnotherActiveAdmin(excludeUserId) {
  const others = await prisma.user.count({
    where: { role: ROLES.ADMIN, isActive: true, id: { not: excludeUserId } },
  });
  if (others === 0) throw httpError(409, 'There must always be at least one active administrator.');
}

async function checkPropertyIds(ids) {
  if (!ids?.length) return;
  const found = await prisma.property.count({ where: { id: { in: ids } } });
  if (found !== new Set(ids).size) throw badRequest('One of the selected properties does not exist.');
}

// --- Users ------------------------------------------------------------------

router.get('/users', async (req, res) => {
  const users = await prisma.user.findMany({ include: { propertyAccess: true }, orderBy: { email: 'asc' } });
  const throttles = await prisma.loginThrottle.findMany({ where: { email: { in: users.map((u) => u.email) } } });
  const byEmail = new Map(throttles.map((t) => [t.email, t]));
  res.json(users.map((u) => userView(u, byEmail.get(u.email))));
});

router.post('/users', async (req, res) => {
  const body = parse(
    z.object({
      email: email(),
      name: text().optional().default(''),
      role,
      propertyIds,
      tempPassword: z.string({ error: 'Please set a temporary password.' }),
    }),
    req.body
  );
  const problem = passwordProblem(body.tempPassword, { email: body.email, role: body.role });
  if (problem) throw badRequest(problem);
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw httpError(409, 'A user with that email already exists.');
  }
  await checkPropertyIds(body.propertyIds);

  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.name,
      role: body.role,
      passwordHash: await hashPassword(body.tempPassword),
      mustChangePassword: true, // they must choose their own on first sign-in
      propertyAccess: body.propertyIds?.length
        ? { create: body.propertyIds.map((propertyId) => ({ propertyId })) }
        : undefined,
    },
    include: { propertyAccess: true },
  });
  await audit(req, 'user.create', { type: 'user', id: user.id, after: userView(user) });
  res.status(201).json(userView(user));
});

router.patch('/users/:id', async (req, res) => {
  const user = await loadUser(req.params.id);
  const body = parse(
    z.object({ name: text().optional(), role: role.optional(), isActive: z.boolean().optional(), propertyIds }),
    req.body
  );
  const self = user.id === req.user.id;
  if (self && (body.role && body.role !== user.role)) throw badRequest('You cannot change your own role.');
  if (self && body.isActive === false) throw badRequest('You cannot deactivate your own account.');

  const demoting = user.role === ROLES.ADMIN && body.role && body.role !== ROLES.ADMIN;
  const deactivating = user.isActive && body.isActive === false;
  if (user.role === ROLES.ADMIN && (demoting || deactivating)) await assertAnotherActiveAdmin(user.id);
  await checkPropertyIds(body.propertyIds);

  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.role !== undefined) data.role = body.role;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  // Changing what someone may do ends their current sessions.
  if ((body.role && body.role !== user.role) || deactivating) data.tokenVersion = { increment: 1 };

  const updated = await prisma.$transaction(async (tx) => {
    if (body.propertyIds) {
      await tx.propertyAccess.deleteMany({ where: { userId: user.id } });
      if (body.propertyIds.length) {
        await tx.propertyAccess.createMany({
          data: [...new Set(body.propertyIds)].map((propertyId) => ({ userId: user.id, propertyId })),
        });
      }
    }
    return tx.user.update({ where: { id: user.id }, data, include: { propertyAccess: true } });
  });
  await audit(req, 'user.update', { type: 'user', id: user.id, before: userView(user), after: userView(updated) });
  res.json(userView(updated));
});

/** Admin sets a temporary password; the user must change it at next sign-in. */
router.post('/users/:id/reset-password', async (req, res) => {
  const user = await loadUser(req.params.id);
  const { tempPassword } = parse(z.object({ tempPassword: z.string({ error: 'Please set a temporary password.' }) }), req.body);
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
  await audit(req, 'user.reset_password', { type: 'user', id: user.id });
  res.json({ ok: true });
});

router.post('/users/:id/unlock', async (req, res) => {
  const user = await loadUser(req.params.id);
  await clearThrottle(user.email);
  await audit(req, 'user.unlock', { type: 'user', id: user.id });
  res.json({ ok: true });
});

/** Sign a user out everywhere (e.g. a lost phone). */
router.post('/users/:id/revoke-sessions', async (req, res) => {
  const user = await loadUser(req.params.id);
  await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
  await audit(req, 'user.revoke_sessions', { type: 'user', id: user.id });
  res.json({ ok: true });
});

/**
 * Permanently delete a user account. Their past actions stay in the audit log
 * (the entry below records who they were). Prefer deactivating.
 */
router.delete('/users/:id', async (req, res) => {
  const user = await loadUser(req.params.id);
  if (user.id === req.user.id) throw badRequest('You cannot delete your own account.');
  if (user.role === ROLES.ADMIN && user.isActive) await assertAnotherActiveAdmin(user.id);
  await audit(req, 'user.delete', { type: 'user', id: user.id, before: userView(user) });
  await prisma.user.delete({ where: { id: user.id } });
  res.json({ ok: true });
});

// --- Audit log (read-only) ----------------------------------------------------

router.get('/audit', async (req, res) => {
  const q = parse(
    z.object({
      action: text(100).optional(),
      entityType: text(50).optional(),
      entityId: text(50).optional(),
      userId: id().optional(),
      page: z.coerce.number().int().min(1).max(10000).optional().default(1),
    }),
    req.query
  );
  const where = {};
  if (q.action) where.action = { startsWith: q.action };
  if (q.entityType) where.entityType = q.entityType;
  if (q.entityId) where.entityId = q.entityId;
  if (q.userId) where.userId = q.userId;
  const PAGE = 50;
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { email: true, name: true } } },
      orderBy: { id: 'desc' },
      skip: (q.page - 1) * PAGE,
      take: PAGE,
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ rows, total, page: q.page, pageSize: PAGE });
});

export default router;

import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { loadRoom, loadTenancy, loadTenant, propertyFilter, assertPropertyAccess } from '../access.js';
import { buildTenancyProfile, bedLabels, roomLabel, ACTIVE } from '../tenancyService.js';
import { audit } from '../audit.js';
import { parse, z, text, optionalEmail, ngwee, date, id, reason } from '../validate.js';
import { badRequest, httpError, notFound } from '../httpError.js';

const router = Router();

const bedKey = (roomId, bed) => `${roomId}-${bed}`;
const BED_TAKEN = 'That bed is already occupied.';

/** Run a write that sets activeBedKey; a unique-constraint clash means the bed is taken. */
async function claimBed(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw httpError(409, BED_TAKEN);
    throw e;
  }
}

/**
 * POST /api/tenancies — assign a tenant to a specific bed of a room.
 * Body: { roomId, bed, tenantId?, newTenant?, monthlyRent, moveInDate }
 */
router.post('/', async (req, res) => {
  const body = parse(
    z.object({
      roomId: id('Please choose a room.'),
      bed: z.string().trim().toUpperCase().default('A'),
      tenantId: id().optional(),
      newTenant: z
        .object({
          name: text().min(1, 'Please enter the tenant name.'),
          phone: text(50).optional().default(''),
          email: optionalEmail(),
          notes: text().optional().default(''),
        })
        .optional(),
      monthlyRent: ngwee('Please enter a valid monthly rent.'),
      moveInDate: date('Please choose a valid move-in date.'),
    }),
    req.body
  );
  const room = await loadRoom(req, body.roomId);
  if (room.archivedAt) throw badRequest('That room has been removed.');
  if (!bedLabels(room.bedCount).includes(body.bed)) throw badRequest('Invalid bed.');

  let tenantId = body.tenantId;
  if (tenantId) {
    const tenant = await loadTenant(req, tenantId);
    if (tenant.propertyId !== room.propertyId) throw badRequest('That tenant belongs to a different property.');
    if (await prisma.tenancy.count({ where: { tenantId, moveOutDate: null } })) {
      throw httpError(409, 'That tenant already has a bed. Move them out first.');
    }
  } else if (!body.newTenant) {
    throw badRequest('Please enter the tenant name.');
  }

  const tenancy = await claimBed(() =>
    prisma.$transaction(async (tx) => {
      if (!tenantId) {
        const created = await tx.tenant.create({ data: { propertyId: room.propertyId, ...body.newTenant } });
        tenantId = created.id;
      }
      return tx.tenancy.create({
        data: {
          roomId: room.id,
          bed: body.bed,
          tenantId,
          monthlyRent: body.monthlyRent,
          moveInDate: body.moveInDate,
          activeBedKey: bedKey(room.id, body.bed), // unique: blocks double-assignment
        },
        include: { tenant: true, room: true },
      });
    })
  );
  await audit(req, 'tenancy.create', { type: 'tenancy', id: tenancy.id, after: tenancy });
  res.status(201).json({ ...tenancy, roomLabel: roomLabel(tenancy.room.number, tenancy.bed) });
});

/**
 * GET /api/tenancies/past?archived=0|1&propertyId= — moved-out tenancies with a
 * summary. (Defined before /:id so "past" isn't treated as an id.)
 */
router.get('/past', async (req, res) => {
  const archived = String(req.query.archived) === '1';
  const filter = await propertyFilter(req);
  let propertyId;
  if (req.query.propertyId) {
    propertyId = Number(req.query.propertyId);
    await assertPropertyAccess(req, propertyId);
  }
  const rows = await prisma.tenancy.findMany({
    where: {
      moveOutDate: { not: null },
      archivedAt: archived ? { not: null } : null,
      tenant: { deletedAt: null },
      room: { propertyId: propertyId ?? filter },
    },
    include: {
      tenant: true,
      room: true,
      payments: { where: { status: ACTIVE }, select: { amount: true, receipt: { select: { id: true } } } },
    },
    orderBy: { moveOutDate: 'desc' },
  });
  res.json(
    rows.map((t) => ({
      id: t.id,
      tenantName: t.tenant.name,
      roomLabel: roomLabel(t.room.number, t.bed),
      moveInDate: t.moveInDate,
      moveOutDate: t.moveOutDate,
      archivedAt: t.archivedAt,
      receiptCount: t.payments.filter((p) => p.receipt).length,
      totalCollected: t.payments.reduce((s, p) => s + p.amount, 0),
    }))
  );
});

/** POST /api/tenancies/adjustments/:adjId/reverse — undo a waiver/charge. */
router.post('/adjustments/:adjId/reverse', async (req, res) => {
  const adjId = Number(req.params.adjId);
  const adj = Number.isInteger(adjId) ? await prisma.arrearsAdjustment.findUnique({ where: { id: adjId } }) : null;
  if (!adj) throw notFound('Adjustment not found.');
  await loadTenancy(req, adj.tenancyId); // access check
  if (adj.reversedAt) throw httpError(409, 'That adjustment has already been reversed.');
  const updated = await prisma.arrearsAdjustment.update({ where: { id: adj.id }, data: { reversedAt: new Date() } });
  await audit(req, 'arrears.reverse', { type: 'tenancy', id: adj.tenancyId, before: adj, after: updated });
  res.json(updated);
});

/** GET /api/tenancies/:id — full profile. */
router.get('/:id', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  res.json(await buildTenancyProfile(tenancy.id));
});

/** PATCH /api/tenancies/:id — rent, move-in date, and (after move-out) the move-out date. */
router.patch('/:id', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  const body = parse(
    z.object({
      monthlyRent: ngwee('Please enter a valid rent.').optional(),
      moveInDate: date('Please enter a valid move-in date.').optional(),
      moveOutDate: date('Please enter a valid move-out date.').optional(),
    }),
    req.body
  );
  if (body.moveOutDate && !tenancy.moveOutDate) {
    throw badRequest('Use "Move out" to end a current tenancy.');
  }
  const moveIn = body.moveInDate || tenancy.moveInDate;
  const moveOut = body.moveOutDate || tenancy.moveOutDate;
  if (moveOut && moveOut < moveIn) throw badRequest('Move-out date cannot be before the move-in date.');

  const updated = await prisma.tenancy.update({ where: { id: tenancy.id }, data: body });
  const { tenant, room, ...before } = tenancy;
  await audit(req, 'tenancy.update', { type: 'tenancy', id: tenancy.id, before, after: updated });
  res.json(updated);
});

/** POST /api/tenancies/:id/moveout — end a tenancy, keeping all history. */
router.post('/:id/moveout', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  if (tenancy.moveOutDate) throw badRequest('This tenant has already moved out.');
  const { moveOutDate } = parse(z.object({ moveOutDate: date().optional() }), req.body);
  const when = moveOutDate || new Date();
  if (when < tenancy.moveInDate) throw badRequest('Move-out date cannot be before the move-in date.');
  const updated = await prisma.tenancy.update({
    where: { id: tenancy.id },
    data: { moveOutDate: when, activeBedKey: null },
  });
  await audit(req, 'tenancy.moveout', { type: 'tenancy', id: tenancy.id, after: { moveOutDate: when } });
  res.json(updated);
});

/** POST /api/tenancies/:id/undo-moveout — reverse a mistaken move-out. */
router.post('/:id/undo-moveout', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  if (!tenancy.moveOutDate) throw badRequest('This tenant has not moved out.');
  if (tenancy.room.archivedAt) throw badRequest('That room has been removed.');
  if (tenancy.tenant.deletedAt) throw badRequest('That tenant has been deleted.');
  if (await prisma.tenancy.count({ where: { tenantId: tenancy.tenantId, moveOutDate: null } })) {
    throw httpError(409, 'This tenant already has another current bed.');
  }
  const updated = await claimBed(() =>
    prisma.tenancy.update({
      where: { id: tenancy.id },
      data: { moveOutDate: null, archivedAt: null, activeBedKey: bedKey(tenancy.roomId, tenancy.bed) },
    })
  );
  await audit(req, 'tenancy.undo_moveout', { type: 'tenancy', id: tenancy.id, before: { moveOutDate: tenancy.moveOutDate } });
  res.json(updated);
});

/** POST /api/tenancies/:id/archive — hide a moved-out tenancy (records kept). */
router.post('/:id/archive', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  if (!tenancy.moveOutDate) throw badRequest('Move the tenant out before archiving them.');
  const updated = await prisma.tenancy.update({ where: { id: tenancy.id }, data: { archivedAt: new Date() } });
  await audit(req, 'tenancy.archive', { type: 'tenancy', id: tenancy.id });
  res.json({ id: updated.id, archivedAt: updated.archivedAt });
});

/** POST /api/tenancies/:id/unarchive — bring an archived tenant back into the list. */
router.post('/:id/unarchive', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  const updated = await prisma.tenancy.update({ where: { id: tenancy.id }, data: { archivedAt: null } });
  await audit(req, 'tenancy.unarchive', { type: 'tenancy', id: tenancy.id });
  res.json({ id: updated.id, archivedAt: updated.archivedAt });
});

/**
 * POST /api/tenancies/:id/adjustments — waive (negative amount) or add a
 * charge (positive amount) to one month's rent, with a required reason.
 */
router.post('/:id/adjustments', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  const body = parse(
    z.object({
      month: z.coerce.number().int().min(1).max(12),
      year: z.coerce.number().int().min(2000).max(2100),
      amount: z.coerce
        .number()
        .int('Amount must be whole ngwee.')
        .refine((n) => n !== 0, 'Amount cannot be zero.')
        .refine((n) => Math.abs(n) <= 1_000_000_000, 'Amount is too large.'),
      reason: reason(),
    }),
    req.body
  );
  const adj = await prisma.arrearsAdjustment.create({
    data: { tenancyId: tenancy.id, ...body, createdById: req.user.id },
  });
  await audit(req, body.amount < 0 ? 'arrears.waive' : 'arrears.charge', { type: 'tenancy', id: tenancy.id, after: adj });
  res.status(201).json(adj);
});

export default router;

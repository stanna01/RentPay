import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { loadRoom, loadTenancy, loadTenant, propertyFilter, assertPropertyAccess } from '../access.js';
import { buildTenancyProfile, bedLabels, roomLabel, ACTIVE } from '../tenancyService.js';
import { ensureBilling, syncStay, applyCredit, loadAccount, MANUAL_CHARGE_TYPES } from '../billingService.js';
import { today, toDbDate, dbDay } from '../dates.js';
import { audit } from '../audit.js';
import { parse, z, text, optionalEmail, ngwee, day, id } from '../validate.js';
import { badRequest, httpError, notFound } from '../httpError.js';

const router = Router();

const bedKey = (roomId, bed) => `${roomId}-${bed}`;

// Within this many days of moving a tenant in, the rent can still be corrected
// (a typo) in either direction; after that it can only go up with notice.
const CORRECTION_DAYS = 7;
const RAISE_NEEDS_NOTICE =
  "To raise the rent, send a rent increase from Notices (tenants must get at least 30 days' notice).";
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
 * Fix a mistyped rent soon after move-in: rent that has not been paid yet is
 * billed again at the new amount, as if it had been right from the start.
 */
async function correctRent(tenancy, newRent, userId) {
  const account = await loadAccount(tenancy.id);
  const auto = account.charges.filter((c) => c.type === 'RENT' && c.createdById == null && !c.cancelledAt);
  if (auto.some((c) => c.state.paid > 0)) {
    throw httpError(409, 'Rent has already been paid at the old amount. Void that payment first, or lower the rent instead.');
  }
  await prisma.$transaction([
    ...auto.map((c) =>
      prisma.charge.update({
        where: { id: c.id },
        data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: 'Rent corrected', periodKey: null },
      })
    ),
    prisma.rentChange.updateMany({ where: { tenancyId: tenancy.id, cancelledAt: null }, data: { cancelledAt: new Date() } }),
  ]);
}

/**
 * POST /api/tenancies — assign a tenant to a specific bed of a room.
 * Body: { roomId, bed, tenantId?, newTenant?, rent, moveInDate } — rent is per
 * month or per term, following the property's billing setup.
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
      rent: ngwee('Please enter a valid rent.'),
      moveInDate: day('Please choose a valid move-in date.'),
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
          rent: body.rent,
          moveInDate: toDbDate(body.moveInDate),
          activeBedKey: bedKey(room.id, body.bed), // unique: blocks double-assignment
        },
        include: { tenant: true, room: true },
      });
    })
  );
  await audit(req, 'tenancy.create', { type: 'tenancy', id: tenancy.id, after: tenancy });
  await ensureBilling([room.propertyId], { tenancyIds: [tenancy.id] }); // bill from the move-in date
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

/** GET /api/tenancies/:id — full profile. */
router.get('/:id', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  res.json(await buildTenancyProfile(tenancy.id));
});

/**
 * PATCH /api/tenancies/:id — rent, move-in date, and (after move-out) the
 * move-out date. Rent can be corrected freely in the first CORRECTION_DAYS
 * days (rent not yet paid is billed again at the new amount); after that it
 * can be lowered from today, and raised only through a rent increase notice.
 */
router.patch('/:id', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  const body = parse(
    z.object({
      rent: ngwee('Please enter a valid rent.').optional(),
      moveInDate: day('Please enter a valid move-in date.').optional(),
      moveOutDate: day('Please enter a valid move-out date.').optional(),
    }),
    req.body
  );
  if (body.moveOutDate && !tenancy.moveOutDate) {
    throw badRequest('Use "Move out" to end a current tenancy.');
  }
  const moveIn = body.moveInDate || dbDay(tenancy.moveInDate);
  const moveOut = body.moveOutDate || dbDay(tenancy.moveOutDate);
  if (moveOut && moveOut < moveIn) throw badRequest('Move-out date cannot be before the move-in date.');

  const data = {};
  if (body.moveInDate) data.moveInDate = toDbDate(body.moveInDate);
  if (body.moveOutDate) data.moveOutDate = toDbDate(body.moveOutDate);
  if (body.rent != null && body.rent !== tenancy.rent) {
    const ageDays = (Date.now() - new Date(tenancy.createdAt).getTime()) / 86_400_000;
    if (ageDays <= CORRECTION_DAYS) {
      await correctRent(tenancy, body.rent, req.user.id);
    } else if (body.rent > tenancy.rent) {
      throw badRequest(RAISE_NEEDS_NOTICE);
    } else {
      await prisma.rentChange.create({
        data: {
          tenancyId: tenancy.id,
          oldRent: tenancy.rent,
          newRent: body.rent,
          startsOn: toDbDate(today()),
          createdById: req.user.id,
          appliedAt: new Date(),
        },
      });
    }
    data.rent = body.rent;
  }

  const updated = await prisma.tenancy.update({ where: { id: tenancy.id }, data });
  if (data.moveInDate || data.moveOutDate) await syncStay(tenancy.id, req.user.id);
  else if (data.rent != null) await ensureBilling([tenancy.room.propertyId], { tenancyIds: [tenancy.id] });
  const { tenant, room, ...before } = tenancy;
  await audit(req, 'tenancy.update', { type: 'tenancy', id: tenancy.id, before, after: updated });
  res.json(updated);
});

/** POST /api/tenancies/:id/moveout — end a tenancy, keeping all history. */
router.post('/:id/moveout', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  if (tenancy.moveOutDate) throw badRequest('This tenant has already moved out.');
  const { moveOutDate } = parse(z.object({ moveOutDate: day().optional() }), req.body);
  const when = moveOutDate || today();
  if (when < dbDay(tenancy.moveInDate)) throw badRequest('Move-out date cannot be before the move-in date.');
  const updated = await prisma.tenancy.update({
    where: { id: tenancy.id },
    data: { moveOutDate: toDbDate(when), activeBedKey: null },
  });
  await syncStay(tenancy.id, req.user.id);
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
  await syncStay(tenancy.id, req.user.id);
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
 * POST /api/tenancies/:id/charges — add a one-off charge (deposit, fee,
 * utilities…). Rent is billed automatically and can't be added by hand.
 * Body: { type: DEPOSIT|FEE|OTHER, description, amount, dueDate }
 */
router.post('/:id/charges', async (req, res) => {
  const tenancy = await loadTenancy(req, req.params.id);
  const body = parse(
    z.object({
      type: z.enum(MANUAL_CHARGE_TYPES, { error: 'Please choose deposit, fee or other.' }),
      description: text().min(1, 'Please describe the charge.'),
      amount: ngwee('Please enter a valid amount.').refine((n) => n > 0, 'Please enter an amount greater than zero.'),
      dueDate: day('Please choose a valid due date.'),
    }),
    req.body
  );
  const charge = await prisma.charge.create({
    data: { tenancyId: tenancy.id, ...body, dueDate: toDbDate(body.dueDate), createdById: req.user.id },
  });
  await audit(req, 'charge.create', { type: 'tenancy', id: tenancy.id, after: charge });
  await applyCredit(tenancy.id);
  res.status(201).json({ ...charge, dueDate: body.dueDate });
});

export default router;

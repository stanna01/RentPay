import { Router } from 'express';
import { prisma } from '../db.js';
import { resolvePropertyId, loadRoom } from '../access.js';
import { bedLabels, roomLabel } from '../tenancyService.js';
import { loadAccounts, accountStatus, propertySummary } from '../billingService.js';
import { STATUS } from '../status.js';
import { audit } from '../audit.js';
import { parse, z } from '../validate.js';
import { roomFields } from './properties.js';
import { badRequest, httpError } from '../httpError.js';

const router = Router();

/**
 * GET /api/rooms?propertyId=
 * Every active room of the property, each bed with its tenant's standing:
 * PAID (owes nothing), DUE, PARTIAL (part-paid) or OVERDUE (something is past
 * its due date), or VACANT. The summary counts beds, money received this
 * month, and what current tenants owe.
 */
router.get('/', async (req, res) => {
  const propertyId = await resolvePropertyId(req);
  const summary = await propertySummary([propertyId]); // also bills anything now due

  const [property, rooms, tenancies] = await Promise.all([
    prisma.property.findUnique({ where: { id: propertyId } }),
    prisma.room.findMany({ where: { propertyId, archivedAt: null }, orderBy: { number: 'asc' } }),
    prisma.tenancy.findMany({
      where: { moveOutDate: null, room: { propertyId } },
      include: { tenant: true },
    }),
  ]);
  const byBed = new Map(tenancies.map((t) => [`${t.roomId}-${t.bed}`, t]));
  const accounts = await loadAccounts(tenancies.map((t) => t.id));

  let totalBeds = 0;
  let occupied = 0;
  const roomTiles = rooms.map((room) => {
    const beds = bedLabels(room.bedCount).map((bed) => {
      totalBeds += 1;
      const base = { bed, roomId: room.id, roomNumber: room.number, roomLabel: roomLabel(room.number, bed), defaultRent: room.defaultRent };
      const tenancy = byBed.get(`${room.id}-${bed}`);
      if (!tenancy) {
        return { ...base, status: STATUS.VACANT, tenantFirstName: null, tenantName: null, tenantId: null, tenancyId: null, balance: 0, overdue: 0, credit: 0 };
      }
      occupied += 1;
      const acc = accounts.get(tenancy.id);
      return {
        ...base,
        status: accountStatus(acc),
        balance: acc.owed,
        overdue: acc.overdue,
        credit: acc.credit,
        oldestDue: acc.oldestDue,
        tenantFirstName: tenancy.tenant.name.split(' ')[0],
        tenantName: tenancy.tenant.name,
        tenantId: tenancy.tenantId,
        tenancyId: tenancy.id,
      };
    });
    return { id: room.id, number: room.number, defaultRent: room.defaultRent, bedCount: room.bedCount, beds };
  });

  // Tenants whose bed was removed/archived still need to appear somewhere.
  const shown = new Set(roomTiles.flatMap((r) => r.beds.map((b) => b.tenancyId).filter(Boolean)));
  const unplaced = tenancies.filter((t) => !shown.has(t.id)).map((t) => ({ tenancyId: t.id, tenantName: t.tenant.name }));

  res.json({
    property: {
      id: property.id,
      name: property.name,
      code: property.code,
      address: property.address,
      billingCycle: property.billingCycle,
      dueDay: property.dueDay,
    },
    periodLabel: summary.periodLabel,
    summary: {
      totalBeds,
      occupied,
      vacant: totalBeds - occupied,
      collected: summary.collected,
      outstanding: summary.outstanding,
      overdue: summary.overdue,
    },
    rooms: roomTiles,
    unplaced,
  });
});

/** GET /api/rooms/:roomId/:bed — single bed + its current tenancy. */
router.get('/:roomId/:bed', async (req, res) => {
  const room = await loadRoom(req, req.params.roomId);
  const bed = String(req.params.bed).toUpperCase();
  if (!bedLabels(room.bedCount).includes(bed)) throw badRequest('That bed does not exist.');
  const tenancy = await prisma.tenancy.findFirst({
    where: { roomId: room.id, bed, moveOutDate: null },
    include: { tenant: true },
  });
  res.json({ room, bed, roomLabel: roomLabel(room.number, bed), tenancy });
});

/** PATCH /api/rooms/:roomId — number, bed count, default rent. */
router.patch('/:roomId', async (req, res) => {
  const room = await loadRoom(req, req.params.roomId);
  const body = parse(
    z.object({
      number: z.coerce.number().int().min(1).max(100000).optional(),
      bedCount: roomFields.bedCount.optional(),
      defaultRent: roomFields.defaultRent.optional(),
    }),
    req.body
  );
  if (body.number && body.number !== room.number) {
    const clash = await prisma.room.findUnique({
      where: { propertyId_number: { propertyId: room.propertyId, number: body.number } },
    });
    if (clash) throw httpError(409, `Room ${body.number} already exists in this property.`);
  }
  if (body.bedCount && body.bedCount < room.bedCount) {
    const keep = bedLabels(body.bedCount);
    const stranded = await prisma.tenancy.count({
      where: { roomId: room.id, moveOutDate: null, bed: { notIn: keep } },
    });
    if (stranded) throw httpError(409, 'A tenant is living in one of the beds you are removing. Move them out first.');
  }
  const { property, ...before } = room;
  const updated = await prisma.room.update({ where: { id: room.id }, data: body });
  await audit(req, 'room.update', { type: 'room', id: room.id, before, after: updated });
  res.json(updated);
});

router.post('/:roomId/archive', async (req, res) => {
  const room = await loadRoom(req, req.params.roomId);
  const current = await prisma.tenancy.count({ where: { roomId: room.id, moveOutDate: null } });
  if (current) throw httpError(409, 'Move out the tenants in this room before removing it.');
  const updated = await prisma.room.update({ where: { id: room.id }, data: { archivedAt: new Date() } });
  await audit(req, 'room.archive', { type: 'room', id: room.id });
  res.json(updated);
});

router.post('/:roomId/unarchive', async (req, res) => {
  const room = await loadRoom(req, req.params.roomId);
  const updated = await prisma.room.update({ where: { id: room.id }, data: { archivedAt: null } });
  await audit(req, 'room.unarchive', { type: 'room', id: room.id });
  res.json(updated);
});

/** Delete a room that never had a tenant; otherwise it must be archived. */
router.delete('/:roomId', async (req, res) => {
  const room = await loadRoom(req, req.params.roomId);
  if (await prisma.tenancy.count({ where: { roomId: room.id } })) {
    throw httpError(409, 'This room has tenancy history, so it cannot be deleted. Archive it instead.');
  }
  const { property, ...before } = room;
  await prisma.room.delete({ where: { id: room.id } });
  await audit(req, 'room.delete', { type: 'room', id: room.id, before });
  res.json({ ok: true });
});

export default router;

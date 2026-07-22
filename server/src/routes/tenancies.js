import { Router } from 'express';
import { prisma } from '../db.js';
import { buildTenancyProfile } from '../tenancyService.js';

const router = Router();

/**
 * POST /api/tenancies — assign a tenant to a specific bed of a room.
 * Body: { roomNumber, bed, tenantId?, newTenant?, monthlyRent, moveInDate }
 * Either an existing tenantId or a newTenant { name, phone, email, notes }.
 */
router.post('/', async (req, res) => {
  const { roomNumber, bed: bedRaw, tenantId, newTenant, monthlyRent, moveInDate } = req.body || {};
  const number = Number(roomNumber);
  const bed = String(bedRaw || 'A').toUpperCase();

  const room = await prisma.room.findUnique({ where: { number } });
  if (!room) return res.status(400).json({ error: 'That room does not exist.' });
  if (!['A', 'B'].includes(bed)) return res.status(400).json({ error: 'Invalid bed.' });

  const occupied = await prisma.tenancy.findFirst({
    where: { roomNumber: number, bed, moveOutDate: null },
  });
  if (occupied) {
    return res.status(409).json({ error: 'That bed is already occupied.' });
  }

  if (monthlyRent == null || monthlyRent < 0) {
    return res.status(400).json({ error: 'Please enter a valid monthly rent.' });
  }
  if (!moveInDate) {
    return res.status(400).json({ error: 'Please choose a move-in date.' });
  }

  let finalTenantId = tenantId ? Number(tenantId) : null;
  if (!finalTenantId) {
    if (!newTenant?.name?.trim()) {
      return res.status(400).json({ error: 'Please enter the tenant name.' });
    }
    const created = await prisma.tenant.create({
      data: {
        name: newTenant.name.trim(),
        phone: (newTenant.phone || '').trim(),
        email: (newTenant.email || '').trim().toLowerCase(),
        notes: (newTenant.notes || '').trim(),
      },
    });
    finalTenantId = created.id;
  }

  const tenancy = await prisma.tenancy.create({
    data: {
      roomNumber: number,
      bed,
      tenantId: finalTenantId,
      monthlyRent: Math.round(monthlyRent),
      moveInDate: new Date(moveInDate),
    },
    include: { tenant: true, room: true },
  });
  res.status(201).json({ ...tenancy, roomLabel: `${tenancy.roomNumber}${tenancy.bed}` });
});

/**
 * GET /api/tenancies/past?archived=0|1 — moved-out tenancies with a summary.
 * Defaults to non-archived past tenants; ?archived=1 lists the archived ones.
 * (Defined before /:id so "past" isn't treated as an id.)
 */
router.get('/past', async (req, res) => {
  const archived = String(req.query.archived) === '1';
  const rows = await prisma.tenancy.findMany({
    where: { moveOutDate: { not: null }, archivedAt: archived ? { not: null } : null },
    include: {
      tenant: true,
      payments: { select: { amount: true, receipt: { select: { id: true } } } },
    },
    orderBy: { moveOutDate: 'desc' },
  });
  res.json(
    rows.map((t) => ({
      id: t.id,
      tenantName: t.tenant.name,
      roomLabel: `${t.roomNumber}${t.bed}`,
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
  const profile = await buildTenancyProfile(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Tenancy not found.' });
  res.json(profile);
});

/** PATCH /api/tenancies/:id — edit rent / move-in date. */
router.patch('/:id', async (req, res) => {
  const { monthlyRent, moveInDate } = req.body || {};
  const data = {};
  if (monthlyRent != null) {
    if (monthlyRent < 0) return res.status(400).json({ error: 'Please enter a valid rent.' });
    data.monthlyRent = Math.round(monthlyRent);
  }
  if (moveInDate != null) data.moveInDate = new Date(moveInDate);
  const tenancy = await prisma.tenancy.update({
    where: { id: Number(req.params.id) },
    data,
  });
  res.json(tenancy);
});

/** POST /api/tenancies/:id/moveout — end a tenancy, keeping all history. */
router.post('/:id/moveout', async (req, res) => {
  const { moveOutDate } = req.body || {};
  const id = Number(req.params.id);
  const tenancy = await prisma.tenancy.findUnique({ where: { id } });
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' });
  if (tenancy.moveOutDate) {
    return res.status(400).json({ error: 'This tenant has already moved out.' });
  }
  const updated = await prisma.tenancy.update({
    where: { id },
    data: { moveOutDate: moveOutDate ? new Date(moveOutDate) : new Date() },
  });
  res.json(updated);
});

/** POST /api/tenancies/:id/archive — hide a moved-out tenancy (records kept). */
router.post('/:id/archive', async (req, res) => {
  const id = Number(req.params.id);
  const tenancy = await prisma.tenancy.findUnique({ where: { id } });
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' });
  if (!tenancy.moveOutDate) {
    return res.status(400).json({ error: 'Move the tenant out before archiving them.' });
  }
  const updated = await prisma.tenancy.update({ where: { id }, data: { archivedAt: new Date() } });
  res.json({ id: updated.id, archivedAt: updated.archivedAt });
});

/** POST /api/tenancies/:id/unarchive — bring an archived tenant back into the list. */
router.post('/:id/unarchive', async (req, res) => {
  const id = Number(req.params.id);
  const tenancy = await prisma.tenancy.findUnique({ where: { id } });
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' });
  const updated = await prisma.tenancy.update({ where: { id }, data: { archivedAt: null } });
  res.json({ id: updated.id, archivedAt: updated.archivedAt });
});

export default router;

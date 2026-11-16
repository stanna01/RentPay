// Properties of the signed-in landlord's own business: list, create, edit,
// archive, delete. Another landlord's property behaves as if it did not exist.

import { Router } from 'express';
import { prisma } from '../db.js';
import { propertyFilter, assertPropertyAccess } from '../access.js';
import { audit } from '../audit.js';
import { parse, z, text, ngwee } from '../validate.js';
import { notFound, httpError } from '../httpError.js';

const router = Router();

const code = () =>
  z
    .string()
    .trim()
    .toUpperCase()
    // Must start with a letter so it can never look like a year in old
    // RCT-YYYY-NNNN receipt numbers.
    .regex(/^[A-Z][A-Z0-9]{1,5}$/, 'Property code must be 2–6 letters or digits, starting with a letter (it appears in receipt numbers).');

// Codes are unique across all landlords (they appear in receipt numbers).
const CODE_TAKEN = 'That code is already in use. Please choose another.';

const roomFields = {
  bedCount: z.coerce.number().int().min(1, 'A room needs at least 1 bed.').max(26, 'A room can have at most 26 beds.'),
  defaultRent: ngwee('Please enter a valid rent amount.'),
};

async function loadProperty(req, rawId) {
  const pid = Number(rawId);
  if (!Number.isInteger(pid)) throw notFound('Property not found.');
  await assertPropertyAccess(req, pid);
  const p = await prisma.property.findUnique({ where: { id: pid } });
  if (!p) throw notFound('Property not found.');
  return p;
}

/**
 * True once any receipt has been numbered with this property's code. (Receipts
 * from before multi-property support, RCT-YYYY-NNNN, don't carry a code, so a
 * migrated property can still choose its code until its first new receipt.)
 */
async function hasIssuedReceipts(property) {
  const n = await prisma.receipt.count({ where: { receiptNumber: { startsWith: `RCT-${property.code}-` } } });
  return n > 0;
}

async function activeTenancyCount(propertyId) {
  return prisma.tenancy.count({ where: { moveOutDate: null, room: { propertyId } } });
}

router.get('/', async (req, res) => {
  const filter = await propertyFilter(req);
  const includeArchived = req.query.includeArchived === '1';
  const props = await prisma.property.findMany({
    where: { id: filter, ...(includeArchived ? {} : { archivedAt: null }) },
    include: { rooms: { where: { archivedAt: null }, select: { bedCount: true } } },
    orderBy: { id: 'asc' },
  });
  res.json(
    props.map(({ rooms, ...p }) => ({
      ...p,
      roomCount: rooms.length,
      bedCount: rooms.reduce((s, r) => s + r.bedCount, 0),
    }))
  );
});

router.get('/:id', async (req, res) => {
  const p = await loadProperty(req, req.params.id);
  const rooms = await prisma.room.findMany({ where: { propertyId: p.id }, orderBy: { number: 'asc' } });
  res.json({ ...p, rooms, receiptsIssued: await hasIssuedReceipts(p) });
});

router.post('/', async (req, res) => {
  const body = parse(
    z.object({
      name: text().min(1, 'Please enter the property name.'),
      address: text().optional().default(''),
      code: code(),
      // Optionally create rooms 1..roomCount in one go.
      roomCount: z.coerce.number().int().min(0).max(500).optional().default(0),
      bedCount: roomFields.bedCount.optional().default(2),
      defaultRent: roomFields.defaultRent.optional().default(0),
    }),
    req.body
  );
  if (await prisma.property.findUnique({ where: { code: body.code } })) {
    throw httpError(409, CODE_TAKEN);
  }
  const property = await prisma.property.create({
    data: {
      organizationId: req.user.organizationId,
      name: body.name,
      address: body.address,
      code: body.code,
      rooms: body.roomCount
        ? {
            create: Array.from({ length: body.roomCount }, (_, i) => ({
              number: i + 1,
              bedCount: body.bedCount,
              defaultRent: body.defaultRent,
            })),
          }
        : undefined,
    },
  });
  await audit(req, 'property.create', { type: 'property', id: property.id, after: { ...property, roomCount: body.roomCount } });
  res.status(201).json(property);
});

router.patch('/:id', async (req, res) => {
  const p = await loadProperty(req, req.params.id);
  const body = parse(
    z.object({ name: text().min(1, 'Please enter the property name.').optional(), address: text().optional(), code: code().optional() }),
    req.body
  );
  if (body.code && body.code !== p.code) {
    if (await hasIssuedReceipts(p)) {
      throw httpError(409, 'The code cannot change after receipts have been issued with it.');
    }
    if (await prisma.property.findUnique({ where: { code: body.code } })) {
      throw httpError(409, CODE_TAKEN);
    }
  }
  const updated = await prisma.property.update({ where: { id: p.id }, data: body });
  await audit(req, 'property.update', { type: 'property', id: p.id, before: p, after: updated });
  res.json(updated);
});

router.post('/:id/archive', async (req, res) => {
  const p = await loadProperty(req, req.params.id);
  if (await activeTenancyCount(p.id)) {
    throw httpError(409, 'Move out all current tenants before archiving this property.');
  }
  const updated = await prisma.property.update({ where: { id: p.id }, data: { archivedAt: new Date() } });
  await audit(req, 'property.archive', { type: 'property', id: p.id });
  res.json(updated);
});

router.post('/:id/unarchive', async (req, res) => {
  const p = await loadProperty(req, req.params.id);
  const updated = await prisma.property.update({ where: { id: p.id }, data: { archivedAt: null } });
  await audit(req, 'property.unarchive', { type: 'property', id: p.id });
  res.json(updated);
});

/** Delete a property that has never had tenants. Otherwise archive it. */
router.delete('/:id', async (req, res) => {
  const p = await loadProperty(req, req.params.id);
  const [tenancies, tenants] = await Promise.all([
    prisma.tenancy.count({ where: { room: { propertyId: p.id } } }),
    prisma.tenant.count({ where: { propertyId: p.id } }),
  ]);
  if (tenancies || tenants || (await hasIssuedReceipts(p))) {
    throw httpError(409, 'This property has tenant or payment records, so it cannot be deleted. Archive it instead.');
  }
  await prisma.$transaction([
    prisma.receiptCounter.deleteMany({ where: { propertyId: p.id } }),
    prisma.room.deleteMany({ where: { propertyId: p.id } }),
    prisma.property.delete({ where: { id: p.id } }),
  ]);
  await audit(req, 'property.delete', { type: 'property', id: p.id, before: p });
  res.json({ ok: true });
});

// --- Rooms within a property -------------------------------------------------

router.post('/:id/rooms', async (req, res) => {
  const p = await loadProperty(req, req.params.id);
  const body = parse(
    z.object({
      number: z.coerce.number().int().min(1, 'Room number must be 1 or more.').max(100000),
      bedCount: roomFields.bedCount.optional().default(2),
      defaultRent: roomFields.defaultRent.optional().default(0),
    }),
    req.body
  );
  if (await prisma.room.findUnique({ where: { propertyId_number: { propertyId: p.id, number: body.number } } })) {
    throw httpError(409, `Room ${body.number} already exists in this property.`);
  }
  const room = await prisma.room.create({ data: { propertyId: p.id, ...body } });
  await audit(req, 'room.create', { type: 'room', id: room.id, after: room });
  res.status(201).json(room);
});

export { roomFields };
export default router;

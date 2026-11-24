// Landlord isolation. A LANDLORD can reach only the properties of their own
// organization (landlord business). Every route that touches a tenant,
// tenancy, room, payment or receipt loads it through one of the helpers below,
// which resolve its property and check access — so an id from another
// landlord behaves exactly like an id that does not exist.

import { prisma } from './db.js';
import { notFound, badRequest } from './httpError.js';

/** Property ids of the user's organization. Cached per request. */
export async function accessiblePropertyIds(req) {
  if (!req._propertyIds) {
    const orgId = req.user.organizationId;
    const rows = orgId
      ? await prisma.property.findMany({ where: { organizationId: orgId }, select: { id: true } })
      : [];
    req._propertyIds = rows.map((r) => r.id);
  }
  return req._propertyIds;
}

/** Prisma `where` fragment limiting a propertyId column to what the user can see. */
export async function propertyFilter(req) {
  return { in: await accessiblePropertyIds(req) };
}

export async function canAccessProperty(req, propertyId) {
  return (await accessiblePropertyIds(req)).includes(Number(propertyId));
}

export async function assertPropertyAccess(req, propertyId, what = 'Property') {
  if (!(await canAccessProperty(req, propertyId))) throw notFound(`${what} not found.`);
}

/**
 * The property a list/dashboard request is about: ?propertyId= (or body), or
 * else the user's first active property. Throws if the user has none.
 */
export async function resolvePropertyId(req) {
  const raw = req.query?.propertyId ?? req.body?.propertyId;
  if (raw != null && raw !== '' && raw !== 'all') {
    const id = Number(raw);
    if (!Number.isInteger(id)) throw badRequest('Invalid property.');
    await assertPropertyAccess(req, id);
    const p = await prisma.property.findUnique({ where: { id } });
    if (!p) throw notFound('Property not found.');
    return id;
  }
  const filter = await propertyFilter(req);
  const first = await prisma.property.findFirst({
    where: { archivedAt: null, id: filter },
    orderBy: { id: 'asc' },
  });
  if (!first) throw notFound('You have no property yet. Add one first.');
  return first.id;
}

function intId(raw, what) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw notFound(`${what} not found.`);
  return id;
}

export async function loadRoom(req, rawId) {
  const room = await prisma.room.findUnique({
    where: { id: intId(rawId, 'Room') },
    include: { property: true },
  });
  if (!room) throw notFound('Room not found.');
  await assertPropertyAccess(req, room.propertyId, 'Room');
  return room;
}

export async function loadTenant(req, rawId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: intId(rawId, 'Tenant') } });
  if (!tenant || tenant.deletedAt) throw notFound('Tenant not found.');
  await assertPropertyAccess(req, tenant.propertyId, 'Tenant');
  return tenant;
}

export async function loadTenancy(req, rawId) {
  const tenancy = await prisma.tenancy.findUnique({
    where: { id: intId(rawId, 'Tenancy') },
    include: { tenant: true, room: { include: { property: true } } },
  });
  if (!tenancy) throw notFound('Tenancy not found.');
  await assertPropertyAccess(req, tenancy.room.propertyId, 'Tenancy');
  return tenancy;
}

export async function loadPayment(req, rawId) {
  const payment = await prisma.payment.findUnique({
    where: { id: intId(rawId, 'Payment') },
    include: {
      allocations: true,
      receipt: { select: { id: true, receiptNumber: true } },
      tenancy: { include: { tenant: true, room: { include: { property: true } } } },
    },
  });
  if (!payment) throw notFound('Payment not found.');
  await assertPropertyAccess(req, payment.tenancy.room.propertyId, 'Payment');
  return payment;
}

export async function loadReceipt(req, rawId) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: intId(rawId, 'Receipt') },
    include: {
      payment: {
        include: {
          tenancy: { include: { tenant: true, room: { include: { property: true } } } },
        },
      },
    },
  });
  if (!receipt) throw notFound('Receipt not found.');
  await assertPropertyAccess(req, receipt.payment.tenancy.room.propertyId, 'Receipt');
  return receipt;
}

export async function loadCharge(req, rawId) {
  const charge = await prisma.charge.findUnique({
    where: { id: intId(rawId, 'Charge') },
    include: { tenancy: { include: { room: true } } },
  });
  if (!charge) throw notFound('Charge not found.');
  await assertPropertyAccess(req, charge.tenancy.room.propertyId, 'Charge');
  return charge;
}

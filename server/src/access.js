// Property-level access control. ADMINs can reach every property; LANDLORDs
// only the properties granted to them in PropertyAccess. Every route that
// touches a tenant, tenancy, room, payment or receipt loads it through one of
// the helpers below, which resolve its property and check access — so an id
// from another property behaves exactly like an id that does not exist.

import { prisma } from './db.js';
import { isAdmin } from './auth.js';
import { notFound, badRequest } from './httpError.js';

/** Property ids the user may access, or null meaning "all" (admin). Cached per request. */
export async function accessiblePropertyIds(req) {
  if (isAdmin(req.user)) return null;
  if (!req._propertyIds) {
    const rows = await prisma.propertyAccess.findMany({
      where: { userId: req.user.id },
      select: { propertyId: true },
    });
    req._propertyIds = rows.map((r) => r.propertyId);
  }
  return req._propertyIds;
}

/** Prisma `where` fragment limiting a propertyId column to what the user can see. */
export async function propertyFilter(req) {
  const ids = await accessiblePropertyIds(req);
  return ids === null ? {} : { in: ids };
}

export async function canAccessProperty(req, propertyId) {
  const ids = await accessiblePropertyIds(req);
  return ids === null || ids.includes(Number(propertyId));
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
    where: { archivedAt: null, ...(filter.in ? { id: filter } : {}) },
    orderBy: { id: 'asc' },
  });
  if (!first) throw notFound('You do not have access to any property yet. Ask an administrator.');
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
      periods: true,
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
          periods: true,
          tenancy: { include: { tenant: true, room: { include: { property: true } } } },
        },
      },
    },
  });
  if (!receipt) throw notFound('Receipt not found.');
  await assertPropertyAccess(req, receipt.payment.tenancy.room.propertyId, 'Receipt');
  return receipt;
}

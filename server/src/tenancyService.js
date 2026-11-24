// Tenancy helpers: bed labels and the tenant-profile payload (statement,
// charges, payments, rent changes). Money rules live in billingService.js.

import { prisma } from './db.js';
import { tenancyDuration } from './status.js';
import { ensureBilling, loadAccount, chargeView, ACTIVE, VOID } from './billingService.js';
import { dbDay, localDay } from './dates.js';

export { ACTIVE, VOID };

/** Bed letters for a room: bedCount 2 → ['A', 'B']. */
export function bedLabels(bedCount) {
  const n = Math.max(1, Math.min(26, bedCount || 1));
  return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
}

export const roomLabel = (roomNumber, bed) => `${roomNumber}${bed}`;

/** A payment as the API returns it (receipt lines are the frozen receipt text). */
export function paymentView(p) {
  return {
    id: p.id,
    amount: p.amount,
    datePaid: p.datePaid,
    method: p.method,
    status: p.status,
    voidedAt: p.voidedAt,
    voidReason: p.voidReason,
    replacesPaymentId: p.replacesPaymentId,
    lines: Array.isArray(p.receiptLines) ? p.receiptLines : [],
    creditAfter: p.creditAfter,
    balanceAfter: p.balanceAfter,
    receipt: p.receipt
      ? { id: p.receipt.id, receiptNumber: p.receipt.receiptNumber, emailStatus: p.receipt.emailStatus, emailedAt: p.receipt.emailedAt }
      : null,
  };
}

/**
 * Statement lines, oldest first, with a running balance: charges add, waivers
 * and payments subtract. A negative balance is credit. Cancelled charges,
 * reversed waivers and voided payments are left out (they never counted).
 */
export function buildStatement(charges, payments) {
  const rows = [];
  for (const c of charges) {
    if (c.cancelledAt) continue;
    rows.push({ date: dbDay(c.periodStart) || localDay(c.createdAt), kind: 'charge', description: c.description, amount: c.amount, order: 0, id: c.id });
    for (const w of c.waivers || []) {
      if (w.reversedAt) continue;
      rows.push({ date: localDay(w.createdAt), kind: 'waiver', description: `Waived: ${c.description} — ${w.reason}`, amount: -w.amount, order: 1, id: w.id });
    }
  }
  for (const p of payments) {
    if (p.status !== ACTIVE) continue;
    rows.push({
      date: localDay(p.datePaid),
      kind: 'payment',
      description: `Payment${p.receipt ? ` — receipt ${p.receipt.receiptNumber}` : ''}`,
      amount: -p.amount,
      order: 2,
      id: p.id,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order || a.id - b.id));
  let balance = 0;
  return rows.map(({ order, ...r }) => {
    balance += r.amount;
    return { ...r, balance };
  });
}

/** The tenant-profile payload: details, charges, statement, payments, rent changes. */
export async function buildTenancyProfile(tenancyId) {
  const tenancy = await prisma.tenancy.findUnique({
    where: { id: tenancyId },
    include: { tenant: true, room: { include: { property: true } } },
  });
  if (!tenancy) return null;
  await ensureBilling([tenancy.room.propertyId], { tenancyIds: [tenancy.id] });

  const [account, payments, rentChanges] = await Promise.all([
    loadAccount(tenancy.id),
    prisma.payment.findMany({
      where: { tenancyId },
      include: { receipt: true },
      orderBy: [{ datePaid: 'desc' }, { id: 'desc' }],
    }),
    prisma.rentChange.findMany({ where: { tenancyId }, orderBy: [{ startsOn: 'desc' }, { id: 'desc' }] }),
  ]);
  const fresh = await prisma.tenancy.findUnique({ where: { id: tenancyId }, select: { rent: true } });
  const property = tenancy.room.property;
  const charges = account.charges.map(chargeView);
  const upcoming = rentChanges.find((c) => !c.cancelledAt && !c.appliedAt);

  return {
    tenancy: {
      id: tenancy.id,
      roomId: tenancy.roomId,
      roomNumber: tenancy.room.number,
      bed: tenancy.bed,
      roomLabel: roomLabel(tenancy.room.number, tenancy.bed),
      property: { id: property.id, name: property.name, code: property.code, billingCycle: property.billingCycle, dueDay: property.dueDay },
      rent: fresh.rent,
      moveInDate: dbDay(tenancy.moveInDate),
      moveOutDate: dbDay(tenancy.moveOutDate),
      createdAt: tenancy.createdAt,
      duration: tenancyDuration(tenancy.moveInDate, tenancy.moveOutDate),
      isCurrent: !tenancy.moveOutDate,
    },
    tenant: tenancy.tenant,
    owed: account.owed,
    overdue: account.overdue,
    credit: account.credit,
    oldestDue: account.oldestDue,
    charges,
    openCharges: charges.filter((c) => c.balance > 0),
    statement: buildStatement(account.charges, payments),
    payments: payments.map(paymentView),
    rentChanges: rentChanges.map((c) => ({
      id: c.id,
      oldRent: c.oldRent,
      newRent: c.newRent,
      startsOn: dbDay(c.startsOn),
      fromNotice: c.rentIncreaseId != null,
      appliedAt: c.appliedAt,
      cancelledAt: c.cancelledAt,
    })),
    upcomingRentChange: upcoming ? { newRent: upcoming.newRent, startsOn: dbDay(upcoming.startsOn) } : null,
  };
}

// Shared read helpers for tenancies: current tenancy lookup, per-month applied
// amounts, payment history, and unpaid-month detection.

import { prisma } from './db.js';
import { monthStatus, tenancyDuration, STATUS } from './status.js';

/** Current (not moved-out) tenancy for a specific bed, with tenant, or null. */
export function currentTenancyForBed(roomNumber, bed) {
  return prisma.tenancy.findFirst({
    where: { roomNumber, bed, moveOutDate: null },
    include: { tenant: true },
    orderBy: { id: 'desc' },
  });
}

/**
 * Sum amountApplied per "year-month" key for a tenancy across all its payments.
 * Returns a Map like { "2026-7" => 150000 }.
 */
export async function appliedByMonth(tenancyId) {
  const rows = await prisma.paymentPeriod.findMany({
    where: { payment: { tenancyId } },
    select: { month: true, year: true, amountApplied: true, expectedRent: true },
  });
  const applied = new Map();
  const expected = new Map();
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    applied.set(key, (applied.get(key) || 0) + r.amountApplied);
    // Keep the latest snapshot's expected rent for display of that month.
    expected.set(key, r.expectedRent);
  }
  return { applied, expected };
}

/** Status of a specific month for a tenancy (uses snapshot expected if present). */
export async function monthStatusForTenancy(tenancy, month, year) {
  const { applied, expected } = await appliedByMonth(tenancy.id);
  const key = `${year}-${month}`;
  const exp = expected.has(key) ? expected.get(key) : tenancy.monthlyRent;
  return monthStatus(applied.get(key) || 0, exp);
}

/** Build the tenant-profile payload: details, duration, history, unpaid months. */
export async function buildTenancyProfile(tenancyId) {
  const tenancy = await prisma.tenancy.findUnique({
    where: { id: tenancyId },
    include: { tenant: true, room: true },
  });
  if (!tenancy) return null;

  const payments = await prisma.payment.findMany({
    where: { tenancyId },
    include: { periods: true, receipt: true },
    orderBy: { datePaid: 'desc' },
  });

  const { applied, expected } = await appliedByMonth(tenancyId);

  // Determine unpaid / partial months from move-in to now (or move-out).
  const unpaidMonths = [];
  const start = new Date(tenancy.moveInDate);
  const end = tenancy.moveOutDate ? new Date(tenancy.moveOutDate) : new Date();
  let y = start.getFullYear();
  let m = start.getMonth() + 1;
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth() + 1)) {
    const key = `${y}-${m}`;
    const exp = expected.has(key) ? expected.get(key) : tenancy.monthlyRent;
    const st = monthStatus(applied.get(key) || 0, exp);
    if (st.status === STATUS.DUE || st.status === STATUS.PARTIAL) {
      unpaidMonths.push({ month: m, year: y, ...st });
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return {
    tenancy: {
      id: tenancy.id,
      roomNumber: tenancy.roomNumber,
      bed: tenancy.bed,
      roomLabel: `${tenancy.roomNumber}${tenancy.bed}`,
      monthlyRent: tenancy.monthlyRent,
      moveInDate: tenancy.moveInDate,
      moveOutDate: tenancy.moveOutDate,
      duration: tenancyDuration(tenancy.moveInDate, tenancy.moveOutDate),
      isCurrent: !tenancy.moveOutDate,
    },
    tenant: tenancy.tenant,
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      datePaid: p.datePaid,
      method: p.method,
      periods: p.periods.sort((a, b) => a.year - b.year || a.month - b.month),
      receipt: p.receipt
        ? {
            id: p.receipt.id,
            receiptNumber: p.receipt.receiptNumber,
            emailStatus: p.receipt.emailStatus,
            emailedAt: p.receipt.emailedAt,
          }
        : null,
    })),
    unpaidMonths,
  };
}

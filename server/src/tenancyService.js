// Shared read helpers for tenancies: the per-month ledger (what was expected,
// what was paid), payment history, and unpaid-month detection.
//
// THE RULE: only ACTIVE payments count as money received, and only
// non-reversed arrears adjustments change what is owed. Every balance, status,
// dashboard figure and report goes through the ledger below so a voided
// payment can never be counted by mistake.

import { prisma } from './db.js';
import { monthStatus, tenancyDuration, STATUS } from './status.js';

export const ACTIVE = 'ACTIVE';
export const VOID = 'VOID';

export const mkey = (year, month) => `${year}-${month}`;

/** Bed letters for a room: bedCount 2 → ['A', 'B']. */
export function bedLabels(bedCount) {
  const n = Math.max(1, Math.min(26, bedCount || 1));
  return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
}

export const roomLabel = (roomNumber, bed) => `${roomNumber}${bed}`;

export function makeLedger(tenancy) {
  const applied = new Map();
  const snapshot = new Map();
  const adjust = new Map();
  return {
    tenancy,
    applied,
    snapshot,
    adjust,
    /** Rent due before adjustments: the snapshot taken at payment time, else current rent. */
    baseExpected(key) {
      return snapshot.has(key) ? snapshot.get(key) : tenancy.monthlyRent;
    },
    /** What is owed for the month, after waivers/charges (never negative). */
    expected(key) {
      return Math.max(0, this.baseExpected(key) + (adjust.get(key) || 0));
    },
    paid(key) {
      return applied.get(key) || 0;
    },
    status(year, month) {
      const key = mkey(year, month);
      return monthStatus(this.paid(key), this.expected(key));
    },
  };
}

/**
 * Build ledgers for many tenancies with two queries in total.
 * @param {Array<{id:number, monthlyRent:number}>} tenancies
 * @param {{excludePaymentIds?: number[]}} [opts] leave these payments out
 *        (used when correcting a payment: the one being replaced must not count)
 * @returns {Promise<Map<number, ReturnType<typeof makeLedger>>>}
 */
export async function loadLedgers(tenancies, { excludePaymentIds = [] } = {}) {
  const ledgers = new Map(tenancies.map((t) => [t.id, makeLedger(t)]));
  if (tenancies.length === 0) return ledgers;
  const ids = tenancies.map((t) => t.id);

  const periods = await prisma.paymentPeriod.findMany({
    where: {
      payment: {
        tenancyId: { in: ids },
        status: ACTIVE,
        ...(excludePaymentIds.length ? { id: { notIn: excludePaymentIds } } : {}),
      },
    },
    select: {
      month: true,
      year: true,
      amountApplied: true,
      expectedRent: true,
      payment: { select: { tenancyId: true } },
    },
    orderBy: { paymentId: 'asc' },
  });
  for (const p of periods) {
    const l = ledgers.get(p.payment.tenancyId);
    const key = mkey(p.year, p.month);
    l.applied.set(key, (l.applied.get(key) || 0) + p.amountApplied);
    l.snapshot.set(key, p.expectedRent); // latest snapshot wins
  }

  const adjustments = await prisma.arrearsAdjustment.findMany({
    where: { tenancyId: { in: ids }, reversedAt: null },
    select: { tenancyId: true, month: true, year: true, amount: true },
  });
  for (const a of adjustments) {
    const l = ledgers.get(a.tenancyId);
    const key = mkey(a.year, a.month);
    l.adjust.set(key, (l.adjust.get(key) || 0) + a.amount);
  }
  return ledgers;
}

export async function loadLedger(tenancy, opts) {
  return (await loadLedgers([tenancy], opts)).get(tenancy.id);
}

/** Iterate {year, month} from one date's month to another's (inclusive). */
export function* monthsBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  let y = a.getFullYear();
  let m = a.getMonth() + 1;
  while (y < b.getFullYear() || (y === b.getFullYear() && m <= b.getMonth() + 1)) {
    yield { year: y, month: m };
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

/** Unpaid / part-paid months from move-in to now (or move-out). */
export function unpaidMonthsFor(ledger) {
  const t = ledger.tenancy;
  const end = t.moveOutDate ? new Date(t.moveOutDate) : new Date();
  const out = [];
  for (const { year, month } of monthsBetween(t.moveInDate, end)) {
    const st = ledger.status(year, month);
    if (st.status === STATUS.DUE || st.status === STATUS.PARTIAL) out.push({ month, year, ...st });
  }
  return out;
}

/** Build the tenant-profile payload: details, duration, history, unpaid months, ledger. */
export async function buildTenancyProfile(tenancyId) {
  const tenancy = await prisma.tenancy.findUnique({
    where: { id: tenancyId },
    include: { tenant: true, room: { include: { property: true } } },
  });
  if (!tenancy) return null;

  const [payments, adjustments, ledger] = await Promise.all([
    prisma.payment.findMany({
      where: { tenancyId },
      include: { periods: true, receipt: true },
      orderBy: [{ datePaid: 'desc' }, { id: 'desc' }],
    }),
    prisma.arrearsAdjustment.findMany({ where: { tenancyId }, orderBy: { createdAt: 'desc' } }),
    loadLedger(tenancy),
  ]);

  // Month-by-month view from move-in to 12 months ahead (used by the payment
  // screen to know which months are settled, including advances).
  const horizon = new Date();
  horizon.setMonth(horizon.getMonth() + 12);
  const months = [];
  for (const { year, month } of monthsBetween(tenancy.moveInDate, horizon)) {
    const key = mkey(year, month);
    const st = ledger.status(year, month);
    months.push({ key, year, month, expected: st.expected, applied: st.applied, balance: st.balance, status: st.status, adjustment: ledger.adjust.get(key) || 0 });
  }

  return {
    tenancy: {
      id: tenancy.id,
      roomId: tenancy.roomId,
      roomNumber: tenancy.room.number,
      bed: tenancy.bed,
      roomLabel: roomLabel(tenancy.room.number, tenancy.bed),
      property: { id: tenancy.room.property.id, name: tenancy.room.property.name, code: tenancy.room.property.code },
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
      status: p.status,
      voidedAt: p.voidedAt,
      voidReason: p.voidReason,
      replacesPaymentId: p.replacesPaymentId,
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
    adjustments,
    months,
    unpaidMonths: unpaidMonthsFor(ledger),
  };
}

/**
 * This month's totals across several properties (the phone app's dashboard):
 * beds, occupied beds, rent collected and rent still outstanding for the
 * current tenants. Archived properties and rooms are left out.
 */
export async function monthSummary(propertyIds, year, month) {
  const room = { archivedAt: null, property: { id: { in: propertyIds }, archivedAt: null } };
  const [rooms, tenancies] = await Promise.all([
    prisma.room.findMany({ where: room, select: { bedCount: true } }),
    prisma.tenancy.findMany({ where: { moveOutDate: null, room } }),
  ]);
  const ledgers = await loadLedgers(tenancies);
  let collected = 0;
  let outstanding = 0;
  for (const t of tenancies) {
    const st = ledgers.get(t.id).status(year, month);
    collected += st.applied;
    outstanding += st.balance;
  }
  return {
    totalBeds: rooms.reduce((s, r) => s + r.bedCount, 0),
    occupiedBeds: tenancies.length,
    collected,
    outstanding,
  };
}

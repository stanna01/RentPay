// Billing: rent charges, balances, credit and how payments are applied.
//
// THE RULES
//   * What a tenant owes is a sum of real lines: charges − waivers − allocations.
//     Nothing is recalculated from calendar months.
//   * An allocation (money from a payment applied to a charge) counts only while
//     its payment is ACTIVE and its charge is not cancelled. Money from an
//     ACTIVE payment that is not counted on any charge is the tenant's CREDIT,
//     and credit is applied automatically to open charges, oldest due first.
//   * Charges are never edited or deleted: a wrong one is cancelled with a
//     reason. Issued rent never changes; a rent change affects later periods.
//   * Every write that moves money for a tenancy locks that tenancy's row first
//     (lockTenancy), so two requests can never apply the same money twice.

import { prisma } from './db.js';
import {
  today,
  dbDay,
  toDbDate,
  daysInMonth,
  monthStart,
  monthsBetweenDays,
  MONTH_NAMES,
} from './dates.js';

export const ACTIVE = 'ACTIVE';
export const VOID = 'VOID';

export const CYCLES = ['MONTHLY', 'TERM'];
export const CHARGE_TYPES = ['RENT', 'DEPOSIT', 'FEE', 'OTHER'];
/** Types a landlord can add by hand (rent is billed automatically). */
export const MANUAL_CHARGE_TYPES = ['DEPOSIT', 'FEE', 'OTHER'];

export const CHARGE_STATUS = {
  PAID: 'PAID',
  PARTIAL: 'PARTIAL', // part-paid, not yet past its due date
  DUE: 'DUE', // nothing paid, not yet past its due date
  OVERDUE: 'OVERDUE', // past its due date with something still owed
  CANCELLED: 'CANCELLED',
};

const STAY_CHANGED = 'Outside the stay (move-in or move-out date changed)';

// --- Pure helpers (unit-tested) -------------------------------------------------

/**
 * The rent periods a tenancy should be billed for up to and including `upTo`:
 * one per month (MONTHLY) or one per term that overlaps the stay (TERM). Only
 * periods that have started are billed.
 * @returns {Array<{periodKey, periodStart, dueDate, description, termId}>}
 */
export function rentPeriods(property, terms, tenancy, upTo) {
  const inDay = dbDay(tenancy.moveInDate);
  const outDay = tenancy.moveOutDate ? dbDay(tenancy.moveOutDate) : null;
  const end = outDay && outDay < upTo ? outDay : upTo;
  if (inDay > end) return [];
  const out = [];

  if (property.billingCycle === 'TERM') {
    for (const term of terms) {
      const start = dbDay(term.startDate);
      const finish = dbDay(term.endDate);
      if (start > upTo || finish < inDay || (outDay && start > outDay)) continue;
      const due = dbDay(term.dueDate);
      out.push({
        periodKey: `T-${term.id}`,
        periodStart: start,
        dueDate: due < inDay ? inDay : due,
        description: `${term.name} rent`,
        termId: term.id,
      });
    }
    return out;
  }

  for (const { year, month } of monthsBetweenDays(inDay, end)) {
    const start = monthStart(year, month);
    const dueDay = Math.min(Math.max(1, property.dueDay || 1), daysInMonth(year, month));
    const due = `${start.slice(0, 8)}${String(dueDay).padStart(2, '0')}`;
    out.push({
      periodKey: `M-${year}-${String(month).padStart(2, '0')}`,
      periodStart: start,
      dueDate: due < inDay ? inDay : due,
      description: `Rent – ${MONTH_NAMES[month]} ${year}`,
      termId: null,
    });
  }
  return out;
}

/**
 * The rent for a period starting on `day`, given the tenancy's current rent and
 * its (not cancelled) rent changes. Correct whether or not a change has been
 * applied to tenancy.rent yet.
 */
export function rentOn(tenancy, changes, day) {
  const live = changes
    .filter((c) => !c.cancelledAt)
    .sort((a, b) => (dbDay(a.startsOn) < dbDay(b.startsOn) ? -1 : dbDay(a.startsOn) > dbDay(b.startsOn) ? 1 : a.id - b.id));
  if (!live.length) return tenancy.rent;
  let rent = live[0].oldRent;
  for (const c of live) if (dbDay(c.startsOn) <= day) rent = c.newRent;
  return rent;
}

/** Amounts and status of one charge. `charge` carries its waivers and counted allocations. */
export function chargeState(charge, onDay = today()) {
  const waived = (charge.waivers || []).filter((w) => !w.reversedAt).reduce((s, w) => s + w.amount, 0);
  const paid = (charge.allocations || []).reduce((s, a) => s + a.amount, 0);
  const net = Math.max(0, charge.amount - waived);
  if (charge.cancelledAt) {
    return { waived, paid, net, balance: 0, status: CHARGE_STATUS.CANCELLED, overdue: false };
  }
  const balance = Math.max(0, net - paid);
  const overdue = balance > 0 && dbDay(charge.dueDate) < onDay;
  let status = CHARGE_STATUS.PAID;
  if (balance > 0) status = overdue ? CHARGE_STATUS.OVERDUE : paid > 0 ? CHARGE_STATUS.PARTIAL : CHARGE_STATUS.DUE;
  return { waived, paid, net, balance, status, overdue };
}

/**
 * Fill open charges in the given order with `amount`.
 * @param {number} amount ngwee
 * @param {Array<{id:number, balance:number}>} open
 * @returns {{lines: Array<{chargeId:number, amount:number}>, leftover:number}}
 */
export function allocate(amount, open) {
  let left = Math.max(0, Math.round(amount || 0));
  const lines = [];
  for (const c of open) {
    if (left <= 0) break;
    const take = Math.min(left, c.balance);
    if (take > 0) {
      lines.push({ chargeId: c.id, amount: take });
      left -= take;
    }
  }
  return { lines, leftover: left };
}

/** Status of a bed tile from its tenant's account. */
export function accountStatus(account) {
  if (account.owed <= 0) return CHARGE_STATUS.PAID;
  if (account.overdue > 0) return CHARGE_STATUS.OVERDUE;
  return account.charges.some((c) => c.state.balance > 0 && c.state.paid > 0) ? CHARGE_STATUS.PARTIAL : CHARGE_STATUS.DUE;
}

// --- Reading accounts -------------------------------------------------------------

const byDueThenId = (a, b) => {
  const da = dbDay(a.dueDate);
  const db = dbDay(b.dueDate);
  return da < db ? -1 : da > db ? 1 : a.id - b.id;
};

/**
 * Every charge and active payment of the given tenancies, with balances.
 * @returns {Promise<Map<number, {charges, payments, owed, overdue, credit, oldestDue}>>}
 *   charges: each charge with .state (chargeState); sorted by due date
 *   payments: active payments with .unallocated (money not on any live charge)
 */
export async function loadAccounts(tenancyIds, db = prisma) {
  const ids = [...new Set(tenancyIds)];
  const accounts = new Map(ids.map((id) => [id, { charges: [], payments: [], owed: 0, overdue: 0, credit: 0, oldestDue: null }]));
  if (!ids.length) return accounts;
  const onDay = today();

  const [charges, payments] = await Promise.all([
    db.charge.findMany({
      where: { tenancyId: { in: ids } },
      include: {
        waivers: { orderBy: { id: 'asc' } },
        allocations: { where: { payment: { status: ACTIVE } }, select: { id: true, amount: true, paymentId: true } },
      },
    }),
    db.payment.findMany({
      where: { tenancyId: { in: ids }, status: ACTIVE },
      select: {
        id: true,
        tenancyId: true,
        amount: true,
        datePaid: true,
        allocations: { where: { charge: { cancelledAt: null } }, select: { amount: true } },
      },
      orderBy: [{ datePaid: 'asc' }, { id: 'asc' }],
    }),
  ]);

  charges.sort(byDueThenId);
  for (const c of charges) {
    const acc = accounts.get(c.tenancyId);
    c.state = chargeState(c, onDay);
    acc.charges.push(c);
    if (c.state.balance > 0) {
      acc.owed += c.state.balance;
      if (c.state.overdue) acc.overdue += c.state.balance;
      if (!acc.oldestDue) acc.oldestDue = dbDay(c.dueDate);
    }
  }
  for (const p of payments) {
    const acc = accounts.get(p.tenancyId);
    p.unallocated = Math.max(0, p.amount - p.allocations.reduce((s, a) => s + a.amount, 0));
    acc.credit += p.unallocated;
    acc.payments.push(p);
  }
  return accounts;
}

export async function loadAccount(tenancyId, db = prisma) {
  return (await loadAccounts([tenancyId], db)).get(tenancyId);
}

/** Lock one tenancy's row until the transaction ends (serialises money writes). */
export async function lockTenancy(tx, tenancyId) {
  await tx.$queryRaw`SELECT id FROM Tenancy WHERE id = ${tenancyId} FOR UPDATE`;
}

// --- Writing ------------------------------------------------------------------------

/**
 * Use a tenancy's credit on its open charges, oldest due first, oldest money
 * first. Safe to call any time; does nothing when there is no credit or debt.
 */
export async function applyCredit(tenancyId) {
  return prisma.$transaction(async (tx) => {
    await lockTenancy(tx, tenancyId);
    const acc = await loadAccount(tenancyId, tx);
    if (acc.credit <= 0 || acc.owed <= 0) return 0;
    const open = acc.charges.filter((c) => c.state.balance > 0).map((c) => ({ id: c.id, left: c.state.balance }));
    const rows = [];
    for (const p of acc.payments) {
      let money = p.unallocated;
      for (const c of open) {
        if (money <= 0) break;
        const take = Math.min(money, c.left);
        if (take <= 0) continue;
        rows.push({ paymentId: p.id, chargeId: c.id, amount: take });
        c.left -= take;
        money -= take;
      }
    }
    if (rows.length) await tx.allocation.createMany({ data: rows });
    return rows.length;
  });
}

/** Apply rent changes and rent increases whose start date has come. */
async function applyDueRentChanges(propertyIds, onDay) {
  const due = toDbDate(onDay);
  const changes = await prisma.rentChange.findMany({
    where: { appliedAt: null, cancelledAt: null, startsOn: { lte: due }, tenancy: { room: { propertyId: { in: propertyIds } } } },
    orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
  });
  for (const c of changes) {
    await prisma.$transaction([
      prisma.tenancy.update({ where: { id: c.tenancyId }, data: { rent: c.newRent } }),
      prisma.rentChange.update({ where: { id: c.id }, data: { appliedAt: new Date() } }),
    ]);
  }
  const increases = await prisma.rentIncrease.findMany({
    where: { appliedAt: null, cancelledAt: null, startsOn: { lte: due }, propertyId: { in: propertyIds } },
  });
  for (const inc of increases) {
    const rooms = Array.isArray(inc.roomIds) ? { id: { in: inc.roomIds } } : {};
    await prisma.$transaction([
      prisma.room.updateMany({ where: { propertyId: inc.propertyId, ...rooms }, data: { defaultRent: inc.newRent } }),
      prisma.rentIncrease.update({ where: { id: inc.id }, data: { appliedAt: new Date() } }),
    ]);
  }
}

/**
 * Make sure every rent charge that should exist by today does, for the given
 * properties (optionally only some tenancies), then apply any credit. Safe to
 * run any number of times and at the same time: the unique (tenancyId,
 * periodKey) index stops a month or term being billed twice.
 */
export async function ensureBilling(propertyIds, { tenancyIds } = {}) {
  const pids = [...new Set(propertyIds)].filter(Boolean);
  if (!pids.length) return;
  const onDay = today();
  await applyDueRentChanges(pids, onDay);

  const [properties, terms, tenancies] = await Promise.all([
    prisma.property.findMany({ where: { id: { in: pids } }, select: { id: true, billingCycle: true, dueDay: true } }),
    prisma.billingTerm.findMany({ where: { propertyId: { in: pids } }, orderBy: { startDate: 'asc' } }),
    prisma.tenancy.findMany({
      where: { room: { propertyId: { in: pids } }, ...(tenancyIds ? { id: { in: tenancyIds } } : {}) },
      select: { id: true, rent: true, moveInDate: true, moveOutDate: true, room: { select: { propertyId: true } } },
    }),
  ]);
  if (!tenancies.length) return;
  const ids = tenancies.map((t) => t.id);
  const [changes, existing] = await Promise.all([
    prisma.rentChange.findMany({ where: { tenancyId: { in: ids }, cancelledAt: null } }),
    prisma.charge.findMany({ where: { tenancyId: { in: ids }, periodKey: { not: null } }, select: { tenancyId: true, periodKey: true } }),
  ]);
  const have = new Set(existing.map((c) => `${c.tenancyId}|${c.periodKey}`));
  const propBy = new Map(properties.map((p) => [p.id, p]));
  const changesBy = new Map();
  for (const c of changes) changesBy.set(c.tenancyId, [...(changesBy.get(c.tenancyId) || []), c]);

  const rows = [];
  for (const t of tenancies) {
    const property = propBy.get(t.room.propertyId);
    const own = terms.filter((x) => x.propertyId === property.id);
    for (const p of rentPeriods(property, own, t, onDay)) {
      if (have.has(`${t.id}|${p.periodKey}`)) continue;
      const amount = rentOn(t, changesBy.get(t.id) || [], p.periodStart);
      if (amount <= 0) continue;
      rows.push({
        tenancyId: t.id,
        type: 'RENT',
        description: p.description,
        amount,
        dueDate: toDbDate(p.dueDate),
        periodStart: toDbDate(p.periodStart),
        periodKey: p.periodKey,
        termId: p.termId,
      });
    }
  }
  if (rows.length) await prisma.charge.createMany({ data: rows, skipDuplicates: true });

  const accounts = await loadAccounts(ids);
  for (const [id, acc] of accounts) {
    if (acc.credit > 0 && acc.owed > 0) await applyCredit(id);
  }
}

/** Run ensureBilling for every property (the daily timer). */
export async function ensureBillingEverywhere() {
  const props = await prisma.property.findMany({ where: { archivedAt: null }, select: { id: true } });
  for (const p of props) await ensureBilling([p.id]);
}

export function startBillingTimer(intervalMs = 6 * 60 * 60 * 1000) {
  const run = () => ensureBillingEverywhere().catch((e) => console.error('[billing]', e.message));
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 5_000).unref?.();
  return timer;
}

/**
 * After a move-in or move-out date changes: cancel the automatic rent charges
 * that now fall outside the stay (their period key is freed, so they are
 * billed again if the stay changes back), then bill what is now inside it.
 */
export async function syncStay(tenancyId, userId) {
  const t = await prisma.tenancy.findUnique({ where: { id: tenancyId }, include: { room: { select: { propertyId: true } } } });
  const inDay = dbDay(t.moveInDate);
  const outDay = t.moveOutDate ? dbDay(t.moveOutDate) : null;
  const auto = await prisma.charge.findMany({
    where: { tenancyId, type: 'RENT', createdById: null, cancelledAt: null },
    include: { term: true },
  });
  const outside = auto.filter((c) => {
    const start = dbDay(c.periodStart);
    if (c.term) {
      return dbDay(c.term.endDate) < inDay || (outDay && start > outDay);
    }
    const monthEnd = `${start.slice(0, 8)}${String(daysInMonth(+start.slice(0, 4), +start.slice(5, 7))).padStart(2, '0')}`;
    return monthEnd < inDay || (outDay && start > outDay);
  });
  for (const c of outside) {
    await prisma.charge.update({
      where: { id: c.id },
      data: { cancelledAt: new Date(), cancelledById: userId ?? null, cancelReason: STAY_CHANGED, periodKey: null },
    });
  }
  await ensureBilling([t.room.propertyId], { tenancyIds: [tenancyId] });
  await applyCredit(tenancyId);
  return outside.length;
}

/**
 * Totals for a set of properties: beds, occupied beds, money received this
 * calendar month, and what current tenants still owe (and how much is overdue).
 */
export async function propertySummary(propertyIds) {
  await ensureBilling(propertyIds);
  const room = { archivedAt: null, property: { id: { in: propertyIds }, archivedAt: null } };
  const now = new Date();
  const [rooms, tenancies, received] = await Promise.all([
    prisma.room.findMany({ where: room, select: { bedCount: true } }),
    prisma.tenancy.findMany({ where: { moveOutDate: null, room }, select: { id: true } }),
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: {
        status: ACTIVE,
        datePaid: { gte: new Date(now.getFullYear(), now.getMonth(), 1), lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) },
        tenancy: { room: { propertyId: { in: propertyIds } } },
      },
    }),
  ]);
  const accounts = await loadAccounts(tenancies.map((t) => t.id));
  let outstanding = 0;
  let overdue = 0;
  for (const acc of accounts.values()) {
    outstanding += acc.owed;
    overdue += acc.overdue;
  }
  return {
    periodLabel: `${MONTH_NAMES[now.getMonth() + 1]} ${now.getFullYear()}`,
    totalBeds: rooms.reduce((s, r) => s + r.bedCount, 0),
    occupiedBeds: tenancies.length,
    collected: received._sum.amount || 0,
    outstanding,
    overdue,
  };
}

/** A charge as the API returns it. */
export function chargeView(c) {
  return {
    id: c.id,
    type: c.type,
    description: c.description,
    amount: c.amount,
    dueDate: dbDay(c.dueDate),
    periodStart: dbDay(c.periodStart),
    automatic: c.createdById == null,
    cancelledAt: c.cancelledAt,
    cancelReason: c.cancelReason,
    ...c.state,
    waivers: (c.waivers || []).map((w) => ({
      id: w.id,
      amount: w.amount,
      reason: w.reason,
      createdAt: w.createdAt,
      reversedAt: w.reversedAt,
    })),
  };
}

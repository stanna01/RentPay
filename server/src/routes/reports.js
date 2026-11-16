import { Router } from 'express';
import { prisma } from '../db.js';
import { requireRole, ROLES } from '../auth.js';
import { ngweeToKwacha } from '../money.js';
import { propertyFilter, assertPropertyAccess } from '../access.js';
import { loadLedgers, unpaidMonthsFor, roomLabel, ACTIVE, VOID } from '../tenancyService.js';

const router = Router();

const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Which properties a report covers: ?propertyId=N (checked), or every property
 * the user can access. Returns a Prisma filter for a propertyId column.
 */
async function reportScope(req) {
  const raw = req.query.propertyId;
  if (raw && raw !== 'all') {
    const pid = Number(raw);
    await assertPropertyAccess(req, pid);
    return pid;
  }
  const f = await propertyFilter(req);
  return f.in ? f : undefined;
}

// Spreadsheet apps execute cells starting with = + - @ as formulas (CSV
// injection), and tenant names are user input — neutralise and quote them.
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
}
const k = (ngwee) => ngweeToKwacha(ngwee).toFixed(2);

/**
 * GET /api/reports/income?year=YYYY&propertyId=[&format=csv]
 * Income per month for a year, based on when payments were RECEIVED (datePaid).
 * Voided payments are excluded.
 */
router.get('/income', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const scope = await reportScope(req);
  const payments = await prisma.payment.findMany({
    where: {
      status: ACTIVE,
      datePaid: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
      tenancy: { room: { propertyId: scope } },
    },
    select: { amount: true, datePaid: true },
  });

  const totals = Array.from({ length: 12 }, () => 0);
  for (const p of payments) totals[new Date(p.datePaid).getMonth()] += p.amount;
  const rows = totals.map((ngwee, i) => ({
    month: i + 1,
    label: MONTH_NAMES[i + 1],
    ngwee,
    kwacha: ngweeToKwacha(ngwee),
  }));
  const totalNgwee = totals.reduce((a, b) => a + b, 0);

  if (req.query.format === 'csv') {
    return sendCsv(res, `income-${year}.csv`, [
      ['Month', 'Income (K)'],
      ...rows.map((r) => [`${r.label} ${year}`, k(r.ngwee)]),
      ['Total', k(totalNgwee)],
    ]);
  }
  res.json({ year, rows, totalNgwee, totalKwacha: ngweeToKwacha(totalNgwee) });
});

/**
 * GET /api/reports/arrears?propertyId=&includePast=1[&format=csv]
 * Every tenancy that owes money: the unpaid / part-paid months from move-in to
 * today (or move-out), after waivers and charges. Current tenants only unless
 * includePast=1.
 */
router.get('/arrears', async (req, res) => {
  const scope = await reportScope(req);
  const includePast = req.query.includePast === '1';
  const tenancies = await prisma.tenancy.findMany({
    where: {
      room: { propertyId: scope },
      ...(includePast ? {} : { moveOutDate: null }),
    },
    include: { tenant: true, room: { include: { property: true } } },
  });
  const ledgers = await loadLedgers(tenancies);

  const rows = [];
  for (const t of tenancies) {
    const months = unpaidMonthsFor(ledgers.get(t.id));
    if (!months.length) continue;
    rows.push({
      tenancyId: t.id,
      tenantName: t.tenant.name,
      tenantPhone: t.tenant.phone,
      property: { id: t.room.property.id, name: t.room.property.name, code: t.room.property.code },
      roomLabel: roomLabel(t.room.number, t.bed),
      isCurrent: !t.moveOutDate,
      months: months.map((m) => ({ month: m.month, year: m.year, expected: m.expected, applied: m.applied, balance: m.balance, status: m.status })),
      oldest: months[0],
      total: months.reduce((s, m) => s + m.balance, 0),
    });
  }
  rows.sort((a, b) => b.total - a.total);
  const totalNgwee = rows.reduce((s, r) => s + r.total, 0);

  if (req.query.format === 'csv') {
    return sendCsv(res, 'arrears.csv', [
      ['Property', 'Room', 'Tenant', 'Phone', 'Status', 'Months owed', 'Oldest month', 'Amount owed (K)'],
      ...rows.map((r) => [
        r.property.name,
        r.roomLabel,
        r.tenantName,
        r.tenantPhone,
        r.isCurrent ? 'Current' : 'Moved out',
        r.months.length,
        `${MONTH_NAMES[r.oldest.month]} ${r.oldest.year}`,
        k(r.total),
      ]),
      ['Total', '', '', '', '', '', '', k(totalNgwee)],
    ]);
  }
  res.json({ rows, totalNgwee, tenantCount: rows.length });
});

/**
 * GET /api/reports/voids?year=&propertyId= — admin: every voided payment with
 * who voided it, why, and its replacement (if it was corrected).
 */
router.get('/voids', requireRole(ROLES.ADMIN), async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const scope = await reportScope(req);
  const voided = await prisma.payment.findMany({
    where: {
      status: VOID,
      voidedAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
      tenancy: { room: { propertyId: scope } },
    },
    include: { receipt: { select: { id: true, receiptNumber: true } }, tenancy: { include: { tenant: true, room: true } } },
    orderBy: { voidedAt: 'desc' },
  });
  const ids = voided.map((p) => p.id);
  const userIds = [...new Set(voided.map((p) => p.voidedById).filter(Boolean))];
  const [replacements, users] = await Promise.all([
    prisma.payment.findMany({ where: { replacesPaymentId: { in: ids } }, select: { replacesPaymentId: true, amount: true, receipt: { select: { id: true, receiptNumber: true } } } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, name: true } }),
  ]);
  const replBy = new Map(replacements.map((r) => [r.replacesPaymentId, r]));
  const userBy = new Map(users.map((u) => [u.id, u]));
  res.json(
    voided.map((p) => ({
      paymentId: p.id,
      receipt: p.receipt,
      amount: p.amount,
      datePaid: p.datePaid,
      voidedAt: p.voidedAt,
      voidReason: p.voidReason,
      voidedBy: userBy.get(p.voidedById) || null,
      tenantName: p.tenancy.tenant.name,
      roomLabel: roomLabel(p.tenancy.room.number, p.tenancy.bed),
      replacement: replBy.get(p.id) || null,
    }))
  );
});

export default router;

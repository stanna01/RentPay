// Recording, voiding and correcting payments, and keeping their receipt PDFs.
//
// Receipts are financial records: a payment is never deleted or rewritten.
//   * VOID     — the payment stops counting toward balances and reports, its
//                receipt keeps its number and gets a copy stamped VOID.
//   * CORRECT  — in ONE transaction the original is voided and a replacement
//                payment with a NEW receipt number is issued (replacesPaymentId).

import { prisma } from './db.js';
import { nextReceiptNumber, ensureReceiptCounter } from './receiptNumber.js';
import { allocatePayment } from './status.js';
import { loadLedger, mkey, roomLabel, ACTIVE, VOID } from './tenancyService.js';
import { buildReceiptPdf, stampVoid } from './pdf.js';
import { httpError, badRequest } from './httpError.js';

export const METHODS = ['cash', 'mobile_money', 'bank'];

/**
 * Create a payment + periods + receipt (atomic, sequential number) and its PDF.
 *
 * @param {object} args
 * @param {object} args.tenancy   tenancy with { tenant, room: { property } }
 * @param {number} args.amount    ngwee (> 0)
 * @param {Date}   args.datePaid
 * @param {string} args.method
 * @param {Array<{month:number, year:number}>} args.months  fill order
 * @param {number} args.createdById
 * @param {{paymentId:number, reason:string, userId:number}} [args.replaces]
 *        when set, that payment is voided in the same transaction (a correction)
 */
export async function createPayment({ tenancy, amount, datePaid, method, months, createdById, replaces }) {
  if (!(amount > 0)) throw badRequest('Please enter a payment amount greater than zero.');
  if (!months?.length) throw badRequest('Please select at least one month to pay for.');
  if (datePaid > endOfToday()) throw badRequest('The payment date cannot be in the future.');

  const ledger = await loadLedger(tenancy, {
    excludePaymentIds: replaces ? [replaces.paymentId] : [],
  });

  // Each selected month can take up to what is still owed on it.
  const meta = months.map(({ month, year }) => {
    const key = mkey(year, month);
    const expected = ledger.expected(key);
    const already = ledger.paid(key);
    return { month, year, key, expected, already, base: ledger.baseExpected(key), room: Math.max(0, expected - already) };
  });
  const { periods: allocated } = allocatePayment(
    amount,
    meta.map((m) => ({ month: m.month, year: m.year, expectedRent: m.room }))
  );
  const periodRows = allocated.map((p, i) => ({
    month: p.month,
    year: p.year,
    amountApplied: p.amountApplied,
    expectedRent: meta[i].base, // snapshot of the rent (before adjustments)
  }));
  const totalBalance = meta.reduce(
    (sum, m, i) => sum + Math.max(0, m.expected - (m.already + periodRows[i].amountApplied)),
    0
  );

  const property = tenancy.room.property;
  const year = datePaid.getFullYear();
  await ensureReceiptCounter(prisma, property.id, year); // outside the txn: hot path is UPDATE-only

  const result = await prisma.$transaction(
    async (tx) => {
      if (replaces) {
        const voided = await tx.payment.updateMany({
          where: { id: replaces.paymentId, status: ACTIVE },
          data: { status: VOID, voidedAt: new Date(), voidedById: replaces.userId, voidReason: replaces.reason },
        });
        if (voided.count !== 1) throw httpError(409, 'That payment has already been voided or corrected.');
      }
      const { receiptNumber } = await nextReceiptNumber(tx, { propertyId: property.id, code: property.code, year });
      const payment = await tx.payment.create({
        data: {
          tenancyId: tenancy.id,
          amount,
          datePaid,
          method,
          createdById,
          replacesPaymentId: replaces?.paymentId ?? null,
          periods: { create: periodRows },
        },
      });
      const receipt = await tx.receipt.create({
        data: { paymentId: payment.id, receiptNumber, emailStatus: 'none' },
      });
      return { payment, receipt, receiptNumber };
    },
    { timeout: 20000, maxWait: 20000 }
  );

  // Build the PDF once and store it. If this fails the receipt still exists and
  // ensureReceiptPdf() will build it the first time it is needed.
  try {
    const bytes = await buildReceiptPdf({
      receiptNumber: result.receiptNumber,
      datePaid: result.payment.datePaid,
      propertyName: property.name,
      propertyAddress: property.address,
      tenantName: tenancy.tenant.name,
      roomLabel: roomLabel(tenancy.room.number, tenancy.bed),
      method,
      amount,
      periods: periodRows,
      totalBalance,
    });
    await prisma.receipt.update({ where: { id: result.receipt.id }, data: { pdf: Buffer.from(bytes) } });
  } catch (e) {
    console.error('[receipt] PDF build failed, will retry on demand:', e.message);
  }

  if (replaces) await stampVoidReceipt(replaces.paymentId, result.receiptNumber);

  return { ...result, periodRows, totalBalance };
}

/** Void an ACTIVE payment (admin). Throws 409 if it is already void. */
export async function voidPayment({ paymentId, reason, userId }) {
  const voided = await prisma.payment.updateMany({
    where: { id: paymentId, status: ACTIVE },
    data: { status: VOID, voidedAt: new Date(), voidedById: userId, voidReason: reason },
  });
  if (voided.count !== 1) throw httpError(409, 'That payment has already been voided.');
  await stampVoidReceipt(paymentId, null);
}

/** Store a VOID-stamped copy of a voided payment's receipt. Best effort. */
async function stampVoidReceipt(paymentId, replacedBy) {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { receipt: true } });
    if (!payment?.receipt) return;
    const original = await ensureReceiptPdf(payment.receipt.id);
    if (!original) return;
    const bytes = await stampVoid(original, {
      reason: payment.voidReason,
      voidedAt: payment.voidedAt,
      replacedBy,
    });
    await prisma.receipt.update({ where: { id: payment.receipt.id }, data: { voidPdf: Buffer.from(bytes) } });
  } catch (e) {
    console.error('[receipt] VOID stamp failed:', e.message);
  }
}

/**
 * Outstanding balance "as at" a payment for the months it covered: rent owed
 * (snapshot + adjustments) minus everything paid for those months by this
 * payment and the ACTIVE payments recorded before it.
 */
export async function balanceAsAt(payment) {
  if (!payment.periods.length) return 0;
  const months = payment.periods.map((p) => ({ month: p.month, year: p.year }));
  const [earlier, adjustments] = await Promise.all([
    prisma.paymentPeriod.findMany({
      where: {
        OR: months,
        payment: { tenancyId: payment.tenancyId, status: ACTIVE, id: { lt: payment.id } },
      },
      select: { month: true, year: true, amountApplied: true },
    }),
    prisma.arrearsAdjustment.findMany({
      where: { tenancyId: payment.tenancyId, reversedAt: null, OR: months },
      select: { month: true, year: true, amount: true },
    }),
  ]);
  const paid = new Map();
  for (const p of [...earlier, ...payment.periods]) {
    const k = mkey(p.year, p.month);
    paid.set(k, (paid.get(k) || 0) + p.amountApplied);
  }
  const adj = new Map();
  for (const a of adjustments) {
    const k = mkey(a.year, a.month);
    adj.set(k, (adj.get(k) || 0) + a.amount);
  }
  const seen = new Set();
  let total = 0;
  for (const p of payment.periods) {
    const k = mkey(p.year, p.month);
    if (seen.has(k)) continue;
    seen.add(k);
    total += Math.max(0, Math.max(0, p.expectedRent + (adj.get(k) || 0)) - (paid.get(k) || 0));
  }
  return total;
}

/**
 * Return the stored receipt PDF bytes, building and storing them first if an
 * earlier build failed. Never regenerates an existing PDF.
 */
export async function ensureReceiptPdf(receiptId) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      payment: {
        include: { periods: true, tenancy: { include: { tenant: true, room: { include: { property: true } } } } },
      },
    },
  });
  if (!receipt) return null;
  if (receipt.pdf) return Buffer.from(receipt.pdf);
  const p = receipt.payment;
  const bytes = await buildReceiptPdf({
    receiptNumber: receipt.receiptNumber,
    datePaid: p.datePaid,
    propertyName: p.tenancy.room.property.name,
    propertyAddress: p.tenancy.room.property.address,
    tenantName: p.tenancy.tenant.name,
    roomLabel: roomLabel(p.tenancy.room.number, p.tenancy.bed),
    method: p.method,
    amount: p.amount,
    periods: [...p.periods].sort((a, b) => a.year - b.year || a.month - b.month),
    totalBalance: await balanceAsAt(p),
  });
  const buf = Buffer.from(bytes);
  // Only fill an empty slot, so two concurrent requests can't overwrite each other.
  await prisma.receipt.updateMany({ where: { id: receiptId, pdf: null }, data: { pdf: buf } });
  const fresh = await prisma.receipt.findUnique({ where: { id: receiptId }, select: { pdf: true } });
  return Buffer.from(fresh.pdf);
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

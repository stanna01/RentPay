// Recording, voiding and correcting payments, and keeping their receipt PDFs.
//
// Receipts are financial records: a payment is never deleted or rewritten.
//   * A payment is applied to the tenant's open charges: the ones the landlord
//     picked first, then the oldest due. Anything left over is credit, used
//     automatically on the next charge.
//   * VOID     — the payment stops counting; its money comes off the charges
//                it paid. Its receipt keeps its number and gets a VOID copy.
//   * CORRECT  — in ONE transaction the original is voided and a replacement
//                payment with a NEW receipt number is issued (replacesPaymentId).
//   * What the receipt says (lines, balance, credit) is frozen when the payment
//     is recorded, so a reprint always matches the original.

import { prisma } from './db.js';
import { nextReceiptNumber, ensureReceiptCounter } from './receiptNumber.js';
import { ensureBilling, loadAccount, lockTenancy, allocate, applyCredit, ACTIVE, VOID } from './billingService.js';
import { roomLabel } from './tenancyService.js';
import { buildReceiptPdf, stampVoid } from './pdf.js';
import { httpError, badRequest } from './httpError.js';

export const METHODS = ['cash', 'mobile_money', 'bank'];

/**
 * Create a payment + allocations + receipt (atomic, sequential number) and its PDF.
 *
 * @param {object} args
 * @param {object} args.tenancy   tenancy with { tenant, room: { property } }
 * @param {number} args.amount    ngwee (> 0)
 * @param {Date}   args.datePaid
 * @param {string} args.method
 * @param {number[]} [args.chargeIds]  charges to pay first, in this order
 * @param {number} args.createdById
 * @param {{paymentId:number, reason:string, userId:number}} [args.replaces]
 *        when set, that payment is voided in the same transaction (a correction)
 */
export async function createPayment({ tenancy, amount, datePaid, method, chargeIds = [], createdById, replaces }) {
  if (!(amount > 0)) throw badRequest('Please enter a payment amount greater than zero.');
  if (datePaid > endOfToday()) throw badRequest('The payment date cannot be in the future.');

  const property = tenancy.room.property;
  await ensureBilling([property.id], { tenancyIds: [tenancy.id] });
  const year = datePaid.getFullYear();
  await ensureReceiptCounter(prisma, property.id, year); // outside the txn: hot path is UPDATE-only

  const result = await prisma.$transaction(
    async (tx) => {
      await lockTenancy(tx, tenancy.id);
      if (replaces) {
        const voided = await tx.payment.updateMany({
          where: { id: replaces.paymentId, status: ACTIVE },
          data: { status: VOID, voidedAt: new Date(), voidedById: replaces.userId, voidReason: replaces.reason },
        });
        if (voided.count !== 1) throw httpError(409, 'That payment has already been voided or corrected.');
      }

      // Read balances inside the lock (and after any void above).
      const account = await loadAccount(tenancy.id, tx);
      const open = account.charges.filter((c) => c.state.balance > 0);
      const byId = new Map(open.map((c) => [c.id, c]));
      for (const id of chargeIds) {
        if (!byId.has(id)) throw badRequest('One of the chosen charges is already paid or does not belong to this tenant.');
      }
      const order = [...chargeIds.map((id) => byId.get(id)), ...open.filter((c) => !chargeIds.includes(c.id))];
      const { lines, leftover } = allocate(amount, order.map((c) => ({ id: c.id, balance: c.state.balance })));

      const receiptLines = lines.map((l) => {
        const c = byId.get(l.chargeId);
        return {
          chargeId: c.id,
          description: c.description,
          chargeAmount: c.state.net,
          paid: l.amount,
          balanceAfter: c.state.balance - l.amount,
        };
      });
      const balanceAfter = account.owed - (amount - leftover);
      const creditAfter = account.credit + leftover;

      const { receiptNumber } = await nextReceiptNumber(tx, { propertyId: property.id, code: property.code, year });
      const payment = await tx.payment.create({
        data: {
          tenancyId: tenancy.id,
          amount,
          datePaid,
          method,
          createdById,
          replacesPaymentId: replaces?.paymentId ?? null,
          receiptLines,
          balanceAfter,
          creditAfter,
        },
      });
      if (lines.length) {
        await tx.allocation.createMany({ data: lines.map((l) => ({ paymentId: payment.id, chargeId: l.chargeId, amount: l.amount })) });
      }
      const receipt = await tx.receipt.create({
        data: { paymentId: payment.id, receiptNumber, emailStatus: 'none' },
      });
      return { payment, receipt, receiptNumber, receiptLines, balanceAfter, creditAfter };
    },
    { timeout: 20000, maxWait: 20000 }
  );

  // Build the PDF once and store it. If this fails the receipt still exists and
  // ensureReceiptPdf() will build it the first time it is needed.
  try {
    const bytes = await buildReceiptPdf(receiptPdfData(result.payment, result.receiptNumber, tenancy));
    await prisma.receipt.update({ where: { id: result.receipt.id }, data: { pdf: Buffer.from(bytes) } });
  } catch (e) {
    console.error('[receipt] PDF build failed, will retry on demand:', e.message);
  }

  if (replaces) await stampVoidReceipt(replaces.paymentId, result.receiptNumber);
  // A correction may have freed money from the original that other charges can use.
  if (replaces) await applyCredit(tenancy.id);

  return result;
}

/** Void an ACTIVE payment. Throws 409 if it is already void. */
export async function voidPayment({ paymentId, reason, userId }) {
  const voided = await prisma.payment.updateMany({
    where: { id: paymentId, status: ACTIVE },
    data: { status: VOID, voidedAt: new Date(), voidedById: userId, voidReason: reason },
  });
  if (voided.count !== 1) throw httpError(409, 'That payment has already been voided.');
  await stampVoidReceipt(paymentId, null);
  // The charges it paid are open again; credit from other payments may cover them.
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, select: { tenancyId: true } });
  await applyCredit(p.tenancyId);
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

/** What the receipt PDF shows, from the payment's frozen receipt text. */
function receiptPdfData(payment, receiptNumber, tenancy) {
  return {
    receiptNumber,
    datePaid: payment.datePaid,
    propertyName: tenancy.room.property.name,
    propertyAddress: tenancy.room.property.address,
    tenantName: tenancy.tenant.name,
    roomLabel: roomLabel(tenancy.room.number, tenancy.bed),
    method: payment.method,
    amount: payment.amount,
    lines: Array.isArray(payment.receiptLines) ? payment.receiptLines : [],
    creditAfter: payment.creditAfter,
    totalBalance: payment.balanceAfter,
  };
}

/**
 * Return the stored receipt PDF bytes, building and storing them first if an
 * earlier build failed. Never regenerates an existing PDF.
 */
export async function ensureReceiptPdf(receiptId) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { payment: { include: { tenancy: { include: { tenant: true, room: { include: { property: true } } } } } } },
  });
  if (!receipt) return null;
  if (receipt.pdf) return Buffer.from(receipt.pdf);
  const p = receipt.payment;
  const bytes = await buildReceiptPdf(receiptPdfData(p, receipt.receiptNumber, p.tenancy));
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

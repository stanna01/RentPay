import { Router } from 'express';
import { prisma } from '../db.js';
import { loadTenancy, loadPayment } from '../access.js';
import { createPayment, voidPayment, METHODS } from '../paymentService.js';
import { queueAndSend, isSmtpConfigured, notifyInBackground } from '../email.js';
import { formatKwacha } from '../money.js';
import { ACTIVE } from '../tenancyService.js';
import { dbDay, localDay } from '../dates.js';
import { audit } from '../audit.js';
import { parse, z, id, date, reason } from '../validate.js';
import { badRequest, httpError } from '../httpError.js';

const router = Router();

const paymentFields = {
  amount: z.coerce
    .number({ error: 'Please enter a payment amount.' })
    .int('Amount must be whole ngwee.')
    .positive('Please enter a payment amount greater than zero.')
    .max(1_000_000_000, 'That amount is too large.'),
  datePaid: date('Please enter a valid payment date.').optional(),
  method: z.enum(METHODS).optional().default('cash'),
  // Charges to pay first, in this order. The rest of the money goes to the
  // oldest due charges, and anything left over is kept as credit.
  chargeIds: z
    .array(id('Invalid charge.'))
    .max(100, 'Too many charges selected.')
    .refine((ids) => new Set(ids).size === ids.length, 'A charge was selected twice.')
    .optional()
    .default([]),
};

async function maybeEmail(receiptId, tenant, sendEmail) {
  if (!sendEmail || !tenant.email || !(await isSmtpConfigured())) return 'none';
  await queueAndSend(receiptId);
  const fresh = await prisma.receipt.findUnique({ where: { id: receiptId } });
  return fresh.emailStatus;
}

/**
 * POST /api/payments
 * Body: { tenancyId, amount (ngwee), datePaid, method, chargeIds?: [id], sendEmail }
 */
router.post('/', async (req, res) => {
  const body = parse(
    z.object({ tenancyId: id('Please choose a tenant.'), ...paymentFields, sendEmail: z.boolean().optional() }),
    req.body
  );
  const tenancy = await loadTenancy(req, body.tenancyId);
  const datePaid = body.datePaid || new Date();
  if (localDay(datePaid) < startOfMonth(tenancy.moveInDate)) {
    throw badRequest('The payment date is before this tenant moved in.');
  }

  const result = await createPayment({
    tenancy,
    amount: body.amount,
    datePaid,
    method: body.method,
    chargeIds: body.chargeIds,
    createdById: req.user.id,
  });
  await audit(req, 'payment.create', {
    type: 'payment',
    id: result.payment.id,
    after: { ...result.payment, receiptNumber: result.receiptNumber },
  });

  res.status(201).json({
    paymentId: result.payment.id,
    receiptId: result.receipt.id,
    receiptNumber: result.receiptNumber,
    amount: body.amount,
    totalBalance: result.balanceAfter,
    credit: result.creditAfter,
    lines: result.receiptLines,
    emailStatus: await maybeEmail(result.receipt.id, tenancy.tenant, body.sendEmail),
  });
});

/**
 * POST /api/payments/:id/void — cancel a payment. It stops counting
 * toward balances and reports; its receipt keeps its number and gets a VOID
 * copy. Body: { reason, notifyTenant? }
 */
router.post('/:id/void', async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  const body = parse(z.object({ reason: reason(), notifyTenant: z.boolean().optional() }), req.body);
  if (payment.status !== ACTIVE) throw httpError(409, 'That payment has already been voided.');

  await voidPayment({ paymentId: payment.id, reason: body.reason, userId: req.user.id });
  await audit(req, 'payment.void', {
    type: 'payment',
    id: payment.id,
    before: { status: payment.status, amount: payment.amount, receiptNumber: payment.receipt?.receiptNumber },
    after: { status: 'VOID', reason: body.reason },
  });

  const tenant = payment.tenancy.tenant;
  if (body.notifyTenant && payment.receipt) {
    notifyInBackground(
      tenant.email,
      `Receipt ${payment.receipt.receiptNumber} has been cancelled — ${payment.tenancy.room.property.name}`,
      `Dear ${tenant.name},\n\nReceipt ${payment.receipt.receiptNumber} for ${formatKwacha(payment.amount)} has been cancelled ` +
        `and is no longer valid.\nReason: ${body.reason}\n\nRegards,\n${payment.tenancy.room.property.name}`
    );
  }
  res.json({ ok: true, paymentId: payment.id, status: 'VOID' });
});

/**
 * POST /api/payments/:id/correct — "edit" a payment. In one transaction
 * the original is voided and a replacement with a NEW receipt number is issued.
 * Body: { amount, datePaid, method, chargeIds?, reason, sendEmail? }
 */
router.post('/:id/correct', async (req, res) => {
  const original = await loadPayment(req, req.params.id);
  const body = parse(
    z.object({ ...paymentFields, reason: reason(), sendEmail: z.boolean().optional() }),
    req.body
  );
  if (original.status !== ACTIVE) throw httpError(409, 'That payment has already been voided or corrected.');
  const tenancy = await loadTenancy(req, original.tenancyId);
  const datePaid = body.datePaid || original.datePaid;
  if (localDay(datePaid) < startOfMonth(tenancy.moveInDate)) {
    throw badRequest('The payment date is before this tenant moved in.');
  }

  const result = await createPayment({
    tenancy,
    amount: body.amount,
    datePaid,
    method: body.method,
    chargeIds: body.chargeIds,
    createdById: req.user.id,
    replaces: { paymentId: original.id, reason: body.reason, userId: req.user.id },
  });
  await audit(req, 'payment.correct', {
    type: 'payment',
    id: original.id,
    before: {
      amount: original.amount,
      datePaid: original.datePaid,
      method: original.method,
      lines: original.receiptLines,
      receiptNumber: original.receipt?.receiptNumber,
    },
    after: {
      replacementPaymentId: result.payment.id,
      amount: body.amount,
      datePaid,
      method: body.method,
      lines: result.receiptLines,
      receiptNumber: result.receiptNumber,
      reason: body.reason,
    },
  });

  res.status(201).json({
    paymentId: result.payment.id,
    receiptId: result.receipt.id,
    receiptNumber: result.receiptNumber,
    replacedPaymentId: original.id,
    totalBalance: result.balanceAfter,
    credit: result.creditAfter,
    emailStatus: await maybeEmail(result.receipt.id, tenancy.tenant, body.sendEmail),
  });
});

/** First day of the month of a stored date-only value, as "YYYY-MM-01". */
function startOfMonth(d) {
  return `${dbDay(d).slice(0, 8)}01`;
}

export default router;

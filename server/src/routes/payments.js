import { Router } from 'express';
import { prisma } from '../db.js';
import { loadTenancy, loadPayment } from '../access.js';
import { createPayment, voidPayment, METHODS } from '../paymentService.js';
import { queueAndSend, isSmtpConfigured, notifyInBackground } from '../email.js';
import { formatKwacha } from '../money.js';
import { ACTIVE } from '../tenancyService.js';
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
  months: z
    .array(
      z.object({
        month: z.coerce.number().int().min(1).max(12),
        year: z.coerce.number().int().min(2000).max(2100),
      }),
      { error: 'Please select at least one month to pay for.' }
    )
    .min(1, 'Please select at least one month to pay for.')
    .max(36, 'You can pay for at most 36 months at once.')
    .refine((ms) => new Set(ms.map((m) => `${m.year}-${m.month}`)).size === ms.length, 'A month was selected twice.'),
};

async function maybeEmail(receiptId, tenant, sendEmail) {
  if (!sendEmail || !tenant.email || !(await isSmtpConfigured())) return 'none';
  await queueAndSend(receiptId);
  const fresh = await prisma.receipt.findUnique({ where: { id: receiptId } });
  return fresh.emailStatus;
}

/**
 * POST /api/payments
 * Body: { tenancyId, amount (ngwee), datePaid, method, months: [{month, year}], sendEmail }
 */
router.post('/', async (req, res) => {
  const body = parse(
    z.object({ tenancyId: id('Please choose a tenant.'), ...paymentFields, sendEmail: z.boolean().optional() }),
    req.body
  );
  const tenancy = await loadTenancy(req, body.tenancyId);
  const datePaid = body.datePaid || new Date();
  if (datePaid < startOfMonth(tenancy.moveInDate)) {
    throw badRequest('The payment date is before this tenant moved in.');
  }

  const result = await createPayment({
    tenancy,
    amount: body.amount,
    datePaid,
    method: body.method,
    months: body.months,
    createdById: req.user.id,
  });
  await audit(req, 'payment.create', {
    type: 'payment',
    id: result.payment.id,
    after: { ...result.payment, receiptNumber: result.receiptNumber, periods: result.periodRows },
  });

  res.status(201).json({
    paymentId: result.payment.id,
    receiptId: result.receipt.id,
    receiptNumber: result.receiptNumber,
    amount: body.amount,
    totalBalance: result.totalBalance,
    emailStatus: await maybeEmail(result.receipt.id, tenancy.tenant, body.sendEmail),
    periods: result.periodRows,
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
 * Body: { amount, datePaid, method, months, reason, sendEmail? }
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
  if (datePaid < startOfMonth(tenancy.moveInDate)) {
    throw badRequest('The payment date is before this tenant moved in.');
  }

  const result = await createPayment({
    tenancy,
    amount: body.amount,
    datePaid,
    method: body.method,
    months: body.months,
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
      periods: original.periods,
      receiptNumber: original.receipt?.receiptNumber,
    },
    after: {
      replacementPaymentId: result.payment.id,
      amount: body.amount,
      datePaid,
      method: body.method,
      periods: result.periodRows,
      receiptNumber: result.receiptNumber,
      reason: body.reason,
    },
  });

  res.status(201).json({
    paymentId: result.payment.id,
    receiptId: result.receipt.id,
    receiptNumber: result.receiptNumber,
    replacedPaymentId: original.id,
    totalBalance: result.totalBalance,
    emailStatus: await maybeEmail(result.receipt.id, tenancy.tenant, body.sendEmail),
  });
});

function startOfMonth(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), 1);
}

export default router;

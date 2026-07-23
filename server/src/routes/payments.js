import { Router } from 'express';
import { prisma, ensureSettings } from '../db.js';
import { nextReceiptNumber, ensureReceiptCounter } from '../receiptNumber.js';
import { allocatePayment } from '../status.js';
import { appliedByMonth } from '../tenancyService.js';
import { buildReceiptPdf } from '../pdf.js';
import { queueAndSend, isSmtpConfigured } from '../email.js';

const router = Router();
const METHODS = new Set(['cash', 'mobile_money', 'bank']);

/**
 * POST /api/payments
 * Body: {
 *   tenancyId, amount (ngwee), datePaid, method,
 *   months: [{ month, year }],   // periods to cover (order = fill order)
 *   sendEmail: bool
 * }
 * Creates payment + periods + receipt (atomic number) + PDF in one transaction,
 * then attempts to email the receipt (queued for retry on failure).
 */
router.post('/', async (req, res) => {
  const { tenancyId, amount, datePaid, method, months, sendEmail } = req.body || {};

  const tenancy = await prisma.tenancy.findUnique({
    where: { id: Number(tenancyId) },
    include: { tenant: true, room: true },
  });
  if (!tenancy) return res.status(400).json({ error: 'Please choose a tenant.' });

  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Please enter a payment amount greater than zero.' });
  }
  if (!Array.isArray(months) || months.length === 0) {
    return res.status(400).json({ error: 'Please select at least one month to pay for.' });
  }
  const pmethod = METHODS.has(method) ? method : 'cash';

  // Resolve the expected rent + already-applied for each selected month.
  const { applied: appliedMap, expected: expectedMap } = await appliedByMonth(tenancy.id);
  const monthMeta = months.map((m) => {
    const month = Number(m.month);
    const year = Number(m.year);
    if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 3000)) {
      throw Object.assign(new Error('A selected month is invalid.'), { status: 400 });
    }
    const key = `${year}-${month}`;
    const fullExpected = expectedMap.has(key) ? expectedMap.get(key) : tenancy.monthlyRent;
    const alreadyApplied = appliedMap.get(key) || 0;
    const remainingRoom = Math.max(0, fullExpected - alreadyApplied);
    return { month, year, fullExpected, alreadyApplied, remainingRoom };
  });

  // Allocate this payment across the remaining room of each selected month.
  const { periods: allocated } = allocatePayment(
    amt,
    monthMeta.map((m) => ({ month: m.month, year: m.year, expectedRent: m.remainingRoom }))
  );

  // Build the period rows to store (full expected snapshot) + receipt view.
  const periodRows = allocated.map((p, i) => ({
    month: p.month,
    year: p.year,
    amountApplied: p.amountApplied,
    expectedRent: monthMeta[i].fullExpected,
  }));

  const totalBalance = monthMeta.reduce((sum, m, i) => {
    const bal = m.fullExpected - (m.alreadyApplied + periodRows[i].amountApplied);
    return sum + Math.max(0, bal);
  }, 0);

  const year = new Date().getFullYear();
  const settings = await ensureSettings();
  await ensureReceiptCounter(prisma, year); // outside the txn to keep the hot path UPDATE-only

  // --- Atomic: receipt number + payment + periods + receipt row --------------
  const result = await prisma.$transaction(
    async (tx) => {
      const { receiptNumber } = await nextReceiptNumber(tx, year);
      const payment = await tx.payment.create({
        data: {
          tenancyId: tenancy.id,
          amount: amt,
          datePaid: datePaid ? new Date(datePaid) : new Date(),
          method: pmethod,
          periods: { create: periodRows },
        },
      });
      const receipt = await tx.receipt.create({
        data: {
          paymentId: payment.id,
          receiptNumber,
          emailStatus: 'none',
        },
      });
      return { payment, receipt, receiptNumber };
    },
    { timeout: 20000, maxWait: 20000 }
  );

  // --- Build the PDF once and store its bytes in the DB ----------------------
  const pdfBytes = await buildReceiptPdf({
    receiptNumber: result.receiptNumber,
    datePaid: result.payment.datePaid,
    propertyName: settings.propertyName,
    propertyAddress: settings.propertyAddress,
    tenantName: tenancy.tenant.name,
    roomLabel: `${tenancy.roomNumber}${tenancy.bed}`,
    method: pmethod,
    amount: amt,
    periods: periodRows,
    totalBalance,
  });
  await prisma.receipt.update({
    where: { id: result.receipt.id },
    data: { pdf: Buffer.from(pdfBytes) },
  });

  // --- Email (queued + retried on failure) -----------------------------------
  let emailStatus = 'none';
  if (sendEmail && tenancy.tenant.email && (await isSmtpConfigured())) {
    await queueAndSend(result.receipt.id);
    const fresh = await prisma.receipt.findUnique({ where: { id: result.receipt.id } });
    emailStatus = fresh.emailStatus;
  }

  res.status(201).json({
    paymentId: result.payment.id,
    receiptId: result.receipt.id,
    receiptNumber: result.receiptNumber,
    amount: amt,
    totalBalance,
    emailStatus,
    periods: periodRows,
  });
});

export default router;

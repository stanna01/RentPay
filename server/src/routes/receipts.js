import { Router } from 'express';
import { prisma } from '../db.js';
import { queueAndSend, isSmtpConfigured } from '../email.js';
import { formatKwacha, amountInWords } from '../money.js';
import { loadReceipt } from '../access.js';
import { ensureReceiptPdf } from '../paymentService.js';
import { roomLabel, ACTIVE } from '../tenancyService.js';
import { audit } from '../audit.js';
import { badRequest, notFound } from '../httpError.js';

const router = Router();

/** The receipt number of the payment that replaced / was replaced by this one. */
async function linkedReceipts(payment) {
  const [replacement, replaced] = await Promise.all([
    prisma.payment.findFirst({ where: { replacesPaymentId: payment.id }, select: { receipt: { select: { id: true, receiptNumber: true } } } }),
    payment.replacesPaymentId
      ? prisma.payment.findUnique({ where: { id: payment.replacesPaymentId }, select: { receipt: { select: { id: true, receiptNumber: true } } } })
      : null,
  ]);
  return { replacedBy: replacement?.receipt || null, replaces: replaced?.receipt || null };
}

/** GET /api/receipts/:id — receipt metadata for the preview screen. */
router.get('/:id', async (req, res) => {
  const receipt = await loadReceipt(req, req.params.id);
  const p = receipt.payment;
  const property = p.tenancy.room.property;

  res.json({
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    paymentId: p.id,
    status: p.status,
    voidedAt: p.voidedAt,
    voidReason: p.voidReason,
    ...(await linkedReceipts(p)),
    datePaid: p.datePaid,
    method: p.method,
    amount: p.amount,
    amountWords: amountInWords(p.amount),
    amountFormatted: formatKwacha(p.amount),
    totalBalance: p.balanceAfter,
    credit: p.creditAfter,
    emailStatus: receipt.emailStatus,
    emailedAt: receipt.emailedAt,
    tenant: p.tenancy.tenant,
    tenancyId: p.tenancyId,
    roomNumber: p.tenancy.room.number,
    bed: p.tenancy.bed,
    roomLabel: roomLabel(p.tenancy.room.number, p.tenancy.bed),
    property: { id: property.id, name: property.name, address: property.address },
    lines: Array.isArray(p.receiptLines) ? p.receiptLines : [],
  });
});

/**
 * GET /api/receipts/:id/pdf — the STORED PDF (never regenerated once built).
 * A voided receipt is served as its VOID-stamped copy. ?download=1 forces a
 * download instead of inline view.
 */
router.get('/:id/pdf', async (req, res) => {
  const receipt = await loadReceipt(req, req.params.id);
  let bytes;
  if (receipt.payment.status !== ACTIVE && receipt.voidPdf) {
    bytes = Buffer.from(receipt.voidPdf);
  } else {
    bytes = await ensureReceiptPdf(receipt.id);
  }
  if (!bytes) throw notFound('Receipt PDF not found.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, no-store');
  const disp = req.query.download ? 'attachment' : 'inline';
  const suffix = receipt.payment.status !== ACTIVE ? '-VOID' : '';
  res.setHeader('Content-Disposition', `${disp}; filename="${receipt.receiptNumber}${suffix}.pdf"`);
  res.send(bytes);
});

/** POST /api/receipts/:id/resend — re-send the stored receipt by email. */
router.post('/:id/resend', async (req, res) => {
  const receipt = await loadReceipt(req, req.params.id);
  if (receipt.payment.status !== ACTIVE) {
    throw badRequest('This receipt has been voided and cannot be sent.');
  }
  if (!receipt.payment.tenancy.tenant.email) {
    throw badRequest('This tenant has no email address on file.');
  }
  if (!(await isSmtpConfigured())) {
    throw badRequest('Email is not set up on this platform yet.');
  }
  await queueAndSend(receipt.id);
  await audit(req, 'receipt.resend', { type: 'receipt', id: receipt.id });
  const fresh = await prisma.receipt.findUnique({ where: { id: receipt.id } });
  res.json({ emailStatus: fresh.emailStatus });
});

export default router;

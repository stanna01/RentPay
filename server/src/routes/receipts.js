import { Router } from 'express';
import { prisma, ensureSettings } from '../db.js';
import { queueAndSend, isSmtpConfigured } from '../email.js';
import { formatKwacha, amountInWords } from '../money.js';

const router = Router();

/** GET /api/receipts/:id — receipt metadata for the preview screen. */
router.get('/:id', async (req, res) => {
  const receipt = await prisma.receipt.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      payment: {
        include: { periods: true, tenancy: { include: { tenant: true, room: true } } },
      },
    },
  });
  if (!receipt) return res.status(404).json({ error: 'Receipt not found.' });
  const settings = await ensureSettings();

  const totalBalance = receipt.payment.periods.reduce(
    (s, p) => s + Math.max(0, p.expectedRent - p.amountApplied),
    0
  );

  res.json({
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    datePaid: receipt.payment.datePaid,
    method: receipt.payment.method,
    amount: receipt.payment.amount,
    amountWords: amountInWords(receipt.payment.amount),
    amountFormatted: formatKwacha(receipt.payment.amount),
    totalBalance,
    emailStatus: receipt.emailStatus,
    emailedAt: receipt.emailedAt,
    tenant: receipt.payment.tenancy.tenant,
    roomNumber: receipt.payment.tenancy.roomNumber,
    bed: receipt.payment.tenancy.bed,
    roomLabel: `${receipt.payment.tenancy.roomNumber}${receipt.payment.tenancy.bed}`,
    property: { name: settings.propertyName, address: settings.propertyAddress },
    periods: receipt.payment.periods.sort((a, b) => a.year - b.year || a.month - b.month),
  });
});

/**
 * GET /api/receipts/:id/pdf — stream the STORED PDF from the DB (never regenerated).
 * ?download=1 forces a download instead of inline view.
 */
router.get('/:id/pdf', async (req, res) => {
  const receipt = await prisma.receipt.findUnique({ where: { id: Number(req.params.id) } });
  if (!receipt || !receipt.pdf) return res.status(404).json({ error: 'Receipt PDF not found.' });
  res.setHeader('Content-Type', 'application/pdf');
  const disp = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename="${receipt.receiptNumber}.pdf"`);
  res.send(Buffer.from(receipt.pdf));
});

/** POST /api/receipts/:id/resend — re-send the stored receipt by email. */
router.post('/:id/resend', async (req, res) => {
  const id = Number(req.params.id);
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: { payment: { include: { tenancy: { include: { tenant: true } } } } },
  });
  if (!receipt) return res.status(404).json({ error: 'Receipt not found.' });
  if (!receipt.payment.tenancy.tenant.email) {
    return res.status(400).json({ error: 'This tenant has no email address on file.' });
  }
  if (!(await isSmtpConfigured())) {
    return res.status(400).json({
      error: 'Email is not set up yet. Add your email settings in Settings, then try again.',
    });
  }
  await queueAndSend(id);
  const fresh = await prisma.receipt.findUnique({ where: { id } });
  res.json({ emailStatus: fresh.emailStatus });
});

export default router;

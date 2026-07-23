// Email sending + retry queue using Nodemailer.
// SMTP config comes from the DB Setting row, falling back to environment vars.

import nodemailer from 'nodemailer';
import { prisma, ensureSettings } from './db.js';
import { formatKwacha } from './money.js';
import { decryptSecret } from './crypto.js';

const MAX_ATTEMPTS = 6;

/** Resolve effective SMTP config: DB settings override .env defaults. */
export async function resolveSmtp() {
  const s = await ensureSettings();
  const host = s.smtpHost || process.env.SMTP_HOST || '';
  const port = s.smtpPort || Number(process.env.SMTP_PORT || 465);
  const secure = s.smtpHost ? s.smtpSecure : String(process.env.SMTP_SECURE) !== 'false';
  const user = s.smtpUser || process.env.SMTP_USER || '';
  // DB password is stored encrypted at rest; decrypt for use. .env is plaintext.
  const pass = decryptSecret(s.smtpPass) || process.env.SMTP_PASS || '';
  const fromName = s.smtpFromName || process.env.SMTP_FROM_NAME || 'RentReceipt';
  const fromEmail =
    s.smtpFromEmail || process.env.SMTP_FROM_EMAIL || user || s.landlordEmail || '';
  return { host, port, secure, user, pass, fromName, fromEmail };
}

function buildTransport(cfg) {
  if (!cfg.host) {
    throw new Error('Email is not configured yet. Add SMTP settings on the Settings screen.');
  }
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: !!cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    // Fail fast with a clear error instead of hanging for minutes on a stalled
    // connection (e.g. a blocked port or flaky network).
    connectionTimeout: 15000, // 15s to establish the TCP connection
    greetingTimeout: 10000, // 10s to receive the SMTP greeting
    socketTimeout: 20000, // 20s of inactivity on the socket
  });
}

/** True when enough SMTP config exists to attempt sending. */
export async function isSmtpConfigured() {
  const cfg = await resolveSmtp();
  return !!cfg.host;
}

/** Send a password-reset link to the landlord's login email. */
export async function sendPasswordResetEmail(to, link) {
  const cfg = await resolveSmtp();
  const transport = buildTransport(cfg);
  await transport.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to,
    subject: 'Reset your RentReceipt password',
    text:
      'A password reset was requested for your RentReceipt landlord account.\n\n' +
      `Open this link within 1 hour to set a new password:\n${link}\n\n` +
      "If you didn't request this, you can ignore this email — your password will not change.",
  });
}

/** Verify SMTP connectivity (used by the Settings "test" button). */
export async function verifySmtp() {
  const cfg = await resolveSmtp();
  const transport = buildTransport(cfg);
  await transport.verify();
  return { ok: true, from: cfg.fromEmail };
}

/** Send a test email to a given address. */
export async function sendTestEmail(to) {
  const cfg = await resolveSmtp();
  const transport = buildTransport(cfg);
  await transport.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to,
    subject: 'RentReceipt test email',
    text: 'This is a test email from RentReceipt. Your email settings are working correctly.',
  });
  return { ok: true };
}

/**
 * Send a receipt email with the stored PDF attached. Throws on failure so the
 * caller can enqueue for retry.
 */
export async function sendReceiptEmail(receiptId) {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      payment: { include: { tenancy: { include: { tenant: true, room: true } } } },
    },
  });
  if (!receipt) throw new Error('Receipt not found');

  const tenant = receipt.payment.tenancy.tenant;
  if (!tenant.email) throw new Error('This tenant has no email address on file.');

  const cfg = await resolveSmtp();
  const transport = buildTransport(cfg);
  const settings = await ensureSettings();

  if (!receipt.pdf) throw new Error('Receipt PDF is missing.');
  const amount = formatKwacha(receipt.payment.amount);

  await transport.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to: tenant.email,
    subject: `Rent receipt ${receipt.receiptNumber} — ${settings.propertyName}`,
    text:
      `Dear ${tenant.name},\n\n` +
      `Thank you for your rent payment of ${amount} for room ${receipt.payment.tenancy.room.number}.\n` +
      `Your receipt (${receipt.receiptNumber}) is attached.\n\n` +
      `Regards,\n${settings.propertyName}`,
    attachments: [
      {
        filename: `${receipt.receiptNumber}.pdf`,
        content: Buffer.from(receipt.pdf),
        contentType: 'application/pdf',
      },
    ],
  });

  await prisma.receipt.update({
    where: { id: receiptId },
    data: { emailStatus: 'sent', emailedAt: new Date() },
  });
}

/** Mark a receipt for sending and try immediately; queue on failure. */
export async function queueAndSend(receiptId) {
  await prisma.receipt.update({ where: { id: receiptId }, data: { emailStatus: 'pending' } });
  await prisma.emailQueue.create({ data: { receiptId, status: 'pending' } });
  await processQueueItem(receiptId).catch(() => {});
}

async function processQueueItem(receiptId) {
  const item = await prisma.emailQueue.findFirst({
    where: { receiptId, status: 'pending' },
    orderBy: { id: 'desc' },
  });
  if (!item) return;
  try {
    await sendReceiptEmail(receiptId);
    await prisma.emailQueue.update({
      where: { id: item.id },
      data: { status: 'sent', sentAt: new Date() },
    });
  } catch (err) {
    const attempts = item.attempts + 1;
    const failedForGood = attempts >= MAX_ATTEMPTS;
    const backoffMs = Math.min(60 * 60 * 1000, 1000 * 2 ** attempts); // cap 1h
    await prisma.emailQueue.update({
      where: { id: item.id },
      data: {
        attempts,
        lastError: String(err.message || err).slice(0, 500),
        status: failedForGood ? 'failed' : 'pending',
        nextRetryAt: new Date(Date.now() + backoffMs),
      },
    });
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { emailStatus: failedForGood ? 'failed' : 'pending' },
    });
  }
}

/** Background worker: retry any due, pending queue items. */
export async function runEmailWorkerOnce() {
  const due = await prisma.emailQueue.findMany({
    where: { status: 'pending', nextRetryAt: { lte: new Date() } },
    orderBy: { nextRetryAt: 'asc' },
    take: 10,
  });
  for (const item of due) {
    await processQueueItem(item.receiptId);
  }
}

export function startEmailWorker(intervalMs = 60_000) {
  const timer = setInterval(() => {
    runEmailWorkerOnce().catch((e) => console.error('[email worker]', e.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

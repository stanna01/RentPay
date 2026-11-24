// Email sending + retry queue using Nodemailer.
// SMTP config comes from the DB Setting row, falling back to environment vars.

import nodemailer from 'nodemailer';
import { prisma, ensureSettings } from './db.js';
import { formatKwacha } from './money.js';
import { decryptSecret } from './crypto.js';
import { ensureReceiptPdf } from './paymentService.js';

const MAX_ATTEMPTS = 6;

// An error that retrying will not fix (voided payment, no email on file).
const permanent = (msg) => Object.assign(new Error(msg), { permanent: true });

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
      'A password reset was requested for your RentReceipt account.\n\n' +
      `Open this link within 30 minutes to set a new password:\n${link}\n\n` +
      "If you didn't request this, you can ignore this email — your password will not change.",
  });
}

/** Send a plain-text notice (security alerts, void notices). Throws on failure. */
export async function sendNoticeEmail(to, subject, text) {
  const cfg = await resolveSmtp();
  const transport = buildTransport(cfg);
  await transport.sendMail({ from: `"${cfg.fromName}" <${cfg.fromEmail}>`, to, subject, text });
}

/**
 * Fire-and-forget notice: never blocks or fails the request, does nothing
 * when email is not configured.
 */
export function notifyInBackground(to, subject, text) {
  if (!to) return;
  setImmediate(async () => {
    try {
      if (await isSmtpConfigured()) await sendNoticeEmail(to, subject, text);
    } catch (e) {
      console.error('[email] notice failed:', e.message);
    }
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
      payment: { include: { tenancy: { include: { tenant: true, room: { include: { property: true } } } } } },
    },
  });
  if (!receipt) throw permanent('Receipt not found');
  // A voided receipt must never reach the tenant as if it were valid.
  if (receipt.payment.status !== 'ACTIVE') throw permanent('This payment has been voided.');

  const tenant = receipt.payment.tenancy.tenant;
  if (!tenant.email) throw permanent('This tenant has no email address on file.');

  const cfg = await resolveSmtp();
  const transport = buildTransport(cfg);
  const property = receipt.payment.tenancy.room.property;

  const pdf = await ensureReceiptPdf(receiptId);
  if (!pdf) throw new Error('Receipt PDF is missing.');
  const amount = formatKwacha(receipt.payment.amount);

  await transport.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to: tenant.email,
    subject: `Rent receipt ${receipt.receiptNumber} — ${property.name}`,
    text:
      `Dear ${tenant.name},\n\n` +
      `Thank you for your rent payment of ${amount} for room ${receipt.payment.tenancy.room.number}${receipt.payment.tenancy.bed}.\n` +
      `Your receipt (${receipt.receiptNumber}) is attached.\n\n` +
      `Regards,\n${property.name}`,
    attachments: [
      {
        filename: `${receipt.receiptNumber}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      },
    ],
  });

  await prisma.receipt.update({
    where: { id: receiptId },
    data: { emailStatus: 'sent', emailedAt: new Date() },
  });
}

/** Send one notice email (a NoticeRecipient row) and mark it sent. */
async function sendNoticeRecipientEmail(recipientId) {
  const r = await prisma.noticeRecipient.findUnique({
    where: { id: recipientId },
    include: { notice: { include: { property: true } } },
  });
  if (!r) throw permanent('Notice not found');
  if (!r.email) throw permanent('This tenant has no email address on file.');
  const cfg = await resolveSmtp();
  const transport = buildTransport(cfg);
  await transport.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to: r.email,
    subject: r.notice.subject,
    text: r.message,
  });
  await prisma.noticeRecipient.update({
    where: { id: recipientId },
    data: { status: 'sent', sentAt: new Date(), lastError: '' },
  });
}

/** Mark a receipt for sending and try immediately; queue on failure. */
export async function queueAndSend(receiptId) {
  await prisma.receipt.update({ where: { id: receiptId }, data: { emailStatus: 'pending' } });
  const item = await prisma.emailQueue.create({ data: { receiptId, status: 'pending' } });
  await processQueueItem(item.id).catch(() => {});
}

/**
 * Queue notice emails for these recipients and start sending them in the
 * background (a notice can go to many tenants, so the request doesn't wait).
 */
export async function queueNoticeEmails(recipientIds) {
  if (!recipientIds.length) return;
  await prisma.emailQueue.createMany({ data: recipientIds.map((id) => ({ noticeRecipientId: id, status: 'pending' })) });
  setImmediate(() => runEmailWorkerOnce(50).catch((e) => console.error('[email worker]', e.message)));
}

async function processQueueItem(itemId) {
  const item = await prisma.emailQueue.findUnique({ where: { id: itemId } });
  if (!item || item.status !== 'pending') return;
  try {
    if (item.receiptId) await sendReceiptEmail(item.receiptId);
    else if (item.noticeRecipientId) await sendNoticeRecipientEmail(item.noticeRecipientId);
    await prisma.emailQueue.update({
      where: { id: item.id },
      data: { status: 'sent', sentAt: new Date() },
    });
  } catch (err) {
    const attempts = item.attempts + 1;
    const failedForGood = attempts >= MAX_ATTEMPTS || !!err.permanent;
    const backoffMs = Math.min(60 * 60 * 1000, 1000 * 2 ** attempts); // cap 1h
    const lastError = String(err.message || err).slice(0, 190);
    await prisma.emailQueue.update({
      where: { id: item.id },
      data: {
        attempts,
        lastError,
        status: failedForGood ? 'failed' : 'pending',
        nextRetryAt: new Date(Date.now() + backoffMs),
      },
    });
    if (item.receiptId) {
      await prisma.receipt.update({
        where: { id: item.receiptId },
        data: { emailStatus: failedForGood ? 'failed' : 'pending' },
      });
    } else if (item.noticeRecipientId) {
      await prisma.noticeRecipient.update({
        where: { id: item.noticeRecipientId },
        data: { status: failedForGood ? 'failed' : 'pending', lastError },
      });
    }
  }
}

/** Background worker: retry any due, pending queue items. */
export async function runEmailWorkerOnce(limit = 10) {
  const due = await prisma.emailQueue.findMany({
    where: { status: 'pending', nextRetryAt: { lte: new Date() } },
    orderBy: { nextRetryAt: 'asc' },
    take: limit,
  });
  for (const item of due) {
    await processQueueItem(item.id);
  }
}

export function startEmailWorker(intervalMs = 60_000) {
  const timer = setInterval(() => {
    runEmailWorkerOnce().catch((e) => console.error('[email worker]', e.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

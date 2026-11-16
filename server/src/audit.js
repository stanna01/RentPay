// Append-only audit trail. Every change to money, people, properties or
// accounts goes through audit(); there is no API to edit or delete entries.

import { prisma } from './db.js';

// Never store secrets or file bytes in the log.
const REDACT = new Set(['passwordHash', 'smtpPass', 'pdf', 'voidPdf', 'password', 'newPassword', 'currentPassword']);

function clean(value) {
  if (value == null) return null;
  return JSON.parse(
    JSON.stringify(value, (k, v) => {
      if (REDACT.has(k)) return v ? '[redacted]' : v;
      if (typeof v === 'bigint') return Number(v);
      return v;
    })
  );
}

/**
 * Record an action. Failures are logged but never break the user's request.
 * @param {import('express').Request|null} req
 * @param {string} action   e.g. "payment.void", "user.create", "login.failed"
 * @param {{type?: string, id?: any, before?: any, after?: any, userId?: number|null}} details
 */
export async function audit(req, action, { type = '', id = '', before = null, after = null, userId } = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId !== undefined ? userId : req?.user?.id ?? null,
        action,
        entityType: type,
        entityId: id == null ? '' : String(id),
        before: clean(before) ?? undefined,
        after: clean(after) ?? undefined,
        ip: String(req?.ip || '').slice(0, 191),
        userAgent: String(req?.get?.('user-agent') || '').slice(0, 255),
      },
    });
  } catch (e) {
    console.error('[audit] failed to record', action, e.message);
  }
}

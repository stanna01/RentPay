// Per-account login lockout (OWASP / NIST guidance).
//
//   * 5 wrong passwords → the email is locked for 15 minutes.
//   * Each further lockout doubles the lock (30m, 1h, …) up to 24 hours.
//   * A successful login or password reset clears everything.
//   * After 24h with no failures the escalation level decays back to zero.
//
// Tracked by normalised email, INCLUDING emails that have no account, so an
// attacker cannot tell real accounts apart by how lockout behaves.

import { prisma } from './db.js';

export const MAX_FAILURES = 5;
export const BASE_LOCK_MS = 15 * 60 * 1000;
export const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
export const DECAY_MS = 24 * 60 * 60 * 1000;

export function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase().slice(0, 191);
}

/** Milliseconds the account is still locked for (0 when not locked). */
export function lockRemainingMs(state, now = new Date()) {
  if (!state?.lockedUntil) return 0;
  return Math.max(0, new Date(state.lockedUntil).getTime() - now.getTime());
}

/** Lock length for a given escalation level: 15m × 2^level, capped at 24h. */
export function lockDurationMs(level) {
  return Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** Math.max(0, level));
}

/**
 * Pure state transition for one failed attempt.
 * @returns {{failedCount, lockoutLevel, lockedUntil, lastFailedAt, lockedNow}}
 */
export function nextStateAfterFailure(state, now = new Date()) {
  let failedCount = state?.failedCount || 0;
  let lockoutLevel = state?.lockoutLevel || 0;
  const last = state?.lastFailedAt ? new Date(state.lastFailedAt).getTime() : 0;
  if (last && now.getTime() - last > DECAY_MS) {
    failedCount = 0;
    lockoutLevel = 0;
  }
  failedCount += 1;
  let lockedUntil = state?.lockedUntil ? new Date(state.lockedUntil) : null;
  let lockedNow = false;
  if (failedCount >= MAX_FAILURES) {
    lockedUntil = new Date(now.getTime() + lockDurationMs(lockoutLevel));
    lockoutLevel += 1;
    failedCount = 0;
    lockedNow = true;
  }
  return { failedCount, lockoutLevel, lockedUntil, lastFailedAt: now, lockedNow };
}

/** Friendly "try again in N minutes" text. */
export function lockMessage(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const when = mins >= 120 ? `${Math.ceil(mins / 60)} hours` : `${mins} minute${mins === 1 ? '' : 's'}`;
  return `Too many failed sign-in attempts. Try again in ${when}, or reset your password.`;
}

export async function getLockRemainingMs(email) {
  const state = await prisma.loginThrottle.findUnique({ where: { email: normaliseEmail(email) } });
  return lockRemainingMs(state);
}

/**
 * Record a failed attempt atomically (row lock, so parallel guesses can't slip
 * past the counter). Returns { lockedNow, remainingMs }.
 */
export async function recordFailure(email) {
  const key = normaliseEmail(email);
  await prisma.$executeRawUnsafe('INSERT IGNORE INTO `LoginThrottle` (`email`) VALUES (?)', key);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe(
      'SELECT `failedCount`, `lockoutLevel`, `lockedUntil`, `lastFailedAt` FROM `LoginThrottle` WHERE `email` = ? FOR UPDATE',
      key
    );
    const now = new Date();
    const next = nextStateAfterFailure(rows[0], now);
    await tx.loginThrottle.update({
      where: { email: key },
      data: {
        failedCount: next.failedCount,
        lockoutLevel: next.lockoutLevel,
        lockedUntil: next.lockedUntil,
        lastFailedAt: next.lastFailedAt,
      },
    });
    return { lockedNow: next.lockedNow, remainingMs: lockRemainingMs(next, now) };
  });
}

export async function clearThrottle(email) {
  await prisma.loginThrottle.deleteMany({ where: { email: normaliseEmail(email) } });
}

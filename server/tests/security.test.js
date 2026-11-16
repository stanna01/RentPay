import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextStateAfterFailure,
  lockRemainingMs,
  lockDurationMs,
  lockMessage,
  normaliseEmail,
  MAX_FAILURES,
  BASE_LOCK_MS,
  MAX_LOCK_MS,
  DECAY_MS,
} from '../src/loginThrottle.js';
import { passwordProblem } from '../src/passwordPolicy.js';

const MIN = 60 * 1000;

function failTimes(n, state = null, start = new Date('2026-11-01T08:00:00Z'), gapMs = 1000) {
  let s = state;
  let now = start;
  let last;
  for (let i = 0; i < n; i++) {
    last = nextStateAfterFailure(s, now);
    s = last;
    now = new Date(now.getTime() + gapMs);
  }
  return { state: s, last, now };
}

// --- Login lockout ------------------------------------------------------------

test('lockout: 4 failures do not lock, the 5th locks for 15 minutes', () => {
  const four = failTimes(MAX_FAILURES - 1);
  assert.equal(four.state.failedCount, 4);
  assert.equal(four.state.lockedUntil, null);
  assert.equal(lockRemainingMs(four.state, four.now), 0);

  const now = four.now;
  const fifth = nextStateAfterFailure(four.state, now);
  assert.equal(fifth.lockedNow, true);
  assert.equal(lockRemainingMs(fifth, now), 15 * MIN);
  assert.equal(fifth.failedCount, 0, 'counter restarts after a lock');
  assert.equal(fifth.lockoutLevel, 1);
});

test('lockout: repeated lockouts double (15m → 30m → 60m) and cap at 24h', () => {
  assert.equal(lockDurationMs(0), 15 * MIN);
  assert.equal(lockDurationMs(1), 30 * MIN);
  assert.equal(lockDurationMs(2), 60 * MIN);
  assert.equal(lockDurationMs(20), MAX_LOCK_MS);

  const first = failTimes(5);
  const second = failTimes(5, first.state, first.now);
  assert.equal(second.state.lockoutLevel, 2);
  assert.equal(lockRemainingMs(second.state, second.last.lastFailedAt), 30 * MIN);
});

test('lockout: escalation decays after 24h without failures', () => {
  const first = failTimes(5);
  assert.equal(first.state.lockoutLevel, 1);
  const muchLater = new Date(first.now.getTime() + DECAY_MS + MIN);
  const next = nextStateAfterFailure(first.state, muchLater);
  assert.equal(next.lockoutLevel, 0);
  assert.equal(next.failedCount, 1);
});

test('lockout: lock expires on its own', () => {
  const { last } = failTimes(5);
  const after = new Date(last.lastFailedAt.getTime() + BASE_LOCK_MS + 1);
  assert.equal(lockRemainingMs(last, after), 0);
});

test('lockout: message shows minutes and hours sensibly', () => {
  assert.match(lockMessage(15 * MIN), /15 minutes/);
  assert.match(lockMessage(30 * 1000), /1 minute\b/);
  assert.match(lockMessage(5 * 60 * MIN), /5 hours/);
});

test('lockout: emails are normalised so case/space tricks share one counter', () => {
  assert.equal(normaliseEmail('  Admin@Example.COM '), 'admin@example.com');
});

// --- Password policy -----------------------------------------------------------

test('password: landlord needs 8+, super admin needs 12+', () => {
  assert.match(passwordProblem('short1', { role: 'LANDLORD' }), /at least 8/);
  assert.equal(passwordProblem('tenant-house-42', { role: 'LANDLORD' }), null);
  assert.equal(passwordProblem('house-key-42', { role: 'SUPER_ADMIN' }), null); // exactly 12
  assert.match(passwordProblem('house-key-4', { role: 'SUPER_ADMIN' }), /at least 12/);
  assert.equal(passwordProblem('blue-house-key-42', { role: 'SUPER_ADMIN' }), null);
});

test('password: common passwords are rejected regardless of case', () => {
  assert.match(passwordProblem('Password123', { role: 'LANDLORD' }), /too common/);
  assert.match(passwordProblem('changeme123', { role: 'LANDLORD' }), /too common/);
  assert.match(passwordProblem('qwertyuiop', { role: 'LANDLORD' }), /too common/);
});

test('password: must not be the email or its local part', () => {
  assert.match(passwordProblem('mary.banda@gmail.com', { email: 'mary.banda@gmail.com' }), /email/);
  assert.match(passwordProblem('marybanda1', { email: 'marybanda1@gmail.com' }), /email/);
});

test('password: rejects repeated characters and over-long (bcrypt 72-byte) input', () => {
  assert.match(passwordProblem('aaaaaaaaaaaa'), /repeated/);
  assert.match(passwordProblem('x'.repeat(73)), /too long/);
  // Multi-byte characters count by bytes, not characters.
  assert.match(passwordProblem('é'.repeat(37)), /too long/);
});

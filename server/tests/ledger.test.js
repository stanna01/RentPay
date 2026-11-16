import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLedger, mkey, bedLabels, monthsBetween, unpaidMonthsFor } from '../src/tenancyService.js';
import { STATUS } from '../src/status.js';

const tenancy = (over = {}) => ({
  id: 1,
  monthlyRent: 150000,
  moveInDate: new Date(2026, 0, 10),
  moveOutDate: null,
  ...over,
});

test('ledger: unpaid month is DUE at the current rent', () => {
  const l = makeLedger(tenancy());
  const st = l.status(2026, 1);
  assert.equal(st.status, STATUS.DUE);
  assert.equal(st.balance, 150000);
});

test('ledger: snapshot rent is used once a payment exists for the month', () => {
  const l = makeLedger(tenancy({ monthlyRent: 200000 })); // rent raised later
  l.applied.set(mkey(2026, 1), 100000);
  l.snapshot.set(mkey(2026, 1), 150000); // rent at payment time
  const st = l.status(2026, 1);
  assert.equal(st.status, STATUS.PARTIAL);
  assert.equal(st.balance, 50000);
});

test('ledger: a waiver reduces what is owed; a charge increases it', () => {
  const l = makeLedger(tenancy());
  l.adjust.set(mkey(2026, 2), -150000); // full waiver
  assert.equal(l.status(2026, 2).status, STATUS.PAID);
  assert.equal(l.status(2026, 2).balance, 0);

  l.adjust.set(mkey(2026, 3), 20000); // K200 damage charge
  assert.equal(l.expected(mkey(2026, 3)), 170000);
  l.applied.set(mkey(2026, 3), 150000);
  assert.equal(l.status(2026, 3).balance, 20000);
});

test('ledger: a waiver larger than the rent never makes the month negative', () => {
  const l = makeLedger(tenancy());
  l.adjust.set(mkey(2026, 4), -999999);
  assert.equal(l.expected(mkey(2026, 4)), 0);
});

test('unpaidMonthsFor lists DUE/PARTIAL months from move-in to move-out', () => {
  const l = makeLedger(tenancy({ moveOutDate: new Date(2026, 3, 15) })); // Jan..Apr
  l.applied.set(mkey(2026, 1), 150000); // Jan paid
  l.applied.set(mkey(2026, 2), 50000); // Feb partial
  l.adjust.set(mkey(2026, 3), -150000); // Mar waived
  const unpaid = unpaidMonthsFor(l).map((m) => `${m.year}-${m.month}:${m.status}`);
  assert.deepEqual(unpaid, ['2026-2:PARTIAL', '2026-4:DUE']);
});

test('bedLabels and monthsBetween', () => {
  assert.deepEqual(bedLabels(2), ['A', 'B']);
  assert.deepEqual(bedLabels(4), ['A', 'B', 'C', 'D']);
  assert.deepEqual(bedLabels(0), ['A']);
  const ms = [...monthsBetween(new Date(2025, 10, 20), new Date(2026, 1, 1))].map((m) => `${m.year}-${m.month}`);
  assert.deepEqual(ms, ['2025-11', '2025-12', '2026-1', '2026-2']);
});

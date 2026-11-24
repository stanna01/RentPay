// Unit tests for the billing rules (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rentPeriods, rentOn, chargeState, allocate, accountStatus, CHARGE_STATUS } from '../src/billingService.js';
import { buildStatement, bedLabels } from '../src/tenancyService.js';
import { toDbDate, addDays, isDay, monthsBetweenDays, formatDay } from '../src/dates.js';

const monthly = { billingCycle: 'MONTHLY', dueDay: 5 };
const termly = { billingCycle: 'TERM', dueDay: 5 };
const tenancy = (over = {}) => ({ id: 1, rent: 150000, moveInDate: toDbDate('2026-01-10'), moveOutDate: null, ...over });
const term = (id, name, start, end, due) => ({ id, name, startDate: toDbDate(start), endDate: toDbDate(end), dueDate: toDbDate(due) });

test('monthly: one rent period per month from move-in to today, due on the due day', () => {
  const p = rentPeriods(monthly, [], tenancy(), '2026-03-02');
  assert.deepEqual(p.map((x) => x.periodKey), ['M-2026-01', 'M-2026-02', 'M-2026-03']);
  assert.equal(p[0].dueDate, '2026-01-10', 'moving in after the due day: due on the move-in day');
  assert.equal(p[1].dueDate, '2026-02-05');
  assert.equal(p[1].description, 'Rent – February 2026');
});

test('monthly: due day is capped at the end of short months; nothing after move-out', () => {
  const p = rentPeriods({ billingCycle: 'MONTHLY', dueDay: 28 }, [], tenancy({ moveOutDate: toDbDate('2026-02-14') }), '2026-06-01');
  assert.deepEqual(p.map((x) => x.periodKey), ['M-2026-01', 'M-2026-02']);
  assert.equal(p[1].dueDate, '2026-02-28');
});

test('terms: billed once a term has started, only terms that overlap the stay', () => {
  const terms = [
    term(1, 'Semester 2 2025', '2025-07-20', '2025-12-18', '2025-07-31'),
    term(2, 'Semester 1 2026', '2026-01-12', '2026-06-26', '2026-01-31'),
    term(3, 'Semester 2 2026', '2026-07-27', '2026-12-18', '2026-08-14'),
  ];
  const t = tenancy({ moveInDate: toDbDate('2026-02-03') });
  const p = rentPeriods(termly, terms, t, '2026-07-01');
  assert.deepEqual(p.map((x) => x.periodKey), ['T-2'], 'semester 2 2026 has not started; 2025 is before the stay');
  assert.equal(p[0].dueDate, '2026-02-03', 'moved in after the due date: due on the move-in day');
  assert.equal(p[0].description, 'Semester 1 2026 rent');
  assert.equal(rentPeriods(termly, terms, t, '2026-07-27').length, 2);
  const left = tenancy({ moveInDate: toDbDate('2026-02-03'), moveOutDate: toDbDate('2026-07-10') });
  assert.equal(rentPeriods(termly, terms, left, '2026-09-01').length, 1, 'no term that starts after move-out');
});

test('rentOn: changes apply from their start date, earlier periods keep the old rent', () => {
  const changes = [
    { id: 1, oldRent: 150000, newRent: 180000, startsOn: toDbDate('2026-03-01'), cancelledAt: null },
    { id: 2, oldRent: 180000, newRent: 170000, startsOn: toDbDate('2026-06-01'), cancelledAt: null },
    { id: 3, oldRent: 170000, newRent: 999999, startsOn: toDbDate('2026-07-01'), cancelledAt: new Date() },
  ];
  // tenancy.rent may already hold an applied change; rentOn must not care.
  const t = tenancy({ rent: 170000 });
  assert.equal(rentOn(t, changes, '2026-02-01'), 150000);
  assert.equal(rentOn(t, changes, '2026-03-01'), 180000);
  assert.equal(rentOn(t, changes, '2026-06-01'), 170000);
  assert.equal(rentOn(t, changes, '2026-08-01'), 170000, 'a cancelled change never applies');
  assert.equal(rentOn(t, [], '2026-08-01'), 170000);
});

const charge = (over = {}) => ({ id: 1, amount: 600000, dueDate: toDbDate('2026-01-20'), cancelledAt: null, waivers: [], allocations: [], ...over });

test('chargeState: due, part-paid, overdue, paid, waived and cancelled', () => {
  assert.equal(chargeState(charge(), '2026-01-15').status, CHARGE_STATUS.DUE);
  assert.equal(chargeState(charge(), '2026-01-20').status, CHARGE_STATUS.DUE, 'due today is not overdue yet');
  assert.equal(chargeState(charge(), '2026-01-21').status, CHARGE_STATUS.OVERDUE);
  const part = chargeState(charge({ allocations: [{ amount: 400000 }] }), '2026-01-15');
  assert.equal(part.status, CHARGE_STATUS.PARTIAL);
  assert.equal(part.balance, 200000);
  const waived = chargeState(charge({ allocations: [{ amount: 400000 }], waivers: [{ amount: 200000, reversedAt: null }, { amount: 50000, reversedAt: new Date() }] }), '2026-02-01');
  assert.equal(waived.status, CHARGE_STATUS.PAID, 'a reversed waiver does not count');
  assert.equal(waived.waived, 200000);
  const cancelled = chargeState(charge({ cancelledAt: new Date() }), '2026-02-01');
  assert.equal(cancelled.status, CHARGE_STATUS.CANCELLED);
  assert.equal(cancelled.balance, 0);
});

test('allocate: fills charges in order and returns what is left over', () => {
  // Worked example from the plan: term K6,000, pay K4,000 → owes K2,000; pay K3,000 → paid + K1,000 credit.
  const first = allocate(400000, [{ id: 1, balance: 600000 }]);
  assert.deepEqual(first, { lines: [{ chargeId: 1, amount: 400000 }], leftover: 0 });
  const second = allocate(300000, [{ id: 1, balance: 200000 }]);
  assert.deepEqual(second, { lines: [{ chargeId: 1, amount: 200000 }], leftover: 100000 });
  const many = allocate(250000, [{ id: 1, balance: 100000 }, { id: 2, balance: 0 }, { id: 3, balance: 100000 }, { id: 4, balance: 100000 }]);
  assert.deepEqual(many.lines, [{ chargeId: 1, amount: 100000 }, { chargeId: 3, amount: 100000 }, { chargeId: 4, amount: 50000 }]);
  assert.equal(many.leftover, 0);
});

test('accountStatus: paid, due, part-paid, overdue', () => {
  const open = (paid, overdue) => ({ state: { balance: 1, paid } , overdue });
  assert.equal(accountStatus({ owed: 0, overdue: 0, charges: [] }), CHARGE_STATUS.PAID);
  assert.equal(accountStatus({ owed: 5, overdue: 5, charges: [open(0)] }), CHARGE_STATUS.OVERDUE);
  assert.equal(accountStatus({ owed: 5, overdue: 0, charges: [open(3)] }), CHARGE_STATUS.PARTIAL);
  assert.equal(accountStatus({ owed: 5, overdue: 0, charges: [open(0)] }), CHARGE_STATUS.DUE);
});

test('statement: running balance; cancelled, reversed and voided lines left out; negative = credit', () => {
  const charges = [
    { id: 1, description: 'Semester 1 rent', amount: 600000, periodStart: toDbDate('2026-01-12'), createdAt: new Date(2026, 0, 12), cancelledAt: null, waivers: [{ id: 9, amount: 50000, reason: 'repairs', createdAt: new Date(2026, 1, 1, 12), reversedAt: null }, { id: 10, amount: 1, reason: 'x', createdAt: new Date(2026, 1, 1, 12), reversedAt: new Date() }] },
    { id: 2, description: 'Wrong fee', amount: 9999, periodStart: null, createdAt: new Date(2026, 0, 13, 12), cancelledAt: new Date(), waivers: [] },
  ];
  const payments = [
    { id: 5, status: 'ACTIVE', amount: 600000, datePaid: new Date(2026, 0, 20, 12), receipt: { receiptNumber: 'RCT-GE-2026-0001' } },
    { id: 6, status: 'VOID', amount: 100, datePaid: new Date(2026, 0, 21, 12), receipt: null },
  ];
  const rows = buildStatement(charges, payments);
  assert.deepEqual(rows.map((r) => [r.kind, r.amount, r.balance]), [
    ['charge', 600000, 600000],
    ['payment', -600000, 0],
    ['waiver', -50000, -50000],
  ]);
});

test('dates helpers', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.ok(isDay('2028-02-29'));
  assert.ok(!isDay('2027-02-29'));
  assert.ok(!isDay('2027-1-5'));
  assert.equal([...monthsBetweenDays('2026-11-30', '2027-02-01')].length, 4);
  assert.equal(formatDay('2027-01-20'), '20 Jan 2027');
  assert.deepEqual(bedLabels(3), ['A', 'B', 'C']);
});

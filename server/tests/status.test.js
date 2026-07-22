import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthStatus,
  roomTileStatus,
  allocatePayment,
  tenancyDuration,
  STATUS,
} from '../src/status.js';

test('monthStatus: PAID when applied >= expected', () => {
  const s = monthStatus(150000, 150000);
  assert.equal(s.status, STATUS.PAID);
  assert.equal(s.balance, 0);
  const over = monthStatus(200000, 150000);
  assert.equal(over.status, STATUS.PAID);
  assert.equal(over.balance, 0);
});

test('monthStatus: PARTIAL with balance', () => {
  const s = monthStatus(90000, 150000);
  assert.equal(s.status, STATUS.PARTIAL);
  assert.equal(s.balance, 60000);
});

test('monthStatus: DUE when nothing applied', () => {
  const s = monthStatus(0, 150000);
  assert.equal(s.status, STATUS.DUE);
  assert.equal(s.balance, 150000);
});

test('monthStatus: no expected rent counts as PAID', () => {
  assert.equal(monthStatus(0, 0).status, STATUS.PAID);
});

test('roomTileStatus: VACANT when no current tenancy', () => {
  const s = roomTileStatus({ hasCurrentTenancy: false, applied: 0, expected: 0 });
  assert.equal(s.status, STATUS.VACANT);
});

test('allocatePayment: single full month', () => {
  const { periods, overpay } = allocatePayment(150000, [
    { month: 7, year: 2026, expectedRent: 150000 },
  ]);
  assert.equal(periods[0].amountApplied, 150000);
  assert.equal(overpay, 0);
});

test('allocatePayment: multi-month split fills each in order', () => {
  const { periods } = allocatePayment(300000, [
    { month: 7, year: 2026, expectedRent: 150000 },
    { month: 8, year: 2026, expectedRent: 150000 },
  ]);
  assert.equal(periods[0].amountApplied, 150000);
  assert.equal(periods[1].amountApplied, 150000);
});

test('allocatePayment: partial only fills first month', () => {
  const { periods } = allocatePayment(200000, [
    { month: 7, year: 2026, expectedRent: 150000 },
    { month: 8, year: 2026, expectedRent: 150000 },
  ]);
  assert.equal(periods[0].amountApplied, 150000);
  assert.equal(periods[1].amountApplied, 50000);
});

test('allocatePayment: overpay lands on the last selected month', () => {
  const { periods, overpay } = allocatePayment(350000, [
    { month: 7, year: 2026, expectedRent: 150000 },
    { month: 8, year: 2026, expectedRent: 150000 },
  ]);
  assert.equal(periods[0].amountApplied, 150000);
  assert.equal(periods[1].amountApplied, 200000); // 150000 + 50000 overpay
  assert.equal(overpay, 0);
});

test('tenancyDuration formats years and months', () => {
  const start = new Date(2024, 0, 15); // 15 Jan 2024
  const end = new Date(2026, 3, 15); // 15 Apr 2026
  assert.equal(tenancyDuration(start, end), '2 years, 3 months');

  const start2 = new Date(2026, 0, 1);
  const end2 = new Date(2026, 1, 1);
  assert.equal(tenancyDuration(start2, end2), '0 years, 1 month');
});

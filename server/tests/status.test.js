import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tenancyDuration, STATUS } from '../src/status.js';

test('tenancyDuration formats years and months', () => {
  const start = new Date(2024, 0, 15); // 15 Jan 2024
  const end = new Date(2026, 3, 15); // 15 Apr 2026
  assert.equal(tenancyDuration(start, end), '2 years, 3 months');

  const start2 = new Date(2026, 0, 1);
  const end2 = new Date(2026, 1, 1);
  assert.equal(tenancyDuration(start2, end2), '0 years, 1 month');
});

test('bed tile statuses include OVERDUE and VACANT', () => {
  assert.deepEqual(Object.keys(STATUS).sort(), ['DUE', 'OVERDUE', 'PAID', 'PARTIAL', 'VACANT']);
});

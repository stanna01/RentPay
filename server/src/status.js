// Month-status logic. Pure functions so they are easy to unit test.

export const STATUS = {
  PAID: 'PAID',
  PARTIAL: 'PARTIAL',
  DUE: 'DUE',
  VACANT: 'VACANT',
};

/**
 * Compute the status of a single month for a tenancy.
 *
 * @param {number} applied  Sum of amountApplied (ngwee) for this month/year.
 * @param {number} expected Expected rent (ngwee) for this month/year.
 * @returns {{status: string, applied: number, expected: number, balance: number}}
 *          balance is what is still owed (>=0); 0 when fully paid.
 */
export function monthStatus(applied, expected) {
  const a = Math.max(0, Math.round(applied || 0));
  const e = Math.max(0, Math.round(expected || 0));

  if (e <= 0) {
    // No rent expected (e.g. free month) — treat any/zero payment as settled.
    return { status: STATUS.PAID, applied: a, expected: e, balance: 0 };
  }
  if (a <= 0) {
    return { status: STATUS.DUE, applied: 0, expected: e, balance: e };
  }
  if (a >= e) {
    return { status: STATUS.PAID, applied: a, expected: e, balance: 0 };
  }
  return { status: STATUS.PARTIAL, applied: a, expected: e, balance: e - a };
}

/**
 * Build a status for a room grid tile. A room with no current tenancy is VACANT.
 * Otherwise the status is for the given month/year of the current tenancy.
 */
export function roomTileStatus({ hasCurrentTenancy, applied, expected }) {
  if (!hasCurrentTenancy) {
    return { status: STATUS.VACANT, applied: 0, expected: 0, balance: 0 };
  }
  return monthStatus(applied, expected);
}

/**
 * Split a payment amount across the chosen months, filling each month up to its
 * expected rent in order, and returning any leftover as an overpayment/credit.
 *
 * @param {number} amount   Total payment (ngwee).
 * @param {Array<{month:number,year:number,expectedRent:number}>} months
 * @returns {{periods: Array, overpay: number}}
 */
export function allocatePayment(amount, months) {
  let remaining = Math.max(0, Math.round(amount || 0));
  const periods = [];
  for (const m of months) {
    const expected = Math.max(0, Math.round(m.expectedRent || 0));
    // Apply up to the expected rent; the last selected month absorbs any
    // remainder if expected is 0 so money is never silently dropped.
    const applied = expected > 0 ? Math.min(remaining, expected) : remaining;
    periods.push({
      month: m.month,
      year: m.year,
      expectedRent: expected,
      amountApplied: applied,
    });
    remaining -= applied;
  }
  // Any money left after covering every selected month up to its expected rent
  // is added onto the LAST selected month as an overpayment (advance credit).
  if (remaining > 0 && periods.length > 0) {
    periods[periods.length - 1].amountApplied += remaining;
    remaining = 0;
  }
  return { periods, overpay: remaining };
}

/** "X years, Y months" between two dates (defaults end to now). */
export function tenancyDuration(moveInDate, moveOutDate = new Date()) {
  const start = new Date(moveInDate);
  const end = moveOutDate ? new Date(moveOutDate) : new Date();
  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const yPart = `${years} year${years === 1 ? '' : 's'}`;
  const mPart = `${rem} month${rem === 1 ? '' : 's'}`;
  return `${yPart}, ${mPart}`;
}

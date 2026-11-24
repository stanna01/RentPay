// Small pure helpers shared by routes. Balances and charge statuses live in
// billingService.js.

/** Status of a bed tile on the rooms grid. */
export const STATUS = {
  PAID: 'PAID',
  PARTIAL: 'PARTIAL',
  DUE: 'DUE',
  OVERDUE: 'OVERDUE',
  VACANT: 'VACANT',
};

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

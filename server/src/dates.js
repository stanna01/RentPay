// Date-only values ("YYYY-MM-DD"). Billing works in whole days.
//
// Every date-only value is stored as midnight UTC (Prisma @db.Date columns
// come back that way, and tenancy move-in/move-out dates are written that way)
// and read back with dbDay(). "Today" is the server's local day, which is
// Africa/Lusaka (set in index.js).

const pad = (n) => String(n).padStart(2, '0');

export const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The local calendar day of a moment, e.g. now → "2026-11-24". */
export function localDay(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export const today = () => localDay(new Date());

/** A stored date-only value (midnight UTC Date, or "YYYY-MM-DD…") as "YYYY-MM-DD". */
export function dbDay(d) {
  if (d == null) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "YYYY-MM-DD" → the Date to store for it (midnight UTC). */
export const toDbDate = (day) => new Date(`${day}T00:00:00.000Z`);

/** True for a real calendar day written as YYYY-MM-DD. */
export function isDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dbDay(toDbDate(s)) === s;
}

export function addDays(day, n) {
  const d = toDbDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dbDay(d);
}

export const daysBetween = (from, to) => Math.round((toDbDate(to) - toDbDate(from)) / 86_400_000);

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const monthStart = (year, month) => `${year}-${pad(month)}-01`;

/** "2027-01-20" → "20 Jan 2027". */
export function formatDay(day) {
  if (!day) return '';
  const [y, m, d] = dbDay(day).split('-').map(Number);
  return `${d} ${MONTH_NAMES[m].slice(0, 3)} ${y}`;
}

/** "2027-01-20" → "20 January 2027". */
export function formatDayLong(day) {
  if (!day) return '';
  const [y, m, d] = dbDay(day).split('-').map(Number);
  return `${d} ${MONTH_NAMES[m]} ${y}`;
}

/** {year, month} for every month from one day's month to another's (inclusive). */
export function* monthsBetweenDays(fromDay, toDay) {
  let [y, m] = fromDay.split('-').map(Number);
  const [ty, tm] = toDay.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    yield { year: y, month: m };
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

// Money and date formatting. All money is integer ngwee (1 Kwacha = 100 ngwee),
// exactly like the server, so there are no floating-point errors.

/** Format integer ngwee in the house style: "K 1,500" (whole) or "K 1,500.50". */
export function formatK(ngwee: number): string {
  const negative = ngwee < 0;
  const abs = Math.abs(Math.round(ngwee));
  const kwacha = Math.floor(abs / 100);
  const ng = abs % 100;
  let s = 'K ' + String(kwacha).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (ng > 0) s += '.' + String(ng).padStart(2, '0');
  return (negative ? '-' : '') + s;
}

/** Parse a Kwacha amount typed by the user ("1,400.50") into ngwee, or null if invalid. */
export function toNgwee(input: string): number | null {
  const n = Number(input.replace(/,/g, '').trim());
  if (input.trim() === '' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-30" → "30 Nov 2026". Date-only values are never shifted by timezones. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Local "today" as YYYY-MM-DD, for comparing with due dates. */
export function todayISO(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Zambian mobile number check: 09XXXXXXXX / 07XXXXXXXX, or with +260 / 260. */
export function normaliseZambianMsisdn(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  const m = digits.match(/^(?:\+?260|0)([79]\d{8})$/);
  return m ? `260${m[1]}` : null;
}

// Money helpers. All amounts are stored as INTEGER ngwee (1 Kwacha = 100 ngwee).
// Formatting to Kwacha only happens at the display / PDF boundary.

/** Parse a user-entered Kwacha string/number into integer ngwee. */
export function kwachaToNgwee(value) {
  if (value === null || value === undefined || value === '') {
    throw new Error('Amount is required');
  }
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Amount must be a positive number');
  }
  // Round to the nearest ngwee to avoid floating point drift (e.g. 0.1 + 0.2).
  return Math.round(n * 100);
}

/** Convert integer ngwee to a Kwacha number (may have decimals). */
export function ngweeToKwacha(ngwee) {
  return (ngwee || 0) / 100;
}

/**
 * Format integer ngwee as a display string in the app's house style:
 * "K 1,500" for whole Kwacha, "K 1,500.50" when there are ngwee.
 */
export function formatKwacha(ngwee, { symbol = 'K' } = {}) {
  const negative = (ngwee || 0) < 0;
  const abs = Math.abs(Math.round(ngwee || 0));
  const kwacha = Math.floor(abs / 100);
  const ng = abs % 100;
  let str = `${symbol} ${kwacha.toLocaleString('en-US')}`;
  if (ng > 0) str += '.' + String(ng).padStart(2, '0');
  return (negative ? '-' : '') + str;
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function threeDigitsToWords(num) {
  const parts = [];
  const hundreds = Math.floor(num / 100);
  const rest = num % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const t = Math.floor(rest / 10);
      const o = rest % 10;
      parts.push(o > 0 ? `${TENS[t]}-${ONES[o]}` : TENS[t]);
    }
  }
  return parts.join(' ');
}

/** Convert a non-negative integer to English words. */
export function integerToWords(num) {
  if (num === 0) return 'zero';
  const groups = [];
  let n = num;
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const words = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const scale = SCALES[i];
    words.push(threeDigitsToWords(groups[i]) + (scale ? ` ${scale}` : ''));
  }
  return words.join(' ');
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Render integer ngwee as a formal amount-in-words for receipts, e.g.
 * 150050 -> "One thousand five hundred Kwacha and fifty Ngwee".
 */
export function amountInWords(ngwee) {
  const safe = Math.max(0, Math.round(ngwee || 0));
  const kwacha = Math.floor(safe / 100);
  const remainder = safe % 100;
  const kwachaWords = `${capitalise(integerToWords(kwacha))} Kwacha`;
  if (remainder === 0) {
    return `${kwachaWords} only`;
  }
  return `${kwachaWords} and ${integerToWords(remainder)} Ngwee`;
}

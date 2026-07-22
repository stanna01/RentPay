// Small fetch wrapper. Always sends the session cookie (same-origin) and
// surfaces friendly error messages from the server.

async function request(method, url, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${url}`, opts);
  } catch {
    // Network failure (server unreachable / offline) — give a helpful message
    // rather than the browser's technical "Failed to fetch".
    const err = new Error("Can't reach the server. Please check your internet connection and try again.");
    err.status = 0;
    throw err;
  }
  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const message = (data && data.error) || 'Something went wrong. Please try again.';
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
};

// Convert Kwacha (user input) to integer ngwee.
export function toNgwee(kwacha) {
  const n = Number(String(kwacha).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// Format integer ngwee in the house style: "K 1,500" (whole) / "K 1,500.50".
export function formatK(ngwee) {
  const negative = (ngwee || 0) < 0;
  const abs = Math.abs(Math.round(ngwee || 0));
  const kwacha = Math.floor(abs / 100);
  const ng = abs % 100;
  let s = 'K ' + kwacha.toLocaleString('en-US');
  if (ng > 0) s += '.' + String(ng).padStart(2, '0');
  return (negative ? '-' : '') + s;
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

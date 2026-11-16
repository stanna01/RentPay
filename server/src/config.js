// Environment configuration and the startup safety checks.

const isProd = () => process.env.NODE_ENV === 'production';

/**
 * Public base URL of the app (no trailing slash). Used for password-reset links
 * and the CSRF origin check. Never derived from request headers.
 */
export function appUrl() {
  const raw = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (raw) return raw;
  if (isProd()) throw new Error('APP_URL is not set.');
  return 'http://localhost:5173'; // Vite dev server
}

/** Origins allowed to make state-changing requests. */
export function allowedOrigins() {
  const set = new Set();
  try {
    set.add(new URL(appUrl()).origin);
  } catch {
    /* reported by assertSecureConfig */
  }
  if (!isProd()) {
    set.add('http://localhost:5173');
    set.add('http://localhost:4000');
    set.add('http://127.0.0.1:5173');
  }
  return set;
}

function weakSecret(s) {
  return (
    !s ||
    s === 'dev-insecure-secret-change-me' ||
    s.length < 32 ||
    /change|insecure|example|placeholder|secret-here/i.test(s)
  );
}

/**
 * Refuse to start in production with missing or weak security settings; warn
 * in development.
 */
export function assertSecureConfig() {
  const problems = [];
  if (weakSecret(process.env.JWT_SECRET || '')) {
    problems.push(
      'JWT_SECRET is missing or weak. Set a strong random value (openssl rand -base64 48).'
    );
  }
  if (weakSecret(process.env.ENCRYPTION_KEY || '')) {
    problems.push(
      'ENCRYPTION_KEY is missing or weak. Set a strong random value, different from JWT_SECRET (openssl rand -base64 48).'
    );
  } else if (process.env.ENCRYPTION_KEY === process.env.JWT_SECRET) {
    problems.push('ENCRYPTION_KEY must be different from JWT_SECRET.');
  }
  const url = (process.env.APP_URL || '').trim();
  if (!url) {
    problems.push('APP_URL is not set (e.g. https://rent.yourdomain.com). Password-reset links need it.');
  } else {
    try {
      const u = new URL(url);
      if (isProd() && u.protocol !== 'https:') problems.push('APP_URL must use https:// in production.');
    } catch {
      problems.push('APP_URL is not a valid URL.');
    }
  }

  if (!problems.length) return;
  const msg = problems.map((p) => `  - ${p}`).join('\n');
  if (isProd()) {
    console.error(`\nFATAL: insecure configuration:\n${msg}\n`);
    process.exit(1);
  }
  console.warn(`\n[warning] configuration issues (OK for local development):\n${msg}\n`);
}

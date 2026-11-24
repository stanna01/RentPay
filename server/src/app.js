// The Express application (routes + security middleware). index.js starts it;
// tests import it directly.
import 'dotenv/config';
// Month boundaries (dashboard, reports, receipts) must follow Zambian time, not
// whatever timezone the hosting server happens to use.
if (!process.env.TZ) process.env.TZ = 'Africa/Lusaka';

import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

import { requireAuth, requirePasswordCurrent, requireRole, ROLES } from './auth.js';
import { wrapAsync } from './asyncWrap.js';
import { allowedOrigins } from './config.js';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import propertiesRoutes from './routes/properties.js';
import roomsRoutes from './routes/rooms.js';
import tenantsRoutes from './routes/tenants.js';
import tenanciesRoutes from './routes/tenancies.js';
import paymentsRoutes from './routes/payments.js';
import receiptsRoutes from './routes/receipts.js';
import reportsRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import auditRoutes from './routes/audit.js';
import chargesRoutes from './routes/charges.js';
import noticesRoutes from './routes/notices.js';
import v1Routes from './routes/v1.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Behind a reverse proxy (Nginx) in production so rate-limiting and secure
// cookies see the real client IP / protocol.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.disable('x-powered-by');

// Security headers, including a Content-Security-Policy tailored to the app:
// own scripts only, Google Fonts for the typeface, inline styles (React and
// Recharts set style attributes), and no framing by other sites.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'self'"], // the receipt PDF viewer
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(process.env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// CSRF defence in depth (on top of SameSite=Lax cookies): a state-changing
// request must come from our own origin. Browsers always send Origin on
// cross-site POSTs, so a forged form or fetch from another site is refused.
const ORIGINS = allowedOrigins();
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  let source = origin;
  if (!source) {
    const referer = req.get('referer');
    if (referer) {
      try {
        source = new URL(referer).origin;
      } catch {
        source = 'invalid';
      }
    }
  }
  // No Origin/Referer at all = not a browser form/fetch (e.g. curl), not CSRF.
  if (!source || ORIGINS.has(source) || source === `${req.protocol}://${req.get('host')}`) return next();
  return res.status(403).json({ error: 'This request was blocked for your security. Please reload the app and try again.' });
});

// Health check (unauthenticated).
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Public auth routes (some individual routes require a session).
app.use('/api/auth', wrapAsync(authRoutes));

// The phone app's API.
app.use('/api/v1', wrapAsync(v1Routes));

// Everything else requires a signed-in user who has set their own password.
// The super admin runs the platform; a landlord works inside their own
// business (routes/access.js keeps each landlord to their own data).
const signedIn = [requireAuth, requirePasswordCurrent];
const superAdmin = [...signedIn, requireRole(ROLES.SUPER_ADMIN)];
const landlord = [...signedIn, requireRole(ROLES.LANDLORD)];
app.use('/api/admin', ...superAdmin, wrapAsync(adminRoutes));
app.use('/api/settings', ...superAdmin, wrapAsync(settingsRoutes));
app.use('/api/properties', ...landlord, wrapAsync(propertiesRoutes));
app.use('/api/rooms', ...landlord, wrapAsync(roomsRoutes));
app.use('/api/tenants', ...landlord, wrapAsync(tenantsRoutes));
app.use('/api/tenancies', ...landlord, wrapAsync(tenanciesRoutes));
app.use('/api/payments', ...landlord, wrapAsync(paymentsRoutes));
app.use('/api/receipts', ...landlord, wrapAsync(receiptsRoutes));
app.use('/api/reports', ...landlord, wrapAsync(reportsRoutes));
app.use('/api/audit', ...landlord, wrapAsync(auditRoutes));
app.use('/api/charges', ...landlord, wrapAsync(chargesRoutes));
app.use('/api/notices', ...landlord, wrapAsync(noticesRoutes));

// Unknown API routes get a JSON 404 (never the SPA's HTML).
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// --- Serve the built client in production (single-process deployment) --------
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDist));
  // SPA fallback: any non-API route serves index.html.
  app.get(/^(?!\/api).*/, async (req, res, next) => {
    try {
      const html = await fs.readFile(path.join(clientDist, 'index.html'), 'utf8');
      res.type('html').send(html);
    } catch {
      next();
    }
  });
}

// Central error handler. The user only ever receives a helpful message — never
// an internal/technical one. Intentional errors (thrown with err.status < 500)
// carry a friendly message we wrote; anything else is unexpected, so we log the
// real detail server-side and show the user a safe, generic message.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request was too large.' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'That request was not valid.' });
  }
  if (err && err.status && err.status < 500) {
    return res
      .status(err.status)
      .json({ error: err.message || 'That request could not be completed.', ...(err.code ? { code: err.code } : {}) });
  }
  console.error('[error]', err?.stack || err?.message || err);
  if (err?.name === 'PrismaClientValidationError') {
    return res.status(400).json({ error: 'That request was not valid.' });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'That record was not found.' });
  }
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
});

export default app;

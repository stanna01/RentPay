import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

import { prisma, ensureSettings } from './db.js';
import { requireAuth } from './auth.js';
import { startEmailWorker } from './email.js';
import { wrapAsync } from './asyncWrap.js';

import authRoutes from './routes/auth.js';
import roomsRoutes from './routes/rooms.js';
import tenantsRoutes from './routes/tenants.js';
import tenanciesRoutes from './routes/tenancies.js';
import paymentsRoutes from './routes/payments.js';
import receiptsRoutes from './routes/receipts.js';
import reportsRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

// Behind a reverse proxy (Nginx) in production so rate-limiting and secure
// cookies see the real client IP / protocol.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security headers. CSP is intentionally left off here because the SPA loads
// Google Fonts and uses inline styles (React/Recharts); enable a tailored CSP
// (see docs/DEPLOYMENT.md) once you've tested it against the built app.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json());
app.use(cookieParser());

// Health check (unauthenticated).
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Public auth routes.
app.use('/api/auth', wrapAsync(authRoutes));

// Everything else requires a logged-in landlord.
app.use('/api/rooms', requireAuth, wrapAsync(roomsRoutes));
app.use('/api/tenants', requireAuth, wrapAsync(tenantsRoutes));
app.use('/api/tenancies', requireAuth, wrapAsync(tenanciesRoutes));
app.use('/api/payments', requireAuth, wrapAsync(paymentsRoutes));
app.use('/api/receipts', requireAuth, wrapAsync(receiptsRoutes));
app.use('/api/reports', requireAuth, wrapAsync(reportsRoutes));
app.use('/api/settings', requireAuth, wrapAsync(settingsRoutes));

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
  console.error('[error]', err?.stack || err?.message || err);
  if (err?.name === 'PrismaClientValidationError') {
    return res.status(400).json({ error: 'That request was not valid.' });
  }
  if (err && err.status && err.status < 500) {
    return res
      .status(err.status)
      .json({ error: err.message || 'That request could not be completed.' });
  }
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
});

// Refuse to start in production with a missing, default, or weak JWT_SECRET —
// a weak secret would let anyone forge a login cookie.
function assertSecureConfig() {
  const s = process.env.JWT_SECRET || '';
  const weak =
    !s ||
    s === 'dev-insecure-secret-change-me' ||
    s.length < 32 ||
    /change|insecure|example|placeholder|secret-here/i.test(s);
  if (weak) {
    const msg =
      'JWT_SECRET is missing or weak. Set a strong random value before deploying.\n' +
      '  Generate one with:  openssl rand -base64 48';
    if (process.env.NODE_ENV === 'production') {
      console.error(`\nFATAL: ${msg}\n`);
      process.exit(1);
    }
    console.warn(`\n[warning] ${msg}\n(OK for local development.)\n`);
  }
}

async function start() {
  assertSecureConfig();
  await ensureSettings();
  startEmailWorker();
  app.listen(PORT, () => {
    console.log(`RentReceipt server listening on http://localhost:${PORT}`);
  });
}

start().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});

// Graceful shutdown.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

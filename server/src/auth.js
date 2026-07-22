import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';

const COOKIE_NAME = 'rr_session';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';
const RESET_TTL = '1h';

export function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function issueCookie(res, landlord) {
  const token = jwt.sign({ sub: landlord.id, email: landlord.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
  });
}

export function clearCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// --- Password reset tokens --------------------------------------------------
// A reset token is signed with (JWT_SECRET + current passwordHash). Because the
// hash is part of the signing key, the token stops verifying the moment the
// password changes — so a reset link is naturally single-use, and it also
// expires after RESET_TTL.
function resetSecret(landlord) {
  return JWT_SECRET + '::' + landlord.passwordHash;
}

export function makeResetToken(landlord) {
  return jwt.sign({ sub: landlord.id, purpose: 'pwreset' }, resetSecret(landlord), {
    expiresIn: RESET_TTL,
  });
}

/** Resolve a reset token to its landlord, or throw a friendly error. */
export async function verifyResetToken(token) {
  const decoded = (() => {
    try {
      return jwt.decode(token);
    } catch {
      return null;
    }
  })();
  if (!decoded?.sub) throw new Error('This reset link is invalid or has expired.');
  const landlord = await prisma.landlord.findUnique({ where: { id: decoded.sub } });
  if (!landlord) throw new Error('This reset link is invalid or has expired.');
  try {
    const payload = jwt.verify(token, resetSecret(landlord));
    if (payload.purpose !== 'pwreset') throw new Error('bad purpose');
    return landlord;
  } catch {
    throw new Error('This reset link is invalid or has expired.');
  }
}

/** Express middleware: require a valid session cookie. */
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Please log in.' });
    const payload = jwt.verify(token, JWT_SECRET);
    const landlord = await prisma.landlord.findUnique({ where: { id: payload.sub } });
    if (!landlord) return res.status(401).json({ error: 'Please log in.' });
    req.landlord = landlord;
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

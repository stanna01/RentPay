import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';

const COOKIE_NAME = 'rr_session';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const JWT_ALGORITHM = 'HS256';
const BCRYPT_COST = 12;

// Session lifetime: a session ends after 12 hours without activity (the cookie
// is re-issued as the user works), and always after 7 days, active or not.
export const IDLE_MS = 12 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const REISSUE_AFTER_MS = 60 * 60 * 1000; // refresh the cookie at most hourly
const RESET_TTL = '30m';

// SUPER_ADMIN runs the platform; LANDLORD runs one landlord business.
export const ROLES = { SUPER_ADMIN: 'SUPER_ADMIN', LANDLORD: 'LANDLORD' };

// Phone app tokens (sent as "Authorization: Bearer"): a short-lived access
// token plus a refresh token to get new ones. Both carry the user's
// tokenVersion, so a password change or "sign out everywhere" ends them too.
const ACCESS_TTL = '15m';
const REFRESH_TTL = '60d';

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(String(plain ?? ''), hash);
}

/** True when a stored hash was made with a lower cost and should be upgraded. */
export function needsRehash(hash) {
  try {
    return bcrypt.getRounds(hash) < BCRYPT_COST;
  } catch {
    return false;
  }
}

// Compared against when the email is unknown, so a login takes the same time
// whether or not the account exists (no user enumeration by timing).
export const DUMMY_HASH = bcrypt.hashSync('rentreceipt-timing-equaliser', BCRYPT_COST);

/**
 * Issue the session cookie. `authTime` (seconds) is when the user actually
 * signed in; it is carried across re-issues to enforce the absolute limit.
 */
export function issueCookie(res, user, authTime = Math.floor(Date.now() / 1000)) {
  const token = jwt.sign({ sub: user.id, tv: user.tokenVersion, at: authTime }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: Math.floor(IDLE_MS / 1000),
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: IDLE_MS,
    path: '/',
  });
}

export function clearCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Access + refresh tokens for the phone app. */
export function issueMobileTokens(user) {
  const sign = (typ, expiresIn) =>
    jwt.sign({ sub: user.id, tv: user.tokenVersion, typ }, JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn });
  return { accessToken: sign('access', ACCESS_TTL), refreshToken: sign('refresh', REFRESH_TTL) };
}

/** The user a still-valid refresh token belongs to, or null. */
export async function userFromRefreshToken(token) {
  try {
    const payload = jwt.verify(String(token || ''), JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    if (payload.typ !== 'refresh') return null;
    const user = await loadSessionUser(payload.sub);
    return canSignIn(user) && user.tokenVersion === payload.tv ? user : null;
  } catch {
    return null;
  }
}

const loadSessionUser = (id) => prisma.user.findUnique({ where: { id }, include: { organization: true } });

/** Active account whose landlord business (if any) is not suspended. */
export const canSignIn = (user) => !!user && user.isActive && (!user.organization || user.organization.isActive);

function bearerToken(req) {
  const m = /^Bearer (.+)$/i.exec(req.get('authorization') || '');
  return m ? m[1] : null;
}

// --- Password reset tokens --------------------------------------------------
// A reset token is signed with (JWT_SECRET + current passwordHash). Because the
// hash is part of the signing key, the token stops verifying the moment the
// password changes — so a reset link is naturally single-use, and it also
// expires after RESET_TTL.
function resetSecret(user) {
  return JWT_SECRET + '::' + user.passwordHash;
}

export function makeResetToken(user) {
  return jwt.sign({ sub: user.id, purpose: 'pwreset' }, resetSecret(user), {
    algorithm: JWT_ALGORITHM,
    expiresIn: RESET_TTL,
  });
}

/** Resolve a reset token to its user, or throw a friendly error. */
export async function verifyResetToken(token) {
  const invalid = () => new Error('This reset link is invalid or has expired.');
  const decoded = (() => {
    try {
      return jwt.decode(token);
    } catch {
      return null;
    }
  })();
  if (!Number.isInteger(decoded?.sub)) throw invalid();
  const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
  if (!user || !user.isActive) throw invalid();
  try {
    const payload = jwt.verify(token, resetSecret(user), { algorithms: [JWT_ALGORITHM] });
    if (payload.purpose !== 'pwreset') throw invalid();
    return user;
  } catch {
    throw invalid();
  }
}

/**
 * Express middleware: require a valid, current session — the web cookie, or a
 * phone-app access token. Rejects tokens whose tokenVersion is stale (password
 * changed, "log out everywhere"), deactivated users, users of a suspended
 * landlord, and web sessions older than the absolute limit.
 */
export async function requireAuth(req, res, next) {
  const bearer = bearerToken(req);
  const expired = () => {
    if (!bearer) clearCookie(res);
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  };
  try {
    const token = bearer || req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Please log in.' });
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    const user = await loadSessionUser(payload.sub);
    if (!canSignIn(user) || user.tokenVersion !== payload.tv) return expired();
    if (bearer) {
      // Only access tokens open the API (never a refresh token or a web cookie value).
      if (payload.typ !== 'access') return expired();
    } else {
      const nowMs = Date.now();
      if (payload.typ || !payload.at || nowMs - payload.at * 1000 > ABSOLUTE_MS) return expired();
      if (nowMs - payload.iat * 1000 > REISSUE_AFTER_MS) issueCookie(res, user, payload.at);
    }
    req.user = user;
    next();
  } catch {
    return expired();
  }
}

/**
 * Block everything except /api/auth/* until a user with a temporary or default
 * password has chosen their own.
 */
export function requirePasswordCurrent(req, res, next) {
  if (req.user?.mustChangePassword) {
    return res.status(403).json({
      error: 'Please choose a new password before continuing.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
  next();
}

/** Express middleware factory: only allow the given role(s). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

export const isSuperAdmin = (user) => user?.role === ROLES.SUPER_ADMIN;

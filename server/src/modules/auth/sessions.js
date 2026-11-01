import mongoose from 'mongoose';
import { ADMIN_ROLES } from '@crm/shared/enums';
import { AppError } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';

// AUTH-22. Enforced by the server against the (injectable) clock, and also by the cookie and the
// session store's own expiry.
export const USER_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
export const ADMIN_IDLE_MS = 30 * 60 * 1000;
export const ADMIN_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000; // don't rewrite the session on every request

export const isAdmin = (user) => (user?.roles ?? []).some((r) => ADMIN_ROLES.includes(r.role));

const sessionsCollection = () => mongoose.connection.collection('sessions');

/** AUTH-23: lets every session of an account be found and deleted. */
export async function ensureSessionIndex() {
  await sessionsCollection().createIndex({ 'session.userId': 1 });
}

/** AUTH-23: end every session of an account, optionally keeping one (the current session). */
export async function endAllSessions(userId, { exceptSid } = {}) {
  const filter = { 'session.userId': String(userId) };
  if (exceptSid) filter._id = { $ne: exceptSid };
  await sessionsCollection().deleteMany(filter);
}

/** Take the person out of the session but keep the CSRF token. */
export function clearAuth(session) {
  for (const key of [
    'userId',
    'signedInAt',
    'lastSeenAt',
    'secondStepPending',
    'secondStepFails',
  ]) {
    delete session[key];
  }
}

/**
 * AUTH-16: after a good password check, the session id is regenerated (no session fixation).
 * The CSRF token is carried over so the page's token keeps working.
 */
export async function establishSession(req, user, { secondStepPending }) {
  const csrf = req.session.csrf;
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
  if (csrf) req.session.csrf = csrf;
  const now = clock.now().toISOString();
  req.session.userId = String(user._id);
  req.session.signedInAt = now;
  req.session.lastSeenAt = now;
  req.session.secondStepPending = Boolean(secondStepPending);
  req.session.secondStepFails = 0;
}

/**
 * AUTH-22 and AUTH-23. Runs after loadUser, so the state and roles are fresh (AUTH-24):
 * - a deactivated or suspended account is signed out at once,
 * - a student or teacher session ends after 14 days without use,
 * - an admin session ends after 30 minutes idle or 12 hours in total.
 */
export function enforceSessionLifetime(req, _res, next) {
  const session = req.session;
  if (!session?.userId) return next();
  if (!req.user) {
    clearAuth(session);
    return next();
  }
  const now = clock.now();
  const admin = isAdmin(req.user);
  const lastSeen = new Date(session.lastSeenAt ?? now);
  const signedIn = new Date(session.signedInAt ?? now);
  const idleLimit = admin ? ADMIN_IDLE_MS : USER_IDLE_MS;
  const expired =
    ['deactivated', 'suspended'].includes(req.user.state) ||
    now.getTime() - lastSeen.getTime() > idleLimit ||
    (admin && now.getTime() - signedIn.getTime() > ADMIN_ABSOLUTE_MS);
  if (expired) {
    clearAuth(session);
    req.user = null;
    return next();
  }
  session.signedInAt ??= now.toISOString();
  if (now.getTime() - lastSeen.getTime() > TOUCH_EVERY_MS || !session.lastSeenAt) {
    session.lastSeenAt = now.toISOString();
  }
  session.cookie.maxAge = idleLimit; // rolling: the cookie is renewed on every response
  next();
}

// Everything a half-signed-in admin may still reach (AUTH-17).
const SECOND_STEP_ALLOWED = new Set([
  '/api/health',
  '/api/auth/csrf',
  '/api/auth/captcha',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/second-step',
  '/api/auth/second-step/email-code',
  '/api/auth/totp/setup',
  '/api/auth/totp/confirm',
]);

/** AUTH-17: until the second step is passed, every other endpoint answers 401 SECOND_STEP_REQUIRED. */
export function secondStepGate(req, _res, next) {
  if (req.user && req.session?.secondStepPending && !SECOND_STEP_ALLOWED.has(req.path)) {
    return next(
      new AppError(401, 'SECOND_STEP_REQUIRED', 'Finish signing in with the second step.'),
    );
  }
  next();
}

import crypto from 'node:crypto';
import { AppError } from './errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('base64url');
  return req.session.csrf;
}

/** FND-28: every non-GET request must send the session's token in X-CSRF-Token. */
export function csrfProtection(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  const expected = req.session?.csrf;
  const sent = req.get('X-CSRF-Token');
  const ok =
    expected &&
    sent &&
    expected.length === sent.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sent));
  if (!ok) return next(new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token.'));
  next();
}

import { loadRequestUser } from './auth.service.js';
import { AppError } from '../../lib/errors.js';

/** FND-16: load the user once per request, after authentication. */
export async function loadUser(req, _res, next) {
  try {
    if (req.session?.userId) {
      req.user = await loadRequestUser(req.session.userId);
      if (!req.user) delete req.session.userId;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Proves the caller is signed in. Permission itself is decided in services via assertCan. */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in.'));
  next();
}

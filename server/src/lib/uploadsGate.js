import { getConfig } from '../config.js';
import { AppError } from './errors.js';

/** Refuses an upload route when UPLOADS_ENABLED=false (no ClamAV on this deployment). */
export function requireUploadsEnabled(_req, _res, next) {
  if (getConfig().UPLOADS_ENABLED) return next();
  next(new AppError(503, 'UPLOADS_DISABLED', 'File uploads are turned off on this server.'));
}

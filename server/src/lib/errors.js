import { ERROR_CODES } from '@crm/shared/errors';

export class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** 429 with a Retry-After header (the error middleware sets it from `retryAfter`, in seconds). */
export function rateLimited(retryAfterSeconds, message = 'Too many requests. Try again later.') {
  const err = new AppError(429, 'RATE_LIMITED', message);
  err.retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  return err;
}

export const notFound = (message = 'Not found.') =>
  new AppError(ERROR_CODES.NOT_FOUND.status, ERROR_CODES.NOT_FOUND.code, message);

export function notFoundHandler(_req, _res, next) {
  next(notFound());
}

export function errorMiddleware(err, req, res, _next) {
  if (err instanceof AppError) {
    const error = { code: err.code, message: err.message };
    if (err.fields) error.fields = err.fields;
    if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
    return res.status(err.status).json({ error });
  }
  if (err?.type === 'entity.too.large') {
    return res
      .status(413)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Request body is too large.' } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body.' } });
  }
  (req.log ?? console).error({ err }, 'unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
}

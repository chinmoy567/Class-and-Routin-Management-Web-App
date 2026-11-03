import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { validate } from '../../lib/validate.js';
import { recordBounce } from './bounce.service.js';

// EML-09: the provider's bounce webhook. Mounted before CSRF: providers cannot send a CSRF token.
export const emailWebhookRouter = Router();

const bounceBody = z.strictObject({
  email: z.string().email().max(254),
  type: z.enum(['bounce', 'complaint']),
});

/** Constant-time comparison, so the secret cannot be guessed one character at a time. */
function sameSecret(given, expected) {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

emailWebhookRouter.post(
  '/email-bounce',
  (req, _res, next) => {
    // Unset secret = webhook refused, so an unconfigured server accepts nothing.
    if (!sameSecret(req.get('x-email-webhook-secret'), getConfig().EMAIL_WEBHOOK_SECRET)) {
      return next(new AppError(403, 'FORBIDDEN', 'Not allowed.'));
    }
    return next();
  },
  validate({ body: bounceBody }),
  async (req, res) => {
    await recordBounce(req.body);
    res.status(204).end();
  },
);

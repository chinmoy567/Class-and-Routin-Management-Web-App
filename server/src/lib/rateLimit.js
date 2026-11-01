import { rateLimit } from 'express-rate-limit';
import { MongoRateLimitStore } from './rateLimitStore.js';
import { rateLimited } from './errors.js';
import { clock } from './time.js';

const secondsUntil = (instant) => (instant.getTime() - clock.now().getTime()) / 1000;

/**
 * Per-IP limit for one route (express-rate-limit on the MongoDB store). Over the limit the
 * caller gets 429 RATE_LIMITED with a Retry-After header.
 */
export function limitByIp({ prefix, windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: false,
    legacyHeaders: false,
    store: new MongoRateLimitStore({ prefix: `${prefix}:` }),
    handler: (req, _res, next) => next(rateLimited(secondsUntil(req.rateLimit.resetTime))),
  });
}

/**
 * Count one hit against `key` (for example an email HMAC) and say whether the limit is passed.
 * The count is a single atomic update, so concurrent requests are never missed.
 */
export async function hit(prefix, key, { windowMs, limit }) {
  const store = new MongoRateLimitStore({ prefix: `${prefix}:` });
  store.init({ windowMs });
  const { totalHits, resetTime } = await store.increment(key);
  return {
    allowed: totalHits <= limit,
    retryAfter: Math.max(1, Math.ceil(secondsUntil(resetTime))),
  };
}

import { OneTimeToken } from './auth.model.js';
import { hashToken, randomToken } from '../../lib/crypto.js';
import { clock } from '../../lib/time.js';

const lookupKey = (userId, code) => `${userId}:${code}`;

/**
 * Create a one-time token. By default it is a random link token (returned once, only its hash is
 * stored). For short numeric codes pass `code`: the hash then includes the user id, so two users
 * with the same code never clash on the unique index.
 */
export async function createToken({ userId, purpose, ttlMs, payload, code, rawToken, session }) {
  const raw = code ?? rawToken ?? randomToken();
  const token_hash = hashToken(code ? lookupKey(userId, code) : raw);
  await OneTimeToken.create(
    [
      {
        user_id: userId,
        purpose,
        token_hash,
        payload,
        expires_at: new Date(clock.now().getTime() + ttlMs),
      },
    ],
    { session },
  );
  return raw;
}

/** A new link or code cancels the ones before it. */
export async function cancelTokens(userId, purpose, { session } = {}) {
  await OneTimeToken.deleteMany({ user_id: userId, purpose, used_at: null }, { session });
}

/**
 * Use a token once. First use wins: the update only matches an unused, unexpired token, so a
 * second or concurrent use gets null. Pass `userId` when the token is a short code.
 */
export async function consumeToken({ token, purpose, userId, session }) {
  const token_hash = hashToken(userId ? lookupKey(userId, token) : token);
  const now = clock.now();
  return OneTimeToken.findOneAndUpdate(
    { token_hash, purpose, used_at: null, expires_at: { $gt: now } },
    { $set: { used_at: now } },
    { returnDocument: 'after', session },
  ).lean();
}

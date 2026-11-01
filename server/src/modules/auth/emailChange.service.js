import { User } from './auth.model.js';
import { assertProfileState } from './profile.service.js';
import { cancelTokens, consumeToken, createToken } from './tokens.service.js';
import { getConfig } from '../../config.js';
import { decrypt, emailHmac, encrypt } from '../../lib/crypto.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { AppError, rateLimited } from '../../lib/errors.js';
import { hit } from '../../lib/rateLimit.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';
import { isDomainAllowed } from '../organisation/index.js';
import { enqueue } from '../notifications/index.js';

const HOUR = 60 * 60 * 1000;
const CHANGE_TTL_MS = 24 * HOUR; // PRF-05

const taken = () => new AppError(409, 'CONFLICT', 'That email address is already in use.');

/**
 * PRF-05: ask for a new address. The link goes to the NEW address, and the old one stays in use
 * until it is used. A new request cancels the earlier link.
 */
export async function requestEmailChange(actor, newEmail) {
  assertProfileState(actor, 'profile.edit_own');
  const limit = await hit('email-change', String(actor._id), { windowMs: HOUR, limit: 3 });
  if (!limit.allowed) throw rateLimited(limit.retryAfter);

  if (!(await isDomainAllowed(newEmail.split('@')[1]))) {
    throw new AppError(400, 'EMAIL_DOMAIN_NOT_ALLOWED', 'Use your university email address.', {
      new_email: 'Use your university email address.',
    });
  }
  const hmac = emailHmac(newEmail);
  if (await User.exists({ email_hmac: hmac })) throw taken();

  const user = await User.findById(actor._id).select('full_name').lean();
  await withTransaction(async (session) => {
    await cancelTokens(actor._id, 'change_email', { session });
    const token = await createToken({
      userId: actor._id,
      purpose: 'change_email',
      ttlMs: CHANGE_TTL_MS,
      payload: { email_enc: encrypt(newEmail), email_hmac: hmac },
      session,
    });
    afterCommit(() =>
      enqueue({
        to_address: newEmail,
        template: 'email_change_confirm',
        data: {
          name: user.full_name,
          link: `${getConfig().APP_URL}/confirm-email?token=${token}`,
        },
      }),
    );
  });
}

/**
 * PRF-05, PRF-08: the link completes the change. First use wins (the token is consumed with a
 * conditional update) and the unique `email_hmac` index stops two accounts taking one address.
 * If the address was taken since, the whole transaction rolls back and the link stays unused.
 */
export async function confirmEmailChange(token) {
  try {
    await withTransaction(async (session) => {
      const used = await consumeToken({ token, purpose: 'change_email', session });
      if (!used) {
        throw new AppError(400, 'TOKEN_INVALID', 'This link has expired or was already used.');
      }
      const { email_enc, email_hmac } = used.payload;
      const user = await User.findById(used.user_id)
        .select('+email_enc full_name')
        .session(session);
      if (!user) {
        throw new AppError(400, 'TOKEN_INVALID', 'This link has expired or was already used.');
      }
      if (await User.exists({ email_hmac, _id: { $ne: user._id } }).session(session)) throw taken();

      const oldAddress = decrypt(user.email_enc);
      user.email_enc = email_enc;
      user.email_hmac = email_hmac;
      user.email_bouncing = false;
      user.email_verified_at = clock.now();
      await user.save({ session });
      await record({
        actor: { _id: user._id, roles: [] },
        action: 'user.email_change',
        target: { type: 'user', id: user._id },
        session,
      });
      afterCommit(() =>
        enqueue({
          to_address: oldAddress,
          template: 'email_changed_notice',
          data: { name: user.full_name },
        }),
      );
    });
  } catch (err) {
    if (err?.code === 11000) throw taken(); // the unique index beat the check above
    throw err;
  }
}

import crypto from 'node:crypto';
import { User } from './auth.model.js';
import { cancelTokens, consumeToken, createToken } from './tokens.service.js';
import { nextScreen } from './next.js';
import { clearAuth } from './sessions.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { AppError, rateLimited } from '../../lib/errors.js';
import { hit } from '../../lib/rateLimit.js';
import { clock } from '../../lib/time.js';
import { generateSecret, otpauthUrl, verifyTotp } from '../../lib/totp.js';
import { enqueue } from '../notifications/index.js';

const MAX_WRONG_CODES = 5; // AUTH-20
const CODE_TTL_MS = 10 * 60 * 1000; // AUTH-19
const ISSUER = 'BAIUST Class and Routine';

const adminUser = (req) => {
  if (!req.session?.secondStepPending) {
    throw new AppError(409, 'CONFLICT', 'There is no second step to complete.');
  }
};

const loadSecrets = (userId) => User.findById(userId).select('+totp_secret_enc +email_enc').lean();

/** AUTH-20: five wrong codes in a row end the half-signed-in session. */
function recordWrongCode(req) {
  req.session.secondStepFails = (req.session.secondStepFails ?? 0) + 1;
  if (req.session.secondStepFails >= MAX_WRONG_CODES) {
    clearAuth(req.session);
    return new AppError(401, 'UNAUTHENTICATED', 'Too many wrong codes. Sign in again.');
  }
  return new AppError(400, 'CODE_INVALID', 'That code is not valid.');
}

function passSecondStep(req) {
  req.session.secondStepPending = false;
  req.session.secondStepFails = 0;
}

/** AUTH-18: start authenticator setup (QR + manual key). Nothing is enabled until confirmed. */
export async function setupTotp(req) {
  adminUser(req);
  const user = await loadSecrets(req.user._id);
  if (user.totp_enabled_at) {
    throw new AppError(409, 'CONFLICT', 'The authenticator app is already set up.');
  }
  const secret = generateSecret();
  await User.updateOne({ _id: user._id }, { $set: { totp_secret_enc: encrypt(secret) } });
  return {
    otpauth_url: otpauthUrl({ secret, account: decrypt(user.email_enc), issuer: ISSUER }),
    secret,
  };
}

/** AUTH-18: confirm the setup with a valid code, then the admin is signed in. */
export async function confirmTotp(req, code) {
  adminUser(req);
  const user = await loadSecrets(req.user._id);
  if (user.totp_enabled_at || !user.totp_secret_enc) {
    throw new AppError(409, 'CONFLICT', 'Start the authenticator setup first.');
  }
  if (!verifyTotp(decrypt(user.totp_secret_enc), code, clock.now())) throw recordWrongCode(req);
  await User.updateOne(
    { _id: user._id, totp_enabled_at: { $exists: false } },
    { $set: { totp_enabled_at: clock.now() } },
  );
  passSecondStep(req);
  return { next: await nextScreen({ user: req.user }) };
}

/** AUTH-18, AUTH-19: an authenticator code, or the code that was emailed (works once, 10 min). */
export async function verifySecondStep(req, code) {
  adminUser(req);
  const user = await loadSecrets(req.user._id);
  if (!user.totp_enabled_at) {
    throw new AppError(409, 'CONFLICT', 'Set up the authenticator app first.');
  }
  const totpOk = verifyTotp(decrypt(user.totp_secret_enc), code, clock.now());
  const emailed = totpOk
    ? null
    : await consumeToken({ token: code, purpose: 'second_step', userId: user._id });
  if (!totpOk && !emailed) throw recordWrongCode(req);
  passSecondStep(req);
  return { next: await nextScreen({ user: req.user }) };
}

/** AUTH-19: "email me a code". At most 3 per 15 minutes; a new code cancels the old ones. */
export async function sendEmailCode(req) {
  adminUser(req);
  const user = await User.findById(req.user._id).select('totp_enabled_at full_name').lean();
  if (!user.totp_enabled_at) {
    throw new AppError(409, 'CONFLICT', 'Set up the authenticator app first.');
  }
  const limit = await hit('second-step-email', String(user._id), {
    windowMs: 15 * 60 * 1000,
    limit: 3,
  });
  if (!limit.allowed) throw rateLimited(limit.retryAfter);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await withTransaction(async (session) => {
    await cancelTokens(user._id, 'second_step', { session });
    await createToken({
      userId: user._id,
      purpose: 'second_step',
      ttlMs: CODE_TTL_MS,
      code,
      session,
    });
    afterCommit(() =>
      enqueue({
        to_user_id: user._id,
        template: 'second_step_code',
        data: { name: user.full_name, code },
      }),
    );
  });
}

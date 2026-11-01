import { User, UserRole } from './auth.model.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password.js';
import { cancelTokens, consumeToken, createToken } from './tokens.service.js';
import { verifyCaptcha } from './captcha.service.js';
import {
  accountKey,
  checkThrottle,
  claimOwnerAlert,
  clearAccount,
  ipKey,
  recordFailure,
} from './throttle.service.js';
import { nextScreen } from './next.js';
import { endAllSessions, isAdmin } from './sessions.js';
import { can } from '../../policy/index.js';
import { getConfig } from '../../config.js';
import { decrypt, emailHmac, encrypt, randomToken } from '../../lib/crypto.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { AppError, rateLimited } from '../../lib/errors.js';
import { hit } from '../../lib/rateLimit.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';
import { addAllowedDomain, isActiveDepartment, isDomainAllowed } from '../organisation/index.js';
import { enqueue } from '../notifications/index.js';
import { ALLOWED_EMAIL_DOMAIN } from '@crm/shared/enums';

const HOUR = 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * HOUR; // AUTH-07
const RESET_TTL_MS = HOUR; // AUTH-25

const link = (path, token) => `${getConfig().APP_URL}${path}?token=${token}`;

/** FND-16: the per-request user object. Returns null if the user can't be loaded. */
export async function loadRequestUser(userId) {
  const user = await User.findById(userId).lean();
  if (!user) return null;
  const roles = await UserRole.find({ user_id: user._id, ended_at: null }).lean();
  return {
    _id: user._id,
    kind: user.kind,
    state: user.state,
    chat_suspended_until: user.chat_suspended_until ?? null,
    roles: roles.map(({ role, department_id, section_id, semester_id }) => ({
      role,
      ...(department_id && { department_id }),
      ...(section_id && { section_id }),
      ...(semester_id && { semester_id }),
    })),
  };
}

/** The address for a user, for the mail queue only. Never put it in a response. */
export async function getEmailAddress(userId) {
  const user = await User.findById(userId).select('+email_enc').lean();
  return user?.email_enc ? decrypt(user.email_enc) : null;
}

/** AUTH-03, AUTH-29: only what the owner's own screens need. No email, phone or hashes. */
export function toPublicUser(user) {
  return {
    id: String(user._id),
    full_name: user.full_name,
    kind: user.kind,
    state: user.state,
    email_verified: Boolean(user.email_verified_at),
    email_bouncing: Boolean(user.email_bouncing),
  };
}

// ---------------------------------------------------------------------------------------------
// Sign-up and verification
// ---------------------------------------------------------------------------------------------

async function sendAlreadyRegistered(email, hmac) {
  const existing = await User.findOne({ email_hmac: hmac }).select('full_name').lean();
  await enqueue({
    to_address: email,
    template: 'already_registered',
    data: {
      name: existing?.full_name ?? '',
      signin_link: `${getConfig().APP_URL}/login`,
      reset_link: `${getConfig().APP_URL}/forgot-password`,
    },
  });
}

/**
 * AUTH-04 to AUTH-08. The answer is the same whether or not the address already has an account;
 * an existing address gets an "you already have an account" email instead of a second account.
 */
export async function signUp(input) {
  const { kind, full_name, email, password } = input;
  const domain = email.split('@')[1];
  if (!(await isDomainAllowed(domain))) {
    throw new AppError(400, 'EMAIL_DOMAIN_NOT_ALLOWED', 'Use your university email address.', {
      email: 'Use your university email address.',
    });
  }
  if (kind === 'teacher' && !(await isActiveDepartment(input.department_id))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      department_id: 'Choose a department from the list.',
    });
  }

  const hmac = emailHmac(email);
  // Hash first on every path, so a new and an existing address take about the same time.
  const password_hash = await hashPassword(password);
  if (await User.exists({ email_hmac: hmac })) return sendAlreadyRegistered(email, hmac);

  try {
    await withTransaction(async (session) => {
      const [user] = await User.create(
        [
          {
            kind,
            state: 'email_unverified',
            full_name,
            email_enc: encrypt(email),
            email_hmac: hmac,
            password_hash,
            password_changed_at: clock.now(),
            ...(kind === 'teacher' && {
              department_id: input.department_id,
              requested_short_code: input.short_code,
            }),
          },
        ],
        { session },
      );
      const token = await createToken({
        userId: user._id,
        purpose: 'verify_email',
        ttlMs: VERIFY_TTL_MS,
        session,
      });
      afterCommit(() =>
        enqueue({
          to_address: email,
          template: 'verify_email',
          data: { name: full_name, link: link('/verify', token) },
        }),
      );
    });
  } catch (err) {
    // Two sign-ups for one address at once: the unique email_hmac index lets only one win.
    if (err.code !== 11000) throw err;
    await sendAlreadyRegistered(email, hmac);
  }
}

/** AUTH-10: a valid link verifies the address and moves the account on. */
export async function verifyEmail(token) {
  return withTransaction(async (session) => {
    const used = await consumeToken({ token, purpose: 'verify_email', session });
    if (!used)
      throw new AppError(400, 'TOKEN_INVALID', 'This link has expired or was already used.');
    const user = await User.findById(used.user_id).session(session);
    if (user.state === 'email_unverified') {
      user.state = user.kind === 'teacher' ? 'pending' : 'claim_pending';
      user.email_verified_at = clock.now();
      await user.save({ session });
    }
    return { next: await nextScreen({ user }) };
  });
}

/** AUTH-11: 3 per hour per address; each new link cancels the old ones. Always the same answer. */
export async function resendVerification(email) {
  const hmac = emailHmac(email);
  const limit = await hit('verify-resend', hmac, { windowMs: HOUR, limit: 3 });
  if (!limit.allowed) throw rateLimited(limit.retryAfter);
  const user = await User.findOne({ email_hmac: hmac, state: 'email_unverified' })
    .select('full_name')
    .lean();
  if (!user) return;
  await withTransaction(async (session) => {
    await cancelTokens(user._id, 'verify_email', { session });
    const token = await createToken({
      userId: user._id,
      purpose: 'verify_email',
      ttlMs: VERIFY_TTL_MS,
      session,
    });
    afterCommit(() =>
      enqueue({
        to_address: email,
        template: 'verify_email',
        data: { name: user.full_name, link: link('/verify', token) },
      }),
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------------------------

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is not correct.');

/**
 * AUTH-12 to AUTH-16. Returns the user and what the session needs; the controller then starts
 * the session (regenerating its id).
 */
export async function logIn({ email, password, captcha }, { ip }) {
  const hmac = emailHmac(email);
  const keys = [accountKey(hmac), ipKey(ip)];

  const { waitMs, captchaRequired } = await checkThrottle(keys);
  if (waitMs > 0) throw rateLimited(waitMs / 1000, 'Too many tries. Wait a moment and try again.');
  if (captchaRequired && !(await verifyCaptcha(captcha))) {
    throw new AppError(403, 'CAPTCHA_REQUIRED', 'Complete the check to continue.');
  }

  const user = await User.findOne({ email_hmac: hmac }).select('+password_hash').lean();
  const passwordOk = user?.password_hash
    ? await verifyPassword(user.password_hash, password)
    : await verifyAgainstDummy(password);

  if (!passwordOk) {
    await Promise.all(keys.map(recordFailure));
    if (user && (await claimOwnerAlert(hmac))) {
      await enqueue({
        to_user_id: user._id,
        template: 'failed_logins',
        data: { name: user.full_name, reset_link: `${getConfig().APP_URL}/forgot-password` },
      });
    }
    throw invalidCredentials();
  }
  if (['deactivated', 'suspended'].includes(user.state)) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account cannot sign in.');
  }
  await clearAccount(hmac);

  const requestUser = await loadRequestUser(user._id);
  const secondStepPending = isAdmin(requestUser);
  const totpEnabled = Boolean(user.totp_enabled_at);
  return {
    requestUser,
    secondStepPending,
    next: await nextScreen({ user: requestUser, totpEnabled, secondStepPending }),
  };
}

// ---------------------------------------------------------------------------------------------
// Recovery and password change
// ---------------------------------------------------------------------------------------------

/** AUTH-25: always the same answer, whether or not the address has an account. */
export async function requestPasswordReset(email) {
  const hmac = emailHmac(email);
  const limit = await hit('reset-request', hmac, { windowMs: HOUR, limit: 3 });
  if (!limit.allowed) throw rateLimited(limit.retryAfter);
  const user = await User.findOne({
    email_hmac: hmac,
    state: { $nin: ['deactivated', 'suspended'] },
  })
    .select('full_name')
    .lean();
  if (!user) return;
  await withTransaction(async (session) => {
    await cancelTokens(user._id, 'reset_password', { session });
    const token = await createToken({
      userId: user._id,
      purpose: 'reset_password',
      ttlMs: RESET_TTL_MS,
      session,
    });
    afterCommit(() =>
      enqueue({
        to_address: email,
        template: 'reset_password',
        data: { name: user.full_name, link: link('/reset-password', token) },
      }),
    );
  });
}

/** AUTH-26: new hash, every session of the account ends, the owner is told. */
export async function confirmPasswordReset({ token, password }) {
  const password_hash = await hashPassword(password);
  const userId = await withTransaction(async (session) => {
    const used = await consumeToken({ token, purpose: 'reset_password', session });
    if (!used)
      throw new AppError(400, 'TOKEN_INVALID', 'This link has expired or was already used.');
    await User.updateOne(
      { _id: used.user_id },
      { $set: { password_hash, password_changed_at: clock.now() } },
      { session },
    );
    await cancelTokens(used.user_id, 'reset_password', { session });
    return used.user_id;
  });
  await endAllSessions(userId);
  await sendPasswordChanged(userId);
}

async function sendPasswordChanged(userId) {
  const user = await User.findById(userId).select('full_name').lean();
  await enqueue({
    to_user_id: userId,
    template: 'password_changed',
    data: { name: user?.full_name ?? '', reset_link: `${getConfig().APP_URL}/forgot-password` },
  });
}

/** AUTH-27: needs the current password; every other session of the account ends (AUTH-23). */
export async function changePassword(actor, sessionId, { current_password, new_password }) {
  if (!can(actor, 'account.change_password')) {
    throw new AppError(403, 'STATE_NOT_ALLOWED', 'This account cannot change its password yet.', {
      state: actor.state,
    });
  }
  const user = await User.findById(actor._id).select('+password_hash').lean();
  if (!user?.password_hash || !(await verifyPassword(user.password_hash, current_password))) {
    throw invalidCredentials();
  }
  await User.updateOne(
    { _id: actor._id },
    { $set: { password_hash: await hashPassword(new_password), password_changed_at: clock.now() } },
  );
  await endAllSessions(actor._id, { exceptSid: sessionId });
  await sendPasswordChanged(actor._id);
}

// ---------------------------------------------------------------------------------------------
// /me
// ---------------------------------------------------------------------------------------------

/** AUTH-29 */
export async function getMe(actor, session) {
  const user = await User.findById(actor._id).lean();
  const secondStepPending = Boolean(session?.secondStepPending);
  return {
    user: toPublicUser(user),
    roles: actor.roles,
    // PRF-06: the client shows a banner at every sign-in until the email is changed.
    email_action_required: Boolean(user.email_bouncing),
    next: await nextScreen({
      user: actor,
      totpEnabled: Boolean(user.totp_enabled_at),
      secondStepPending,
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------

/** FND-36: create the first super admin. Refuses if one already exists. */
export async function seedSuperAdmin({ email, name, appUrl }) {
  return withTransaction(async (session) => {
    if (await UserRole.exists({ role: 'super_admin', ended_at: null }).session(session)) {
      throw new AppError(409, 'CONFLICT', 'A super admin already exists.');
    }
    const token = randomToken();
    const [user] = await User.create(
      [
        {
          kind: 'staff',
          state: 'active',
          full_name: name,
          email_enc: encrypt(email.trim()),
          email_hmac: emailHmac(email),
          email_verified_at: clock.now(),
        },
      ],
      { session },
    );
    await createToken({
      userId: user._id,
      purpose: 'reset_password',
      ttlMs: 24 * HOUR,
      rawToken: token,
      session,
    });
    await UserRole.create([{ user_id: user._id, role: 'super_admin', granted_at: clock.now() }], {
      session,
    });
    await addAllowedDomain(ALLOWED_EMAIL_DOMAIN, { session });
    await record({
      actor: { _id: user._id, roles: [{ role: 'super_admin' }] },
      action: 'super_admin.create',
      target: { type: 'user', id: user._id },
      new_value: { name },
      session,
    });
    return { userId: user._id, resetLink: `${appUrl}/reset-password?token=${token}` };
  });
}

import { User, UserRole } from './auth.model.js';
import { decrypt, encrypt, emailHmac, hashToken, randomToken } from '../../lib/crypto.js';
import { withTransaction } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';
import { addAllowedDomain } from '../organisation/index.js';
import { ALLOWED_EMAIL_DOMAIN } from '@crm/shared/enums';

/** FND-16: the per-request user object. Returns null if the user can't be loaded. */
export async function loadRequestUser(userId) {
  const user = await User.findById(userId).lean();
  if (!user) return null;
  const roles = await UserRole.find({ user_id: user._id }).lean();
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

/** FND-36: create the first super admin. Refuses if one already exists. */
export async function seedSuperAdmin({ email, name, appUrl }) {
  return withTransaction(async (session) => {
    if (await UserRole.exists({ role: 'super_admin' }).session(session)) {
      throw new AppError(409, 'CONFLICT', 'A super admin already exists.');
    }
    const token = randomToken();
    const [user] = await User.create(
      [
        {
          kind: 'staff',
          state: 'active',
          name,
          email_enc: encrypt(email.trim()),
          email_hmac: emailHmac(email),
          email_verified_at: clock.now(),
          reset_token_hash: hashToken(token),
          reset_token_expires: new Date(clock.now().getTime() + 24 * 60 * 60 * 1000),
        },
      ],
      { session },
    );
    await UserRole.create([{ user_id: user._id, role: 'super_admin' }], { session });
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

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User, UserRole } from '../src/modules/auth/auth.model.js';
import { loadRequestUser } from '../src/modules/auth/auth.service.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { encrypt, emailHmac } from '../src/lib/crypto.js';
import { generateSecret } from '../src/lib/totp.js';

const rand = () => crypto.randomBytes(4).toString('hex');
export const makeId = () => new mongoose.Types.ObjectId();

/** A password that passes the rules, for tests that sign in with the real route. */
export const TEST_PASSWORD = 'correct-horse-1';

/**
 * Departments, semesters and sections have no collections yet (specs 03, 04, 09 add them and
 * their real factories). Until then a department is just an id and a code, not saved.
 */
export const makeDepartment = (overrides = {}) => ({
  _id: makeId(),
  code: `D${rand()}`.toUpperCase(),
  ...overrides,
});

/**
 * Create a user with roles. Returns the request-user shape plus `email` for tests.
 * Pass `password` to be able to sign in with it. Pass `totp: true` to turn the authenticator on;
 * the secret is then returned as `totpSecret`.
 */
export async function makeUser({
  kind = 'student',
  state = 'active',
  roles = [],
  name = 'Test User',
  email = `u${rand()}@baiust.ac.bd`,
  password,
  totp = false,
  phone,
  departmentId,
} = {}) {
  const totpSecret = totp ? generateSecret() : undefined;
  const user = await User.create({
    kind,
    state,
    full_name: name,
    email_enc: encrypt(email),
    email_hmac: emailHmac(email),
    email_verified_at: state === 'email_unverified' ? undefined : new Date(),
    ...(phone && { phone_enc: encrypt(phone) }),
    ...(departmentId && { department_id: departmentId }),
    ...(password && { password_hash: await hashPassword(password) }),
    ...(totp && { totp_secret_enc: encrypt(totpSecret), totp_enabled_at: new Date() }),
  });
  if (roles.length) await UserRole.create(roles.map((r) => ({ ...r, user_id: user._id })));
  const requestUser = { ...(await loadRequestUser(user._id)), email };
  if (totp) Object.defineProperty(requestUser, 'totpSecret', { value: totpSecret });
  return requestUser;
}

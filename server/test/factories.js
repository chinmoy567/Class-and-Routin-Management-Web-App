import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User, UserRole } from '../src/modules/auth/auth.model.js';
import { loadRequestUser } from '../src/modules/auth/auth.service.js';
import { encrypt, emailHmac } from '../src/lib/crypto.js';

const rand = () => crypto.randomBytes(4).toString('hex');
export const makeId = () => new mongoose.Types.ObjectId();

/**
 * Departments, semesters and sections have no collections yet (specs 03, 04, 09 add them and
 * their real factories). Until then a department is just an id and a code, not saved.
 */
export const makeDepartment = (overrides = {}) => ({
  _id: makeId(),
  code: `D${rand()}`.toUpperCase(),
  ...overrides,
});

/** Create a user with roles. Returns the request-user shape plus `email` for tests. */
export async function makeUser({
  kind = 'student',
  state = 'active',
  roles = [],
  name = 'Test User',
  email = `u${rand()}@baiust.ac.bd`,
} = {}) {
  const user = await User.create({
    kind,
    state,
    name,
    email_enc: encrypt(email),
    email_hmac: emailHmac(email),
    email_verified_at: state === 'email_unverified' ? undefined : new Date(),
  });
  if (roles.length) await UserRole.create(roles.map((r) => ({ ...r, user_id: user._id })));
  return { ...(await loadRequestUser(user._id)), email };
}

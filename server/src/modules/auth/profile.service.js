import { User, UserRole } from './auth.model.js';
import { assertCan, can } from '../../policy/index.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { withTransaction } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { record } from '../audit/index.js';

// Spec spots filled by later specs: 10 (enrolment), 06 (teacher short code), 03/04/09 (names).
const extras = {
  student: async () => ({
    department_id: null,
    level: null,
    term: null,
    section: null,
    group: null,
    confirmed_semester: null,
  }),
  teacher: async (user) => ({
    department_id: user.department_id ?? null,
    short_code: null,
    linked: false,
  }),
};

/** Later specs plug in the real student block (spec 10) and teacher link (spec 06). */
export function registerProfileExtras({ student, teacher } = {}) {
  if (student) extras.student = student;
  if (teacher) extras.teacher = teacher;
}

const stateNotAllowed = (actor) =>
  new AppError(403, 'STATE_NOT_ALLOWED', 'This account cannot edit its profile yet.', {
    state: actor.state,
  });

export function assertProfileState(actor, action) {
  if (!can(actor, action)) throw stateNotAllowed(actor);
}

const photoUrl = (user) => (user.photo_file_id ? `/api/users/${user._id}/photo` : null);

function photoStatus(user) {
  if (user.pending_photo_file_id) return 'pending';
  if (user.photo_scan_failed_at) return 'rejected';
  return user.photo_file_id ? 'clean' : 'none';
}

/** The department this person belongs to, for scope checks (null when not known yet). */
export async function departmentOf(user) {
  if (user.kind === 'student') return (await extras.student(user)).department_id ?? null;
  return user.department_id ?? null;
}

const roleLabels = (user, roles) => {
  const labels = new Set();
  if (user.kind === 'student') labels.add('student');
  if (user.kind === 'teacher') labels.add('teacher');
  for (const r of roles) if (r.role === 'cr' || r.role === 'dcr') labels.add(r.role);
  return [...labels];
};

/** PRF-01: the owner's full profile. The only place email and phone are returned. */
export async function getOwnProfile(actor) {
  assertProfileState(actor, 'profile.view_own');
  const user = await User.findById(actor._id).select('+email_enc +phone_enc').lean();
  const roles = actor.roles.map((r) => ({ ...r, label: r.role }));
  return {
    id: String(user._id),
    full_name: user.full_name,
    email: user.email_enc ? decrypt(user.email_enc) : null,
    phone: user.phone_enc ? decrypt(user.phone_enc) : null,
    kind: user.kind,
    state: user.state,
    email_bouncing: Boolean(user.email_bouncing),
    photo: { url: photoUrl(user), status: photoStatus(user) },
    roles,
    ...(user.kind === 'student' && { student: await extras.student(user) }),
    ...(user.kind === 'teacher' && { teacher: await extras.teacher(user) }),
  };
}

/** PRF-03, PRF-08: the phone is stored encrypted and the audit entry holds no number. */
export async function updatePhone(actor, phone) {
  assertProfileState(actor, 'profile.edit_own');
  await withTransaction(async (session) => {
    await User.updateOne(
      { _id: actor._id },
      phone ? { $set: { phone_enc: encrypt(phone) } } : { $unset: { phone_enc: 1 } },
      { session },
    );
    await record({
      actor,
      action: 'user.phone_change',
      target: { type: 'user', id: actor._id },
      new_value: { has_phone: Boolean(phone) },
      session,
    });
  });
  return getOwnProfile(actor);
}

const VISIBLE_STATES = ['active', 'unconfirmed', 'graduated'];

/** PRF-07: the only fields anyone else may see. Never level, term, section, group, phone, email. */
export async function getPublicProfile(viewer, userId) {
  const user = await User.findById(userId).lean();
  if (!user) throw notFound();
  const department_id = await departmentOf(user);
  if (!can(viewer, 'profile.view_public', { department_id })) {
    throw new AppError(403, 'STATE_NOT_ALLOWED', 'This account cannot view profiles yet.', {
      state: viewer.state,
    });
  }
  // Hidden accounts look like they don't exist, except to the admins of that department.
  const admin = can(viewer, 'profile.rename', { department_id });
  if (!VISIBLE_STATES.includes(user.state) && !admin) throw notFound();
  const roles = await UserRole.find({ user_id: user._id, ended_at: null }).lean();
  return {
    id: String(user._id),
    full_name: user.full_name,
    photo_url: photoUrl(user),
    department_id: department_id ? String(department_id) : null,
    roles: roleLabels(user, roles),
  };
}

/** PRF-02, PRF-08: only an admin of the user's department changes a name. */
export async function renameUser(actor, userId, full_name) {
  const target = await User.findById(userId).lean();
  if (!target) throw notFound();
  const department_id = await departmentOf(target);
  assertCan(actor, 'profile.rename', { department_id });
  await withTransaction(async (session) => {
    await User.updateOne({ _id: target._id }, { $set: { full_name } }, { session });
    await record({
      actor,
      action: 'user.name_change',
      scope_department_id: department_id ?? undefined,
      target: { type: 'user', id: target._id },
      old_value: { full_name: target.full_name },
      new_value: { full_name },
      session,
    });
  });
  return { id: String(target._id), full_name };
}

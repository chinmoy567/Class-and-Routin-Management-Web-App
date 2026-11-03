import { hashPassword, generateTemporaryPassword } from './password.js';
// Spec 09: what other modules may ask about student accounts. Never returns email or phone.
import { User, UserRole } from './auth.model.js';
import { clock } from '../../lib/time.js';

const ELIGIBLE_STATES = ['claim_pending', 'active', 'unconfirmed'];
const photoUrl = (u) => (u.photo_file_id ? `/api/users/${u._id}/photo` : null);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);

/** CRD-01: is this a student with a verified email in a state that may become CR/DCR? */
export async function representativeCandidate(userId) {
  const u = await User.findById(userId).select('kind state email_verified_at full_name').lean();
  if (!u) return null;
  const eligible =
    u.kind === 'student' && Boolean(u.email_verified_at) && ELIGIBLE_STATES.includes(u.state);
  return { id: String(u._id), full_name: u.full_name, state: u.state, eligible };
}

/** CRD-04: the student becomes active (if waiting) and is stamped with the semester. */
export async function activateStudentForSemester(userId, semesterId, session, departmentId) {
  await User.updateOne(
    { _id: userId, state: { $in: ['claim_pending', 'unconfirmed'] } },
    { $set: { state: 'active' } },
    { session },
  );
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        confirmed_semester_id: semesterId,
        ...(departmentId && { department_id: departmentId }),
      },
    },
    { session },
  );
}

/** Name, photo and state for a list of users, keyed by id. */
export async function studentSummaries(userIds) {
  const rows = await User.find({ _id: { $in: userIds } })
    .select('full_name photo_file_id state')
    .lean();
  return new Map(
    rows.map((u) => [
      String(u._id),
      { id: String(u._id), full_name: u.full_name, photo_url: photoUrl(u), state: u.state },
    ]),
  );
}

/** CRD-01: eligible students whose name matches. Students without a department match any. */
export async function findEligibleStudents(q, departmentId, limit = 20) {
  const filter = {
    kind: 'student',
    state: { $in: ELIGIBLE_STATES },
    email_verified_at: { $exists: true },
    full_name: { $regex: escapeRegex(q), $options: 'i' },
  };
  if (departmentId) {
    filter.$or = [{ department_id: departmentId }, { department_id: { $exists: false } }];
  }
  const rows = await User.find(filter).select('full_name photo_file_id state').limit(limit).lean();
  return rows.map((u) => ({
    id: String(u._id),
    full_name: u.full_name,
    photo_url: photoUrl(u),
    uv_id: null, // spec 10 fills this from the approved UV ID claim
    state: u.state,
  }));
}

const BLOCK_AFTER = 5;
const BLOCK_MS = 24 * 60 * 60 * 1000;

/** Spec 10: what the join logic needs to know about the student. Never email or phone. */
export async function studentForJoin(userId, session) {
  const u = await User.findById(userId)
    .select('kind state full_name department_id claim_rejections confirmed_semester_id')
    .session(session ?? null)
    .lean();
  return u
    ? {
        id: String(u._id),
        kind: u.kind,
        state: u.state,
        full_name: u.full_name,
        department_id: u.department_id ? String(u.department_id) : null,
        blocked_until: u.claim_rejections?.blocked_until ?? null,
      }
    : null;
}

/** JR-08: when the student may claim again, or null. */
export async function claimBlockedUntil(userId) {
  const u = await User.findById(userId).select('claim_rejections').lean();
  const until = u?.claim_rejections?.blocked_until;
  return until && until > clock.now() ? until : null;
}

/** JR-08: count one rejected claim. The fifth starts a 24-hour block and the count starts again. */
export async function countClaimRejection(userId, session) {
  const now = clock.now();
  const u = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { 'claim_rejections.count': 1 } },
    { new: true, session },
  )
    .select('claim_rejections')
    .lean();
  if (u?.claim_rejections?.count >= BLOCK_AFTER) {
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          'claim_rejections.count': 0,
          'claim_rejections.blocked_until': new Date(now.getTime() + BLOCK_MS),
        },
      },
      { session },
    );
  }
}

/** JR-01: the name given on the first request. */
export const setStudentName = (userId, fullName, session) =>
  User.updateOne({ _id: userId }, { $set: { full_name: fullName } }, { session });

/** JR-19: a revoked claim sends the account back to waiting. */
export const sendStudentBackToWaiting = (userId, session) =>
  User.updateOne(
    { _id: userId, kind: 'student', state: { $in: ['active', 'unconfirmed'] } },
    { $set: { state: 'claim_pending' }, $unset: { confirmed_semester_id: '' } },
    { session },
  );

/** Admins who should hear about a claim problem: the department's admins, else the super admins. */
export async function departmentAdminIds(departmentId) {
  const dept = await UserRole.find({
    role: 'dept_admin',
    department_id: departmentId,
    ended_at: null,
  }).lean();
  const rows = dept.length
    ? dept
    : await UserRole.find({ role: 'super_admin', ended_at: null }).lean();
  return [...new Set(rows.map((r) => String(r.user_id)))];
}

/** ROL-07: every `active` student becomes `unconfirmed` in one write. Returns how many changed. */
export async function unconfirmActiveStudents(session) {
  const res = await User.updateMany(
    { kind: 'student', state: 'active' },
    { $set: { state: 'unconfirmed' } },
    { session },
  );
  return res.modifiedCount;
}

/** Spec 14: what the semester update screen needs about the student. Never email or phone. */
export async function studentForUpdate(userId) {
  const u = await User.findById(userId)
    .select('kind state full_name department_id confirmed_semester_id not_enrolled_semester_id')
    .lean();
  return u
    ? {
        id: String(u._id),
        state: u.state,
        confirmed_semester_id: u.confirmed_semester_id ? String(u.confirmed_semester_id) : null,
        not_enrolled_semester_id: u.not_enrolled_semester_id
          ? String(u.not_enrolled_semester_id)
          : null,
      }
    : null;
}

/** ROL-10: the student is not enrolled this semester. Matches only an unconfirmed student. */
export async function markNotEnrolled(userId, semesterId, session) {
  const res = await User.updateOne(
    { _id: userId, kind: 'student', state: 'unconfirmed' },
    { $set: { not_enrolled_semester_id: semesterId } },
    { session },
  );
  return res.matchedCount;
}

/** ROL-10: a join request clears the "not enrolled" choice. */
export const clearNotEnrolled = (userId, session) =>
  User.updateOne({ _id: userId }, { $unset: { not_enrolled_semester_id: '' } }, { session });

/** ROL-09: an unconfirmed student who finished the degree becomes graduated. Null if not unconfirmed. */
export async function graduateStudent(userId, session) {
  return User.findOneAndUpdate(
    { _id: userId, kind: 'student', state: 'unconfirmed' },
    { $set: { state: 'graduated', graduated_at: clock.now() } },
    { new: true, session },
  ).lean();
}

/** ROL-12, ROL-13: unconfirmed students, except those who chose "not enrolled" for this semester. */
export async function unconfirmedStudentIds(semesterId) {
  const rows = await User.find({
    kind: 'student',
    state: 'unconfirmed',
    not_enrolled_semester_id: { $ne: semesterId },
  })
    .select('_id')
    .lean();
  return rows.map((r) => String(r._id));
}

/**
 * CRD-DSH-04: state, name, photo and "not enrolled this semester" for the given students, keyed by
 * id. Never email or phone.
 */
export async function studentCandidates(userIds, semesterId) {
  const rows = await User.find({ _id: { $in: userIds }, kind: 'student' })
    .select('full_name photo_file_id state not_enrolled_semester_id')
    .lean();
  return new Map(
    rows.map((u) => [
      String(u._id),
      {
        id: String(u._id),
        full_name: u.full_name,
        photo_url: photoUrl(u),
        state: u.state,
        not_enrolled: String(u.not_enrolled_semester_id ?? '') === String(semesterId),
      },
    ]),
  );
}

// ---------------------------------------------------------------------------------------------
// Spec 18: the student management screens. Nothing here returns an email address or a phone.
// ---------------------------------------------------------------------------------------------

/** ADM-12: ids of students whose name contains `q` (case-insensitive). */
export async function studentIdsByName(q, limit = 50) {
  const rows = await User.find({
    kind: 'student',
    full_name: { $regex: escapeRegex(q), $options: 'i' },
  })
    .select('_id')
    .limit(limit)
    .lean();
  return rows.map((r) => String(r._id));
}

/** ADM-12, ADM-13: ids of students whose department is one of `departmentIds`. */
export async function studentIdsOfDepartments(departmentIds) {
  const rows = await User.find({ kind: 'student', department_id: { $in: departmentIds } })
    .select('_id')
    .lean();
  return rows.map((r) => String(r._id));
}

/** The email status shown to admins: whether the address is verified or bouncing. Never the address. */
export const emailStatusOf = (u) =>
  u.email_bouncing ? 'bouncing' : u.email_verified_at ? 'verified' : 'unverified';

/** ADM-12: name, photo, state and email status for the given students. */
export async function studentAdminRows(userIds) {
  const rows = await User.find({ _id: { $in: userIds }, kind: 'student' })
    .select('full_name photo_file_id state department_id email_verified_at email_bouncing')
    .sort({ full_name: 1 })
    .lean();
  return rows.map((u) => ({
    id: String(u._id),
    full_name: u.full_name,
    photo_url: photoUrl(u),
    state: u.state,
    email_status: emailStatusOf(u),
    department_id: u.department_id ? String(u.department_id) : null,
    must_change_password: Boolean(u.must_change_password),
  }));
}

/** ADM-13..ADM-15: what an admin action needs to know about one student. */
export async function studentForAdmin(userId, session) {
  const u = await User.findById(userId)
    .select(
      'kind state full_name department_id state_before_deactivation must_change_password email_verified_at',
    )
    .session(session ?? null)
    .lean();
  if (!u || u.kind !== 'student') return null;
  return {
    id: String(u._id),
    state: u.state,
    full_name: u.full_name,
    department_id: u.department_id ? String(u.department_id) : null,
    state_before_deactivation: u.state_before_deactivation ?? null,
    must_change_password: Boolean(u.must_change_password),
  };
}

/**
 * First action wins (mongo-patterns): the state moves only while it is still one of `from`. Returns
 * the document as it was before the change, or null when the state had already moved on.
 */
export function transitionStudentState(userId, { from, to, set = {}, unset = {} }, session) {
  return User.findOneAndUpdate(
    { _id: userId, kind: 'student', state: { $in: from } },
    { $set: { ...set, state: to }, ...(Object.keys(unset).length && { $unset: unset }) },
    { new: false, session, projection: { state: 1, state_before_deactivation: 1 } },
  ).lean();
}

/** ADM-13: remember the state a deactivated account had, so reactivation can restore it. */
export const setStateBeforeDeactivation = (userId, state, session) =>
  User.updateOne({ _id: userId }, { $set: { state_before_deactivation: state } }, { session });

/**
 * ADM-15: a new temporary password. Only the argon2id hash is stored. The clear password is returned
 * once, to the caller, and never written anywhere else.
 */
export async function issueTemporaryPassword(userId, session) {
  const password = generateTemporaryPassword();
  const res = await User.updateOne(
    { _id: userId, kind: 'student', state: { $ne: 'deactivated' } },
    {
      $set: {
        password_hash: await hashPassword(password),
        password_changed_at: clock.now(),
        must_change_password: true,
      },
    },
    { session },
  );
  return res.matchedCount ? password : null;
}

// ADM-19: the names of the people in audit entries. Never an email or a phone.
export async function userNames(userIds) {
  const rows = await User.find({ _id: { $in: userIds } })
    .select('full_name')
    .lean();
  return new Map(rows.map((u) => [String(u._id), u.full_name]));
}

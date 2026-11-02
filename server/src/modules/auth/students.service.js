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

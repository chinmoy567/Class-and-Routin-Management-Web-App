import { Enrolment } from './enrolment.model.js';
import { UvClaim } from './uvclaim.model.js';
import { clock } from '../../lib/time.js';

/** The student's accepted enrolment in a semester, or null. */
export const acceptedEnrolmentOf = (userId, semesterId, session) =>
  Enrolment.findOne({ user_id: userId, semester_id: semesterId, status: 'accepted' })
    .session(session ?? null)
    .lean();

/** CRD-04: withdraw the student's pending request, wherever it is. */
export async function withdrawPendingForUser(userId, session) {
  const res = await Enrolment.updateMany(
    { user_id: userId, status: 'pending' },
    { $set: { status: 'withdrawn', decided_at: clock.now() } },
    { session },
  );
  return res.modifiedCount;
}

/** CRD-04: an accepted enrolment with no group, decided by the admin who made the assignment. */
export async function createAcceptedForRepresentative(
  { userId, semesterId, sectionId, decidedBy },
  session,
) {
  const [row] = await Enrolment.create(
    [
      {
        user_id: userId,
        semester_id: semesterId,
        section_id: sectionId,
        status: 'accepted',
        decided_by: decidedBy,
        decided_at: clock.now(),
      },
    ],
    { session },
  );
  return row;
}

/** CRD-08: mark the section's pending requests as escalated to the admin queue (once). */
export async function escalatePendingOfSection(sectionId, session) {
  const res = await Enrolment.updateMany(
    { section_id: sectionId, status: 'pending', escalated_at: { $exists: false } },
    { $set: { escalated_at: clock.now() } },
    { session },
  );
  return res.modifiedCount;
}

/** EDT-07: a group with a pending or accepted enrolment cannot be removed. */
export const groupInUse = async (groupId) =>
  Boolean(await Enrolment.exists({ group_id: groupId, status: { $in: ['pending', 'accepted'] } }));

/**
 * ROL-04, D2: at rollover the old semester's pending requests are withdrawn, so the student can
 * send a new one (a pending request blocks another). Undecided UV claims go with them.
 */
export async function withdrawPendingOfSemester(semesterId, session) {
  const pending = await Enrolment.find({ semester_id: semesterId, status: 'pending' })
    .select('_id uv_claim_id')
    .session(session)
    .lean();
  if (!pending.length) return 0;
  const claimIds = pending.map((p) => p.uv_claim_id).filter(Boolean);
  if (claimIds.length) {
    await UvClaim.deleteMany({ _id: { $in: claimIds }, status: 'pending' }, { session });
  }
  const res = await Enrolment.updateMany(
    { _id: { $in: pending.map((p) => p._id) }, status: 'pending' },
    { $set: { status: 'withdrawn', decided_at: clock.now() } },
    { session },
  );
  return res.modifiedCount;
}

/** EML-08: escalated join requests still waiting, in scope (counts only), for the admin digest. */
export async function countEscalatedPending({ departmentIds }) {
  const filter = { status: 'pending', escalated_at: { $exists: true } };
  if (departmentIds) filter.department_id = { $in: departmentIds };
  return Enrolment.countDocuments(filter);
}

/** DSH-13: the accepted enrolments of one section in one semester (students of that section). */
export const listAcceptedOfSection = (sectionId, semesterId) =>
  Enrolment.find({ section_id: sectionId, semester_id: semesterId, status: 'accepted' }).lean();

/** DSH-07, DSH-13: the number of accepted students per section, keyed by section id string. */
export async function countAcceptedBySection(sectionIds, semesterId) {
  const rows = await Enrolment.find({
    section_id: { $in: sectionIds },
    semester_id: semesterId,
    status: 'accepted',
  })
    .select('section_id')
    .lean();
  const counts = new Map();
  for (const r of rows)
    counts.set(String(r.section_id), (counts.get(String(r.section_id)) ?? 0) + 1);
  return counts;
}

/** DSH-13: each user's approved UV ID (text form), keyed by user id string. */
export async function approvedUvIds(userIds) {
  const rows = await UvClaim.find({ user_id: { $in: userIds }, status: 'approved' })
    .select('user_id uv_id_text')
    .lean();
  return new Map(rows.map((r) => [String(r.user_id), r.uv_id_text]));
}

/** CRD-DSH-04, CRD-DSH-09: a section's enrolments of one status in one semester, oldest first. */
export const enrolmentsOfSection = (sectionId, semesterId, status) =>
  Enrolment.find({ section_id: sectionId, semester_id: semesterId, status })
    .sort({ created_at: 1 })
    .lean();

/** CRD-DSH-04: the given users who already have an accepted enrolment this semester (any section). */
export async function acceptedUserIdsOf(userIds, semesterId) {
  const rows = await Enrolment.find({
    user_id: { $in: userIds },
    semester_id: semesterId,
    status: 'accepted',
  })
    .select('user_id')
    .lean();
  return new Set(rows.map((r) => String(r.user_id)));
}

import { Enrolment } from './enrolment.model.js';
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
 * send a new one (a pending request blocks another).
 */
export async function withdrawPendingOfSemester(semesterId, session) {
  const res = await Enrolment.updateMany(
    { semester_id: semesterId, status: 'pending' },
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

// ---------------------------------------------------------------------------------------------
// Spec 18: read-only lookups for the admin student screens. Nothing here returns contact details.
// ---------------------------------------------------------------------------------------------

/** ADM-12: students with any enrolment (request or membership) in one of the departments. */
export async function enrolledUserIdsOfDepartments(departmentIds) {
  const ids = await Enrolment.distinct('user_id', { department_id: { $in: departmentIds } });
  return ids.map(String);
}

/**
 * ADM-12, ADM-16: the student's enrolment for a semester, keyed by user id. An accepted enrolment
 * wins over a pending request.
 */
export async function currentEnrolmentsOf(userIds, semesterId) {
  const rows = await Enrolment.find({
    user_id: { $in: userIds },
    semester_id: semesterId,
    status: { $in: ['accepted', 'pending'] },
  })
    .select('user_id section_id group_id status department_id')
    .lean();
  const byUser = new Map();
  for (const r of rows) {
    const key = String(r.user_id);
    const seen = byUser.get(key);
    if (!seen || (r.status === 'accepted' && seen.status !== 'accepted')) byUser.set(key, r);
  }
  return byUser;
}

// ADM-13: the department a student belongs to, from their latest enrolment, when the account has none.
export async function departmentOfStudent(userId) {
  const row = await Enrolment.findOne({ user_id: userId, department_id: { $exists: true } })
    .sort({ created_at: -1 })
    .select('department_id')
    .lean();
  return row?.department_id ? String(row.department_id) : null;
}

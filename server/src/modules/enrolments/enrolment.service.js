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


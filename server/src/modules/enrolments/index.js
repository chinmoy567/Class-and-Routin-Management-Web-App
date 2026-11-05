import { registerDigestProvider } from '../notifications/index.js';
import { registerCalendarAudienceProvider } from '../calendar/index.js';
import { currentSemester } from '../organisation/index.js';
import { Enrolment } from './enrolment.model.js';
import { countEscalatedPending } from './enrolment.service.js';
export {
  acceptedEnrolmentOf,
  withdrawPendingForUser,
  createAcceptedForRepresentative,
  escalatePendingOfSection,
  withdrawPendingOfSemester,
  listAcceptedOfSection,
  countAcceptedBySection,
  enrolmentsOfSection,
  acceptedUserIdsOf,
  enrolledUserIdsOfDepartments,
  currentEnrolmentsOf,
  departmentOfStudent,
} from './enrolment.service.js';
export { Enrolment } from './enrolment.model.js';
export { groupInUse } from './enrolment.service.js';

// EML-08: escalated join requests (the CR or DCR did not decide in time), for the admin digest.
registerDigestProvider({
  key: 'escalated_join_requests',
  labelKey: 'digest.escalated_join_requests',
  count: countEscalatedPending,
});

/**
 * CAL-11: the students of these sections who have an accepted enrolment this semester. They are
 * emailed when a class is cancelled or restored.
 */
export async function acceptedStudentUserIdsOfSections(sectionIds) {
  const semester = await currentSemester();
  if (!semester) return [];
  const rows = await Enrolment.find({
    section_id: { $in: sectionIds },
    semester_id: semester.id,
    status: 'accepted',
  })
    .select('user_id')
    .lean();
  return rows.map((r) => String(r.user_id));
}
registerCalendarAudienceProvider(acceptedStudentUserIdsOfSections);

/** BKG-16: the students of one group of a section with an accepted enrolment this semester. */
export async function acceptedStudentUserIdsOfGroup(sectionId, groupId) {
  const semester = await currentSemester();
  if (!semester) return [];
  const rows = await Enrolment.find({
    section_id: sectionId,
    group_id: groupId,
    semester_id: semester.id,
    status: 'accepted',
  })
    .select('user_id')
    .lean();
  return rows.map((r) => String(r.user_id));
}

/** CHT-01: the student's open join request (pending), or null. Used for the claim_pending chat rule. */
export async function pendingEnrolmentOf(userId) {
  return Enrolment.findOne({ user_id: userId, status: 'pending' }).select('section_id').lean();
}

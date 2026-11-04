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
  approvedUvIds,
  enrolmentsOfSection,
  acceptedUserIdsOf,
  enrolledUserIdsOfDepartments,
  userIdsByUvId,
  currentEnrolmentsOf,
  approvedClaimsOf,
  departmentOfStudent,
} from './enrolment.service.js';
export { Enrolment } from './enrolment.model.js';
export { UvClaim } from './uvclaim.model.js';
export { groupInUse } from './enrolment.service.js';

// EML-08: escalated ID claims (join requests the CR or DCR could not handle), for the admin digest.
registerDigestProvider({
  key: 'escalated_id_claims',
  labelKey: 'digest.escalated_id_claims',
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

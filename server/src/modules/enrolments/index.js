import { registerDigestProvider } from '../notifications/index.js';
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

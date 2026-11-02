import { registerPolicies } from '../../policy/index.js';
import { representativesPolicy } from './representatives.policy.js';
import { registerRepresentativeProvider } from '../auth/index.js';
import { ownRepresentativeRole } from './query.service.js';

registerPolicies(representativesPolicy);
registerRepresentativeProvider(ownRepresentativeRole); // CRD-09

export { representativesRouter } from './representatives.routes.js';
export { isOpen, crDcrOf } from './query.service.js';
export { endRolesOfSemester } from './remove.service.js';
export { registerCrAssignedHook, resetCrAssignedHooks } from './hooks.js';

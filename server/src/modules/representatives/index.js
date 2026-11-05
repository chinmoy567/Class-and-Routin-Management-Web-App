import { registerPolicies } from '../../policy/index.js';
import { representativesPolicy } from './representatives.policy.js';
import { registerRepresentativeProvider } from '../auth/index.js';
import { registerDigestProvider } from '../notifications/index.js';
import { ownRepresentativeRole } from './query.service.js';
import { countOpenFlags } from './cr/cr.flags.service.js';

registerPolicies(representativesPolicy);
registerRepresentativeProvider(ownRepresentativeRole); // CRD-09
// CRD-DSH-11, spec 15: open flags are waiting for the admin.
registerDigestProvider({
  key: 'open_flags',
  labelKey: 'digest.open_flags',
  count: countOpenFlags,
});

export { representativesRouter } from './representatives.routes.js';
export { crRouter } from './cr/cr.routes.js';
export { isOpen, crDcrOf, rolesInEffect, sectionIdsWithCr } from './query.service.js';
export { endRolesOfSemester } from './remove.service.js';
export { unconfirmedOf as unconfirmedOfSection } from './cr/cr.lists.js';
export { listFlagsForAdmin, resolveFlag } from './cr/flags.admin.service.js';
export { registerCrAssignedHook, registerRepAssignedHook, resetCrAssignedHooks } from './hooks.js';
export { repRolesOfUsers } from './query.service.js';

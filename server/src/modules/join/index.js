import { registerPolicies } from '../../policy/index.js';
import { joinPolicy } from './join.policy.js';
import { registerOpenJoinRequestCheck } from '../auth/index.js';
import { registerGroupUsage } from '../routine/index.js';
import { groupInUse } from '../enrolments/index.js';
import { hasOpenRequest } from './request.service.js';

registerPolicies(joinPolicy);
// AUTH-29: a waiting student with a pending or rejected request sees the waiting screen.
registerOpenJoinRequestCheck(hasOpenRequest);
// EDT-07: a group that has a pending or accepted enrolment cannot be removed.
registerGroupUsage({ inUse: groupInUse });

export { joinRouter } from './join.routes.js';
export { listSectionRequests, listSectionClosed } from './list.service.js';
export { defineJobs as defineJoinJobs, ESCALATE_JOB, escalateStaleRequests } from './join.jobs.js';
export { registerJoinAcceptedHook, resetJoinAcceptedHooks } from './hooks.js';

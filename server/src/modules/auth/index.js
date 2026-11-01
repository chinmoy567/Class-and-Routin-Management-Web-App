import { registerPolicies } from '../../policy/index.js';
import { authPolicy } from './auth.policy.js';

registerPolicies(authPolicy);

export { authRouter, meRouter } from './auth.routes.js';
export { meProfileRouter, usersRouter, adminUsersRouter } from './profile.routes.js';
export { registerProfileExtras } from './profile.service.js';
export { defineJobs as defineAuthJobs } from './photo.jobs.js';
export { loadUser, requireAuth } from './auth.middleware.js';
export { loadRequestUser, getEmailAddress, seedSuperAdmin, toPublicUser } from './auth.service.js';
export {
  endAllSessions,
  ensureSessionIndex,
  enforceSessionLifetime,
  secondStepGate,
} from './sessions.js';
export { registerOpenJoinRequestCheck } from './next.js';
export { User, UserRole } from './auth.model.js';

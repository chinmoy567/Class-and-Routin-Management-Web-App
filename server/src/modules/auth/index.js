import { registerPolicies } from '../../policy/index.js';
import { authPolicy } from './auth.policy.js';
import { User } from './auth.model.js';
import { registerDepartmentUsage } from '../organisation/index.js';

registerPolicies(authPolicy);

// DEP-02: a department that has a teacher can no longer change its code.
registerDepartmentUsage({
  codeLocked: async (departmentId) =>
    Boolean(await User.exists({ kind: 'teacher', department_id: departmentId })),
});

export { authRouter, meRouter } from './auth.routes.js';
export { adminRolesRouter } from './adminRoles.routes.js';
export { defineJobs as defineAdminRoleJobs, COVERAGE_JOB } from './adminRoles.jobs.js';
export {
  findDepartmentsWithoutActiveAdmin,
  runCoverageCheck,
  listAdmins,
} from './adminRoles.service.js';
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

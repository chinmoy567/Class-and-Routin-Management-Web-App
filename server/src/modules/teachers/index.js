import { registerPolicies } from '../../policy/index.js';
import { teachersPolicy } from './teachers.policy.js';
import {
  registerPendingScreen,
  registerProfileExtras,
  registerTeacherVerifiedHook,
} from '../auth/index.js';
import { registerDepartmentUsage } from '../organisation/index.js';
import { createPendingRegistration, pendingScreen } from './registration.service.js';
import { departmentHasTeachers, profileBlock } from './directory.service.js';

registerPolicies(teachersPolicy);
registerTeacherVerifiedHook(createPendingRegistration); // TCH-01
registerPendingScreen(pendingScreen);
registerProfileExtras({ teacher: profileBlock }); // TCH-11
registerDepartmentUsage({ codeLocked: departmentHasTeachers });

export { teachersAdminRouter, teachersMeRouter } from './teachers.routes.js';
export {
  findByCode,
  fullNames,
  sectionsTaughtBy,
  recordsOf,
  registerSectionsProvider,
  registerLinkChangeListener,
  resetTeacherProviders,
} from './directory.service.js';
export { Teacher, TeacherRegistration } from './teachers.model.js';

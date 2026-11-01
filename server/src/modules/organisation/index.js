import { registerPolicies } from '../../policy/index.js';
import { organisationPolicy } from './organisation.policy.js';

registerPolicies(organisationPolicy);

export { organisationRouter } from './organisation.routes.js';
export { departmentsPublicRouter, departmentsAdminRouter } from './department.routes.js';
export {
  addAllowedDomain,
  isDomainAllowed,
  listDomains,
  addDomain,
  removeDomain,
} from './organisation.service.js';
export {
  listActiveDepartments,
  listAllDepartments,
  getDepartment,
  isActiveDepartment,
  createDepartment,
  updateDepartment,
  retireDepartment,
  registerDepartmentUsage,
  resetDepartmentUsage,
  listDepartmentsForCoverage,
  claimAdminAlert,
  clearAdminAlert,
  departmentNames,
} from './department.service.js';
export { semestersRouter, semestersAdminRouter } from './semester.routes.js';
export {
  currentSemester,
  draftSemester,
  registerSemesterUsage,
  resetSemesterUsage,
} from './semester.service.js';
export { Department, Semester } from './organisation.model.js';

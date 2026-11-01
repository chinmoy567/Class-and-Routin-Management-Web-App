import { registerPolicies } from '../../policy/index.js';
import { organisationPolicy } from './organisation.policy.js';

registerPolicies(organisationPolicy);

export { organisationRouter } from './organisation.routes.js';
export {
  addAllowedDomain,
  isDomainAllowed,
  isActiveDepartment,
  setDepartmentLookup,
  listDomains,
  addDomain,
  removeDomain,
} from './organisation.service.js';

import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

const active = (user) => stateIn(user, 'active');

export const representativesPolicy = {
  // Resource: { department_id } of the section.
  'representative.view': (user, r) => active(user) && isAdminOf(user, r?.department_id),
  'representative.manage': (user, r) => active(user) && isAdminOf(user, r?.department_id),
  // Any active admin may search; a given department is checked separately.
  'representative.search': (user) => active(user) && hasRole(user, ['super_admin', 'dept_admin']),
};

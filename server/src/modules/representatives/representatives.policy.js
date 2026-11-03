import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

const active = (user) => stateIn(user, 'active');

export const representativesPolicy = {
  // Resource: { department_id } of the section.
  'representative.view': (user, r) => active(user) && isAdminOf(user, r?.department_id),
  'representative.manage': (user, r) => active(user) && isAdminOf(user, r?.department_id),
  // Any active admin may search; a given department is checked separately.
  'representative.search': (user) => active(user) && hasRole(user, ['super_admin', 'dept_admin']),
  // Spec 17. Resource: { department_id, section_id, is_rep }. `is_rep` is worked out on the server
  // from the CR/DCR roles in effect for the section (CRD-DSH-01). Anyone else gets 404.
  'cr.dashboard.view': {
    allow: (user, r) => active(user) && (r?.is_rep === true || isAdminOf(user, r?.department_id)),
    hideExistence: true,
  },
  'cr.dashboard.remind': {
    allow: (user, r) => active(user) && (r?.is_rep === true || isAdminOf(user, r?.department_id)),
    hideExistence: true,
  },
  // CRD-DSH-11: only the CR or DCR raises a flag. An admin reads flags, but does not raise them.
  'cr.flag.raise': {
    allow: (user, r) => active(user) && r?.is_rep === true,
    hideExistence: true,
  },
  // Spec 18. Resource: { department_id } of the flag. An admin of another department gets 404.
  'flag.admin': {
    allow: (user, r) => active(user) && isAdminOf(user, r?.department_id),
    hideExistence: true,
  },
  // Spec 18: any active department or super admin may list flags, and the scope is applied per request.
  'flag.admin_list': (user) => active(user) && hasRole(user, ['super_admin', 'dept_admin']),
};

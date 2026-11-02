import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

const active = (user) => stateIn(user, 'active');

export const routinePolicy = {
  // Any import endpoint: an active admin. Students, teachers and CRs are refused with 403.
  'import.access': (user) => active(user) && hasRole(user, ['super_admin', 'dept_admin']),
  // Template, upload, view, confirm, publish for department D: its admin, or a super admin.
  // The resource is `{ department_id }`.
  'import.manage': (user, resource) => active(user) && isAdminOf(user, resource?.department_id),
};

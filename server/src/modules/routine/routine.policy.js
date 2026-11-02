import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

const active = (user) => stateIn(user, 'active');

export const routinePolicy = {
  // Any import endpoint: an active admin. Students, teachers and CRs are refused with 403.
  'import.access': (user) => active(user) && hasRole(user, ['super_admin', 'dept_admin']),
  // Template, upload, view, confirm, publish for department D: its admin, or a super admin.
  // The resource is `{ department_id }`.
  'import.manage': (user, resource) => active(user) && isAdminOf(user, resource?.department_id),
  // Spec 08: read any section grid. An active admin of any department.
  'slot.view': (user) => active(user) && hasRole(user, ['super_admin', 'dept_admin']),
  // EDT-02, EDT-03, EDT-07, EDT-10: resource `{ department_id }` is the owner of the slot or
  // section; only its admin, or a super admin, may change it.
  'slot.add': (user, resource) => active(user) && isAdminOf(user, resource?.department_id),
  'slot.manage': (user, resource) => active(user) && isAdminOf(user, resource?.department_id),
  'section.manage': (user, resource) => active(user) && isAdminOf(user, resource?.department_id),
};

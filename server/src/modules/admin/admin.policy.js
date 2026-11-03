// Spec 18. Every admin action is checked against the account state, the role and the department.
import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

const active = (user) => stateIn(user, 'active');

export const adminPolicy = {
  // ADM-11: any active admin may open the dashboard. Passing another department is a 403 (checked in
  // the scope helper, through the department the request names).
  'admin.dashboard.view': (user, r) =>
    active(user) &&
    (r?.department_id
      ? isAdminOf(user, r.department_id)
      : hasRole(user, ['super_admin', 'dept_admin'])),
  // ADM-19: any active admin reads the audit log. The scope is applied in the service.
  'admin.audit.read': (user) => active(user) && hasRole(user, ['super_admin', 'dept_admin']),
  // ADM-12: any active admin searches. Results are limited to their departments in the service.
  'admin.student.search': (user) => active(user) && hasRole(user, ['super_admin', 'dept_admin']),
  // ADM-13 to ADM-15: the student's department. Another department's student is a 404.
  'admin.student.manage': {
    allow: (user, r) => active(user) && isAdminOf(user, r?.department_id),
    hideExistence: true,
  },
};

import { hasRole } from '../../policy/index.js';

/** The departments an admin acts for, or null for a super admin (all departments). */
export function adminDepartmentIds(actor) {
  if (hasRole(actor, 'super_admin')) return null;
  return actor.roles.filter((r) => r.role === 'dept_admin').map((r) => String(r.department_id));
}

export const idOk = (id) => /^[a-f0-9]{24}$/i.test(String(id));

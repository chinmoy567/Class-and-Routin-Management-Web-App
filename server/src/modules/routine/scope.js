import { hasRole } from '../../policy/index.js';
import { AppError, notFound } from '../../lib/errors.js';

export const idOk = (id) => /^[a-f0-9]{24}$/i.test(String(id));

const invalid = (message) =>
  new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', { department_id: message });

/**
 * Which department an admin acts for: the one asked for, or their only department. A super
 * admin, or an admin of several departments, must name one.
 */
export function resolveDepartmentScope(actor, departmentId) {
  if (departmentId) return String(departmentId).toLowerCase();
  const own = (actor.roles ?? [])
    .filter((r) => r.role === 'dept_admin')
    .map((r) => String(r.department_id));
  const unique = [...new Set(own)];
  if (!hasRole(actor, 'super_admin') && unique.length === 1) return unique[0];
  throw invalid('Choose a department');
}

export { notFound };

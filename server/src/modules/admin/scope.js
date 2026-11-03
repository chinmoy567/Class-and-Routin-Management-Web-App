// Spec 18, ADM-11 and X1: which departments an admin may see. A department named in the request must be
// one of the admin's own (or any, for a super admin); anything else is refused with 403.
import { assertCan, hasRole } from '../../policy/index.js';
import { listActiveDepartments } from '../organisation/index.js';

/**
 * `{ all, ids }`. `all` is true for a super admin without a department filter (every department, and the
 * university-wide audit entries too). `ids` are the department ids in scope.
 */
export async function scopeOf(actor, departmentId) {
  if (departmentId) {
    assertCan(actor, 'admin.dashboard.view', { department_id: departmentId });
    return { all: false, ids: [String(departmentId)] };
  }
  if (hasRole(actor, 'super_admin')) {
    const everyone = await listActiveDepartments();
    return { all: true, ids: everyone.map((d) => String(d.id)) };
  }
  const own = (actor.roles ?? [])
    .filter((r) => r.role === 'dept_admin' && r.department_id)
    .map((r) => String(r.department_id));
  return { all: false, ids: [...new Set(own)] };
}

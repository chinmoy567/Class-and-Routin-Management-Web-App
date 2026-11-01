const asList = (v) => (Array.isArray(v) ? v : [v]);
const same = (a, b) => String(a) === String(b);

/**
 * Does the user hold `role` (a name or a list of names) in the given scope?
 * `scope` keys (department_id, section_id, semester_id) may be a single id or a list.
 * Unscoped roles (e.g. super_admin) match any scope only when the role has no scope itself
 * and the role is super_admin.
 */
export function hasRole(user, role, scope = {}) {
  const wanted = asList(role);
  return (user?.roles ?? []).some((r) => {
    if (!wanted.includes(r.role)) return false;
    if (r.role === 'super_admin') return true;
    return Object.entries(scope).every(([key, value]) => {
      if (value === undefined || value === null) return true;
      return r[key] !== undefined && r[key] !== null && asList(value).some((v) => same(v, r[key]));
    });
  });
}

/** True for a super admin, or a department admin of that department. */
export function isAdminOf(user, departmentId) {
  return (
    hasRole(user, 'super_admin') ||
    (departmentId !== undefined &&
      departmentId !== null &&
      hasRole(user, 'dept_admin', { department_id: departmentId }))
  );
}

export const stateIn = (user, states) => Boolean(user) && asList(states).includes(user.state);

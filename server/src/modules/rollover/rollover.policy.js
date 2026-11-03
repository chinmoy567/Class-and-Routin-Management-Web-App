import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

export const rolloverPolicy = {
  // Spec 14 permissions: any active admin may open the readiness screen (a department admin
  // sees only their own department, see 'rollover.readiness').
  'rollover.view': (user) =>
    stateIn(user, 'active') && hasRole(user, ['super_admin', 'dept_admin']),
  // Resource: { department_id }. A super admin sees every department, a dept admin only theirs.
  'rollover.readiness': (user, r) => stateIn(user, 'active') && isAdminOf(user, r?.department_id),
  // Make current: only an active super admin (ROL-03).
  'rollover.make_current': (user) => stateIn(user, 'active') && hasRole(user, 'super_admin'),
  // Spec 14 semester update screen: only an unconfirmed student.
  'semester_update.use': (user) => user?.kind === 'student' && stateIn(user, 'unconfirmed'),
};

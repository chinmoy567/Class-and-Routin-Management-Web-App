import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

const active = (user) => stateIn(user, 'active');

export const teachersPolicy = {
  // Listing: any active admin (the service narrows the list to their departments).
  'teacher.admin_list': (user) => active(user) && hasRole(user, ['super_admin', 'dept_admin']),
  // Every admin action on registrations, records and accounts: resource is { department_id }.
  'teacher.manage': (user, resource) => active(user) && isAdminOf(user, resource?.department_id),
  // TCH-05: a teacher still waiting (their registration was rejected).
  'teacher.apply': (user) => user.kind === 'teacher' && stateIn(user, 'pending'),
};

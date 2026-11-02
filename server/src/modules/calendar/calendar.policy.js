import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

const active = (u) => stateIn(u, 'active');

export const calendarPolicy = {
  // CAL-02: super admin any scope; dept admin only their own dept (not university scope).
  // resource: { scope_department_id } (null = university)
  'calendar.event.read': (user) => active(user),

  'calendar.event.manage': (user, resource) => {
    if (!active(user)) return false;
    if (hasRole(user, 'super_admin')) return true;
    // dept admin: must not be creating/editing a university-scope event
    if (!resource?.scope_department_id) return false;
    return isAdminOf(user, resource.scope_department_id);
  },

  // CAL-10: admin of the slot's owning department.
  // resource: { owner_department_id }
  'calendar.cancellation.manage': (user, resource) =>
    active(user) && isAdminOf(user, resource?.owner_department_id),
};

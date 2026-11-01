import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

const active = (user) => stateIn(user, 'active');

export const roomsPolicy = {
  // ROOM-08: every signed-in `active` person lists active rooms (code and type only).
  'room.list': (user) => active(user),
  // The admin list: one department (its own, unless a super admin), or no department given.
  'room.admin_list': (user, resource) =>
    active(user) &&
    (resource?.department_id
      ? isAdminOf(user, resource.department_id)
      : hasRole(user, ['super_admin', 'dept_admin'])),
  // ROOM-01: the admin of the owning department, or any super admin.
  'room.create': (user, resource) => active(user) && isAdminOf(user, resource?.department_id),
  // ROOM-04: only the owner's admin edits the room. An admin of a sharing department cannot.
  'room.manage': (user, room) => active(user) && isAdminOf(user, room?.owner_department_id),
};

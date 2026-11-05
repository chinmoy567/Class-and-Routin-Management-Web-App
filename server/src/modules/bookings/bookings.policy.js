import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

// Spec 19 Permissions table. Scope is checked against the section, department or the room's
// owner and sharing departments (resource.department_ids), never against what the request says.
const active = (user) => stateIn(user, 'active');
const repOf = (user, sectionId) => hasRole(user, ['cr', 'dcr'], { section_id: sectionId });
const teacherRole = (user) => hasRole(user, 'teacher');
const anyAdminOf = (user, departmentIds = []) =>
  hasRole(user, 'super_admin') || departmentIds.some((d) => isAdminOf(user, d));

export const bookingsPolicy = {
  // BKG-01: a CR or DCR for their own section, or an active linked teacher. The teacher must teach
  // the section; that is checked in the service from the routine.
  // Resource: { section_id }
  'room_request.send': (user, r) =>
    active(user) && (repOf(user, r?.section_id) || teacherRole(user)),

  // Cancel own or the section's request. Resource: { section_id, sent_by_user_id, department_ids, requester_teacher_user_id }
  'room_request.cancel': (user, r) => {
    if (!active(user)) return false;
    if (repOf(user, r?.section_id)) return true;
    if (r?.requester_teacher_user_id && String(r.requester_teacher_user_id) === String(user._id)) {
      return true;
    }
    return anyAdminOf(user, r?.department_ids);
  },

  // BKG-12: the decision queue and approve or reject. Any department that owns or shares the room.
  // Resource: { department_ids }
  'room_request.decide': (user, r) => active(user) && anyAdminOf(user, r?.department_ids),
  'room_request.view_queue': (user, r) => active(user) && anyAdminOf(user, r?.department_ids),

  // BKG-22, BKG-23: cancel an approved booking (reason required) and add a no-show note.
  'room_request.admin_cancel': (user, r) => active(user) && anyAdminOf(user, r?.department_ids),
  'room_request.no_show': (user, r) => active(user) && anyAdminOf(user, r?.department_ids),

  // BKG-26: a requester sees their own requests (and the section's). Resource: { section_id }
  'room_request.view_own': (user, r) =>
    active(user) && (repOf(user, r?.section_id) || teacherRole(user)),
};

import { isAdminOf, stateIn } from '../../policy/index.js';

const active = (user) => stateIn(user, 'active');

export const dashboardPolicy = {
  // DSH-01, DSH-02: an `active` student or teacher. Staff-only accounts have no dashboard.
  'dashboard.read': (user) => active(user) && (user.kind === 'student' || user.kind === 'teacher'),
  // DSH-13: a teacher of the section, or an admin of the section's department. Anyone else gets a
  // 404 (hideExistence), so a section's existence is not revealed. The resource carries `taught`,
  // worked out on the server from the routine, never from the request.
  'section.roster.read': {
    allow: (user, resource) =>
      active(user) && (resource?.taught === true || isAdminOf(user, resource?.department_id)),
    hideExistence: true,
  },
};

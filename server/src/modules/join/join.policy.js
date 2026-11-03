import { hasRole, isAdminOf, stateIn } from '../../policy/index.js';

const WAITING = ['claim_pending', 'unconfirmed'];
const active = (user) => stateIn(user, 'active');
const isStudent = (user) => user?.kind === 'student';
// A CR or DCR role is only in the request user while its semester is current (spec 09).
const repOf = (user, sectionId) => hasRole(user, ['cr', 'dcr'], { section_id: sectionId });

export const joinPolicy = {
  // JR-01, JR-04: only a waiting student sends or withdraws a request.
  'join.request': (user) => isStudent(user) && stateIn(user, WAITING),
  // JR-21: the student's own latest request.
  'join.view_own': (user) => isStudent(user) && stateIn(user, [...WAITING, 'active']),
  // JR-20: a rejected student can still sign in.
  'join.appeal': (user) => isStudent(user) && stateIn(user, WAITING),
  // Resource: { department_id, section_id, escalated }. JR-14: after escalation only the admin.
  'join.decide': (user, r) =>
    active(user) &&
    (isAdminOf(user, r?.department_id) || (!r?.escalated && repOf(user, r?.section_id))),
  'join.view': (user, r) =>
    active(user) && (isAdminOf(user, r?.department_id) || repOf(user, r?.section_id)),
  // Spec 10 (PATCH group): anyone without access gets NOT_FOUND, so another section's existence is hidden.
  'join.group': {
    allow: (user, r) =>
      active(user) && (isAdminOf(user, r?.department_id) || repOf(user, r?.section_id)),
    hideExistence: true,
  },
  // Resource: { department_id }. Revoke, appeals, escalated list, standalone claims.
  'join.admin': (user, r) => active(user) && isAdminOf(user, r?.department_id),
  'join.admin_any': (user) => active(user) && hasRole(user, ['super_admin', 'dept_admin']),
  // JR-18
  'join.claim_own': (user) => active(user) && isStudent(user) && hasRole(user, ['cr', 'dcr']),
};

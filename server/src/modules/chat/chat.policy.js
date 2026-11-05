// Spec 20: chat rules for can(). Every resource is loaded by the service first, so these
// functions do no database work.
import { registerPolicies, hasRole, isAdminOf, stateIn } from '../../policy/index.js';

// CHT-01: the states that may use chat at all. `claim_pending` is limited further below.
export const CHAT_STATES = ['active', 'unconfirmed', 'graduated', 'claim_pending'];
// CHT-09: states in which a group member may read and send.
const GROUP_SEND_STATES = ['active', 'unconfirmed', 'graduated'];

/**
 * CHT-01, CHT-02: may `a` and `b` talk one-to-one? Each side is `{ id, state, pendingRepIds }`,
 * where `pendingRepIds` holds the CR/DCR ids of a `claim_pending` student's open join request.
 */
export function pairAllowed(a, b) {
  if (!CHAT_STATES.includes(a.state) || !CHAT_STATES.includes(b.state)) return false;
  if (a.state === 'claim_pending' && b.state === 'claim_pending') return false;
  if (a.state === 'claim_pending') return (a.pendingRepIds ?? []).includes(String(b.id));
  if (b.state === 'claim_pending') return (b.pendingRepIds ?? []).includes(String(a.id));
  return true;
}

export const chatPolicy = {
  // Own state only. Results are filtered per person by chat.open_direct.
  'chat.search': (user) => stateIn(user, CHAT_STATES),
  // resource: { me, other }
  'chat.open_direct': (user, r) => pairAllowed(r.me, r.other),
  // resource: { conversation, member, closed, me, other }
  'chat.send': (user, r) => {
    if (r.conversation.type === 'direct') return pairAllowed(r.me, r.other);
    return (
      Boolean(r.member) && !r.member.removed_at && !r.closed && stateIn(user, GROUP_SEND_STATES)
    );
  },
  // resource: { member } (the caller's membership of the conversation, or null). Hidden as 404.
  'chat.read': {
    allow: (user, r) => Boolean(r.member) && !r.member.removed_at && stateIn(user, CHAT_STATES),
    hideExistence: true,
  },
  // A removed member may appeal once (CHT-10a). Hidden as 404 otherwise.
  'chat.appeal': {
    allow: (user, r) =>
      Boolean(r.member) &&
      Boolean(r.member.removed_at) &&
      String(r.member.user_id) === String(user._id) &&
      stateIn(user, CHAT_STATES),
    hideExistence: true,
  },
  // FIL-04: file upload. Active students and teachers, and unconfirmed students in one-to-one chats
  // only. The send rules (member, not removed, group open) are checked by the service as well.
  'chat.send_file': (user, r) =>
    stateIn(user, r.conversation.type === 'direct' ? ['active', 'unconfirmed'] : ['active']),
  // resource: { message }. The sender deletes their own message.
  'chat.delete_own': (user, r) => String(r.message.sender_id) === String(user._id),
  // resource: { conversation, isOwner }. CR/DCR in effect and a current member (CHT-10).
  'chat.moderate_group': (user, r) => r.conversation.type === 'section_group' && Boolean(r.isOwner),
  // resource: { department_id } of the section. Admin of that department only (CHT-10).
  'chat.restore_member': {
    allow: (user, r) => stateIn(user, 'active') && isAdminOf(user, r.department_id),
    hideExistence: true,
  },
  // CHT-10a: the admin's appeals list (super admin: all; dept admin: own departments, filtered in
  // the service).
  'chat.admin_appeals': (user) =>
    stateIn(user, 'active') && (hasRole(user, 'super_admin') || hasRole(user, 'dept_admin')),
};

// Spec 22. Admin targets and self-actions are refused in the services with their own codes.
Object.assign(chatPolicy, {
  // SAF-01, SAF-04: any chat-enabled user may block or report.
  'chat.block': (user) => stateIn(user, CHAT_STATES),
  'chat.report': (user) => stateIn(user, CHAT_STATES),
  // SAF-05, SAF-06: an active admin of the routed department (super admin for admin targets).
  // resource: { report }. Anyone else gets 404.
  'chat.review_report': {
    allow: (user, r) => {
      if (!stateIn(user, 'active')) return false;
      if (hasRole(user, 'super_admin')) return true;
      if (r.report.to_super_admins) return false;
      return isAdminOf(user, r.report.department_id);
    },
    hideExistence: true,
  },
  // SAF-10, SAF-11: an admin of the target's department (super admin for all, never oneself).
  // resource: { target_department_id, target_is_self }. Refused as FORBIDDEN.
  'chat.suspend': (user, r) => {
    if (!stateIn(user, 'active') || r.target_is_self) return false;
    return isAdminOf(user, r.target_department_id);
  },
});

registerPolicies(chatPolicy);

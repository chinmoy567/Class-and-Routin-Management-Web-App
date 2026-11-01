import { isAdminOf, stateIn } from '../../policy/index.js';

export const SIGNABLE = [
  'email_unverified',
  'claim_pending',
  'active',
  'unconfirmed',
  'graduated',
  'pending',
];

// PRF-09: editing the profile is allowed in every state that can sign in, except `email_unverified`.
const PROFILE_STATES = SIGNABLE.filter((s) => s !== 'email_unverified');
// PRF-07: who may look at a public profile. Stands in for the chat rules until spec 20.
const CHAT_STATES = ['active', 'unconfirmed', 'graduated'];

export const authPolicy = {
  // Any account that can sign in may read /me (even if it only reaches the verify screen).
  'account.view_me': (user) => stateIn(user, SIGNABLE),
  // Changing a password is part of editing the profile, which `email_unverified` cannot do.
  'account.change_password': (user) =>
    stateIn(
      user,
      SIGNABLE.filter((s) => s !== 'email_unverified'),
    ),
  'profile.view_own': (user) => stateIn(user, PROFILE_STATES),
  'profile.edit_own': (user) => stateIn(user, PROFILE_STATES),
  // resource: { department_id } of the profile being viewed
  'profile.view_public': (user, target) =>
    stateIn(user, CHAT_STATES) || isAdminOf(user, target?.department_id),
  // PRF-02: only an admin of the user's department (a super admin for anyone)
  'profile.rename': (user, target) => isAdminOf(user, target?.department_id),
};

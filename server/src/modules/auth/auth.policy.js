import { stateIn } from '../../policy/index.js';

const SIGNABLE = [
  'email_unverified',
  'claim_pending',
  'active',
  'unconfirmed',
  'graduated',
  'pending',
];

export const authPolicy = {
  // Any account that can sign in may read /me (even if it only reaches the verify screen).
  'account.view_me': (user) => stateIn(user, SIGNABLE),
  // Changing a password is part of editing the profile, which `email_unverified` cannot do.
  'account.change_password': (user) =>
    stateIn(
      user,
      SIGNABLE.filter((s) => s !== 'email_unverified'),
    ),
};

import { hasRole, stateIn } from '../../policy/index.js';

export const organisationPolicy = {
  // AUTH-28: only an active super admin manages the allowed email domains.
  'email_domain.manage': (user) => stateIn(user, 'active') && hasRole(user, 'super_admin'),
};

// AUTH-29: the screen each person lands on, decided by the server from the account state.

let hasOpenJoinRequest = async () => false;

/**
 * Spec 10 (join requests) registers the real check. Until then a `claim_pending` student has
 * no open request, so they land on the join form.
 */
export function registerOpenJoinRequestCheck(fn) {
  hasOpenJoinRequest = fn;
}

export async function nextScreen({ user, totpEnabled = false, secondStepPending = false }) {
  if (secondStepPending) return totpEnabled ? 'second-step' : 'setup-totp';
  switch (user.state) {
    case 'email_unverified':
      return 'verify-email';
    case 'claim_pending':
      return (await hasOpenJoinRequest(user._id)) ? 'waiting-approval' : 'join-form';
    case 'pending':
      return 'waiting-approval';
    case 'unconfirmed':
      return 'semester-update';
    default:
      return 'dashboard';
  }
}

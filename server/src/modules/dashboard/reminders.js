// DSH-10, DSH-16: profile reminders as labels and booleans. No address or number is returned.
import { contactStatus } from '../auth/index.js';

/** The email state the reminder banner reads: `ok`, `unverified` or `bouncing`. */
const emailState = (c) => {
  if (c.email_bouncing) return 'bouncing';
  if (!c.email_verified) return 'unverified';
  return 'ok';
};

export async function contactReminders(userId) {
  const c = await contactStatus(userId);
  if (!c) return null;
  return {
    email: emailState(c),
    phone_missing: !c.has_phone,
    photo_missing: !c.has_photo,
  };
}

import { findUserIdByEmail, markEmailBouncing } from '../auth/index.js';
import { logger } from '../../lib/logger.js';

/**
 * EML-09: a permanent bounce for an address marks its account, so the user is asked for a new
 * address at sign-in. A complaint is only logged. Returns true when an account was marked.
 */
export async function recordBounce({ email, type }) {
  if (type !== 'bounce') {
    logger.info({ type }, 'email provider event noted');
    return false;
  }
  const userId = await findUserIdByEmail(email);
  if (!userId) return false;
  await markEmailBouncing(userId);
  return true;
}

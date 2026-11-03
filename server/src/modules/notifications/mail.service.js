import { getAgenda } from '../../lib/jobs.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { clock } from '../../lib/time.js';
import { logger } from '../../lib/logger.js';
import { getMailRecipient, findUserIdByEmail, markEmailBouncing } from '../auth/index.js';
import { renderTemplate } from './templates/index.js';
import { deliver } from './transport.js';
import { EmailDedupe } from './email.model.js';

export const EMAIL_JOB = 'email.send';
const DEDUPE_WINDOW_MS = 24 * 3600 * 1000;

/**
 * FND-23: queue an email. Pass `to_user_id`, or `to_address` for an address no account holds yet
 * (sign-up, reset, email change). The address is stored encrypted, never as plain text (EML-05).
 * EML-04: a `dedupe_key` already queued in the last 24 hours drops this email. Returns false then.
 */
export async function enqueue({ to_user_id, to_address, template, data = {}, dedupe_key }) {
  if (!to_user_id && !to_address) throw new Error('enqueue needs to_user_id or to_address');
  if (dedupe_key && !(await claimDedupe(dedupe_key))) return false;
  const payload = { template, data };
  if (dedupe_key) payload.dedupe_key = dedupe_key;
  if (to_user_id) payload.to_user_id = String(to_user_id);
  else payload.to_address_enc = encrypt(to_address);
  try {
    const job = getAgenda().create(EMAIL_JOB, payload);
    job.schedule('now');
    await job.save();
  } catch (err) {
    if (dedupe_key) await EmailDedupe.deleteOne({ key: dedupe_key }); // let a later try queue it
    throw err;
  }
  return true;
}

/** Insert the key, or take it over when its last use is older than the window. */
async function claimDedupe(key) {
  const now = clock.now();
  try {
    await EmailDedupe.create({ key, at: now });
    return true;
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  const stale = await EmailDedupe.updateOne(
    { key, at: { $lt: new Date(now.getTime() - DEDUPE_WINDOW_MS) } },
    { $set: { at: now } },
  );
  return stale.modifiedCount === 1;
}

/** SMTP 5xx is a permanent failure: the address is refused, so it is not retried (EML-09). */
const isPermanentFailure = (err) =>
  Number.isInteger(err?.responseCode) && err.responseCode >= 500 && err.responseCode < 600;

async function resolveRecipient({ to_user_id, to_address_enc }) {
  if (to_user_id) return getMailRecipient(to_user_id);
  const address = decrypt(to_address_enc);
  const userId = await findUserIdByEmail(address);
  const user = userId ? await getMailRecipient(userId) : null;
  return { userId, address, bouncing: user?.bouncing ?? false };
}

/**
 * Job handler: decrypt the address, render and send. Idempotent by the dedupe key (EML-04).
 * EML-10: nothing goes to a bouncing address except the change confirmation to the new address.
 */
export async function sendEmailJob(job) {
  const { to_user_id, to_address_enc, template, data } = job.attrs.data;
  const recipient = await resolveRecipient({ to_user_id, to_address_enc });
  if (!recipient?.address) return; // user gone or has no address: nothing to send
  if (recipient.bouncing && template !== 'email_change_confirm') {
    logger.info({ template }, 'email not sent: address is bouncing');
    return;
  }
  const message = renderTemplate(template, data);
  try {
    await deliver({ to: recipient.address, ...message });
  } catch (err) {
    if (!isPermanentFailure(err)) throw err; // transient: the job retries (EML-01)
    if (recipient.userId) await markEmailBouncing(recipient.userId);
    logger.warn({ template, code: err.responseCode }, 'email refused by the mail server');
  }
}

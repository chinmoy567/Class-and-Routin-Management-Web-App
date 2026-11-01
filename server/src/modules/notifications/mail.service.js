import { getAgenda } from '../../lib/jobs.js';
import { getConfig } from '../../config.js';
import { getEmailAddress } from '../auth/index.js';
import { renderTemplate } from './templates/index.js';
import { createTransport } from './transport.js';

export const EMAIL_JOB = 'email.send';

/** FND-23: queue an email. Pass `to_user_id` or `to_address`. */
export async function enqueue({ to_user_id, to_address, template, data = {}, dedupe_key }) {
  if (!to_user_id && !to_address) throw new Error('enqueue needs to_user_id or to_address');
  const payload = { to_user_id, to_address, template, data, dedupe_key };
  const job = getAgenda().create(EMAIL_JOB, payload);
  if (dedupe_key) job.unique({ 'data.dedupe_key': dedupe_key }, { insertOnly: true });
  job.schedule('now');
  await job.save();
}

/** Job handler: render and send. Safe to run twice, because the dedupe key stops duplicates. */
export async function sendEmailJob(job) {
  const { to_user_id, to_address, template, data } = job.attrs.data;
  const to = to_address ?? (await getEmailAddress(to_user_id));
  if (!to) return; // user gone or has no address: nothing to send
  const message = renderTemplate(template, data);
  await createTransport(getConfig()).send({ to, ...message });
}

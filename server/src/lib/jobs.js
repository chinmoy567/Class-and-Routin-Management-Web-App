import Agenda from 'agenda';
import { clock } from './time.js';
import { logger } from './logger.js';

export const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

let agenda = null;
export const getAgenda = () => {
  if (!agenda) throw new Error('Agenda is not started.');
  return agenda;
};

/**
 * FND-21: retry with exponential backoff, up to `maxAttempts` tries. A job that still fails
 * stays in the collection marked failed (failedAt/failReason) and is logged at error level.
 * Handlers must be idempotent (FND-22).
 */
export function withRetry(
  handler,
  { maxAttempts = MAX_ATTEMPTS, baseDelayMs = BASE_DELAY_MS } = {},
) {
  return async (job) => {
    try {
      await handler(job);
    } catch (err) {
      job.fail(err);
      const attempts = job.attrs.failCount;
      if (attempts < maxAttempts) {
        job.schedule(new Date(clock.now().getTime() + baseDelayMs * 2 ** (attempts - 1)));
      } else {
        logger.error({ err, job: job.attrs.name, attempts }, 'job failed permanently');
      }
      await job.save();
    }
  };
}

/**
 * Start Agenda on the same MongoDB. `registrars` are each module's `defineJobs(define)`
 * functions from `<module>.jobs.js`.
 */
export async function startJobs({ url, registrars = [], processEvery = '5 seconds', retry = {} }) {
  agenda = new Agenda({ db: { address: url, collection: 'agendaJobs' }, processEvery });
  const define = (name, handler, options = {}) =>
    agenda.define(name, options, withRetry(handler, retry));
  for (const register of registrars) register(define);
  await agenda.start();
  return agenda;
}

export async function stopJobs() {
  if (agenda) await agenda.stop();
  agenda = null;
}

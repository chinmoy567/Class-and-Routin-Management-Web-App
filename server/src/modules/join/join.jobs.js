// JR-14: a request nobody decided within 72 hours moves to the department admin.
import { Enrolment } from '../enrolments/index.js';
import { logger } from '../../lib/logger.js';
import { clock } from '../../lib/time.js';

export const ESCALATE_JOB = 'join.escalate';
export const ESCALATE_AFTER_MS = 72 * 60 * 60 * 1000;

/** Idempotent: a request already escalated is not touched again. Returns how many moved. */
export async function escalateStaleRequests() {
  const cutoff = new Date(clock.now().getTime() - ESCALATE_AFTER_MS);
  const res = await Enrolment.updateMany(
    { status: 'pending', escalated_at: { $exists: false }, created_at: { $lte: cutoff } },
    { $set: { escalated_at: clock.now() } },
  );
  if (res.modifiedCount) logger.info({ count: res.modifiedCount }, 'join requests escalated');
  return res.modifiedCount;
}

export function defineJobs(define) {
  define(ESCALATE_JOB, () => escalateStaleRequests());
}

import { EMAIL_JOB, sendEmailJob } from './mail.service.js';
import { FLUSH_JOB, flushBatch } from './batch.service.js';
import { DIGEST_JOB, sendAdminDigests } from './digest.service.js';
import { OPS_REPORT_JOB, sendOpsReport } from './ops.service.js';

const MINUTE_MS = 60 * 1000;

export function defineJobs(define) {
  // EML-01: 5 tries, backing off 8, 16, 32 and 64 minutes: about 2 hours in all.
  define(EMAIL_JOB, sendEmailJob, {
    concurrency: 5,
    retry: { maxAttempts: 5, baseDelayMs: 8 * MINUTE_MS },
  });
  define(FLUSH_JOB, flushBatch);
  define(DIGEST_JOB, () => sendAdminDigests());
  define(OPS_REPORT_JOB, () => sendOpsReport());
}

export { EMAIL_JOB, FLUSH_JOB, DIGEST_JOB, OPS_REPORT_JOB };

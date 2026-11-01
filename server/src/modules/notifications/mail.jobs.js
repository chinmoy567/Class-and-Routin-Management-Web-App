import { EMAIL_JOB, sendEmailJob } from './mail.service.js';

export function defineJobs(define) {
  define(EMAIL_JOB, sendEmailJob, { concurrency: 5 });
}

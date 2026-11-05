// Spec 21, FIL-06: the malware scan job for chat files.
import { FILE_SCAN_JOB, scanFile } from './chat.files.service.js';

export function defineJobs(define) {
  define(FILE_SCAN_JOB, (job) => scanFile(job.attrs.data), { concurrency: 2 });
}

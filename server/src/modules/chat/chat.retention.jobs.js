// Spec 22, SAF-12 to SAF-14: the nightly chat retention job (02:00 Asia/Dhaka, set in server.js).
import { RETENTION_JOB, runRetention } from './chat.retention.service.js';

export function defineJobs(define) {
  define(RETENTION_JOB, () => runRetention());
}

export { RETENTION_JOB };

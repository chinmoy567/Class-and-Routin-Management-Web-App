import { PHOTO_SCAN_JOB, scanPhoto } from './photo.service.js';

export function defineJobs(define) {
  define(PHOTO_SCAN_JOB, (job) => scanPhoto(job.attrs.data), { concurrency: 2 });
}

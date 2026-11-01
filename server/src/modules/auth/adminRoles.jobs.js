import { runCoverageCheck } from './adminRoles.service.js';

export const COVERAGE_JOB = 'admin.coverage_check';

export function defineJobs(define) {
  define(COVERAGE_JOB, () => runCoverageCheck());
}

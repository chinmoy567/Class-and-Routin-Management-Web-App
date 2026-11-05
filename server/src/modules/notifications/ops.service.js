import mongoose from 'mongoose';
import { getConfig } from '../../config.js';
import { pingClamd } from '../../lib/clamav.js';
import { logger } from '../../lib/logger.js';
import { clock } from '../../lib/time.js';
import { enqueue } from './mail.service.js';

export const OPS_REPORT_JOB = 'ops.daily_report';
const DAY_MS = 24 * 3600 * 1000;

/**
 * OPS-13: what the daily operations email reports. Counts only: failed Agenda jobs in the last 24
 * hours (by job name) and whether the ClamAV scanner answers. Nothing from job data is included.
 */
export async function buildOpsReport({
  now = clock.now(),
  db = mongoose.connection.db,
  ping = pingClamd,
} = {}) {
  const since = new Date(now.getTime() - DAY_MS);
  const filter = { failedAt: { $gte: since } };
  const failedCount = await db.collection('agendaJobs').countDocuments(filter);
  const failedNames = (await db.collection('agendaJobs').distinct('name', filter)).sort();
  const clamavUp = await ping();
  return { failedCount, failedNames, clamavUp };
}

/** OPS-13: queue the daily report to OPS_ALERT_EMAIL. Sent every day, so silence means a broken job. */
export async function sendOpsReport(deps = {}) {
  const report = await buildOpsReport(deps);
  const to = getConfig().OPS_ALERT_EMAIL;
  if (!to) {
    logger.warn('OPS_ALERT_EMAIL is not set: the daily operations report was not sent');
    return report;
  }
  const day = (deps.now ?? clock.now()).toISOString().slice(0, 10);
  await enqueue({
    to_address: to,
    template: 'ops_report',
    data: {
      failed_count: String(report.failedCount),
      failed_names: report.failedNames.length ? report.failedNames.join(', ') : 'none',
      clamav: report.clamavUp ? 'up' : 'DOWN',
    },
    dedupe_key: `ops-report:${day}`,
  });
  return report;
}

/** OPS-12: a burst of error lines. The counter already limits this to one alert per window. */
export async function sendErrorAlert({ count, windowMs }) {
  const to = getConfig().OPS_ALERT_EMAIL;
  if (!to) {
    logger.warn('OPS_ALERT_EMAIL is not set: the error alert was not sent');
    return false;
  }
  return enqueue({
    to_address: to,
    template: 'ops_alert',
    data: { count: String(count), minutes: String(Math.round(windowMs / 60000)) },
    dedupe_key: `ops-alert:${Math.floor(clock.now().getTime() / windowMs)}`,
  });
}

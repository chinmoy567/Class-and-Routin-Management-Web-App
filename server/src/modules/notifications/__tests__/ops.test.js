import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  connectTestDb,
  disconnectTestDb,
  startTestMail,
  stopTestMail,
  drainMail,
  clearDb,
  clearOutbox,
} from '../../../../test/harness.js';
import { buildOpsReport, sendOpsReport, sendErrorAlert } from '../ops.service.js';

beforeAll(async () => {
  await connectTestDb();
  await startTestMail();
});
beforeEach(async () => {
  await clearDb();
  await mongoose.connection.db.collection('agendaJobs').deleteMany({});
  clearOutbox();
});
afterAll(async () => {
  await stopTestMail();
  await disconnectTestDb();
});

const NOW = new Date('2027-01-10T02:00:00Z');
const HOUR = 3600 * 1000;
const agendaJobs = () => mongoose.connection.db.collection('agendaJobs');
const up = async () => true;
const down = async () => false;

describe('OPS-13 daily operations report', () => {
  it('OPS-13 counts failed jobs from the last 24 hours only, by name', async () => {
    await agendaJobs().insertMany([
      { name: 'email.send', failedAt: new Date(NOW.getTime() - HOUR) },
      { name: 'email.send', failedAt: new Date(NOW.getTime() - 2 * HOUR) },
      { name: 'chat.retention', failedAt: new Date(NOW.getTime() - 5 * HOUR) },
      { name: 'old.job', failedAt: new Date(NOW.getTime() - 3 * 24 * HOUR) },
      { name: 'not.failed' },
    ]);
    const report = await buildOpsReport({ now: NOW, ping: up });
    expect(report.failedCount).toBe(3);
    expect(report.failedNames).toEqual(['chat.retention', 'email.send']);
  });

  it('OPS-13 reports ClamAV as down when it does not answer', async () => {
    const report = await buildOpsReport({ now: NOW, ping: down });
    expect(report.clamavUp).toBe(false);
  });

  it('OPS-13 the daily email goes to OPS_ALERT_EMAIL, with counts and names only', async () => {
    await agendaJobs().insertOne({
      name: 'test.failing',
      failedAt: new Date(NOW.getTime() - HOUR),
      data: { secret: 'do-not-send' },
    });
    await sendOpsReport({ now: NOW, ping: down });
    const mails = await drainMail();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('ops@example.invalid');
    expect(mails[0].text).toContain('Failed background jobs in the last 24 hours: 1');
    expect(mails[0].text).toContain('Job names: test.failing');
    expect(mails[0].text).toContain('ClamAV virus scanner: DOWN');
    expect(mails[0].text).not.toContain('do-not-send');
  });

  it('OPS-13 the report is sent once per day even when it runs twice', async () => {
    await sendOpsReport({ now: NOW, ping: up });
    await sendOpsReport({ now: NOW, ping: up });
    expect(await drainMail()).toHaveLength(1);
  });
});

describe('OPS-12 error alert email', () => {
  it('OPS-12 an alert is emailed to OPS_ALERT_EMAIL with the count and window', async () => {
    await sendErrorAlert({ count: 21, windowMs: 5 * 60 * 1000 });
    const mails = await drainMail();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('ops@example.invalid');
    expect(mails[0].subject).toContain('21 error lines in 5 minutes');
  });
});

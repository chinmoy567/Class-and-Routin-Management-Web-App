import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  connectTestDb,
  disconnectTestDb,
  startTestMail,
  stopTestMail,
  drainMail,
  clearDb,
  clearOutbox,
} from '../../../../test/harness.js';
import { makeUser } from '../../../../test/factories.js';
import { getAgenda, withRetry } from '../../../lib/jobs.js';
import { clock } from '../../../lib/time.js';
import { getConfig } from '../../../config.js';
import { User } from '../../auth/index.js';
import { enqueue, sendEmailJob, setSendOverride, getOutbox } from '../index.js';
import { renderTemplate } from '../templates/index.js';
import { EmailDedupe } from '../email.model.js';

const MINUTE = 60 * 1000;
const sendRetry = withRetry(sendEmailJob, { maxAttempts: 5, baseDelayMs: 8 * MINUTE });

const jobsNamed = (name = 'email.send') => getAgenda().jobs({ name });

beforeAll(async () => {
  await connectTestDb();
  await startTestMail(); // queued, never polled: each test runs the job itself
});
beforeEach(async () => {
  await clearDb();
  clearOutbox();
  setSendOverride(null);
});
afterAll(async () => {
  setSendOverride(null);
  await stopTestMail();
  await disconnectTestDb();
});

describe('sending (EML-01, EML-02)', () => {
  it('EML-01 a transport failure is retried, and success on the 3rd try sends exactly one email', async () => {
    const user = await makeUser({ kind: 'student' });
    const sent = [];
    let calls = 0;
    setSendOverride(async (message) => {
      calls += 1;
      if (calls <= 2) throw new Error('connection reset'); // transient, not a 5xx
      sent.push(message);
    });
    await enqueue({ to_user_id: user._id, template: 'test', data: { name: 'Ayesha' } });
    const [job] = await jobsNamed();

    const before = clock.now().getTime();
    await sendRetry(job); // try 1 fails: the next try is 8 minutes later
    expect(job.attrs.nextRunAt.getTime() - before).toBeGreaterThanOrEqual(8 * MINUTE - 1000);
    expect(job.attrs.nextRunAt.getTime() - before).toBeLessThanOrEqual(8 * MINUTE + 1000);
    await sendRetry(job); // try 2 fails: 16 minutes
    expect(job.attrs.nextRunAt.getTime() - before).toBeGreaterThanOrEqual(16 * MINUTE - 1000);
    await sendRetry(job); // try 3 succeeds

    expect(calls).toBe(3);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(user.email);
  });

  it('EML-01 after five failed tries the email is kept as a failed job and is not tried again', async () => {
    const user = await makeUser({ kind: 'student' });
    let calls = 0;
    setSendOverride(async () => {
      calls += 1;
      throw new Error('connection refused');
    });
    await enqueue({ to_user_id: user._id, template: 'test', data: { name: 'A' } });
    const [job] = await jobsNamed();
    for (let i = 0; i < 4; i += 1) await sendRetry(job);
    const bookedAfterFourth = job.attrs.nextRunAt.getTime();
    await sendRetry(job); // the fifth and last try
    expect(calls).toBe(5);
    expect(job.attrs.failCount).toBe(5);
    expect(job.attrs.failedAt).toBeTruthy();
    expect(job.attrs.failReason).toBe('connection refused');
    // The fifth failure books no further try.
    expect(job.attrs.nextRunAt.getTime()).toBe(bookedAfterFourth);
  });

  it('EML-02 every email is sent from MAIL_FROM', async () => {
    const user = await makeUser({ kind: 'student' });
    await enqueue({ to_user_id: user._id, template: 'test', data: { name: 'Ayesha' } });
    const sentMail = await drainMail();
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].from).toBe(getConfig().MAIL_FROM);
  });
});

describe('dedupe (EML-04)', () => {
  it('EML-04 the same dedupe key enqueued twice sends one email', async () => {
    const user = await makeUser({ kind: 'student' });
    const first = await enqueue({
      to_user_id: user._id,
      template: 'test',
      data: { name: 'A' },
      dedupe_key: 'k-1',
    });
    const second = await enqueue({
      to_user_id: user._id,
      template: 'test',
      data: { name: 'A' },
      dedupe_key: 'k-1',
    });
    expect([first, second]).toEqual([true, false]);
    expect(await jobsNamed()).toHaveLength(1);
    expect(await drainMail()).toHaveLength(1);
  });

  it('EML-04 a key used more than 24 hours ago is accepted again', async () => {
    const user = await makeUser({ kind: 'student' });
    await enqueue({ to_user_id: user._id, template: 'test', data: {}, dedupe_key: 'k-old' });
    await EmailDedupe.updateOne(
      { key: 'k-old' },
      { $set: { at: new Date(clock.now().getTime() - 25 * 3600 * 1000) } },
    );
    expect(
      await enqueue({ to_user_id: user._id, template: 'test', data: {}, dedupe_key: 'k-old' }),
    ).toBe(true);
    expect(await jobsNamed()).toHaveLength(2);
  });

  it('EML-04 concurrent enqueues with one key queue one job', async () => {
    const user = await makeUser({ kind: 'student' });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        enqueue({ to_user_id: user._id, template: 'test', data: {}, dedupe_key: 'race' }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await jobsNamed()).toHaveLength(1);
  });
});

describe('addresses in the queue (EML-05)', () => {
  it('EML-05 the job document holds no plain email address, for a user or a new address', async () => {
    const user = await makeUser({ kind: 'student' });
    const newAddress = 'new.address@baiust.ac.bd';
    await enqueue({ to_user_id: user._id, template: 'test', data: { name: 'A' } });
    await enqueue({
      to_address: newAddress,
      template: 'email_change_confirm',
      data: { name: 'Rafi' },
    });
    const jobs = await jobsNamed();
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      const stored = JSON.stringify(job.attrs);
      expect(stored).not.toContain('@');
      expect(stored).not.toContain(newAddress);
      expect(stored).not.toContain(user.email);
    }
  });

  it('EML-05 an address with no account is still delivered, from its encrypted form', async () => {
    const newAddress = 'fresh.student@baiust.ac.bd';
    await enqueue({
      to_address: newAddress,
      template: 'email_change_confirm',
      data: { name: 'Rafi' },
    });
    await drainMail();
    expect(getOutbox().map((m) => m.to)).toEqual([newAddress]);
  });
});

describe('bounces (EML-09, EML-10)', () => {
  it('EML-10 nothing goes to a bouncing address except the change confirmation', async () => {
    const user = await makeUser({ kind: 'student' });
    await User.updateOne({ _id: user._id }, { $set: { email_bouncing: true } });
    await enqueue({ to_user_id: user._id, template: 'test', data: { name: 'A' } });
    await enqueue({
      to_address: user.email,
      template: 'semester_update_reminder',
      data: { name: 'Rafi', semester: 'Fall 2026' },
    });
    await enqueue({
      to_user_id: user._id,
      template: 'email_change_confirm',
      data: { name: 'Rafi' },
    });
    const sent = await drainMail();
    // Only the change confirmation goes out, and it goes to the address on the account.
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe(renderTemplate('email_change_confirm', { name: 'Rafi' }).subject);
    expect(sent[0].to).toBe(user.email);
  });

  it('EML-09 a permanent SMTP 5xx marks the address as bouncing and is not retried', async () => {
    const user = await makeUser({ kind: 'student' });
    setSendOverride(async () => {
      throw Object.assign(new Error('550 mailbox unavailable'), { responseCode: 550 });
    });
    await enqueue({ to_user_id: user._id, template: 'test', data: { name: 'A' } });
    const [job] = await jobsNamed();
    await expect(sendEmailJob(job)).resolves.toBeUndefined(); // no throw, so no retry
    expect((await User.findById(user._id).lean()).email_bouncing).toBe(true);
  });

  it('EML-09 a temporary failure (4xx) is retried and does not mark the address', async () => {
    const user = await makeUser({ kind: 'student' });
    setSendOverride(async () => {
      throw Object.assign(new Error('451 try again later'), { responseCode: 451 });
    });
    await enqueue({ to_user_id: user._id, template: 'test', data: { name: 'A' } });
    const [job] = await jobsNamed();
    await expect(sendEmailJob(job)).rejects.toThrow('451');
    expect((await User.findById(user._id).lean()).email_bouncing).toBe(false);
  });
});

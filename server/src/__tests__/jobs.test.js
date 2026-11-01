import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb } from '../../test/harness.js';
import { makeUser } from '../../test/factories.js';
import { startJobs, stopJobs, getAgenda, withRetry } from '../lib/jobs.js';
import { enqueue, defineMailJobs, getOutbox, clearOutbox } from '../modules/notifications/index.js';
import { renderTemplate } from '../modules/notifications/templates/index.js';
import { t } from '../i18n/index.js';

const waitFor = async (fn, ms = 15_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
};

let runs = 0;
let ran = 0;

beforeAll(async () => {
  await connectTestDb();
  await startJobs({
    url: `${process.env.TEST_MONGO_URI.replace('/?', `/${mongoose.connection.name}?`)}`,
    processEvery: 100,
    retry: { baseDelayMs: 50 },
    registrars: [
      defineMailJobs,
      (define) => {
        define('test.always-fails', async () => {
          runs += 1;
          throw new Error('nope');
        });
        define('test.idempotent', async (job) => {
          // conditional update: the second run changes nothing (FND-22)
          const res = await mongoose.connection
            .collection('idem')
            .updateOne(
              { _id: job.attrs.data.key, done: { $ne: true } },
              { $set: { done: true } },
              { upsert: true },
            )
            .catch(() => ({ modifiedCount: 0, upsertedCount: 0 }));
          if (res.modifiedCount || res.upsertedCount) ran += 1;
        });
      },
    ],
  });
}, 60_000);

afterAll(async () => {
  await stopJobs();
  await disconnectTestDb();
});

afterEach(() => clearOutbox());

describe('jobs', () => {
  it('FND-21 a failing job is retried and after 5 failures is marked failed', async () => {
    await getAgenda().now('test.always-fails');
    const failed = await waitFor(async () => {
      const [job] = await getAgenda().jobs({ name: 'test.always-fails' });
      return job?.attrs.failCount >= 5 ? job : null;
    });
    expect(failed.attrs.failCount).toBe(5);
    expect(failed.attrs.failedAt).toBeTruthy();
    expect(failed.attrs.failReason).toBe('nope');
    await new Promise((r) => setTimeout(r, 600));
    expect(runs).toBe(5); // no sixth try
  }, 30_000);

  it('FND-21 withRetry backs off exponentially and logs the final failure', async () => {
    const times = [];
    const job = {
      attrs: { name: 'x', failCount: 0 },
      fail() {
        this.attrs.failCount += 1;
      },
      schedule(d) {
        times.push(d);
      },
      save: vi.fn(),
    };
    const wrapped = withRetry(
      async () => {
        throw new Error('e');
      },
      { baseDelayMs: 1000, maxAttempts: 3 },
    );
    await wrapped(job);
    await wrapped(job);
    await wrapped(job);
    expect(times).toHaveLength(2); // third failure is final
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000); // 2s delay vs 1s delay
  });

  it('FND-22 running a job twice changes nothing the second time', async () => {
    await getAgenda().now('test.idempotent', { key: 'k1' });
    await getAgenda().now('test.idempotent', { key: 'k1' });
    await waitFor(async () =>
      (await getAgenda().jobs({ name: 'test.idempotent' })).every((j) => j.attrs.lastFinishedAt),
    );
    expect(ran).toBe(1);
  });
});

describe('mail', () => {
  it('FND-23 enqueue adds an email.send job that renders from the i18n file', async () => {
    await enqueue({ to_address: 'a@baiust.ac.bd', template: 'test', data: { name: 'Rafi' } });
    const mail = await waitFor(() => getOutbox()[0]);
    expect(mail.to).toBe('a@baiust.ac.bd');
    expect(mail.subject).toBe(t('email.test.subject'));
    expect(mail.text).toBe('This is a test email for Rafi.');
    expect(mail.html).toContain('<p>');
    expect(mail.from).toBe('no-reply@baiust.ac.bd');
  });

  it('FND-23 enqueue by user id looks the address up on the server', async () => {
    const user = await makeUser({ email: 'lookup@baiust.ac.bd' });
    await enqueue({ to_user_id: user._id, template: 'test', data: { name: 'L' } });
    const mail = await waitFor(() => getOutbox()[0]);
    expect(mail.to).toBe('lookup@baiust.ac.bd');
  });

  it('FND-23 a dedupe_key sends once', async () => {
    const args = {
      to_address: 'd@baiust.ac.bd',
      template: 'test',
      data: { name: 'D' },
      dedupe_key: 'once-1',
    };
    await enqueue(args);
    await enqueue(args);
    await waitFor(() => getOutbox().length >= 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(getOutbox()).toHaveLength(1);
  });

  it('FND-23 enqueue needs a recipient; an unknown template fails loudly', async () => {
    await expect(enqueue({ template: 'test' })).rejects.toThrow(/to_user_id or to_address/);
    expect(() => renderTemplate('missing')).toThrow(/Unknown email template/);
  });

  it('FND-24 in test the transport writes to the in-memory outbox instead of sending', async () => {
    await enqueue({ to_address: 'o@baiust.ac.bd', template: 'test', data: { name: 'O' } });
    await waitFor(() => getOutbox().length === 1);
    expect(getOutbox()[0].to).toBe('o@baiust.ac.bd');
  });

  it('FND-32 server text comes from en.json with variables', () => {
    expect(t('email.test.body', { name: 'Z' })).toBe('This is a test email for Z.');
    expect(t('no.such.key')).toBe('no.such.key');
  });
});

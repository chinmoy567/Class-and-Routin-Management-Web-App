import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { getConfig } from '../src/config.js';
import { syncAllIndexes } from '../src/lib/db.js';
import { clock } from '../src/lib/time.js';
import { createApp, createSessionMiddleware } from '../src/app.js';
import { MongoRateLimitStore } from '../src/lib/rateLimitStore.js';
import { startJobs, stopJobs, getAgenda } from '../src/lib/jobs.js';
import { ensureSessionIndex } from '../src/modules/auth/index.js';
import { solves } from '../src/modules/auth/captcha.service.js';
import { scanPhoto, PHOTO_SCAN_JOB } from '../src/modules/auth/photo.service.js';
import { sendEmailJob, getOutbox, clearOutbox } from '../src/modules/notifications/index.js';
// Register every model so syncAllIndexes() builds their indexes.
import '../src/modules/auth/auth.model.js';
import '../src/modules/organisation/organisation.model.js';
import '../src/modules/audit/audit.model.js';

/** Connect this test file to its own database on the shared replica set. */
export async function connectTestDb() {
  const dbName = `t_${crypto.randomBytes(6).toString('hex')}`;
  await mongoose.connect(process.env.TEST_MONGO_URI, { dbName });
  await syncAllIndexes();
  await new MongoRateLimitStore().ensureIndexes();
  await ensureSessionIndex();
}

/**
 * Mail in tests: the queue is started but never polls, and `drainMail()` runs the queued
 * `email.send` jobs on the spot and returns the outbox. No waiting, no timing.
 */
export async function startTestMail() {
  const url = process.env.TEST_MONGO_URI.replace('/?', `/${mongoose.connection.name}?`);
  await startJobs({ url, processEvery: '1 hour', registrars: [] });
}
export const stopTestMail = () => stopJobs();

export async function drainMail() {
  const jobs = await getAgenda().jobs({ name: 'email.send' });
  for (const job of jobs) {
    await sendEmailJob(job);
    await job.remove();
  }
  return [...getOutbox()];
}
export { clearOutbox };

/** Run the queued `photo.scan` jobs on the spot, as drainMail does for mail. */
export async function drainPhotoScans() {
  const jobs = await getAgenda().jobs({ name: PHOTO_SCAN_JOB });
  for (const job of jobs) {
    await scanPhoto(job.attrs.data);
    await job.remove();
  }
}

/** The token in the first link of an email body, for tests that follow a link. */
export const tokenFrom = (mail) =>
  new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');

/** Sign in through the real route, on a fresh agent that already carries a CSRF token. */
export async function signIn(app, email, password, extra = {}) {
  const agent = await loginAs(null, app);
  const res = await agent.post('/api/auth/login').send({ email, password, ...extra });
  return { agent, res };
}

export async function disconnectTestDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

/** Empty every collection (the audit_log is emptied through the driver, bypassing the guard). */
export async function clearDb() {
  const collections = await mongoose.connection.db.collections();
  for (const c of collections) await c.deleteMany({});
}

/** FND-34: fix the clock (Date or ISO string); call clock.reset() afterwards. */
export const fixClock = (instant) => clock.set(instant);
export const resetClock = () => clock.reset();

/** Build the app with a test-only login route (never mounted in production). */
export function buildTestApp(options = {}) {
  return createApp(getConfig(), {
    sessionMiddleware: createSessionMiddleware(getConfig()),
    ...options,
    mountBefore(app) {
      app.get('/api/__test__/login', (req, res) => {
        req.session.userId = req.query.userId;
        res.json({ ok: true });
      });
      options.mountBefore?.(app);
    },
  });
}

/**
 * Supertest agent with the session cookie and CSRF token already set.
 * With no user it is an anonymous session that still carries a CSRF token.
 */
export async function loginAs(user, app = buildTestApp()) {
  const agent = request.agent(app);
  if (user) await agent.get('/api/__test__/login').query({ userId: String(user._id) });
  const { body } = await agent.get('/api/auth/csrf');
  const token = body.data.token;
  for (const method of ['post', 'put', 'patch', 'delete']) {
    const original = agent[method].bind(agent);
    agent[method] = (...args) => original(...args).set('X-CSRF-Token', token);
  }
  agent.csrfToken = token;
  return agent;
}

/** Solve a proof-of-work CAPTCHA challenge the way the browser does. */
export async function solveCaptcha(agent) {
  const { body } = await agent.get('/api/auth/captcha');
  const { id, prefix, bits } = body.data;
  for (let n = 0; ; n++) {
    if (solves(prefix, String(n), bits)) return { id, solution: String(n) };
  }
}

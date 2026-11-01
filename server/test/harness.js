import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { getConfig } from '../src/config.js';
import { syncAllIndexes } from '../src/lib/db.js';
import { clock } from '../src/lib/time.js';
import { createApp, createSessionMiddleware } from '../src/app.js';
import { MongoRateLimitStore } from '../src/lib/rateLimitStore.js';
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

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import {
  buildTestApp,
  clearDb,
  clearOutbox,
  connectTestDb,
  disconnectTestDb,
  drainMail,
  fixClock,
  resetClock,
  signIn,
  startTestMail,
  stopTestMail,
  tokenFrom,
  loginAs,
} from '../../../../test/harness.js';
import { TEST_PASSWORD, makeUser } from '../../../../test/factories.js';
import { User, UserRole } from '../auth.model.js';
import { endAllSessions } from '../index.js';
import { totpCode } from '../../../lib/totp.js';
import { clock } from '../../../lib/time.js';
import { addAllowedDomain } from '../../organisation/index.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  await startTestMail();
  app = buildTestApp();
});
afterAll(async () => {
  await stopTestMail();
  await disconnectTestDb();
});
const T0 = '2030-03-04T05:00:00Z';
beforeEach(async () => {
  await clearDb();
  clearOutbox();
  fixClock(T0);
  await addAllowedDomain('baiust.ac.bd');
});
afterEach(() => resetClock());

const advance = (ms) => fixClock(new Date(new Date(T0).getTime() + ms));
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

async function signInAdmin(admin) {
  const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
  await agent.post('/api/auth/second-step').send({ code: totpCode(admin.totpSecret, clock.now()) });
  return agent;
}
const makeAdmin = () =>
  makeUser({
    kind: 'staff',
    roles: [{ role: 'super_admin' }],
    password: TEST_PASSWORD,
    totp: true,
  });
const sessionCount = (userId) =>
  mongoose.connection.collection('sessions').countDocuments({ 'session.userId': String(userId) });

describe('session lifetime (AUTH-22)', () => {
  it('AUTH-22 an admin session idle for 31 minutes is UNAUTHENTICATED', async () => {
    const agent = await signInAdmin(await makeAdmin());
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    advance(31 * MINUTE);
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('AUTH-22 an admin who keeps working is not signed out after 30 minutes', async () => {
    const agent = await signInAdmin(await makeAdmin());
    for (const minutes of [20, 40, 60, 80]) {
      advance(minutes * MINUTE);
      expect((await agent.get('/api/auth/me')).status).toBe(200);
    }
  });

  it('AUTH-22 an admin session ends after 12 hours in total, even when active', async () => {
    const agent = await signInAdmin(await makeAdmin());
    for (let m = 20; m < 12 * 60; m += 20) {
      advance(m * MINUTE);
      expect((await agent.get('/api/auth/me')).status).toBe(200);
    }
    advance(12 * HOUR + MINUTE);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('AUTH-22 a student session idle for 13 days still works, 15 days does not', async () => {
    const student = await makeUser({ password: TEST_PASSWORD });
    const { agent } = await signIn(app, student.email, TEST_PASSWORD);
    advance(13 * DAY);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    advance(13 * DAY + 14 * DAY + HOUR); // 14 days + 1 hour after the last use
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('AUTH-22 a teacher session follows the same 14 day rule, and use renews it', async () => {
    const teacher = await makeUser({ kind: 'teacher', password: TEST_PASSWORD });
    const { agent } = await signIn(app, teacher.email, TEST_PASSWORD);
    for (let d = 10; d <= 50; d += 10) {
      advance(d * DAY);
      expect((await agent.get('/api/auth/me')).status).toBe(200);
    }
  });

  it('AUTH-22 an admin whose role is gone gets the student rules from the next request', async () => {
    const admin = await makeAdmin();
    const agent = await signInAdmin(admin);
    await UserRole.deleteMany({ user_id: admin._id });
    advance(2 * HOUR);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });
});

describe('ending sessions (AUTH-23)', () => {
  async function twoBrowsers(user) {
    const a = await signIn(app, user.email, TEST_PASSWORD);
    const b = await signIn(app, user.email, TEST_PASSWORD);
    expect((await a.agent.get('/api/auth/me')).status).toBe(200);
    expect((await b.agent.get('/api/auth/me')).status).toBe(200);
    return { a: a.agent, b: b.agent };
  }

  it('AUTH-23 each session records the user, so all of an account can be found', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const other = await makeUser({ password: TEST_PASSWORD });
    await twoBrowsers(user);
    await signIn(app, other.email, TEST_PASSWORD);
    expect(await sessionCount(user._id)).toBe(2);
    expect(await sessionCount(other._id)).toBe(1);
    await endAllSessions(user._id);
    expect(await sessionCount(user._id)).toBe(0);
    expect(await sessionCount(other._id)).toBe(1);
  });

  it("AUTH-23 after a password reset another browser's session is UNAUTHENTICATED", async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { a, b } = await twoBrowsers(user);
    const anon = await loginAs(null, app);
    await anon.post('/api/auth/reset/request').send({ email: user.email });
    const token = tokenFrom((await drainMail()).at(-1));
    const reset = await anon
      .post('/api/auth/reset/confirm')
      .send({ token, password: 'brand-new-pass-7' });
    expect(reset.status).toBe(200);
    for (const agent of [a, b]) {
      const res = await agent.get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('AUTH-23 a password change ends the other sessions but keeps the current one', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { a, b } = await twoBrowsers(user);
    const res = await a
      .post('/api/me/password')
      .send({ current_password: TEST_PASSWORD, new_password: 'another-pass-42' });
    expect(res.status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect(await sessionCount(user._id)).toBe(1);
  });

  it.each(['deactivated', 'suspended'])(
    'AUTH-23 a %s account is signed out on its next request',
    async (state) => {
      const user = await makeUser({ kind: 'teacher', password: TEST_PASSWORD });
      const { a } = await twoBrowsers(user);
      await User.updateOne({ _id: user._id }, { $set: { state } });
      expect((await a.get('/api/auth/me')).status).toBe(401);
      // and cannot sign back in
      const again = await signIn(app, user.email, TEST_PASSWORD);
      expect(again.res.body.error.code).toBe('ACCOUNT_DISABLED');
    },
  );

  it('AUTH-23 signing out destroys the session', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { agent } = await signIn(app, user.email, TEST_PASSWORD);
    expect((await agent.post('/api/auth/logout').send({})).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect(await sessionCount(user._id)).toBe(0);
  });

  it('AUTH-23 a half-signed-in admin can sign out too', async () => {
    const admin = await makeAdmin();
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    expect((await agent.post('/api/auth/logout').send({})).status).toBe(204);
  });
});

describe('fresh state and roles (AUTH-24)', () => {
  it('AUTH-24 an admin role removed while the session is open stops working on the next request', async () => {
    const admin = await makeAdmin();
    const agent = await signInAdmin(admin);
    expect((await agent.get('/api/admin/email-domains')).status).toBe(200);
    await UserRole.deleteMany({ user_id: admin._id, role: 'super_admin' });
    const res = await agent.get('/api/admin/email-domains');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('AUTH-24 a role granted while the session is open takes effect on the next request', async () => {
    const user = await makeUser({ kind: 'staff', password: TEST_PASSWORD });
    const { agent } = await signIn(app, user.email, TEST_PASSWORD);
    expect((await agent.get('/api/admin/email-domains')).status).toBe(403);
    await UserRole.create({ user_id: user._id, role: 'super_admin' });
    expect((await agent.get('/api/admin/email-domains')).status).toBe(200);
  });

  it('AUTH-24 a state change shows up on the very next /me', async () => {
    const student = await makeUser({ state: 'claim_pending', password: TEST_PASSWORD });
    const { agent } = await signIn(app, student.email, TEST_PASSWORD);
    expect((await agent.get('/api/auth/me')).body.data.next).toBe('join-form');
    await User.updateOne({ _id: student._id }, { $set: { state: 'active' } });
    const me = await agent.get('/api/auth/me');
    expect(me.body.data.user.state).toBe('active');
    expect(me.body.data.next).toBe('dashboard');
  });

  it('AUTH-24 a user who no longer exists is signed out', async () => {
    const student = await makeUser({ password: TEST_PASSWORD });
    const { agent } = await signIn(app, student.email, TEST_PASSWORD);
    await User.deleteOne({ _id: student._id });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

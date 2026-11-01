import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  clearOutbox,
  connectTestDb,
  disconnectTestDb,
  drainMail,
  fixClock,
  loginAs,
  resetClock,
  signIn,
  startTestMail,
  stopTestMail,
  tokenFrom,
} from '../../../../test/harness.js';
import { TEST_PASSWORD, makeUser } from '../../../../test/factories.js';
import { OneTimeToken, User } from '../auth.model.js';
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
const post = async (path, body) => (await loginAs(null, app)).post(path).send(body);
const NEW_PASSWORD = 'brand-new-pass-7';

async function requestReset(email) {
  const res = await post('/api/auth/reset/request', { email });
  const mails = await drainMail();
  clearOutbox();
  return { res, token: mails.length ? tokenFrom(mails.at(-1)) : null, mails };
}

describe('forgot password (AUTH-25)', () => {
  it('AUTH-25 the answer is the same for a known and an unknown address', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const known = await requestReset(user.email);
    const unknown = await requestReset('nobody@baiust.ac.bd');
    expect(known.res.status).toBe(202);
    expect(unknown.res.status).toBe(202);
    expect(known.res.body).toEqual(unknown.res.body);
    expect(known.mails).toHaveLength(1);
    expect(unknown.mails).toHaveLength(0);
  });

  it('AUTH-25 the link lasts 1 hour', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { token } = await requestReset(user.email);
    const stored = await OneTimeToken.findOne({ purpose: 'reset_password' });
    expect(stored.expires_at.toISOString()).toBe('2030-03-04T06:00:00.000Z');
    advance(61 * MINUTE);
    const late = await post('/api/auth/reset/confirm', { token, password: NEW_PASSWORD });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('TOKEN_INVALID');
  });

  it('AUTH-25 the link works once', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { token } = await requestReset(user.email);
    expect((await post('/api/auth/reset/confirm', { token, password: NEW_PASSWORD })).status).toBe(
      200,
    );
    const again = await post('/api/auth/reset/confirm', { token, password: 'yet-another-pass-1' });
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });

  it('AUTH-25 the link works for only one of several requests sent together', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { token } = await requestReset(user.email);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        post('/api/auth/reset/confirm', { token, password: `concurrent-pass-${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('AUTH-25 a new link cancels the older one', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const first = await requestReset(user.email);
    const second = await requestReset(user.email);
    expect(first.token).not.toBe(second.token);
    expect(
      (await post('/api/auth/reset/confirm', { token: first.token, password: NEW_PASSWORD }))
        .status,
    ).toBe(400);
    expect(
      (await post('/api/auth/reset/confirm', { token: second.token, password: NEW_PASSWORD }))
        .status,
    ).toBe(200);
  });

  it('AUTH-25 limited to 3 per hour per account, with the same answer for unknown addresses', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    for (const email of [user.email, 'ghost@baiust.ac.bd']) {
      const statuses = [];
      for (let i = 0; i < 4; i++)
        statuses.push((await post('/api/auth/reset/request', { email })).status);
      expect(statuses).toEqual([202, 202, 202, 429]);
    }
  });

  it('AUTH-25 limited to 10 per hour per IP', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await post('/api/auth/reset/request', { email: `n${i}@baiust.ac.bd` })).status,
      );
    }
    expect(statuses).toEqual([...Array(10).fill(202), 429]);
  });

  it('AUTH-25 a deactivated or suspended account gets no link, with the same quiet answer', async () => {
    const off = await makeUser({ state: 'deactivated', password: TEST_PASSWORD });
    const { res, mails } = await requestReset(off.email);
    expect(res.status).toBe(202);
    expect(mails).toHaveLength(0);
  });
});

describe('reset password (AUTH-26)', () => {
  it('AUTH-26 sets the new password, stops the old one working, and emails the owner', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { token } = await requestReset(user.email);
    advance(MINUTE);
    const res = await post('/api/auth/reset/confirm', { token, password: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const stored = await User.findById(user._id).select('+password_hash');
    expect(stored.password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.password_changed_at.toISOString()).toBe('2030-03-04T05:01:00.000Z');

    expect((await signIn(app, user.email, TEST_PASSWORD)).res.status).toBe(401);
    expect((await signIn(app, user.email, NEW_PASSWORD)).res.status).toBe(200);

    const mails = await drainMail();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe(user.email);
    expect(mails[0].subject).toMatch(/password was changed/i);
  });

  it('AUTH-26 a weak new password is refused and the link is not used up', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { token } = await requestReset(user.email);
    const weak = await post('/api/auth/reset/confirm', { token, password: 'short1' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    expect((await post('/api/auth/reset/confirm', { token, password: NEW_PASSWORD })).status).toBe(
      200,
    );
  });

  it('AUTH-26 the one-time link from the seed script sets a first password', async () => {
    const { seedSuperAdmin } = await import('../index.js');
    const { resetLink } = await seedSuperAdmin({
      email: 'root@baiust.ac.bd',
      name: 'Root',
      appUrl: 'http://localhost:5173',
    });
    const token = new URL(resetLink).searchParams.get('token');
    expect((await post('/api/auth/reset/confirm', { token, password: NEW_PASSWORD })).status).toBe(
      200,
    );
    const { res } = await signIn(app, 'root@baiust.ac.bd', NEW_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data.next).toBe('setup-totp'); // a super admin sets up the authenticator first
  });
});

describe('change password (AUTH-27)', () => {
  const change = (agent, current_password, new_password) =>
    agent.post('/api/me/password').send({ current_password, new_password });

  it('AUTH-27 needs the current password', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { agent } = await signIn(app, user.email, TEST_PASSWORD);
    const wrong = await change(agent, 'not-my-password-1', NEW_PASSWORD);
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await change(agent, TEST_PASSWORD, NEW_PASSWORD)).status).toBe(200);
    expect((await signIn(app, user.email, NEW_PASSWORD)).res.status).toBe(200);
    expect((await signIn(app, user.email, TEST_PASSWORD)).res.status).toBe(401);
  });

  it('AUTH-27 the new password must follow the rules', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { agent } = await signIn(app, user.email, TEST_PASSWORD);
    const res = await change(agent, TEST_PASSWORD, 'nodigitshere');
    expect(res.status).toBe(400);
    expect(res.body.error.fields.new_password).toBeTruthy();
  });

  it('AUTH-27 emails the owner about the change', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { agent } = await signIn(app, user.email, TEST_PASSWORD);
    await change(agent, TEST_PASSWORD, NEW_PASSWORD);
    const mails = await drainMail();
    expect(mails.map((m) => m.to)).toEqual([user.email]);
  });

  it('AUTH-27 a signed-out caller is refused', async () => {
    const res = await post('/api/me/password', {
      current_password: 'x',
      new_password: NEW_PASSWORD,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('AUTH-27 an account that has not verified its email cannot change its password', async () => {
    const user = await makeUser({ state: 'email_unverified', password: TEST_PASSWORD });
    const { agent } = await signIn(app, user.email, TEST_PASSWORD);
    const res = await change(agent, TEST_PASSWORD, NEW_PASSWORD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
    expect(res.body.error.fields.state).toBe('email_unverified');
  });

  it.each(['claim_pending', 'active', 'unconfirmed', 'graduated'])(
    'AUTH-27 a %s student can change their password',
    async (state) => {
      const user = await makeUser({ state, password: TEST_PASSWORD });
      const { agent } = await signIn(app, user.email, TEST_PASSWORD);
      expect((await change(agent, TEST_PASSWORD, NEW_PASSWORD)).status).toBe(200);
    },
  );

  it('AUTH-27 a pending teacher can change their password', async () => {
    const user = await makeUser({ kind: 'teacher', state: 'pending', password: TEST_PASSWORD });
    const { agent } = await signIn(app, user.email, TEST_PASSWORD);
    expect((await change(agent, TEST_PASSWORD, NEW_PASSWORD)).status).toBe(200);
  });
});

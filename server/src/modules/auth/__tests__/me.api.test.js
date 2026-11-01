import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  fixClock,
  loginAs,
  resetClock,
  signIn,
} from '../../../../test/harness.js';
import { TEST_PASSWORD, makeDepartment, makeUser } from '../../../../test/factories.js';
import { registerOpenJoinRequestCheck } from '../index.js';
import { User } from '../auth.model.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearDb();
  fixClock('2030-03-04T05:00:00Z');
});
afterEach(() => {
  resetClock();
  registerOpenJoinRequestCheck(async () => false);
});

const meOf = async (user) => (await loginAs(user, app)).get('/api/auth/me');

describe('GET /api/auth/me (AUTH-29)', () => {
  const cases = [
    ['student', 'email_unverified', 'verify-email'],
    ['student', 'claim_pending', 'join-form'],
    ['student', 'active', 'dashboard'],
    ['student', 'unconfirmed', 'semester-update'],
    ['student', 'graduated', 'dashboard'],
    ['teacher', 'email_unverified', 'verify-email'],
    ['teacher', 'pending', 'waiting-approval'],
    ['teacher', 'active', 'dashboard'],
    ['staff', 'active', 'dashboard'],
  ];
  it.each(cases)('AUTH-29 a %s in state %s lands on %s', async (kind, state, next) => {
    const user = await makeUser({ kind, state });
    const res = await meOf(user);
    expect(res.status).toBe(200);
    expect(res.body.data.next).toBe(next);
    expect(res.body.data.user).toMatchObject({ id: String(user._id), kind, state });
  });

  it('AUTH-29 a claim_pending student with an open join request lands on the waiting screen', async () => {
    const user = await makeUser({ state: 'claim_pending' });
    registerOpenJoinRequestCheck(async (id) => String(id) === String(user._id));
    expect((await meOf(user)).body.data.next).toBe('waiting-approval');
    const other = await makeUser({ state: 'claim_pending' });
    expect((await meOf(other)).body.data.next).toBe('join-form');
  });

  it('AUTH-29 an admin lands on the second step or the authenticator setup until it is done', async () => {
    const withTotp = await makeUser({
      kind: 'staff',
      roles: [{ role: 'super_admin' }],
      password: TEST_PASSWORD,
      totp: true,
    });
    const without = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'dept_admin', department_id: makeDepartment()._id }],
      password: TEST_PASSWORD,
    });
    const a = await signIn(app, withTotp.email, TEST_PASSWORD);
    expect((await a.agent.get('/api/auth/me')).body.data.next).toBe('second-step');
    const b = await signIn(app, without.email, TEST_PASSWORD);
    expect((await b.agent.get('/api/auth/me')).body.data.next).toBe('setup-totp');
  });

  it('AUTH-29 returns the roles in effect', async () => {
    const dept = makeDepartment();
    const user = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'teacher' }, { role: 'dept_admin', department_id: dept._id }],
    });
    const res = await meOf(user);
    expect(res.body.data.roles).toEqual([
      { role: 'teacher' },
      { role: 'dept_admin', department_id: String(dept._id) },
    ]);
  });

  it('AUTH-03 AUTH-29 never returns email, phone, hashes or secrets', async () => {
    const user = await makeUser({ password: TEST_PASSWORD, totp: true });
    await User.updateOne({ _id: user._id }, { $set: { phone_enc: 'ciphertext' } });
    const res = await meOf(user);
    const body = JSON.stringify(res.body);
    for (const secret of [
      user.email,
      'ciphertext',
      'argon2',
      'email_enc',
      'email_hmac',
      'phone',
      'totp',
    ]) {
      expect(body).not.toContain(secret);
    }
    expect(Object.keys(res.body.data.user).sort()).toEqual(
      ['email_bouncing', 'email_verified', 'full_name', 'id', 'kind', 'state'].sort(),
    );
  });

  it('AUTH-29 shows only whether the email is verified or bouncing', async () => {
    const verified = await makeUser();
    expect((await meOf(verified)).body.data.user).toMatchObject({
      email_verified: true,
      email_bouncing: false,
    });
    const unverified = await makeUser({ state: 'email_unverified' });
    expect((await meOf(unverified)).body.data.user.email_verified).toBe(false);
    await User.updateOne({ _id: verified._id }, { $set: { email_bouncing: true } });
    expect((await meOf(verified)).body.data.user.email_bouncing).toBe(true);
  });

  it('AUTH-29 a signed-out caller gets UNAUTHENTICATED', async () => {
    const res = await (await loginAs(null, app)).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(['deactivated', 'suspended'])(
    'AUTH-13 a %s account is treated as signed out',
    async (state) => {
      const user = await makeUser({ kind: state === 'suspended' ? 'teacher' : 'student', state });
      const res = await meOf(user);
      expect(res.status).toBe(401);
    },
  );
});

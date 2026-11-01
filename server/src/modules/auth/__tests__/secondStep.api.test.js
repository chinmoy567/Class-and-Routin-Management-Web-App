import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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
} from '../../../../test/harness.js';
import { TEST_PASSWORD, makeDepartment, makeUser } from '../../../../test/factories.js';
import { User } from '../auth.model.js';
import { totpCode } from '../../../lib/totp.js';
import { decrypt } from '../../../lib/crypto.js';
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

const makeSuperAdmin = (over = {}) =>
  makeUser({
    kind: 'staff',
    roles: [{ role: 'super_admin' }],
    password: TEST_PASSWORD,
    totp: true,
    ...over,
  });

const emailedCode = (mail) => mail.text.match(/code is (\d{6})/)[1];

describe('the second step is required for admins (AUTH-17)', () => {
  it('AUTH-17 a dept admin who passes the password but not the second step gets 401 SECOND_STEP_REQUIRED on /api/rooms', async () => {
    const dept = makeDepartment();
    const admin = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'dept_admin', department_id: dept._id }],
      password: TEST_PASSWORD,
      totp: true,
    });
    const { agent, res } = await signIn(app, admin.email, TEST_PASSWORD);
    expect(res.body.data.next).toBe('second-step');
    const rooms = await agent.get('/api/rooms');
    expect(rooms.status).toBe(401);
    expect(rooms.body.error.code).toBe('SECOND_STEP_REQUIRED');
  });

  it('AUTH-17 the same holds for every other endpoint, but /me tells the page what to show', async () => {
    const admin = await makeSuperAdmin();
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    for (const path of ['/api/admin/email-domains', '/api/anything', '/api/health-not']) {
      const res = await agent.get(path);
      expect(res.body.error.code).toBe('SECOND_STEP_REQUIRED');
    }
    const post = await agent.post('/api/me/password').send({});
    expect(post.body.error.code).toBe('SECOND_STEP_REQUIRED');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.next).toBe('second-step');
  });

  it('AUTH-17 after the authenticator code the admin reaches the rest of the API', async () => {
    const admin = await makeSuperAdmin();
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    const res = await agent
      .post('/api/auth/second-step')
      .send({ code: totpCode(admin.totpSecret, clock.now()) });
    expect(res.status).toBe(200);
    expect(res.body.data.next).toBe('dashboard');
    expect((await agent.get('/api/rooms')).body.error.code).toBe('NOT_FOUND'); // past the gate
    expect((await agent.get('/api/admin/email-domains')).status).toBe(200);
  });

  it('AUTH-17 the second step is needed at every sign-in', async () => {
    const admin = await makeSuperAdmin();
    for (let i = 0; i < 2; i++) {
      const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
      expect((await agent.get('/api/admin/email-domains')).status).toBe(401);
      await agent
        .post('/api/auth/second-step')
        .send({ code: totpCode(admin.totpSecret, clock.now()) });
      expect((await agent.get('/api/admin/email-domains')).status).toBe(200);
    }
  });

  it('AUTH-17 students and teachers are never half-signed-in', async () => {
    const student = await makeUser({ password: TEST_PASSWORD });
    const teacher = await makeUser({ kind: 'teacher', password: TEST_PASSWORD });
    for (const user of [student, teacher]) {
      const { agent, res } = await signIn(app, user.email, TEST_PASSWORD);
      expect(res.body.data.next).toBe('dashboard');
      expect((await agent.get('/api/rooms')).body.error.code).toBe('NOT_FOUND');
      const step = await agent.post('/api/auth/second-step').send({ code: '123456' });
      expect(step.status).toBe(409);
    }
  });

  it('AUTH-17 the second-step endpoints refuse someone who is not signed in', async () => {
    const { agent } = await signIn(app, 'nobody@baiust.ac.bd', 'whatever-123');
    for (const path of ['/api/auth/second-step', '/api/auth/totp/confirm']) {
      expect((await agent.post(path).send({ code: '123456' })).status).toBe(401);
    }
    expect((await agent.post('/api/auth/second-step/email-code').send({})).status).toBe(401);
    expect((await agent.post('/api/auth/totp/setup').send({})).status).toBe(401);
  });
});

describe('authenticator app (AUTH-18)', () => {
  it('AUTH-18 an admin without an authenticator sets it up right after the password and confirms with a code', async () => {
    const admin = await makeSuperAdmin({ totp: false });
    const { agent, res } = await signIn(app, admin.email, TEST_PASSWORD);
    expect(res.body.data.next).toBe('setup-totp');

    // the code check and the email fallback are not available before setup
    expect((await agent.post('/api/auth/second-step').send({ code: '123456' })).status).toBe(409);
    expect((await agent.post('/api/auth/second-step/email-code').send({})).status).toBe(409);

    const setup = await agent.post('/api/auth/totp/setup').send({});
    expect(setup.status).toBe(200);
    const { otpauth_url, secret } = setup.body.data;
    expect(otpauth_url).toMatch(/^otpauth:\/\/totp\//);
    expect(otpauth_url).toContain(`secret=${secret}`);

    // stored encrypted, and not switched on yet
    const stored = await User.findById(admin._id).select('+totp_secret_enc');
    expect(stored.totp_secret_enc).not.toContain(secret);
    expect(decrypt(stored.totp_secret_enc)).toBe(secret);
    expect(stored.totp_enabled_at).toBeUndefined();

    const bad = await agent.post('/api/auth/totp/confirm').send({ code: '000000' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CODE_INVALID');
    expect((await agent.get('/api/admin/email-domains')).status).toBe(401);

    const ok = await agent
      .post('/api/auth/totp/confirm')
      .send({ code: totpCode(secret, clock.now()) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.next).toBe('dashboard');
    expect((await User.findById(admin._id)).totp_enabled_at).toBeInstanceOf(Date);
    expect((await agent.get('/api/admin/email-domains')).status).toBe(200);

    // next sign-in asks for the code, not the setup
    const again = await signIn(app, admin.email, TEST_PASSWORD);
    expect(again.res.body.data.next).toBe('second-step');
  });

  it('AUTH-18 setup is refused once the authenticator is already on', async () => {
    const admin = await makeSuperAdmin();
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    const res = await agent.post('/api/auth/totp/setup').send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('AUTH-18 confirm needs setup to have been started', async () => {
    const admin = await makeSuperAdmin({ totp: false });
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    const res = await agent.post('/api/auth/totp/confirm').send({ code: '123456' });
    expect(res.status).toBe(409);
  });

  it('AUTH-18 codes from one 30 second step either side are accepted, two steps away are not', async () => {
    const admin = await makeSuperAdmin();
    for (const [offset, status] of [
      [-1, 200],
      [1, 200],
      [-2, 400],
      [2, 400],
    ]) {
      const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
      const res = await agent
        .post('/api/auth/second-step')
        .send({ code: totpCode(admin.totpSecret, clock.now(), offset) });
      expect(res.status).toBe(status);
    }
  });

  it('AUTH-18 the code must be six digits', async () => {
    const admin = await makeSuperAdmin();
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    for (const code of ['12345', '1234567', 'abcdef', '']) {
      const res = await agent.post('/api/auth/second-step').send({ code });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('emailed code (AUTH-19)', () => {
  const requestCode = async (agent) => {
    const res = await agent.post('/api/auth/second-step/email-code').send({});
    expect(res.status).toBe(202);
    const mails = await drainMail();
    clearOutbox();
    return emailedCode(mails.at(-1));
  };

  it('AUTH-19 an emailed code works once', async () => {
    const admin = await makeSuperAdmin();
    const a = await signIn(app, admin.email, TEST_PASSWORD);
    const b = await signIn(app, admin.email, TEST_PASSWORD);
    const code = await requestCode(a.agent);
    expect(code).toMatch(/^\d{6}$/);
    const first = await a.agent.post('/api/auth/second-step').send({ code });
    expect(first.status).toBe(200);
    // a second sign-in cannot reuse it
    const second = await b.agent.post('/api/auth/second-step').send({ code });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('CODE_INVALID');
  });

  it('AUTH-19 an emailed code fails after 10 minutes but works just before', async () => {
    const admin = await makeSuperAdmin();
    const a = await signIn(app, admin.email, TEST_PASSWORD);
    const code = await requestCode(a.agent);
    advance(10 * MINUTE + 1000);
    const late = await a.agent.post('/api/auth/second-step').send({ code });
    expect(late.body.error.code).toBe('CODE_INVALID');

    const b = await signIn(app, admin.email, TEST_PASSWORD);
    const code2 = await requestCode(b.agent);
    advance(10 * MINUTE + 1000 + 9 * MINUTE);
    expect((await b.agent.post('/api/auth/second-step').send({ code: code2 })).status).toBe(200);
  });

  it('AUTH-19 at most 3 codes per 15 minutes', async () => {
    const admin = await makeSuperAdmin();
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await agent.post('/api/auth/second-step/email-code').send({})).status);
    }
    expect(statuses).toEqual([202, 202, 202, 429]);
    advance(16 * MINUTE);
    expect((await agent.post('/api/auth/second-step/email-code').send({})).status).toBe(202);
  });

  it('AUTH-19 a new code cancels the one before it', async () => {
    const admin = await makeSuperAdmin();
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    const first = await requestCode(agent);
    const second = await requestCode(agent);
    if (first !== second) {
      expect((await agent.post('/api/auth/second-step').send({ code: first })).status).toBe(400);
    }
    expect((await agent.post('/api/auth/second-step').send({ code: second })).status).toBe(200);
  });

  it('AUTH-19 the same code used by two sign-ins at the same moment works for exactly one', async () => {
    const admin = await makeSuperAdmin();
    const sessions = await Promise.all(
      Array.from({ length: 4 }, () => signIn(app, admin.email, TEST_PASSWORD)),
    );
    const code = await requestCode(sessions[0].agent);
    const results = await Promise.all(
      sessions.map((s) => s.agent.post('/api/auth/second-step').send({ code })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('AUTH-19 the code goes to the admin who asked and to nobody else', async () => {
    const admin = await makeSuperAdmin({ email: 'boss@baiust.ac.bd' });
    await makeSuperAdmin({ email: 'other@baiust.ac.bd' });
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    await agent.post('/api/auth/second-step/email-code').send({});
    const mails = await drainMail();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('boss@baiust.ac.bd');
  });

  it("AUTH-19 one admin's emailed code does not work for another admin", async () => {
    const one = await makeSuperAdmin();
    const two = await makeSuperAdmin();
    const a = await signIn(app, one.email, TEST_PASSWORD);
    const b = await signIn(app, two.email, TEST_PASSWORD);
    const code = await requestCode(a.agent);
    expect((await b.agent.post('/api/auth/second-step').send({ code })).status).toBe(400);
  });
});

describe('wrong codes (AUTH-20)', () => {
  it('AUTH-20 five wrong codes in a row end the half-signed-in session', async () => {
    const admin = await makeSuperAdmin();
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await agent.post('/api/auth/second-step').send({ code: '000000' })).status);
    }
    expect(statuses).toEqual([400, 400, 400, 400, 401]);
    // even the right code no longer helps: the admin starts again from the password
    const right = await agent
      .post('/api/auth/second-step')
      .send({ code: totpCode(admin.totpSecret, clock.now()) });
    expect(right.status).toBe(401);
    expect((await agent.get('/api/auth/me')).status).toBe(401);

    const again = await signIn(app, admin.email, TEST_PASSWORD);
    expect(again.res.status).toBe(200);
  });

  it('AUTH-20 four wrong codes then the right one still signs in', async () => {
    const admin = await makeSuperAdmin();
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    for (let i = 0; i < 4; i++) {
      expect((await agent.post('/api/auth/second-step').send({ code: '000000' })).status).toBe(400);
    }
    const ok = await agent
      .post('/api/auth/second-step')
      .send({ code: totpCode(admin.totpSecret, clock.now()) });
    expect(ok.status).toBe(200);
  });

  it('AUTH-20 wrong codes during setup count too', async () => {
    const admin = await makeSuperAdmin({ totp: false });
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    await agent.post('/api/auth/totp/setup').send({});
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await agent.post('/api/auth/totp/confirm').send({ code: '000000' })).status);
    }
    expect(statuses).toEqual([400, 400, 400, 400, 401]);
  });
});

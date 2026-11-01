import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { getConfig } from '../../../config.js';
import { createSessionMiddleware } from '../../../app.js';
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
  solveCaptcha,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { TEST_PASSWORD, makeUser } from '../../../../test/factories.js';
import { LoginThrottle } from '../auth.model.js';
import { claimOwnerAlert } from '../throttle.service.js';
import { emailHmac } from '../../../lib/crypto.js';
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
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const fail = (agent, email) =>
  agent.post('/api/auth/login').send({ email, password: 'wrong-pass-9' });

describe('sign-in', () => {
  it('AUTH-12 a wrong password and an unknown email return identical responses', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const wrongPassword = await signIn(app, user.email, 'not-the-password-1');
    const unknownEmail = await signIn(app, 'nobody@baiust.ac.bd', 'not-the-password-1');
    expect(wrongPassword.res.status).toBe(401);
    expect(unknownEmail.res.status).toBe(401);
    expect(wrongPassword.res.body).toEqual(unknownEmail.res.body);
    expect(wrongPassword.res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('AUTH-12 a good sign-in returns the screen to show and starts a session', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const { agent, res } = await signIn(app, user.email, TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ next: 'dashboard' });
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('AUTH-12 the email is not case sensitive', async () => {
    const user = await makeUser({ password: TEST_PASSWORD, email: 'mixed@baiust.ac.bd' });
    const { res } = await signIn(app, 'MIXED@Baiust.ac.bd', TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(user.email).toBe('mixed@baiust.ac.bd');
  });

  it('AUTH-13 deactivated and suspended accounts get ACCOUNT_DISABLED and nothing more', async () => {
    const deactivated = await makeUser({ state: 'deactivated', password: TEST_PASSWORD });
    const suspended = await makeUser({
      kind: 'teacher',
      state: 'suspended',
      password: TEST_PASSWORD,
    });
    for (const user of [deactivated, suspended]) {
      const { res } = await signIn(app, user.email, TEST_PASSWORD);
      expect(res.status).toBe(403);
      expect(Object.keys(res.body.error).sort()).toEqual(['code', 'message']);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    }
  });

  it('AUTH-13 a wrong password on a disabled account does not reveal that it is disabled', async () => {
    const user = await makeUser({ state: 'deactivated', password: TEST_PASSWORD });
    const { res } = await signIn(app, user.email, 'wrong-pass-9');
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('AUTH-12 an unverified account signs in and is sent to the verify screen', async () => {
    const user = await makeUser({ state: 'email_unverified', password: TEST_PASSWORD });
    const { res } = await signIn(app, user.email, TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data.next).toBe('verify-email');
  });

  it('AUTH-16 the session id changes when the password is accepted', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const agent = request.agent(app);
    const before = await agent.get('/api/auth/csrf');
    const sid = (r) => r.headers['set-cookie'].find((c) => c.startsWith('sid=')).split(';')[0];
    const token = before.body.data.token;
    const login = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', token)
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(sid(login)).not.toBe(sid(before));
    // the token still works after the regenerate, and the old cookie is no longer a session
    const fixated = request.agent(app);
    fixated.jar.setCookie(sid(before));
    expect((await fixated.get('/api/auth/me')).status).toBe(401);
  });

  it('AUTH-21 the session cookie is HTTP-only, SameSite=Lax and Secure in production', async () => {
    const dev = await request(app).get('/api/auth/csrf');
    const devCookie = dev.headers['set-cookie'][0];
    expect(devCookie).toMatch(/HttpOnly/i);
    expect(devCookie).toMatch(/SameSite=Lax/i);

    const prodApp = buildTestApp({
      sessionMiddleware: createSessionMiddleware({ ...getConfig(), NODE_ENV: 'production' }),
    });
    const prod = await request(prodApp).get('/api/auth/csrf').set('X-Forwarded-Proto', 'https');
    expect(prod.headers['set-cookie'][0]).toMatch(/Secure/i);
  });
});

describe('throttling and CAPTCHA (AUTH-14)', () => {
  it('AUTH-14 after 5 failures the 6th try waits 1 s, then needs a CAPTCHA, and the account still opens', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const agent = await loginAs(null, app);
    for (let i = 0; i < 5; i++) expect((await fail(agent, user.email)).status).toBe(401);

    // right away: it has to wait
    const tooSoon = await agent
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('RATE_LIMITED');
    expect(tooSoon.headers['retry-after']).toBe('1');

    // after the wait: a CAPTCHA is required, even for the right password
    advance(1100);
    const noCaptcha = await agent
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(noCaptcha.status).toBe(403);
    expect(noCaptcha.body.error.code).toBe('CAPTCHA_REQUIRED');

    // with a solved CAPTCHA the right password signs in: the account was never locked
    const captcha = await solveCaptcha(agent);
    const ok = await agent
      .post('/api/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD, captcha });
    expect(ok.status).toBe(200);
    // success resets the account counter
    expect(await LoginThrottle.findOne({ key: `acct:${emailHmac(user.email)}` })).toBeNull();
  });

  it('AUTH-14 the wait doubles: 1 s, 2 s, 4 s, capped at 5 minutes', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const agent = await loginAs(null, app);
    const key = `acct:${emailHmac(user.email)}`;
    const waits = [];
    let t = 0;
    for (let i = 1; i <= 14; i++) {
      const body = { email: user.email, password: 'wrong-pass-9' };
      if (i > 5) body.captcha = await solveCaptcha(agent);
      const res = await agent.post('/api/auth/login').send(body);
      expect(res.status).toBe(401);
      const doc = await LoginThrottle.findOne({ key }).lean();
      if (doc.next_allowed_at)
        waits.push((doc.next_allowed_at.getTime() - new Date(T0).getTime() - t) / 1000);
      t += (waits.at(-1) ?? 0) * 1000 + 1;
      advance(t);
    }
    expect(waits.slice(0, 9)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256]);
    expect(waits.slice(9)).toEqual([300]); // 512 s is capped at 5 minutes
  });

  it('AUTH-14 a wrong, reused or expired CAPTCHA is refused', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const agent = await loginAs(null, app);
    for (let i = 0; i < 5; i++) await fail(agent, user.email);
    advance(2000);
    const login = (captcha) =>
      agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD, captcha });

    const wrong = await agent.get('/api/auth/captcha');
    expect((await login({ id: wrong.body.data.id, solution: 'not-it' })).body.error.code).toBe(
      'CAPTCHA_REQUIRED',
    );

    const expired = await solveCaptcha(agent);
    advance(2000 + 6 * MINUTE);
    expect((await login(expired)).body.error.code).toBe('CAPTCHA_REQUIRED');

    const good = await solveCaptcha(agent);
    expect((await login(good)).status).toBe(200);
    // the same answer cannot be used a second time (the first success also reset the counter,
    // so check the challenge itself)
    const { verifyCaptcha } = await import('../captcha.service.js');
    expect(await verifyCaptcha(good)).toBe(false);
  });

  it('AUTH-14 a CAPTCHA works once even when many requests send the same answer', async () => {
    const agent = await loginAs(null, app);
    const answer = await solveCaptcha(agent);
    const { verifyCaptcha } = await import('../captcha.service.js');
    const results = await Promise.all(Array.from({ length: 6 }, () => verifyCaptcha(answer)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('AUTH-14 an unknown email is throttled exactly like a real one', async () => {
    const agent = await loginAs(null, app);
    for (let i = 0; i < 5; i++) await fail(agent, 'ghost@baiust.ac.bd');
    const sixth = await fail(agent, 'ghost@baiust.ac.bd');
    expect(sixth.status).toBe(429);
    expect(sixth.headers['retry-after']).toBe('1');
  });

  it('AUTH-14 failures are also counted per IP, so other accounts need a CAPTCHA from that address', async () => {
    const other = await makeUser({ password: TEST_PASSWORD });
    const agent = await loginAs(null, app);
    for (let i = 0; i < 5; i++) await fail(agent, `ghost${i}@baiust.ac.bd`);
    advance(1100);
    const res = await agent
      .post('/api/auth/login')
      .send({ email: other.email, password: TEST_PASSWORD });
    expect(res.body.error.code).toBe('CAPTCHA_REQUIRED');
  });

  it('AUTH-14 failures at the same moment are all counted (no lost updates)', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const agents = await Promise.all(Array.from({ length: 12 }, () => loginAs(null, app)));
    await Promise.all(agents.map((a) => fail(a, user.email)));
    const doc = await LoginThrottle.findOne({ key: `acct:${emailHmac(user.email)}` }).lean();
    expect(doc.fails).toBe(12);
    expect(doc.hour_fails).toBe(12);
  });

  it('AUTH-14 the count starts again after 15 quiet minutes', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const agent = await loginAs(null, app);
    for (let i = 0; i < 4; i++) await fail(agent, user.email);
    advance(16 * MINUTE);
    await fail(agent, user.email);
    const doc = await LoginThrottle.findOne({ key: `acct:${emailHmac(user.email)}` }).lean();
    expect(doc.fails).toBe(1);
    expect(doc.next_allowed_at).toBeNull();
  });
});

describe('failed sign-in email (AUTH-15)', () => {
  it('AUTH-15 10 failures in an hour send the owner one email, and no more that hour', async () => {
    const user = await makeUser({ password: TEST_PASSWORD });
    const agent = await loginAs(null, app);
    // one try every 5 minutes: no throttling kicks in, but the hour counter reaches 10
    for (let i = 0; i < 12; i++) {
      advance(i * 5 * MINUTE);
      expect((await fail(agent, user.email)).status).toBe(401);
      if (i === 8) expect(await drainMail()).toHaveLength(0); // 9 failures: nothing yet
    }
    const mails = await drainMail();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe(user.email);
    expect(mails[0].subject).toMatch(/failed sign-in/i);
  });

  it('AUTH-15 an unknown address gets no email', async () => {
    const agent = await loginAs(null, app);
    for (let i = 0; i < 10; i++) {
      advance(i * 5 * MINUTE);
      await fail(agent, 'ghost@baiust.ac.bd');
    }
    expect(await drainMail()).toHaveLength(0);
  });

  it('AUTH-15 only one of several callers at the same moment claims the alert', async () => {
    const hmac = emailHmac('claim@baiust.ac.bd');
    await LoginThrottle.collection.insertOne({
      key: `acct:${hmac}`,
      fails: 10,
      hour_fails: 10,
      hour_started_at: new Date(T0),
    });
    const results = await Promise.all(Array.from({ length: 6 }, () => claimOwnerAlert(hmac)));
    expect(results.filter(Boolean)).toHaveLength(1);
    advance(61 * MINUTE);
    expect(await claimOwnerAlert(hmac)).toBe(true); // an hour later it may fire again
  });
});

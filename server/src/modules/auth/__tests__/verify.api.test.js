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
  startTestMail,
  stopTestMail,
  tokenFrom,
} from '../../../../test/harness.js';
import { makeId } from '../../../../test/factories.js';
import { User } from '../auth.model.js';
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
beforeEach(async () => {
  await clearDb();
  clearOutbox();
  fixClock('2030-03-04T05:00:00Z');
  await addAllowedDomain('baiust.ac.bd');
});
afterEach(() => resetClock());

const post = async (path, body) => (await loginAs(null, app)).post(path).send(body);

async function signUpAndGetToken(over = {}) {
  const body = {
    kind: 'student',
    full_name: 'Rafi Ahmed',
    email: 'rafi@baiust.ac.bd',
    password: 'secret-pass-1',
    ...over,
  };
  await post('/api/auth/signup', body);
  const mails = await drainMail();
  clearOutbox();
  return { token: tokenFrom(mails.at(-1)), email: body.email };
}

describe('email verification', () => {
  it('AUTH-10 a verified student is claim_pending and lands on the join form', async () => {
    const { token } = await signUpAndGetToken();
    const res = await post('/api/auth/verify', { token });
    expect(res.status).toBe(200);
    expect(res.body.data.next).toBe('join-form');
    const user = await User.findOne();
    expect(user.state).toBe('claim_pending');
    expect(user.email_verified_at).toBeInstanceOf(Date);
  });

  it('AUTH-10 a verified teacher is pending and lands on the waiting screen', async () => {
    const { token } = await signUpAndGetToken({
      kind: 'teacher',
      email: 'salma@baiust.ac.bd',
      department_id: String(makeId()),
      short_code: 'SK',
    });
    const res = await post('/api/auth/verify', { token });
    expect(res.body.data.next).toBe('waiting-approval');
    expect((await User.findOne()).state).toBe('pending');
  });

  it('AUTH-10 a link used after 24 hours and 1 minute is TOKEN_INVALID', async () => {
    const { token } = await signUpAndGetToken();
    fixClock('2030-03-05T05:01:00Z');
    const res = await post('/api/auth/verify', { token });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
    expect((await User.findOne()).state).toBe('email_unverified');
  });

  it('AUTH-10 a link used just inside 24 hours still works', async () => {
    const { token } = await signUpAndGetToken();
    fixClock('2030-03-05T04:59:00Z');
    expect((await post('/api/auth/verify', { token })).status).toBe(200);
  });

  it('AUTH-10 a link works once: the second use is TOKEN_INVALID', async () => {
    const { token } = await signUpAndGetToken();
    expect((await post('/api/auth/verify', { token })).status).toBe(200);
    const again = await post('/api/auth/verify', { token });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });

  it('AUTH-10 a made-up token is TOKEN_INVALID', async () => {
    const res = await post('/api/auth/verify', { token: 'x'.repeat(43) });
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('AUTH-10 the same link used by several requests at once works exactly once', async () => {
    const { token } = await signUpAndGetToken();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post('/api/auth/verify', { token })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'TOKEN_INVALID')).toHaveLength(4);
  });
});

describe('resend verification', () => {
  it('AUTH-11 a new link cancels the old one', async () => {
    const { token: oldToken, email } = await signUpAndGetToken();
    expect((await post('/api/auth/verify/resend', { email })).status).toBe(202);
    const newToken = tokenFrom((await drainMail())[0]);
    expect(newToken).not.toBe(oldToken);
    expect((await post('/api/auth/verify', { token: oldToken })).body.error.code).toBe(
      'TOKEN_INVALID',
    );
    expect((await post('/api/auth/verify', { token: newToken })).status).toBe(200);
  });

  it('AUTH-11 resend is limited to 3 per hour per account', async () => {
    const { email } = await signUpAndGetToken();
    const statuses = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await post('/api/auth/verify/resend', { email })).status);
    expect(statuses).toEqual([202, 202, 202, 429]);
    expect(await drainMail()).toHaveLength(3);
    fixClock('2030-03-04T06:01:00Z'); // an hour later
    expect((await post('/api/auth/verify/resend', { email })).status).toBe(202);
  });

  it('AUTH-11 AUTH-08 an unknown address and a verified account both get the same quiet 202', async () => {
    const { token, email } = await signUpAndGetToken();
    await post('/api/auth/verify', { token });
    const unknown = await post('/api/auth/verify/resend', { email: 'nobody@baiust.ac.bd' });
    const verified = await post('/api/auth/verify/resend', { email });
    expect(unknown.status).toBe(202);
    expect(verified.status).toBe(202);
    expect(unknown.body).toEqual(verified.body);
    expect(await drainMail()).toHaveLength(0);
  });

  it('AUTH-11 the 429 does not depend on whether the address has an account', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (await post('/api/auth/verify/resend', { email: 'ghost@baiust.ac.bd' })).status,
      );
    }
    expect(statuses).toEqual([202, 202, 202, 429]);
  });
});

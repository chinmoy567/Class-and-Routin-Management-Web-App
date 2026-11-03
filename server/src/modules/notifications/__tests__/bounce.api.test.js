import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  signIn,
} from '../../../../test/harness.js';
import { makeUser, TEST_PASSWORD } from '../../../../test/factories.js';
import { resetConfigForTests } from '../../../config.js';
import { User } from '../../auth/index.js';

const SECRET = 'bounce-webhook-secret-for-tests';
// The config is read from the environment once; a test changes the secret and re-reads it.
const setSecret = (value) => {
  process.env.EMAIL_WEBHOOK_SECRET = value;
  resetConfigForTests();
};
const hook = () => request(buildTestApp());
const post = (body, secret = SECRET) => {
  const req = hook().post('/api/webhooks/email-bounce');
  return secret === null ? req.send(body) : req.set('x-email-webhook-secret', secret).send(body);
};

beforeAll(async () => {
  await connectTestDb();
  setSecret(SECRET);
});
beforeEach(async () => {
  await clearDb();
  setSecret(SECRET);
});
afterAll(async () => {
  setSecret('');
  await disconnectTestDb();
});

describe('bounce webhook (EML-09)', () => {
  it('EML-09 a request without the shared secret is refused', async () => {
    const user = await makeUser({ kind: 'student' });
    const res = await post({ email: user.email, type: 'bounce' }, null);
    expect(res.status).toBe(403);
    expect((await User.findById(user._id).lean()).email_bouncing).toBe(false);
  });

  it('EML-09 a wrong secret is refused', async () => {
    const user = await makeUser({ kind: 'student' });
    const res = await post({ email: user.email, type: 'bounce' }, 'guess');
    expect(res.status).toBe(403);
    expect((await User.findById(user._id).lean()).email_bouncing).toBe(false);
  });

  it('EML-09 with no secret configured, every call is refused', async () => {
    setSecret('');
    const user = await makeUser({ kind: 'student' });
    const res = await post({ email: user.email, type: 'bounce' }, '');
    expect(res.status).toBe(403);
  });

  it('EML-09 a bounce marks the account, and the next sign-in asks for a new address', async () => {
    const user = await makeUser({ kind: 'student', state: 'active', password: TEST_PASSWORD });
    const res = await post({ email: user.email, type: 'bounce' });
    expect(res.status).toBe(204);
    expect(res.text).toBe(''); // nothing about the address comes back
    expect((await User.findById(user._id).lean()).email_bouncing).toBe(true);

    // The real sign-in route says so, and so does the session check after it.
    const { res: signedIn } = await signIn(buildTestApp(), user.email, TEST_PASSWORD);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.email_action_required).toBe(true);
  });

  it('EML-09 a complaint does not mark the account', async () => {
    const user = await makeUser({ kind: 'student' });
    const res = await post({ email: user.email, type: 'complaint' });
    expect(res.status).toBe(204);
    expect((await User.findById(user._id).lean()).email_bouncing).toBe(false);
  });

  it('EML-09 an unknown address gets the same 204 and changes nothing', async () => {
    const res = await post({ email: 'nobody@baiust.ac.bd', type: 'bounce' });
    expect(res.status).toBe(204);
  });

  it('EML-09 a malformed body is rejected', async () => {
    const res = await post({ email: 'not-an-address', type: 'bounce' });
    expect(res.status).toBe(400);
  });
});

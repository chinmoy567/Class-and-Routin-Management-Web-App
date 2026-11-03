import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { passwordSchema } from '@crm/shared';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  fixClock,
  resetClock,
  signIn,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { TEST_PASSWORD, makeUser } from '../../../../test/factories.js';
import { generateTemporaryPassword } from '../password.js';
import { User } from '../auth.model.js';

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
  fixClock('2027-04-06T04:00:00Z');
});
afterEach(resetClock);

/** A student whose password is a temporary one, so they must change it at next sign-in. */
async function temporaryStudent() {
  const student = await makeUser({
    kind: 'student',
    state: 'active',
    password: TEST_PASSWORD,
    email: 'temp.student@baiust.ac.bd',
  });
  await User.updateOne({ _id: student._id }, { $set: { must_change_password: true } });
  return student;
}

describe('ADM-15 temporary password generator', () => {
  it('ADM-15 a temporary password is 12 characters, has a letter and a digit, and passes the rules', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toHaveLength(12);
      expect(passwordSchema.safeParse(pw).success).toBe(true);
      expect(pw).not.toMatch(/[0O1lI]/);
    }
  });

  it('ADM-15 two temporary passwords are different', () => {
    const seen = new Set(Array.from({ length: 20 }, () => generateTemporaryPassword()));
    expect(seen.size).toBe(20);
  });
});

describe('ADM-15 forced password change', () => {
  it('ADM-15 the next sign-in returns next: change-password', async () => {
    await temporaryStudent();
    const { res } = await signIn(app, 'temp.student@baiust.ac.bd', TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data.next).toBe('change-password');
  });

  it('ADM-15 until the password is changed, every other endpoint answers 403', async () => {
    await temporaryStudent();
    const { agent } = await signIn(app, 'temp.student@baiust.ac.bd', TEST_PASSWORD);
    const blocked = await agent.get('/api/me/dashboard');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('STATE_NOT_ALLOWED');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.next).toBe('change-password');
  });

  it('ADM-15 changing the password clears the flag, and the next screen is the dashboard', async () => {
    await temporaryStudent();
    const { agent } = await signIn(app, 'temp.student@baiust.ac.bd', TEST_PASSWORD);
    const changed = await agent.post('/api/me/password').send({
      current_password: TEST_PASSWORD,
      new_password: 'a-new-password-2',
    });
    expect(changed.status).toBe(200);
    const me = await agent.get('/api/auth/me');
    expect(me.body.data.next).toBe('dashboard');
    const user = await User.findOne({ email_hmac: { $exists: true } }).lean();
    expect(user.must_change_password).toBe(false);
  });

  it('ADM-15 an account without the flag is not held', async () => {
    await makeUser({
      kind: 'student',
      state: 'active',
      password: TEST_PASSWORD,
      email: 'plain@baiust.ac.bd',
    });
    const { agent, res } = await signIn(app, 'plain@baiust.ac.bd', TEST_PASSWORD);
    expect(res.body.data.next).toBe('dashboard');
    expect((await agent.get('/api/me/dashboard')).status).not.toBe(403);
  });
});

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
  solveCaptcha,
  startTestMail,
  stopTestMail,
  tokenFrom,
} from '../../../../test/harness.js';
import { createDepartment, makeId } from '../../../../test/factories.js';
import { OneTimeToken, User } from '../auth.model.js';
import { addAllowedDomain } from '../../organisation/index.js';
import { decrypt } from '../../../lib/crypto.js';

let app;
let dept;
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
  dept = await createDepartment();
});
afterEach(() => resetClock());

const student = (over = {}) => ({
  kind: 'student',
  full_name: 'Rafi Ahmed',
  email: 'rafi@baiust.ac.bd',
  password: 'secret-pass-1',
  ...over,
});
const teacher = (over = {}) => ({
  kind: 'teacher',
  full_name: 'Dr Salma',
  email: 'salma@baiust.ac.bd',
  password: 'secret-pass-1',
  department_id: dept.id,
  short_code: 'sk',
  ...over,
});
/** Spec 24 OS-02: a student body gets a solved CAPTCHA unless the test sets `captcha` itself. */
const signUp = async (body) => {
  const agent = await loginAs(null, app);
  const send =
    body.kind === 'student' && !('captcha' in body)
      ? { ...body, captcha: await solveCaptcha(agent) }
      : body;
  return agent.post('/api/auth/signup').send(send);
};

describe('sign-up', () => {
  it('OS-01 AUTH-05 a student may use any email domain; a teacher needs an allowed one', async () => {
    const gmail = await signUp(student({ email: 'x@gmail.com' }));
    expect(gmail.status).toBe(202);
    expect(await User.countDocuments({ kind: 'student' })).toBe(1);
    const badTeacher = await signUp(teacher({ email: 't@gmail.com' }));
    expect(badTeacher.status).toBe(400);
    expect(badTeacher.body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    expect(await User.countDocuments({ kind: 'teacher' })).toBe(0);
    const okTeacher = await signUp(teacher({ email: 't@baiust.ac.bd' }));
    expect(okTeacher.status).toBe(202);
  });

  it('OS-03 a university address gets no special treatment for a student', async () => {
    expect((await signUp(student({ email: 'u@baiust.ac.bd' }))).status).toBe(202);
    expect((await signUp(student({ email: 'p@outlook.com' }))).status).toBe(202);
    // both get the same account: unverified student, same verification email
    const users = await User.find({ kind: 'student' }).lean();
    expect(users.map((u) => u.state)).toEqual(['email_unverified', 'email_unverified']);
    const mail = await drainMail();
    expect(mail.map((m) => m.subject)).toEqual([mail[0].subject, mail[0].subject]);
  });

  it('OS-02 a student sign-up without a CAPTCHA, or with a wrong one, is CAPTCHA_REQUIRED', async () => {
    const none = await signUp(student({ captcha: undefined }));
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('CAPTCHA_REQUIRED');
    const agent = await loginAs(null, app);
    const { id } = (await agent.get('/api/auth/captcha')).body.data;
    const wrong = await agent
      .post('/api/auth/signup')
      .send({ ...student(), captcha: { id, solution: 'not-it' } });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('CAPTCHA_REQUIRED');
    expect(await User.countDocuments()).toBe(0);
    expect(await drainMail()).toHaveLength(0);
  });

  it('OS-02 a CAPTCHA works once: reusing a solved one is refused', async () => {
    const agent = await loginAs(null, app);
    const captcha = await solveCaptcha(agent);
    const first = await agent.post('/api/auth/signup').send({ ...student(), captcha });
    expect(first.status).toBe(202);
    const again = await agent
      .post('/api/auth/signup')
      .send({ ...student({ email: 'second@gmail.com' }), captcha });
    expect(again.body.error.code).toBe('CAPTCHA_REQUIRED');
  });

  it('OS-02 OS-13 teacher sign-up keeps its behaviour: no CAPTCHA needed', async () => {
    expect((await signUp(teacher())).status).toBe(202);
  });

  it('AUTH-08 OS-02 a student signing up again with a known address gets the same answer', async () => {
    expect((await signUp(student({ email: 'same@gmail.com' }))).status).toBe(202);
    const again = await signUp(student({ email: 'same@gmail.com' }));
    expect(again.status).toBe(202);
    expect(await User.countDocuments()).toBe(1);
  });

  it('AUTH-05 a teacher subdomain is not allowed unless listed', async () => {
    const res = await signUp(teacher({ email: 'x@mail.baiust.ac.bd' }));
    expect(res.body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    await addAllowedDomain('mail.baiust.ac.bd');
    expect((await signUp(teacher({ email: 'x@mail.baiust.ac.bd' }))).status).toBe(202);
  });

  it('AUTH-01 AUTH-07 a new account is email_unverified and gets a verification email', async () => {
    const res = await signUp(student());
    expect(res.status).toBe(202);
    const user = await User.findOne().select('+password_hash');
    expect(user).toMatchObject({
      kind: 'student',
      state: 'email_unverified',
      full_name: 'Rafi Ahmed',
    });
    const [mail] = await drainMail();
    expect(mail.to).toBe('rafi@baiust.ac.bd');
    expect(mail.subject).toMatch(/confirm/i);
    expect(mail.text).toContain('/verify?token=');
  });

  it('AUTH-07 the verification link lasts 24 hours', async () => {
    await signUp(student());
    const token = await OneTimeToken.findOne({ purpose: 'verify_email' });
    expect(token.expires_at.getTime() - Date.now()).toBeGreaterThan(0);
    expect(token.expires_at.toISOString()).toBe('2030-03-05T05:00:00.000Z');
  });

  it('AUTH-06 the password is stored as an argon2id hash, never in plain text', async () => {
    await signUp(student());
    const user = await User.findOne().select('+password_hash');
    expect(user.password_hash).toMatch(/^\$argon2id\$/);
    expect(user.password_hash).not.toContain('secret-pass-1');
  });

  it('AUTH-06 weak passwords are refused with field errors', async () => {
    for (const password of ['abc1234', 'abcdefgh', '12345678', 'a1'.repeat(65)]) {
      const res = await signUp(student({ password }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.fields.password).toBeTruthy();
    }
    expect(await User.countDocuments()).toBe(0);
  });

  it('AUTH-04 a teacher gives a department and a short code (upper-cased)', async () => {
    const missing = await signUp(teacher({ department_id: undefined }));
    expect(missing.status).toBe(400);
    const res = await signUp(teacher());
    expect(res.status).toBe(202);
    expect(await User.findOne()).toMatchObject({ kind: 'teacher', requested_short_code: 'SK' });
  });

  it('AUTH-04 a teacher short code must be 1 to 10 letters', async () => {
    for (const short_code of ['', 'ABCDEFGHIJK', 'A1']) {
      const res = await signUp(teacher({ short_code }));
      expect(res.status).toBe(400);
      expect(res.body.error.fields.short_code).toBeTruthy();
    }
  });

  it('AUTH-04 a teacher department must be an active department', async () => {
    for (const department_id of [
      String(makeId()),
      (await createDepartment({ retired: true })).id,
    ]) {
      const res = await signUp(teacher({ department_id }));
      expect(res.status).toBe(400);
      expect(res.body.error.fields.department_id).toBeTruthy();
    }
    expect(await User.countDocuments()).toBe(0);
  });

  it('AUTH-04 a staff account cannot be created from the sign-up page', async () => {
    const res = await signUp(student({ kind: 'staff' }));
    expect(res.status).toBe(400);
  });

  it('AUTH-08 signing up twice gives the same response and only one account', async () => {
    const first = await signUp(student());
    const second = await signUp(student({ full_name: 'Someone Else', password: 'other-pass-22' }));
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(await User.countDocuments()).toBe(1);
    const mails = await drainMail();
    expect(mails.map((m) => m.subject)).toEqual([
      expect.stringMatching(/confirm/i),
      expect.stringMatching(/already have an account/i),
    ]);
  });

  it('AUTH-02 AUTH-08 the same address in other letters is the same account', async () => {
    await signUp(student({ email: 'rafi@baiust.ac.bd' }));
    await signUp(student({ email: 'RAFI@Baiust.ac.bd' }));
    expect(await User.countDocuments()).toBe(1);
  });

  it('AUTH-02 AUTH-08 many sign-ups at the same moment create exactly one account', async () => {
    const agents = await Promise.all(Array.from({ length: 4 }, () => loginAs(null, app)));
    const captchas = await Promise.all(agents.map((a) => solveCaptcha(a)));
    const results = await Promise.all(
      agents.map((a, i) => a.post('/api/auth/signup').send({ ...student(), captcha: captchas[i] })),
    );
    expect(results.every((r) => r.status === 202)).toBe(true);
    expect(await User.countDocuments()).toBe(1);
    const mails = await drainMail();
    expect(mails.filter((m) => /confirm/i.test(m.subject))).toHaveLength(1);
  });

  it('AUTH-03 email is stored only encrypted, looked up by its HMAC, and never returned', async () => {
    const res = await signUp(student());
    expect(JSON.stringify(res.body)).not.toContain('rafi@');
    const raw = await User.collection.findOne({});
    expect(raw.email_enc).toBeTruthy();
    expect(raw.email_enc).not.toContain('rafi');
    expect(raw.email_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(decrypt(raw.email_enc)).toBe('rafi@baiust.ac.bd');
    expect(raw).not.toHaveProperty('email');
    // not selected unless asked for
    expect((await User.findOne()).email_enc).toBeUndefined();
    expect((await User.findOne()).password_hash).toBeUndefined();
  });

  it('AUTH-09 sign-up is limited to 5 per hour per IP', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await signUp(student({ email: `n${i}@baiust.ac.bd` }))).status);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
    const res = await signUp(student({ email: 'n9@baiust.ac.bd' }));
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('AUTH-01 a state that does not belong to the kind is refused by the model', async () => {
    await expect(
      User.create({ kind: 'staff', state: 'claim_pending', full_name: 'X', email_hmac: 'h1' }),
    ).rejects.toThrow(/State is not allowed/);
    await expect(
      User.create({ kind: 'student', state: 'pending', full_name: 'X', email_hmac: 'h2' }),
    ).rejects.toThrow(/State is not allowed/);
    await expect(
      User.create({ kind: 'teacher', state: 'suspended', full_name: 'X', email_hmac: 'h3' }),
    ).resolves.toBeTruthy();
  });
});

describe('sign-up then verify (token helper)', () => {
  it('the emailed token can be read back by the test helper', async () => {
    await signUp(student());
    const [mail] = await drainMail();
    expect(tokenFrom(mail)).toMatch(/^[\w-]{40,}$/);
  });
});

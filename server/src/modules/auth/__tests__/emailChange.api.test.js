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
import { User } from '../auth.model.js';
import { AuditLog } from '../../audit/audit.model.js';
import { addAllowedDomain } from '../../organisation/index.js';
import { decrypt, emailHmac } from '../../../lib/crypto.js';

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

const NEW = 'new.address@baiust.ac.bd';
const request = (agent, email = NEW) => agent.post('/api/me/email').send({ new_email: email });
const confirm = async (token) =>
  (await loginAs(null, app)).post('/api/me/email/confirm').send({ token });

/** Ask for a change and return the token from the mail sent to the new address. */
async function requestAndGetToken(user, email = NEW) {
  const res = await request(await loginAs(user, app), email);
  expect(res.status).toBe(202);
  const mails = await drainMail();
  clearOutbox();
  const mail = mails.find((m) => m.to === email);
  expect(mail, 'the link goes to the new address').toBeTruthy();
  return tokenFrom(mail);
}

describe('POST /api/me/email (PRF-05)', () => {
  it('PRF-05 the link goes to the NEW address only, and the old email stays in use meanwhile', async () => {
    const me = await makeUser({ password: TEST_PASSWORD });
    const res = await request(await loginAs(me, app));
    expect(res.status).toBe(202);
    const mails = await drainMail();
    expect(mails.map((m) => m.to)).toEqual([NEW]);
    expect(mails[0].subject).toMatch(/new email/i);

    // the old email still signs in, the new one does not exist yet
    expect((await signIn(app, me.email, TEST_PASSWORD)).res.status).toBe(200);
    expect((await signIn(app, NEW, TEST_PASSWORD)).res.status).toBe(401);
    const user = await User.findById(me._id).select('+email_enc').lean();
    expect(decrypt(user.email_enc)).toBe(me.email);
  });

  it('PRF-05 an address outside the allowed domains → EMAIL_DOMAIN_NOT_ALLOWED', async () => {
    const res = await request(await loginAs(await makeUser(), app), 'x@gmail.com');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  });

  it('PRF-05 an address used by another account → CONFLICT', async () => {
    const other = await makeUser();
    const res = await request(await loginAs(await makeUser(), app), other.email);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await drainMail()).toHaveLength(0);
  });

  it('PRF-05 a bad address → VALIDATION_ERROR', async () => {
    const res = await request(await loginAs(await makeUser(), app), 'nope');
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PRF-05 the 4th request within an hour → RATE_LIMITED', async () => {
    const agent = await loginAs(await makeUser(), app);
    for (let i = 0; i < 3; i++)
      expect((await request(agent, `a${i}@baiust.ac.bd`)).status).toBe(202);
    const res = await request(agent, 'a9@baiust.ac.bd');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeTruthy();
  });

  it('PRF-05 a newer request cancels the earlier link', async () => {
    const me = await makeUser();
    const first = await requestAndGetToken(me, 'first@baiust.ac.bd');
    const second = await requestAndGetToken(me, 'second@baiust.ac.bd');
    expect((await confirm(first)).body.error.code).toBe('TOKEN_INVALID');
    expect((await confirm(second)).status).toBe(200);
  });

  it('PRF-09 email_unverified → 403 STATE_NOT_ALLOWED', async () => {
    const res = await request(await loginAs(await makeUser({ state: 'email_unverified' }), app));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('PRF-05 anonymous → 401', async () => {
    expect((await request(await loginAs(null, app))).status).toBe(401);
  });
});

describe('POST /api/me/email/confirm (PRF-05, PRF-08)', () => {
  it('PRF-05 after confirming only the new email works, and the old address got a notice', async () => {
    const me = await makeUser({ password: TEST_PASSWORD, name: 'Rafi Ahmed' });
    await User.updateOne({ _id: me._id }, { $set: { email_bouncing: true } });
    const token = await requestAndGetToken(me);

    const res = await confirm(token);
    expect(res.status).toBe(200);

    expect((await signIn(app, NEW, TEST_PASSWORD)).res.status).toBe(200);
    expect((await signIn(app, me.email, TEST_PASSWORD)).res.status).toBe(401);

    const user = await User.findById(me._id).select('+email_enc').lean();
    expect(decrypt(user.email_enc)).toBe(NEW);
    expect(user.email_hmac).toBe(emailHmac(NEW));
    expect(user.email_bouncing).toBe(false);

    const mails = await drainMail();
    const notice = mails.find((m) => m.to === me.email);
    expect(notice, 'the old address is told').toBeTruthy();
    expect(notice.subject).toMatch(/changed/i);
    expect(mails.some((m) => m.to === NEW)).toBe(false);
  });

  it('PRF-05 a link used twice → TOKEN_INVALID the second time', async () => {
    const token = await requestAndGetToken(await makeUser());
    expect((await confirm(token)).status).toBe(200);
    const again = await confirm(token);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });

  it('PRF-05 a link used after 24 hours → TOKEN_INVALID', async () => {
    const me = await makeUser();
    const token = await requestAndGetToken(me);
    fixClock('2030-03-05T05:01:00Z');
    expect((await confirm(token)).body.error.code).toBe('TOKEN_INVALID');
    fixClock('2030-03-05T04:59:00Z');
    expect((await confirm(token)).status).toBe(200);
  });

  it('PRF-05 an unknown token → TOKEN_INVALID', async () => {
    expect((await confirm('x'.repeat(40))).body.error.code).toBe('TOKEN_INVALID');
  });

  it('PRF-05 another account took the address before the link was used → CONFLICT, link stays unused', async () => {
    const me = await makeUser({ password: TEST_PASSWORD });
    const token = await requestAndGetToken(me);
    await makeUser({ email: NEW });
    const res = await confirm(token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    const user = await User.findById(me._id).select('+email_enc').lean();
    expect(decrypt(user.email_enc)).toBe(me.email);
    expect(await drainMail()).toHaveLength(0);
  });

  it('PRF-08 the change is audited without either address', async () => {
    const me = await makeUser();
    await confirm(await requestAndGetToken(me));
    const entries = await AuditLog.find({ action: 'user.email_change' }).lean();
    expect(entries).toHaveLength(1);
    expect(String(entries[0].target_id)).toBe(String(me._id));
    const text = JSON.stringify(entries[0]);
    expect(text).not.toContain(NEW);
    expect(text).not.toContain(me.email);
  });

  it('PRF-05 two clicks at the same time: one wins, the other gets TOKEN_INVALID', async () => {
    const token = await requestAndGetToken(await makeUser());
    const results = await Promise.all([confirm(token), confirm(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(results.find((r) => r.status === 400).body.error.code).toBe('TOKEN_INVALID');
  });

  it('PRF-05 two accounts confirming the same new address at the same time: exactly one wins', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const tokenA = await requestAndGetToken(a);
    const tokenB = await requestAndGetToken(b);
    const results = await Promise.all([confirm(tokenA), confirm(tokenB)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await User.countDocuments({ email_hmac: emailHmac(NEW) })).toBe(1);
  });
});

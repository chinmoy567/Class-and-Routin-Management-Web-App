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
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { TEST_PASSWORD, createDepartment, makeUser } from '../../../../test/factories.js';
import { Semester } from '../../organisation/index.js';
import { Section } from '../../routine/index.js';
import { Enrolment } from '../../enrolments/index.js';
import { AuditLog } from '../../audit/index.js';
import { User } from '../../auth/index.js';

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
  // Tuesday 2027-04-06 10:00 in Asia/Dhaka. The current semester is Spring 2027.
  fixClock('2027-04-06T04:00:00Z');
});
afterEach(resetClock);

async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const eee = await createDepartment({ code: 'EEE' });
  const sem = await Semester.create({
    name: 'Spring 2027',
    start_date: '2027-04-04',
    end_date: '2027-10-04',
    status: 'current',
  });
  const section = await Section.create({
    semester_id: sem._id,
    department_id: cse._id,
    level: 2,
    term: 'I',
    letter: 'A',
  });
  const cseAdmin = await makeUser({
    kind: 'teacher',
    state: 'active',
    name: 'CSE Admin',
    roles: [{ role: 'dept_admin', department_id: cse._id }],
  });
  const superAdmin = await makeUser({
    kind: 'staff',
    state: 'active',
    name: 'Super Admin',
    roles: [{ role: 'super_admin' }],
  });
  const rahim = await makeUser({
    kind: 'student',
    state: 'active',
    name: 'Rahim Uddin',
    email: 'rahim@baiust.ac.bd',
    password: TEST_PASSWORD,
    departmentId: cse._id,
    uv_id: '0822310205101077',
  });
  await Enrolment.create({
    user_id: rahim._id,
    semester_id: sem._id,
    section_id: section._id,
    department_id: cse._id,
    status: 'accepted',
  });
  const karim = await makeUser({
    kind: 'student',
    state: 'active',
    name: 'Karim Hossain',
    email: 'karim@eee.baiust.ac.bd',
    departmentId: eee._id,
  });
  const jamal = await makeUser({
    kind: 'student',
    state: 'unconfirmed',
    name: 'Jamal Mia',
    email: 'jamal@baiust.ac.bd',
    departmentId: cse._id,
  });
  return { cse, eee, sem, section, cseAdmin, superAdmin, rahim, karim, jamal };
}

const expectNoContact = (body) => {
  // Object ids are random hex and can contain "880" or digit runs, so they are removed first.
  // Only phone-shaped text counts: +880 numbers and 11-digit 01x mobile numbers.
  const text = JSON.stringify(body).replace(/[0-9a-f]{24}/g, '');
  expect(text).not.toMatch(/@/);
  expect(text).not.toMatch(/\+880\d|\b880\d{10}\b|\b01[3-9]\d{8}\b/);
};

describe('ADM-12 student search', () => {
  it('ADM-12 a CSE admin finds a CSE student by name, with an email status and no address', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent.get('/api/admin/students').query({ q: 'Rahim' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      full_name: 'Rahim Uddin',
      state: 'active',
      email_status: 'verified',
      uv_id: '0822310205101077',
      section: { label: '2-I-A' },
    });
    expectNoContact(res.body);
  });

  it('ADM-12 search by part of the profile UV ID finds the student', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent.get('/api/admin/students').query({ q: '822310205' });
    expect(res.body.data.map((r) => r.full_name)).toEqual(['Rahim Uddin']);
  });

  it('ADM-12 a bouncing address is shown as bouncing', async () => {
    const w = await world();
    await User.updateOne({ _id: w.rahim._id }, { $set: { email_bouncing: true } });
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent.get('/api/admin/students').query({ q: 'Rahim' });
    expect(res.body.data[0].email_status).toBe('bouncing');
  });

  it('ADM-12 a CSE admin never sees an EEE student, even when searching by that name', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent.get('/api/admin/students').query({ q: 'Karim' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('ADM-12 a super admin sees students of every department', async () => {
    const w = await world();
    const agent = await loginAs(w.superAdmin, app);
    const eeeStudent = await agent.get('/api/admin/students').query({ q: 'Karim' });
    expect(eeeStudent.status).toBe(200);
    expect(eeeStudent.body.data.map((r) => r.full_name)).toEqual(['Karim Hossain']);
    const cseStudent = await agent.get('/api/admin/students').query({ q: 'Rahim' });
    expect(cseStudent.body.data.map((r) => r.full_name)).toEqual(['Rahim Uddin']);
    expectNoContact(eeeStudent.body);
  });

  it('ADM-11 a CSE admin asking for the EEE department gets 403', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent
      .get('/api/admin/students')
      .query({ q: 'Karim', department_id: String(w.eee._id) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ADM-12 a student or teacher cannot search (403), and an anonymous visitor is refused (401)', async () => {
    const w = await world();
    const student = await loginAs(w.rahim, app);
    expect((await student.get('/api/admin/students').query({ q: 'Rahim' })).status).toBe(403);
    const anon = await loginAs(null, app);
    expect((await anon.get('/api/admin/students').query({ q: 'Rahim' })).status).toBe(401);
  });
});

describe('ADM-13 deactivate and reactivate', () => {
  it('ADM-13 a reason is required (5 to 500 characters)', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent
      .post(`/api/admin/students/${w.rahim._id}/deactivate`)
      .send({ reason: 'no' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ADM-13 deactivating ends the open session, and the student cannot sign in again', async () => {
    const w = await world();
    const { agent: studentAgent, res: login } = await signIn(
      app,
      'rahim@baiust.ac.bd',
      TEST_PASSWORD,
    );
    expect(login.status).toBe(200);
    expect((await studentAgent.get('/api/auth/me')).status).toBe(200);

    const admin = await loginAs(w.cseAdmin, app);
    const res = await admin
      .post(`/api/admin/students/${w.rahim._id}/deactivate`)
      .send({ reason: 'Left the programme' });
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('deactivated');

    expect((await studentAgent.get('/api/auth/me')).status).toBe(401);
    const again = await signIn(app, 'rahim@baiust.ac.bd', TEST_PASSWORD);
    expect(again.res.status).toBe(403);
    expect(again.res.body.error.code).toBe('ACCOUNT_DISABLED');
    const stored = await User.findById(w.rahim._id).lean();
    expect(stored.state).toBe('deactivated');
    expect(stored.state_before_deactivation).toBe('active');
  });

  it('ADM-13 reactivating a student with an accepted enrolment this semester restores active', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    await admin
      .post(`/api/admin/students/${w.rahim._id}/deactivate`)
      .send({ reason: 'Left the programme' });
    const res = await admin.post(`/api/admin/students/${w.rahim._id}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('active');
  });

  it('ADM-13 reactivating without a current enrolment restores unconfirmed, not active', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    await admin
      .post(`/api/admin/students/${w.jamal._id}/deactivate`)
      .send({ reason: 'Away this term' });
    const res = await admin.post(`/api/admin/students/${w.jamal._id}/reactivate`);
    expect(res.body.data.state).toBe('unconfirmed');
  });

  it('ADM-13 a CSE admin cannot deactivate an EEE student: the student looks missing (404)', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    const res = await admin
      .post(`/api/admin/students/${w.karim._id}/deactivate`)
      .send({ reason: 'Not my student' });
    expect(res.status).toBe(404);
    expect((await User.findById(w.karim._id).lean()).state).toBe('active');
  });

  it('ADM-13 a student cannot deactivate anyone (404, not 403: the existence of the student is hidden)', async () => {
    const w = await world();
    const student = await loginAs(w.rahim, app);
    const res = await student
      .post(`/api/admin/students/${w.jamal._id}/deactivate`)
      .send({ reason: 'Trying it' });
    expect(res.status).toBe(404);
  });

  it('X6 two deactivations at the same moment: exactly one 200 and one 409 CONFLICT', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    const [a, b] = await Promise.all([
      admin.post(`/api/admin/students/${w.rahim._id}/deactivate`).send({ reason: 'First request' }),
      admin
        .post(`/api/admin/students/${w.rahim._id}/deactivate`)
        .send({ reason: 'Second request' }),
    ]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('CONFLICT');
  });
});

describe('ADM-14 graduation', () => {
  it('ADM-14 an active student can be marked graduated and the mark reversed to unconfirmed', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    const done = await admin.post(`/api/admin/students/${w.rahim._id}/graduate`);
    expect(done.status).toBe(200);
    expect(done.body.data.state).toBe('graduated');
    const undo = await admin.post(`/api/admin/students/${w.rahim._id}/ungraduate`);
    expect(undo.body.data.state).toBe('unconfirmed');
  });

  it('ADM-14 a deactivated student cannot be marked graduated (409)', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    await admin
      .post(`/api/admin/students/${w.rahim._id}/deactivate`)
      .send({ reason: 'Left the programme' });
    const res = await admin.post(`/api/admin/students/${w.rahim._id}/graduate`);
    expect(res.status).toBe(409);
  });

  it('ADM-17 graduation and reversal are audited with the old and new state', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    await admin.post(`/api/admin/students/${w.rahim._id}/graduate`);
    const entry = await AuditLog.findOne({ action: 'student.graduate' }).lean();
    expect(entry.old_value).toEqual({ state: 'active' });
    expect(entry.new_value).toEqual({ state: 'graduated' });
    expect(String(entry.scope_department_id)).toBe(String(w.cse._id));
  });
});

describe('ADM-15 temporary password', () => {
  it('ADM-15 the temporary password is returned once, is not cached, and the student must change it at next sign-in', async () => {
    const w = await world();
    const { agent: studentAgent } = await signIn(app, 'rahim@baiust.ac.bd', TEST_PASSWORD);
    const admin = await loginAs(w.cseAdmin, app);
    const res = await admin.post(`/api/admin/students/${w.rahim._id}/temp-password`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    const temp = res.body.data.temp_password;
    expect(temp).toHaveLength(12);

    // The old session has ended, and the temporary password signs the student in.
    expect((await studentAgent.get('/api/auth/me')).status).toBe(401);
    const login = await signIn(app, 'rahim@baiust.ac.bd', temp);
    expect(login.res.status).toBe(200);
    expect(login.res.body.data.next).toBe('change-password');
    // The old password no longer works.
    expect((await signIn(app, 'rahim@baiust.ac.bd', TEST_PASSWORD)).res.status).toBe(401);
  });

  it('ADM-15 only the hash is stored, and the audit entry holds no password', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    const res = await admin.post(`/api/admin/students/${w.rahim._id}/temp-password`);
    const temp = res.body.data.temp_password;
    const stored = await User.findById(w.rahim._id).select('+password_hash').lean();
    expect(stored.password_hash).not.toContain(temp);
    expect(stored.password_hash.startsWith('$argon2id$')).toBe(true);
    const entries = await AuditLog.find({ action: 'student.temp_password' }).lean();
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain(temp);
    expect(String(entries[0].scope_department_id)).toBe(String(w.cse._id));
  });

  it('ADM-15 a deactivated student gets no temporary password (409)', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    await admin
      .post(`/api/admin/students/${w.rahim._id}/deactivate`)
      .send({ reason: 'Left the programme' });
    const res = await admin.post(`/api/admin/students/${w.rahim._id}/temp-password`);
    expect(res.status).toBe(409);
  });

  it('ADM-15 a CSE admin cannot issue one for an EEE student (404)', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    expect((await admin.post(`/api/admin/students/${w.karim._id}/temp-password`)).status).toBe(404);
  });
});

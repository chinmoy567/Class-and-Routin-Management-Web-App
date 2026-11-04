import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  fixClock,
  loginAs,
  resetClock,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { Semester } from '../../organisation/index.js';
import { Section, SectionGroup } from '../../routine/index.js';
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
  fixClock('2027-04-06T04:00:00Z');
});
afterEach(resetClock);

/** CSE and EEE with one section each in the current semester, a G1 group in CSE, and one admin of each. */
async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const eee = await createDepartment({ code: 'EEE' });
  const sem = await Semester.create({
    name: 'Spring 2027',
    start_date: '2027-04-04',
    end_date: '2027-10-04',
    status: 'current',
  });
  const cseSection = await Section.create({
    semester_id: sem._id,
    department_id: cse._id,
    level: 2,
    term: 'I',
    letter: 'A',
  });
  const eeeSection = await Section.create({
    semester_id: sem._id,
    department_id: eee._id,
    level: 2,
    term: 'I',
    letter: 'A',
  });
  const g1 = await SectionGroup.create({ section_id: cseSection._id, label: 'G1' });
  const cseAdmin = await makeUser({
    kind: 'teacher',
    state: 'active',
    roles: [{ role: 'dept_admin', department_id: cse._id }],
  });
  const cseStudent = await makeUser({
    kind: 'student',
    state: 'active',
    departmentId: cse._id,
    uv_id: '111',
  });
  const eeeStudent = await makeUser({ kind: 'student', state: 'active', departmentId: eee._id });
  const cseEnrol = await Enrolment.create({
    user_id: cseStudent._id,
    semester_id: sem._id,
    section_id: cseSection._id,
    department_id: cse._id,
    status: 'accepted',
  });
  const eeeEnrol = await Enrolment.create({
    user_id: eeeStudent._id,
    semester_id: sem._id,
    section_id: eeeSection._id,
    department_id: eee._id,
    status: 'accepted',
  });
  const eeeAppeal = await Enrolment.create({
    user_id: (await makeUser({ kind: 'student', state: 'claim_pending', departmentId: eee._id }))
      ._id,
    semester_id: sem._id,
    section_id: eeeSection._id,
    department_id: eee._id,
    status: 'rejected',
    reason: 'Wrong section',
    appeal: { at: new Date(), status: 'open' },
  });
  return {
    cse,
    eee,
    sem,
    cseSection,
    eeeSection,
    g1,
    cseAdmin,
    cseStudent,
    eeeStudent,
    cseEnrol,
    eeeEnrol,
    eeeAppeal,
  };
}

describe('ADM-16 admin actions stay in the admin department', () => {
  it('ADM-16 a CSE admin sets a CSE student group by hand: it is stored as an admin override and audited', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent
      .patch(`/api/enrolments/${w.cseEnrol._id}/group`)
      .send({ group_id: String(w.g1._id) });
    expect(res.status).toBe(200);
    const row = await Enrolment.findById(w.cseEnrol._id).lean();
    expect(row.group_set_by).toBe('admin');
    expect(String(row.group_id)).toBe(String(w.g1._id));
    expect(await AuditLog.countDocuments({ action: 'join.group_change' })).toBe(1);
  });

  it('ADM-16 a CSE admin cannot set the group of an EEE student: refused and nothing changes', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent
      .patch(`/api/enrolments/${w.eeeEnrol._id}/group`)
      .send({ group_id: null });
    expect(res.status).toBe(404);
    expect((await Enrolment.findById(w.eeeEnrol._id).lean()).group_set_by).toBeUndefined();
  });

  it('ADM-16 and OS-11 a CSE admin removes a CSE student from the section with a reason; the account goes back to waiting', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent
      .post(`/api/admin/enrolments/${w.cseEnrol._id}/remove`)
      .send({ reason: 'Checked in person with the office' });
    expect(res.status).toBe(200);
    expect((await Enrolment.findById(w.cseEnrol._id).lean()).status).toBe('revoked');
    expect((await User.findById(w.cseStudent._id).lean()).state).toBe('claim_pending');
    expect(await AuditLog.countDocuments({ action: 'join.remove' })).toBe(1);
  });

  it('ADM-16 and OS-11 a CSE admin cannot remove an EEE student: 403 and the membership stays', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent
      .post(`/api/admin/enrolments/${w.eeeEnrol._id}/remove`)
      .send({ reason: 'Not my department' });
    expect(res.status).toBe(403);
    expect((await Enrolment.findById(w.eeeEnrol._id).lean()).status).toBe('accepted');
    expect((await User.findById(w.eeeStudent._id).lean()).state).toBe('active');
    expect(await AuditLog.countDocuments({ action: 'join.remove' })).toBe(0);
  });

  it('ADM-16 a CSE admin cannot decide an EEE appeal: refused and the rejection stays open', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent
      .post(`/api/admin/enrolments/${w.eeeAppeal._id}/appeal-decision`)
      .send({ decision: 'reverse' });
    expect(res.status).toBe(403);
    expect((await Enrolment.findById(w.eeeAppeal._id).lean()).status).toBe('rejected');
  });

  it('ADM-16 a CSE admin decides a CSE appeal: upholding it closes the appeal', async () => {
    const w = await world();
    const cseAppeal = await Enrolment.create({
      user_id: (
        await makeUser({ kind: 'student', state: 'claim_pending', departmentId: w.cse._id })
      )._id,
      semester_id: w.sem._id,
      section_id: w.cseSection._id,
      department_id: w.cse._id,
      status: 'rejected',
      reason: 'Wrong section',
      appeal: { at: new Date(), status: 'open' },
    });
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent
      .post(`/api/admin/enrolments/${cseAppeal._id}/appeal-decision`)
      .send({ decision: 'uphold' });
    expect(res.status).toBe(200);
    expect((await Enrolment.findById(cseAppeal._id).lean()).appeal.status).toBe('upheld');
  });
});

describe('ADM-17 nothing is hard-deleted', () => {
  it('ADM-17 deactivating keeps the account, its enrolment and its profile UV ID, and the audit shows old and new state', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent
      .post(`/api/admin/students/${w.cseStudent._id}/deactivate`)
      .send({ reason: 'Left the programme' });
    expect(res.status).toBe(200);
    expect(await User.exists({ _id: w.cseStudent._id })).toBeTruthy();
    expect(await Enrolment.exists({ _id: w.cseEnrol._id })).toBeTruthy();
    expect((await User.findById(w.cseStudent._id).lean()).uv_id).toBe('111');
    const entry = await AuditLog.findOne({ action: 'student.deactivate' }).lean();
    expect(entry.old_value).toEqual({ state: 'active' });
    expect(entry.new_value).toMatchObject({ state: 'deactivated', reason: 'Left the programme' });
  });
});

describe('ADM-22 no admin response carries an email or a phone', () => {
  it('ADM-22 every admin list and dashboard response is free of the seeded addresses and of the @ sign', async () => {
    const w = await world();
    await makeUser({
      kind: 'student',
      state: 'active',
      email: 'secret.one@baiust.ac.bd',
      departmentId: w.cse._id,
      name: 'Secret One',
    });
    await makeUser({
      kind: 'teacher',
      state: 'pending',
      email: 'secret.two@baiust.ac.bd',
      name: 'Secret Two',
    });
    const { TeacherRegistration } = await import('../../teachers/teachers.model.js');
    const pending = await makeUser({
      kind: 'teacher',
      state: 'pending',
      email: 'secret.three@baiust.ac.bd',
      name: 'Secret Three',
    });
    await TeacherRegistration.create({
      user_id: pending._id,
      department_id: w.cse._id,
      requested_short_code: 'CSE09',
    });
    const agent = await loginAs(w.cseAdmin, app);
    const urls = [
      '/api/admin/dashboard',
      '/api/admin/students?q=Secret',
      '/api/admin/flags',
      '/api/admin/audit',
      '/api/admin/join-requests?view=appeals',
      '/api/admin/join-requests?view=rejected',
    ];
    for (const url of urls) {
      const res = await agent.get(url);
      expect(res.status, url).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text, url).not.toMatch(/secret\.(one|two|three)@|@baiust|\+?880/);
    }
  });
});

describe('X6 concurrency for reactivate and graduate', () => {
  it('X6 two reactivations at the same moment: exactly one 200 and one 409 CONFLICT', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    await admin
      .post(`/api/admin/students/${w.cseStudent._id}/deactivate`)
      .send({ reason: 'Away this term' });
    const [a, b] = await Promise.all([
      admin.post(`/api/admin/students/${w.cseStudent._id}/reactivate`),
      admin.post(`/api/admin/students/${w.cseStudent._id}/reactivate`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('CONFLICT');
    expect((await User.findById(w.cseStudent._id).lean()).state).toBe('active');
  });

  it('X6 two graduations at the same moment: exactly one 200 and one 409 CONFLICT', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    const [a, b] = await Promise.all([
      admin.post(`/api/admin/students/${w.cseStudent._id}/graduate`),
      admin.post(`/api/admin/students/${w.cseStudent._id}/graduate`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('CONFLICT');
    expect((await User.findById(w.cseStudent._id).lean()).state).toBe('graduated');
  });
});

describe('S24 a teacher without an admin role is refused every admin read', () => {
  it('ADM-11 a teacher with no admin role gets 403 on each admin read, even with a department filter', async () => {
    const w = await world();
    const teacher = await makeUser({ kind: 'teacher', state: 'active', departmentId: w.cse._id });
    const agent = await loginAs(teacher, app);
    const dep = String(w.cse._id);
    for (const url of [
      '/api/admin/dashboard',
      `/api/admin/dashboard?department_id=${dep}`,
      `/api/admin/students?q=Rahim&department_id=${dep}`,
      `/api/admin/flags?department_id=${dep}`,
      '/api/admin/audit',
    ]) {
      const res = await agent.get(url);
      expect(res.status, url).toBe(403);
    }
  });
});

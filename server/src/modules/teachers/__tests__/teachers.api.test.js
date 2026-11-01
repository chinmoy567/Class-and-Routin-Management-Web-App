import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTestApp,
  clearDb,
  clearOutbox,
  connectTestDb,
  disconnectTestDb,
  drainMail,
  loginAs,
  signIn,
  startTestMail,
  stopTestMail,
  tokenFrom,
} from '../../../../test/harness.js';
import { createDepartment, makeUser, TEST_PASSWORD } from '../../../../test/factories.js';
import {
  findByCode,
  fullNames,
  registerLinkChangeListener,
  registerSectionsProvider,
  resetTeacherProviders,
  sectionsTaughtBy,
  Teacher,
  TeacherRegistration,
} from '../index.js';
import { User, UserRole } from '../../auth/index.js';
import { addAllowedDomain } from '../../organisation/index.js';
import { list as auditList } from '../../audit/index.js';

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
  await addAllowedDomain('baiust.ac.bd');
});
afterEach(resetTeacherProviders);

const asDeptAdmin = async (dept) =>
  loginAs(
    await makeUser({ kind: 'staff', roles: [{ role: 'dept_admin', department_id: dept._id }] }),
    app,
  );
const asSuper = async () =>
  loginAs(await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] }), app);

/** A signed-up and verified teacher: pending, with a pending registration. */
async function pendingTeacher(dept, code = 'AR', extra = {}) {
  const user = await makeUser({
    kind: 'teacher',
    state: 'pending',
    name: 'Abdur Rahman',
    password: TEST_PASSWORD,
    departmentId: dept._id,
    ...extra,
  });
  const reg = await TeacherRegistration.create({
    user_id: user._id,
    department_id: dept._id,
    requested_short_code: code,
  });
  return { user, reg };
}

/** An approved, active teacher holding the teacher role in the department. */
const activeTeacher = (dept, extra = {}) =>
  makeUser({
    kind: 'teacher',
    roles: [{ role: 'teacher', department_id: dept._id }],
    departmentId: dept._id,
    password: TEST_PASSWORD,
    ...extra,
  });

const decide = (agent, id, body) =>
  agent.post(`/api/admin/teacher-registrations/${id}/decision`).send(body);

describe('teacher registration (spec 06)', () => {
  it('TCH-01 verifying a teacher email creates a pending registration', async () => {
    const dept = await createDepartment();
    const agent = await loginAs(null, app);
    await agent.post('/api/auth/signup').send({
      kind: 'teacher',
      full_name: 'Salma Khatun',
      email: 'salma@baiust.ac.bd',
      password: 'secret-pass-1',
      department_id: dept.id,
      short_code: 'sk',
    });
    const token = tokenFrom((await drainMail()).at(-1));
    const res = await (await loginAs(null, app)).post('/api/auth/verify').send({ token });
    expect(res.status).toBe(200);
    const regs = await TeacherRegistration.find().lean();
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({ status: 'pending', requested_short_code: 'SK' });
    expect(String(regs[0].department_id)).toBe(dept.id);
  });

  it('TCH-02 the department admin sees pending registrations with email and earlier rejections', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const { user, reg } = await pendingTeacher(cse, 'AR', { email: 'ar@baiust.ac.bd' });
    await TeacherRegistration.create({
      user_id: user._id,
      department_id: cse._id,
      requested_short_code: 'XX',
      status: 'rejected',
      reason: 'Wrong short code',
      created_at: new Date('2020-01-01'),
    });
    await pendingTeacher(eee, 'ZZ');
    const res = await (
      await asDeptAdmin(cse)
    ).get('/api/admin/teacher-registrations?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: String(reg._id),
      full_name: 'Abdur Rahman',
      email: 'ar@baiust.ac.bd',
      requested_short_code: 'AR',
    });
    expect(res.body.data[0].earlier_rejections).toEqual([
      expect.objectContaining({ reason: 'Wrong short code' }),
    ]);
  });

  it('TCH-02 a super admin sees every department; others are refused', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    await pendingTeacher(cse);
    await pendingTeacher(eee, 'ZZ');
    expect(
      (await (await asSuper()).get('/api/admin/teacher-registrations')).body.data,
    ).toHaveLength(2);
    const admin = await asDeptAdmin(cse);
    expect(
      (await admin.get(`/api/admin/teacher-registrations?department_id=${eee.id}`)).status,
    ).toBe(403);
    const student = await loginAs(await makeUser({ kind: 'student' }), app);
    expect((await student.get('/api/admin/teacher-registrations')).status).toBe(403);
    const teacher = await loginAs(await activeTeacher(cse), app);
    expect((await teacher.get('/api/admin/teacher-registrations')).status).toBe(403);
  });

  it('TCH-03 approving activates the account, grants the teacher role and emails the teacher', async () => {
    const cse = await createDepartment();
    const { user, reg } = await pendingTeacher(cse);
    const res = await decide(await asDeptAdmin(cse), reg._id, { decision: 'approve' });
    expect(res.status).toBe(200);
    expect((await User.findById(user._id)).state).toBe('active');
    expect(
      await UserRole.exists({ user_id: user._id, role: 'teacher', department_id: cse._id }),
    ).toBeTruthy();
    expect((await TeacherRegistration.findById(reg._id)).status).toBe('approved');
    const mails = await drainMail();
    expect(mails.some((m) => m.subject.includes('approved'))).toBe(true);
  });

  it('TCH-03 two admins approving at once: one 200, one 409 ALREADY_DECIDED', async () => {
    const cse = await createDepartment();
    const { reg } = await pendingTeacher(cse);
    const a = await asDeptAdmin(cse);
    const b = await asDeptAdmin(cse);
    const results = await Promise.all([
      decide(a, reg._id, { decision: 'approve' }),
      decide(b, reg._id, { decision: 'approve' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('ALREADY_DECIDED');
    expect(await UserRole.countDocuments({ role: 'teacher' })).toBe(1);
  });

  it('TCH-03 an approve and a reject at once: only one wins', async () => {
    const cse = await createDepartment();
    const { reg } = await pendingTeacher(cse);
    const results = await Promise.all([
      decide(await asDeptAdmin(cse), reg._id, { decision: 'approve' }),
      decide(await asDeptAdmin(cse), reg._id, { decision: 'reject', reason: 'No such teacher' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('TCH-03 deciding again is ALREADY_DECIDED', async () => {
    const cse = await createDepartment();
    const { reg } = await pendingTeacher(cse);
    const admin = await asDeptAdmin(cse);
    await decide(admin, reg._id, { decision: 'approve' });
    const again = await decide(admin, reg._id, { decision: 'approve' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('TCH-04 rejecting without a reason (or a short one) is VALIDATION_ERROR', async () => {
    const cse = await createDepartment();
    const { reg } = await pendingTeacher(cse);
    const admin = await asDeptAdmin(cse);
    for (const body of [{ decision: 'reject' }, { decision: 'reject', reason: 'no' }]) {
      const res = await decide(admin, reg._id, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const long = await decide(admin, reg._id, { decision: 'reject', reason: 'x'.repeat(501) });
    expect(long.status).toBe(400);
    expect((await TeacherRegistration.findById(reg._id)).status).toBe('pending');
  });

  it('TCH-04 rejecting keeps the account pending, emails the reason and shows the rejected screen', async () => {
    const cse = await createDepartment();
    const { user, reg } = await pendingTeacher(cse);
    const res = await decide(await asDeptAdmin(cse), reg._id, {
      decision: 'reject',
      reason: 'We have no teacher with that code',
    });
    expect(res.status).toBe(200);
    expect((await User.findById(user._id)).state).toBe('pending');
    const saved = await TeacherRegistration.findById(reg._id);
    expect(saved).toMatchObject({
      status: 'rejected',
      reason: 'We have no teacher with that code',
    });
    const mails = await drainMail();
    expect(mails.find((m) => m.subject.includes('not approved')).text).toContain(
      'We have no teacher with that code',
    );
    const { agent, res: login } = await signIn(app, user.email, TEST_PASSWORD);
    expect(login.body.data.next).toBe('teacher-rejected');
    const mine = await agent.get('/api/me/teacher-registration');
    expect(mine.body.data).toMatchObject({ status: 'rejected', reason: expect.any(String) });
  });

  it('TCH-05 a rejected teacher applies again, and the admin sees the earlier rejection', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const { user, reg } = await pendingTeacher(cse);
    await decide(await asDeptAdmin(cse), reg._id, {
      decision: 'reject',
      reason: 'Wrong department',
    });
    const { agent } = await signIn(app, user.email, TEST_PASSWORD);
    const res = await agent
      .post('/api/me/teacher-registration')
      .send({ department_id: eee.id, short_code: 'ar' });
    expect(res.status).toBe(201);
    const list = await (await asDeptAdmin(eee)).get('/api/admin/teacher-registrations');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ requested_short_code: 'AR' });
    expect(list.body.data[0].earlier_rejections[0].reason).toBe('Wrong department');
    const { res: login } = await signIn(app, user.email, TEST_PASSWORD);
    expect(login.body.data.next).toBe('waiting-approval');
  });

  it('TCH-05 only one pending registration per account, even for requests at once', async () => {
    const cse = await createDepartment();
    const { user } = await pendingTeacher(cse);
    const { agent } = await signIn(app, user.email, TEST_PASSWORD);
    const sent = await Promise.all(
      [1, 2, 3].map(() =>
        agent
          .post('/api/me/teacher-registration')
          .send({ department_id: cse.id, short_code: 'AR' }),
      ),
    );
    expect(sent.every((r) => r.status === 409)).toBe(true);
    expect(sent[0].body.error.code).toBe('CONFLICT');
    expect(await TeacherRegistration.countDocuments({ status: 'pending' })).toBe(1);
  });

  it('TCH-05 apply again is refused for students and active teachers', async () => {
    const cse = await createDepartment();
    for (const user of [await makeUser({ kind: 'student' }), await activeTeacher(cse)]) {
      const res = await (
        await loginAs(user, app)
      )
        .post('/api/me/teacher-registration')
        .send({ department_id: cse.id, short_code: 'AR' });
      expect(res.status).toBe(403);
    }
  });

  it('TCH-06 approval and rejection are audited', async () => {
    const cse = await createDepartment();
    const one = await pendingTeacher(cse, 'AR');
    const two = await pendingTeacher(cse, 'BB');
    const admin = await asDeptAdmin(cse);
    await decide(admin, one.reg._id, { decision: 'approve' });
    await decide(admin, two.reg._id, { decision: 'reject', reason: 'Not a teacher here' });
    expect(await auditList({ action: 'teacher.registration.approve' })).toHaveLength(1);
    const [rejected] = await auditList({ action: 'teacher.registration.reject' });
    expect(rejected.new_value.reason).toBe('Not a teacher here');
    expect(String(rejected.scope_department_id)).toBe(cse.id);
  });

  it('a CSE admin deciding an EEE registration is 403 and changes nothing', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const { reg } = await pendingTeacher(eee);
    const res = await decide(await asDeptAdmin(cse), reg._id, { decision: 'approve' });
    expect(res.status).toBe(403);
    expect((await TeacherRegistration.findById(reg._id)).status).toBe('pending');
  });
});

describe('teacher records and linking (spec 06)', () => {
  const addRecord = (agent, dept, short_code = 'AR', full_name = 'Dr. Abdur Rahman') =>
    agent.post('/api/admin/teachers').send({ department_id: dept.id, short_code, full_name });

  it('TCH-07 an admin adds a record; a duplicate code in the department is a CONFLICT', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const res = await addRecord(agent, cse, 'ar');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ short_code: 'AR', linked: false });
    const dup = await addRecord(agent, cse, 'AR', 'Someone Else');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    expect(await auditList({ action: 'teacher.record.create' })).toHaveLength(1);
  });

  it('TCH-07 TBA is reserved and never a record', async () => {
    const cse = await createDepartment();
    const res = await addRecord(await asDeptAdmin(cse), cse, 'tba');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Teacher.countDocuments()).toBe(0);
  });

  it('TCH-07 a record can be renamed, and the list shows its link status', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const id = (await addRecord(agent, cse)).body.data.id;
    const res = await agent
      .patch(`/api/admin/teachers/${id}`)
      .send({ full_name: 'Prof. A. Rahman' });
    expect(res.status).toBe(200);
    const list = await agent.get(`/api/admin/teachers?department_id=${cse.id}`);
    expect(list.body.data[0]).toMatchObject({ full_name: 'Prof. A. Rahman', linked: false });
  });

  it('TCH-08 an admin links an active teacher; a second account for the same record is a CONFLICT', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const id = (await addRecord(agent, cse)).body.data.id;
    const first = await activeTeacher(cse);
    const second = await activeTeacher(cse);
    const ok = await agent
      .post(`/api/admin/teachers/${id}/link`)
      .send({ user_id: String(first._id) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.linked_user.id).toBe(String(first._id));
    const dup = await agent
      .post(`/api/admin/teachers/${id}/link`)
      .send({ user_id: String(second._id) });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });

  it('TCH-08 two links at once for one record: one wins', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const id = (await addRecord(agent, cse)).body.data.id;
    const users = [await activeTeacher(cse), await activeTeacher(cse)];
    const results = await Promise.all(
      users.map((u) =>
        agent.post(`/api/admin/teachers/${id}/link`).send({ user_id: String(u._id) }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('TCH-08 AR in CSE and AR in CE go to different accounts', async () => {
    const cse = await createDepartment();
    const ce = await createDepartment();
    const a = (await addRecord(await asDeptAdmin(cse), cse)).body.data.id;
    const b = (await addRecord(await asDeptAdmin(ce), ce)).body.data.id;
    const u1 = await activeTeacher(cse);
    const u2 = await activeTeacher(ce);
    expect(
      (
        await (
          await asDeptAdmin(cse)
        )
          .post(`/api/admin/teachers/${a}/link`)
          .send({ user_id: String(u1._id) })
      ).status,
    ).toBe(200);
    expect(
      (
        await (
          await asDeptAdmin(ce)
        )
          .post(`/api/admin/teachers/${b}/link`)
          .send({ user_id: String(u2._id) })
      ).status,
    ).toBe(200);
  });

  it('TCH-08 the same account cannot be linked to two records of one department', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const a = (await addRecord(agent, cse, 'AR')).body.data.id;
    const b = (await addRecord(agent, cse, 'BB', 'B B')).body.data.id;
    const user = await activeTeacher(cse);
    await agent.post(`/api/admin/teachers/${a}/link`).send({ user_id: String(user._id) });
    const res = await agent
      .post(`/api/admin/teachers/${b}/link`)
      .send({ user_id: String(user._id) });
    expect(res.status).toBe(409);
  });

  it('TCH-08 only an active teacher of that department can be linked (USER_NOT_ELIGIBLE)', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const id = (await addRecord(agent, cse)).body.data.id;
    const candidates = [
      await makeUser({ kind: 'student' }),
      (await pendingTeacher(cse)).user,
      await activeTeacher(eee),
      await activeTeacher(cse, { state: 'suspended' }),
    ];
    for (const c of candidates) {
      const res = await agent
        .post(`/api/admin/teachers/${id}/link`)
        .send({ user_id: String(c._id) });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('USER_NOT_ELIGIBLE');
    }
  });

  it('TCH-08 approving links the record that matches the requested code in the same step', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const rec = (await addRecord(agent, cse, 'AR')).body.data;
    const { user, reg } = await pendingTeacher(cse, 'AR');
    await decide(agent, reg._id, { decision: 'approve' });
    expect(String((await Teacher.findById(rec.id)).user_id)).toBe(String(user._id));
  });

  it('TCH-08 approving with a chosen record links that one; a taken record is refused and nothing changes', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const rec = (await addRecord(agent, cse, 'ZZ')).body.data;
    const first = await pendingTeacher(cse, 'AR');
    const second = await pendingTeacher(cse, 'AR');
    const ok = await decide(agent, first.reg._id, { decision: 'approve', teacher_id: rec.id });
    expect(ok.status).toBe(200);
    const taken = await decide(agent, second.reg._id, { decision: 'approve', teacher_id: rec.id });
    expect(taken.status).toBe(409);
    expect((await User.findById(second.user._id)).state).toBe('pending');
    expect((await TeacherRegistration.findById(second.reg._id)).status).toBe('pending');
  });

  it('TCH-10 linking and unlinking are audited and tell the link-change listeners', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const id = (await addRecord(agent, cse)).body.data.id;
    const user = await activeTeacher(cse);
    const listener = vi.fn();
    registerLinkChangeListener(listener);
    await agent.post(`/api/admin/teachers/${id}/link`).send({ user_id: String(user._id) });
    const res = await agent.post(`/api/admin/teachers/${id}/unlink`);
    expect(res.status).toBe(200);
    expect(res.body.data.linked).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(await auditList({ action: 'teacher.link' })).toHaveLength(1);
    expect(await auditList({ action: 'teacher.unlink' })).toHaveLength(1);
    expect((await agent.post(`/api/admin/teachers/${id}/unlink`)).status).toBe(409);
  });

  it('a CSE admin cannot read, add, edit, link or unlink in EEE', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const rec = (await addRecord(await asDeptAdmin(eee), eee)).body.data;
    const eeeTeacher = await activeTeacher(eee);
    const agent = await asDeptAdmin(cse);
    expect((await agent.get(`/api/admin/teachers?department_id=${eee.id}`)).status).toBe(403);
    expect((await addRecord(agent, eee, 'QQ')).status).toBe(403);
    expect(
      (await agent.patch(`/api/admin/teachers/${rec.id}`).send({ full_name: 'Hacked' })).status,
    ).toBe(403);
    expect(
      (
        await agent
          .post(`/api/admin/teachers/${rec.id}/link`)
          .send({ user_id: String(eeeTeacher._id) })
      ).status,
    ).toBe(403);
    expect((await agent.post(`/api/admin/teachers/${rec.id}/unlink`)).status).toBe(403);
    expect((await agent.get('/api/admin/teachers')).body.data).toHaveLength(0);
    expect((await Teacher.findById(rec.id)).full_name).toBe('Dr. Abdur Rahman');
  });

  it('students and teachers cannot use the admin teacher routes', async () => {
    const cse = await createDepartment();
    for (const user of [await makeUser({ kind: 'student' }), await activeTeacher(cse)]) {
      const agent = await loginAs(user, app);
      expect((await agent.get('/api/admin/teachers')).status).toBe(403);
      expect((await addRecord(agent, cse)).status).toBe(403);
    }
  });
});

describe('suspend, remove and reactivate (spec 06)', () => {
  const act = (agent, user, action, body) =>
    agent.post(`/api/admin/teacher-accounts/${user._id}/${action}`).send(body ?? {});

  it('TCH-12 suspending needs a reason, ends the sessions and blocks sign-in', async () => {
    const cse = await createDepartment();
    const teacher = await activeTeacher(cse);
    const { agent: teacherAgent, res: first } = await signIn(app, teacher.email, TEST_PASSWORD);
    expect(first.status).toBe(200);
    expect((await teacherAgent.get('/api/auth/me')).status).toBe(200);

    const admin = await asDeptAdmin(cse);
    expect((await act(admin, teacher, 'suspend')).status).toBe(400);
    const res = await act(admin, teacher, 'suspend', { reason: 'Away on leave' });
    expect(res.status).toBe(200);
    expect((await User.findById(teacher._id)).state).toBe('suspended');

    expect((await teacherAgent.get('/api/auth/me')).status).toBe(401);
    const { res: again } = await signIn(app, teacher.email, TEST_PASSWORD);
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('ACCOUNT_DISABLED');
    const [entry] = await auditList({ action: 'teacher.suspend' });
    expect(entry.new_value).toMatchObject({ state: 'suspended', reason: 'Away on leave' });
  });

  it('TCH-12 removing deactivates the account, ends sessions and is audited', async () => {
    const cse = await createDepartment();
    const teacher = await activeTeacher(cse);
    const { agent: teacherAgent } = await signIn(app, teacher.email, TEST_PASSWORD);
    const res = await act(await asDeptAdmin(cse), teacher, 'remove', {
      reason: 'Left the university',
    });
    expect(res.status).toBe(200);
    expect((await User.findById(teacher._id)).state).toBe('deactivated');
    expect((await teacherAgent.get('/api/auth/me')).status).toBe(401);
    expect(await auditList({ action: 'teacher.remove' })).toHaveLength(1);
  });

  it('TCH-13 an admin reactivates a suspended or removed teacher', async () => {
    const cse = await createDepartment();
    const admin = await asDeptAdmin(cse);
    for (const action of ['suspend', 'remove']) {
      const teacher = await activeTeacher(cse);
      await act(admin, teacher, action, { reason: 'For a good reason' });
      const res = await act(admin, teacher, 'reactivate');
      expect(res.status).toBe(200);
      expect((await User.findById(teacher._id)).state).toBe('active');
      const { res: login } = await signIn(app, teacher.email, TEST_PASSWORD);
      expect(login.status).toBe(200);
    }
    expect(await auditList({ action: 'teacher.reactivate' })).toHaveLength(2);
  });

  it('TCH-12 reactivating an active teacher, or suspending a suspended one, is a CONFLICT', async () => {
    const cse = await createDepartment();
    const admin = await asDeptAdmin(cse);
    const teacher = await activeTeacher(cse);
    expect((await act(admin, teacher, 'reactivate')).status).toBe(409);
    await act(admin, teacher, 'suspend', { reason: 'For a good reason' });
    expect((await act(admin, teacher, 'suspend', { reason: 'For a good reason' })).status).toBe(
      409,
    );
  });

  it('a CSE admin cannot suspend, remove or reactivate an EEE teacher; students are not teachers', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const teacher = await activeTeacher(eee);
    const admin = await asDeptAdmin(cse);
    for (const action of ['suspend', 'remove']) {
      expect((await act(admin, teacher, action, { reason: 'No right to do this' })).status).toBe(
        403,
      );
    }
    expect((await act(admin, teacher, 'reactivate')).status).toBe(403);
    expect((await User.findById(teacher._id)).state).toBe('active');
    const student = await makeUser({ kind: 'student' });
    expect((await act(admin, student, 'suspend', { reason: 'Not a teacher' })).status).toBe(404);
    expect(
      (await act(await asSuper(), teacher, 'suspend', { reason: 'Super admin acts' })).status,
    ).toBe(200);
  });

  it('an admin cannot suspend their own teacher account', async () => {
    const cse = await createDepartment();
    const me = await makeUser({
      kind: 'teacher',
      roles: [
        { role: 'teacher', department_id: cse._id },
        { role: 'dept_admin', department_id: cse._id },
      ],
    });
    const res = await act(await loginAs(me, app), me, 'suspend', { reason: 'Why not myself' });
    expect(res.status).toBe(409);
  });

  it('TCH-14 removing a teacher keeps the record, the link and the full name', async () => {
    const cse = await createDepartment();
    const admin = await asDeptAdmin(cse);
    const rec = (
      await admin
        .post('/api/admin/teachers')
        .send({ department_id: cse.id, short_code: 'AR', full_name: 'Dr. Abdur Rahman' })
    ).body.data;
    const teacher = await activeTeacher(cse);
    await admin.post(`/api/admin/teachers/${rec.id}/link`).send({ user_id: String(teacher._id) });
    await act(admin, teacher, 'remove', { reason: 'Left the university' });
    const saved = await Teacher.findById(rec.id);
    expect(String(saved.user_id)).toBe(String(teacher._id));
    expect((await fullNames([rec.id])).get(rec.id)).toBe('Dr. Abdur Rahman');
  });
});

describe('teacher directory exports (spec 06)', () => {
  it('TCH-15 findByCode finds a record (any letter case) and TBA is never a record', async () => {
    const cse = await createDepartment();
    await Teacher.create({ department_id: cse._id, short_code: 'AR', full_name: 'A R' });
    expect((await findByCode(cse._id, ' ar ')).full_name).toBe('A R');
    expect(await findByCode(cse._id, 'XX')).toBeNull();
    expect(await findByCode(cse._id, 'TBA')).toBeNull();
    // another department's code is not found
    expect(await findByCode((await createDepartment())._id, 'AR')).toBeNull();
  });

  it('TCH-15 fullNames maps ids to names', async () => {
    const cse = await createDepartment();
    const a = await Teacher.create({ department_id: cse._id, short_code: 'AR', full_name: 'A R' });
    const b = await Teacher.create({ department_id: cse._id, short_code: 'BB', full_name: 'B B' });
    const names = await fullNames([a._id, b._id]);
    expect([...names.entries()]).toEqual(
      expect.arrayContaining([
        [String(a._id), 'A R'],
        [String(b._id), 'B B'],
      ]),
    );
  });

  it('TCH-16 sectionsTaughtBy is empty until linked, then asks the routine provider with the linked records', async () => {
    const cse = await createDepartment();
    const teacher = await activeTeacher(cse);
    const rec = await Teacher.create({
      department_id: cse._id,
      short_code: 'AR',
      full_name: 'A R',
    });
    const provider = vi.fn(async () => ['CSE 2-II-A']);
    registerSectionsProvider(provider);
    expect(await sectionsTaughtBy(teacher._id)).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
    await Teacher.updateOne({ _id: rec._id }, { $set: { user_id: teacher._id } });
    expect(await sectionsTaughtBy(teacher._id)).toEqual(['CSE 2-II-A']);
    expect(String(provider.mock.calls[0][0][0])).toBe(String(rec._id));
  });

  it('TCH-11 an unlinked teacher profile says not linked', async () => {
    const cse = await createDepartment();
    const teacher = await activeTeacher(cse);
    const res = await (await loginAs(teacher, app)).get('/api/me/profile');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('"linked":false');
  });
});

describe('teacher accounts list (spec 06)', () => {
  it('TCH-08 lists the department teacher accounts with link status and no email, and refuses other departments', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const t1 = await activeTeacher(cse, { name: 'Linked One' });
    await activeTeacher(cse, { name: 'Free Two' });
    await activeTeacher(eee, { name: 'Other Dept' });
    await Teacher.create({
      department_id: cse._id,
      short_code: 'AA',
      full_name: 'Linked One',
      user_id: t1._id,
    });
    const agent = await asDeptAdmin(cse);
    const res = await agent.get(`/api/admin/teacher-accounts?department_id=${cse.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((a) => [a.full_name, a.linked])).toEqual([
      ['Free Two', false],
      ['Linked One', true],
    ]);
    expect(JSON.stringify(res.body)).not.toContain('@');
    expect((await agent.get(`/api/admin/teacher-accounts?department_id=${eee.id}`)).status).toBe(
      403,
    );
  });
});

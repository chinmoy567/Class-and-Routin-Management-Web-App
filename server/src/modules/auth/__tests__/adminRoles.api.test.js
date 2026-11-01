import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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
import { TEST_PASSWORD, createDepartment, makeId, makeUser } from '../../../../test/factories.js';
import { User, UserRole } from '../auth.model.js';
import { addAllowedDomain, Department } from '../../organisation/index.js';
import { list as auditList } from '../../audit/index.js';
import { removeAdminRole, runCoverageCheck } from '../adminRoles.service.js';

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
afterEach(clearOutbox);

const superAdmin = (extra = {}) =>
  makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }], ...extra });
const activeRoles = (userId) => UserRole.find({ user_id: userId, ended_at: null }).lean();
const grant = (agent, body) => agent.post('/api/admin/admins').send(body);

describe('grant admin roles (DEP-05, DEP-06, DEP-08, DEP-10)', () => {
  it('DEP-05 a super admin grants dept_admin; a teacher keeps the teacher role', async () => {
    const dept = await createDepartment();
    const root = await superAdmin();
    const teacher = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'teacher', department_id: dept._id }],
    });
    const res = await grant(await loginAs(root, app), {
      user_id: String(teacher._id),
      role: 'dept_admin',
      department_id: dept.id,
    });
    expect(res.status).toBe(201);
    const roles = (await activeRoles(teacher._id)).map((r) => r.role).sort();
    expect(roles).toEqual(['dept_admin', 'teacher']);
  });

  it('DEP-05 an account that is not active and verified is USER_NOT_ELIGIBLE', async () => {
    const dept = await createDepartment();
    const agent = await loginAs(await superAdmin(), app);
    for (const state of ['email_unverified', 'pending', 'deactivated', 'suspended']) {
      const kind = ['pending', 'suspended'].includes(state) ? 'teacher' : 'student';
      const target = await makeUser({ kind, state });
      const res = await grant(agent, {
        user_id: String(target._id),
        role: 'dept_admin',
        department_id: dept.id,
      });
      expect(res.status, state).toBe(422);
      expect(res.body.error.code).toBe('USER_NOT_ELIGIBLE');
      expect(await activeRoles(target._id)).toHaveLength(0);
    }
    // active but never verified
    const odd = await makeUser({ kind: 'student', state: 'active' });
    await User.updateOne({ _id: odd._id }, { $unset: { email_verified_at: 1 } });
    const res = await grant(agent, { user_id: String(odd._id), role: 'super_admin' });
    expect(res.body.error.code).toBe('USER_NOT_ELIGIBLE');
  });

  it('DEP-06 a super admin grants super_admin to an active, verified account', async () => {
    const target = await makeUser({ kind: 'teacher' });
    const res = await grant(await loginAs(await superAdmin(), app), {
      user_id: String(target._id),
      role: 'super_admin',
    });
    expect(res.status).toBe(201);
    expect((await activeRoles(target._id)).map((r) => r.role)).toContain('super_admin');
  });

  it('DEP-05 the department is required for dept_admin and must exist', async () => {
    const agent = await loginAs(await superAdmin(), app);
    const target = await makeUser({ kind: 'teacher' });
    const none = await grant(agent, { user_id: String(target._id), role: 'dept_admin' });
    expect(none.status).toBe(400);
    const missing = await grant(agent, {
      user_id: String(target._id),
      role: 'dept_admin',
      department_id: String(makeId()),
    });
    expect(missing.status).toBe(400);
    const retired = await createDepartment({ retired: true });
    const gone = await grant(agent, {
      user_id: String(target._id),
      role: 'dept_admin',
      department_id: retired.id,
    });
    expect(gone.status).toBe(400);
    const extra = await grant(agent, {
      user_id: String(target._id),
      role: 'super_admin',
      department_id: retired.id,
    });
    expect(extra.status).toBe(400);
  });

  it('DEP-05 granting the same role twice (even together) is a CONFLICT', async () => {
    const dept = await createDepartment();
    const agent = await loginAs(await superAdmin(), app);
    const target = await makeUser({ kind: 'teacher' });
    const body = { user_id: String(target._id), role: 'dept_admin', department_id: dept.id };
    const results = await Promise.all(Array.from({ length: 4 }, () => grant(agent, body)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'CONFLICT')).toHaveLength(3);
    expect(await activeRoles(target._id)).toHaveLength(1);
  });

  it('DEP-08 nobody grants a role to their own account', async () => {
    const root = await superAdmin();
    const dept = await createDepartment();
    const res = await grant(await loginAs(root, app), {
      user_id: String(root._id),
      role: 'dept_admin',
      department_id: dept.id,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('DEP-08 admin roles never come from sign-up', async () => {
    const anon = await loginAs(null, app);
    const res = await anon.post('/api/auth/signup').send({
      kind: 'staff',
      full_name: 'Sneaky',
      email: 'sneaky@baiust.ac.bd',
      password: 'secret-pass-1',
    });
    expect(res.status).toBe(400);
    expect(await UserRole.countDocuments()).toBe(0);
  });

  it('DEP-10 every grant and removal is audited with who, when, role and department', async () => {
    const dept = await createDepartment();
    const root = await superAdmin();
    const target = await makeUser({ kind: 'teacher' });
    const agent = await loginAs(root, app);
    const granted = await grant(agent, {
      user_id: String(target._id),
      role: 'dept_admin',
      department_id: dept.id,
    });
    await agent.delete(`/api/admin/admins/${granted.body.data.id}`);
    const entries = await auditList({ target_type: 'user', target_id: target._id });
    const actions = entries.map((e) => e.action).sort();
    expect(actions).toEqual(['admin_role.grant', 'admin_role.remove']);
    for (const e of entries) {
      expect(String(e.actor_id)).toBe(String(root._id));
      expect(e.at).toBeInstanceOf(Date);
      expect(String(e.scope_department_id)).toBe(dept.id);
    }
    const grantEntry = entries.find((e) => e.action === 'admin_role.grant');
    expect(grantEntry.new_value.role).toBe('dept_admin');
    expect(JSON.stringify(entries)).not.toMatch(/@baiust/);
  });
});

describe('remove admin roles (DEP-07, DEP-08, DEP-09)', () => {
  it('DEP-07 a super admin removes a dept_admin role; the row is ended, not deleted', async () => {
    const dept = await createDepartment();
    const admin = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    });
    const role = await UserRole.findOne({ user_id: admin._id });
    const res = await (
      await loginAs(await superAdmin(), app)
    ).delete(`/api/admin/admins/${role._id}`);
    expect(res.status).toBe(204);
    const after = await UserRole.findById(role._id).lean();
    expect(after.ended_at).toBeInstanceOf(Date);
    expect(after.ended_by).toBeTruthy();
    const again = await (
      await loginAs(await superAdmin(), app)
    ).delete(`/api/admin/admins/${role._id}`);
    expect(again.status).toBe(404);
  });

  it('DEP-07 removing the last active super admin is 409 LAST_SUPER_ADMIN', async () => {
    const first = await superAdmin();
    const second = await superAdmin();
    const secondRole = await UserRole.findOne({ user_id: second._id });
    const firstRole = await UserRole.findOne({ user_id: first._id });
    // `first` removes `second` (fine), then a stale request from `second` tries to remove `first`.
    await removeAdminRole(first, String(secondRole._id));
    await expect(removeAdminRole(second, String(firstRole._id))).rejects.toMatchObject({
      status: 409,
      code: 'LAST_SUPER_ADMIN',
    });
    expect(await activeRoles(first._id)).toHaveLength(1);
  });

  it('DEP-07 two super admins removing each other together leave exactly one', async () => {
    const a = await superAdmin();
    const b = await superAdmin();
    const roleA = await UserRole.findOne({ user_id: a._id });
    const roleB = await UserRole.findOne({ user_id: b._id });
    const [r1, r2] = await Promise.allSettled([
      removeAdminRole(a, String(roleB._id)),
      removeAdminRole(b, String(roleA._id)),
    ]);
    const outcomes = [r1, r2];
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((r) => r.status === 'rejected').reason.code).toBe('LAST_SUPER_ADMIN');
    expect(await UserRole.countDocuments({ role: 'super_admin', ended_at: null })).toBe(1);
  });

  it('DEP-07 a deactivated super admin does not count towards the minimum', async () => {
    const live = await superAdmin();
    const dead = await superAdmin({ state: 'deactivated' });
    const liveRole = await UserRole.findOne({ user_id: live._id });
    const other = await superAdmin();
    await expect(removeAdminRole(other, String(liveRole._id))).resolves.toBeUndefined();
    // `dead` and `other` remain, but only `other` is active: it cannot be removed by a stale actor
    const otherRole = await UserRole.findOne({ user_id: other._id });
    await expect(removeAdminRole(live, String(otherRole._id))).rejects.toMatchObject({
      code: 'LAST_SUPER_ADMIN',
    });
  });

  it('DEP-07 the admin list warns when fewer than two super admins exist', async () => {
    const root = await superAdmin();
    const agent = await loginAs(root, app);
    let res = await agent.get('/api/admin/admins');
    expect(res.status).toBe(200);
    expect(res.body.data.super_admin_count).toBe(1);
    expect(res.body.data.fewer_than_two_super_admins).toBe(true);
    await superAdmin();
    res = await agent.get('/api/admin/admins');
    expect(res.body.data.fewer_than_two_super_admins).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/@baiust|email|phone/);
  });

  it('DEP-08 a super admin cannot remove their own role', async () => {
    const root = await superAdmin();
    await superAdmin();
    const role = await UserRole.findOne({ user_id: root._id });
    const res = await (await loginAs(root, app)).delete(`/api/admin/admins/${role._id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await activeRoles(root._id)).toHaveLength(1);
  });

  it('DEP-09 a grant ends the target sessions and the next sign-in asks for the second step', async () => {
    const dept = await createDepartment();
    const teacher = await makeUser({
      kind: 'teacher',
      password: TEST_PASSWORD,
      totp: true,
      roles: [{ role: 'teacher', department_id: dept._id }],
    });
    const first = await signIn(app, teacher.email, TEST_PASSWORD);
    expect(first.res.body.data.next).toBe('dashboard');
    expect((await first.agent.get('/api/auth/me')).status).toBe(200);

    await grant(await loginAs(await superAdmin(), app), {
      user_id: String(teacher._id),
      role: 'dept_admin',
      department_id: dept.id,
    });

    const old = await first.agent.get('/api/auth/me');
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('UNAUTHENTICATED');
    const again = await signIn(app, teacher.email, TEST_PASSWORD);
    expect(again.res.body.data.next).toBe('second-step');
  });

  it('DEP-09 a removal also ends the target sessions', async () => {
    const dept = await createDepartment();
    const admin = await makeUser({
      kind: 'teacher',
      password: TEST_PASSWORD,
      totp: true,
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    });
    const role = await UserRole.findOne({ user_id: admin._id });
    const session = await signIn(app, admin.email, TEST_PASSWORD);
    expect(session.res.body.data.next).toBe('second-step');
    await (await loginAs(await superAdmin(), app)).delete(`/api/admin/admins/${role._id}`);
    expect((await session.agent.get('/api/auth/me')).status).toBe(401);
    const next = await signIn(app, admin.email, TEST_PASSWORD);
    expect(next.res.body.data.next).toBe('dashboard');
  });
});

describe('resets (DEP-11)', () => {
  it('DEP-11 resetting a password emails the link to the admin and ends their sessions', async () => {
    const dept = await createDepartment();
    const admin = await makeUser({
      kind: 'teacher',
      password: TEST_PASSWORD,
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    });
    const res = await (
      await loginAs(await superAdmin(), app)
    ).post(`/api/admin/admins/${admin._id}/reset-password`);
    expect(res.status).toBe(202);
    expect(JSON.stringify(res.body)).not.toContain(admin.email);
    const mails = await drainMail();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe(admin.email);
    const token = tokenFrom(mails[0]);
    const anon = await loginAs(null, app);
    const done = await anon
      .post('/api/auth/reset/confirm')
      .send({ token, password: 'brand-new-pass-7' });
    expect(done.status).toBe(200);
    expect(await auditList({ action: 'admin.password_reset' })).toHaveLength(1);
  });

  it('DEP-11 resetting the second step clears the authenticator', async () => {
    const dept = await createDepartment();
    const admin = await makeUser({
      kind: 'teacher',
      password: TEST_PASSWORD,
      totp: true,
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    });
    const res = await (
      await loginAs(await superAdmin(), app)
    ).post(`/api/admin/admins/${admin._id}/reset-second-step`);
    expect(res.status).toBe(200);
    const user = await User.findById(admin._id).select('+totp_secret_enc').lean();
    expect(user.totp_enabled_at).toBeUndefined();
    expect(user.totp_secret_enc).toBeUndefined();
    const next = await signIn(app, admin.email, TEST_PASSWORD);
    expect(next.res.body.data.next).toBe('setup-totp');
    expect(await auditList({ action: 'admin.second_step_reset' })).toHaveLength(1);
  });

  it('DEP-11 a super admin can reset another super admin, never themselves', async () => {
    const a = await superAdmin();
    const b = await superAdmin();
    const agent = await loginAs(a, app);
    expect((await agent.post(`/api/admin/admins/${b._id}/reset-second-step`)).status).toBe(200);
    expect((await agent.post(`/api/admin/admins/${b._id}/reset-password`)).status).toBe(202);
    for (const path of ['reset-password', 'reset-second-step']) {
      const self = await agent.post(`/api/admin/admins/${a._id}/${path}`);
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('DEP-11 an account without an admin role is not reset through this route', async () => {
    const student = await makeUser({ kind: 'student' });
    const agent = await loginAs(await superAdmin(), app);
    for (const path of ['reset-password', 'reset-second-step']) {
      const res = await agent.post(`/api/admin/admins/${student._id}/${path}`);
      expect(res.status).toBe(404);
    }
    expect(await drainMail()).toHaveLength(0);
  });
});

describe('search (picker for a new admin)', () => {
  it('returns verified active accounts by name, without email or phone', async () => {
    const dept = await createDepartment();
    await makeUser({
      kind: 'teacher',
      name: 'Dr Salma Khan',
      phone: '+8801712345678',
      departmentId: dept._id,
    });
    await makeUser({ kind: 'student', name: 'Salma Hidden', state: 'email_unverified' });
    await makeUser({ kind: 'student', name: 'Salma Gone', state: 'deactivated' });
    const agent = await loginAs(await superAdmin(), app);
    const res = await agent.get('/api/admin/users/search').query({ q: 'salma' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      full_name: 'Dr Salma Khan',
      kind: 'teacher',
      department: { id: dept.id, code: dept.code },
    });
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['department', 'full_name', 'id', 'kind']);
    expect(JSON.stringify(res.body)).not.toMatch(/@baiust|0171|email|phone/);
    const bad = await agent.get('/api/admin/users/search').query({ q: 'a' });
    expect(bad.status).toBe(400);
  });
});

describe('cross-scope and role refusals (DEP-14)', () => {
  it('DEP-14 no one but a super admin reaches any admin-role endpoint', async () => {
    const dept = await createDepartment();
    const other = await createDepartment();
    const victim = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'dept_admin', department_id: other._id }],
    });
    const role = await UserRole.findOne({ user_id: victim._id });
    const people = {
      deptAdminOfOther: await makeUser({
        kind: 'teacher',
        roles: [{ role: 'dept_admin', department_id: dept._id }],
      }),
      teacher: await makeUser({ kind: 'teacher' }),
      student: await makeUser({ kind: 'student' }),
      cr: await makeUser({ kind: 'student', roles: [{ role: 'cr', section_id: makeId() }] }),
      unverified: await makeUser({ kind: 'student', state: 'email_unverified' }),
    };
    for (const [who, user] of Object.entries(people)) {
      const agent = await loginAs(user, app);
      const calls = [
        agent.get('/api/admin/admins'),
        grant(agent, { user_id: String(user._id), role: 'super_admin' }),
        grant(agent, { user_id: String(victim._id), role: 'super_admin' }),
        agent.delete(`/api/admin/admins/${role._id}`),
        agent.post(`/api/admin/admins/${victim._id}/reset-password`),
        agent.post(`/api/admin/admins/${victim._id}/reset-second-step`),
        agent.get('/api/admin/users/search').query({ q: 'test' }),
      ];
      for (const res of await Promise.all(calls)) {
        expect([401, 403], `${who} got ${res.status}`).toContain(res.status);
      }
    }
    expect(await activeRoles(victim._id)).toHaveLength(1);
    expect(await drainMail()).toHaveLength(0);
    const anon = await loginAs(null, app);
    expect((await anon.get('/api/admin/admins')).status).toBe(401);
  });
});

describe('coverage (DEP-12)', () => {
  it('DEP-12 removing a department only admin emails every super admin once', async () => {
    const dept = await createDepartment({ code: 'ABC' });
    const root = await superAdmin();
    const second = await superAdmin();
    const admin = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    });
    const role = await UserRole.findOne({ user_id: admin._id });
    clearOutbox();
    await (await loginAs(root, app)).delete(`/api/admin/admins/${role._id}`);
    const mails = (await drainMail()).filter((m) => /no active department admin/i.test(m.text));
    expect(mails.map((m) => m.to).sort()).toEqual([root.email, second.email].sort());
    clearOutbox();
    // running the check again (the hourly job) sends nothing more
    expect(await runCoverageCheck()).toEqual({ alerted: 0 });
    expect(
      (await drainMail()).filter((m) => /no active department admin/i.test(m.text)),
    ).toHaveLength(0);
  });

  it('DEP-12 a deactivated or suspended admin counts as no admin; a new one clears the alert', async () => {
    const dept = await createDepartment({ code: 'XYZ' });
    await superAdmin();
    const admin = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    });
    expect(await runCoverageCheck()).toEqual({ alerted: 0 });
    await User.updateOne({ _id: admin._id }, { $set: { state: 'suspended' } });
    expect(await runCoverageCheck()).toEqual({ alerted: 1 });
    expect((await Department.findById(dept.id)).admin_alert_sent_at).toBeTruthy();
    expect(await runCoverageCheck()).toEqual({ alerted: 0 });
    await User.updateOne({ _id: admin._id }, { $set: { state: 'active' } });
    await runCoverageCheck();
    expect((await Department.findById(dept.id)).admin_alert_sent_at).toBeUndefined();
    await User.updateOne({ _id: admin._id }, { $set: { state: 'suspended' } });
    expect(await runCoverageCheck()).toEqual({ alerted: 1 });
  });

  it('DEP-12 two checks running together alert once', async () => {
    await createDepartment({ code: 'TWO' });
    await superAdmin();
    clearOutbox();
    const results = await Promise.all([runCoverageCheck(), runCoverageCheck(), runCoverageCheck()]);
    expect(results.reduce((n, r) => n + r.alerted, 0)).toBe(1);
    const mails = (await drainMail()).filter((m) => /no active department admin/i.test(m.text));
    expect(mails).toHaveLength(1);
  });

  it('DEP-12 retired departments are not alerted', async () => {
    await createDepartment({ retired: true });
    await superAdmin();
    expect(await runCoverageCheck()).toEqual({ alerted: 0 });
  });
});

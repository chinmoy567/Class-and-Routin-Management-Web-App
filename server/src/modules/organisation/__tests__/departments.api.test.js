import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
} from '../../../../test/harness.js';
import { createDepartment, makeId, makeUser } from '../../../../test/factories.js';
import { Department } from '../organisation.model.js';
import { registerDepartmentUsage, resetDepartmentUsage } from '../index.js';
import { list as auditList } from '../../audit/index.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(clearDb);
afterEach(resetDepartmentUsage);

const superAdmin = () => makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] });
const asSuper = async () => loginAs(await superAdmin(), app);

describe('departments (spec 03)', () => {
  it('DEP-01 a super admin creates a department and it is audited', async () => {
    const agent = await asSuper();
    const res = await agent
      .post('/api/admin/departments')
      .send({ code: 'CSE', name: 'Computer Science' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: 'CSE', name: 'Computer Science', retired: false });
    expect(await auditList({ action: 'department.create' })).toHaveLength(1);
  });

  it('DEP-01 a duplicate code is a CONFLICT, even when created together', async () => {
    const agent = await asSuper();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        agent.post('/api/admin/departments').send({ code: 'EEE', name: 'Electrical' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'CONFLICT')).toHaveLength(3);
    expect(await Department.countDocuments({ code: 'EEE' })).toBe(1);
  });

  it('DEP-01 the code must be 2 to 10 upper-case letters', async () => {
    const agent = await asSuper();
    for (const code of ['C', 'cse', 'CSE1', 'ABCDEFGHIJK', '']) {
      const res = await agent.post('/api/admin/departments').send({ code, name: 'X Department' });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.code).toBeTruthy();
    }
  });

  it('DEP-02 a super admin renames a department; the code is locked once it is in use', async () => {
    const agent = await asSuper();
    const dept = await createDepartment({ code: 'CE' });
    const renamed = await agent
      .patch(`/api/admin/departments/${dept.id}`)
      .send({ name: 'Civil Engineering' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Civil Engineering');

    const free = await agent.patch(`/api/admin/departments/${dept.id}`).send({ code: 'CIVIL' });
    expect(free.status).toBe(200);
    expect(free.body.data.code).toBe('CIVIL');

    registerDepartmentUsage({ codeLocked: async () => true });
    const locked = await agent.patch(`/api/admin/departments/${dept.id}`).send({ code: 'CVL' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('CODE_LOCKED');
    const ok = await agent.patch(`/api/admin/departments/${dept.id}`).send({ name: 'Civil Eng' });
    expect(ok.status).toBe(200);
  });

  it('DEP-02 renaming to a code another department has is a CONFLICT', async () => {
    const agent = await asSuper();
    await createDepartment({ code: 'BBA' });
    const dept = await createDepartment({ code: 'MBA' });
    const res = await agent.patch(`/api/admin/departments/${dept.id}`).send({ code: 'BBA' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('DEP-03 retiring hides the department from the public list but keeps it', async () => {
    const agent = await asSuper();
    const keep = await createDepartment({ code: 'KEEP' });
    const gone = await createDepartment({ code: 'GONE' });
    const res = await agent.post(`/api/admin/departments/${gone.id}/retire`);
    expect(res.status).toBe(200);
    expect(res.body.data.retired).toBe(true);
    const pub = await (await loginAs(null, app)).get('/api/departments');
    expect(pub.body.data.map((d) => d.code)).toEqual([keep.code]);
    expect(await Department.countDocuments({ code: 'GONE' })).toBe(1);
    const all = await agent.get('/api/admin/departments');
    expect(all.body.data.map((d) => d.code).sort()).toEqual(['GONE', keep.code].sort());
  });

  it('DEP-03 a department used by a section of the current or draft semester cannot be retired', async () => {
    const agent = await asSuper();
    const dept = await createDepartment();
    registerDepartmentUsage({ inUseBySemester: async (id) => String(id) === dept.id });
    const res = await agent.post(`/api/admin/departments/${dept.id}/retire`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEPARTMENT_IN_USE');
    expect((await Department.findById(dept.id)).retired).toBe(false);
  });

  it('DEP-04 the public list needs no sign-in and shows active departments only', async () => {
    const dept = await createDepartment({ code: 'PUB', name: 'Public' });
    await createDepartment({ code: 'OLD', retired: true });
    const anon = await loginAs(null, app);
    const res = await anon.get('/api/departments');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: dept.id, code: 'PUB', name: 'Public', retired: false }]);
  });

  it('DEP-14 only a super admin manages departments; every other role is refused', async () => {
    const dept = await createDepartment();
    const people = {
      deptAdmin: await makeUser({
        kind: 'teacher',
        roles: [{ role: 'dept_admin', department_id: dept._id }],
      }),
      teacher: await makeUser({ kind: 'teacher' }),
      student: await makeUser({ kind: 'student' }),
      cr: await makeUser({ kind: 'student', roles: [{ role: 'cr', section_id: makeId() }] }),
      deactivatedSuper: await makeUser({
        kind: 'staff',
        state: 'deactivated',
        roles: [{ role: 'super_admin' }],
      }),
    };
    for (const [who, user] of Object.entries(people)) {
      const agent = await loginAs(user, app);
      const calls = [
        agent.get('/api/admin/departments'),
        agent.post('/api/admin/departments').send({ code: 'NEW', name: 'New Dept' }),
        agent.patch(`/api/admin/departments/${dept.id}`).send({ name: 'Changed' }),
        agent.post(`/api/admin/departments/${dept.id}/retire`),
      ];
      for (const res of await Promise.all(calls)) {
        expect([401, 403], `${who} got ${res.status}`).toContain(res.status);
      }
    }
    const anon = await loginAs(null, app);
    const res = await anon.post('/api/admin/departments').send({ code: 'NEW', name: 'New Dept' });
    expect(res.status).toBe(401);
    expect(await Department.countDocuments({ code: 'NEW' })).toBe(0);
    expect((await Department.findById(dept.id)).retired).toBe(false);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
} from '../../../../test/harness.js';
import { createDepartment, makeId, makeUser } from '../../../../test/factories.js';
import { Semester } from '../organisation.model.js';
import {
  currentSemester,
  draftSemester,
  registerSemesterUsage,
  resetSemesterUsage,
} from '../index.js';
import { setEmitter } from '../../../lib/events.js';
import { list as auditList } from '../../audit/index.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(clearDb);
afterEach(() => {
  resetSemesterUsage();
  setEmitter(null);
});

const superAdmin = () => makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] });
const asSuper = async () => loginAs(await superAdmin(), app);
const asDeptAdmin = async () => {
  const dept = await createDepartment();
  return loginAs(
    await makeUser({
      kind: 'staff',
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    }),
    app,
  );
};

const body = (over = {}) => ({
  name: 'Spring 2027',
  start_date: '2027-04-04',
  end_date: '2027-09-30',
  ...over,
});
const draft = async (agent, over) =>
  (await agent.post('/api/admin/semesters').send(body(over))).body.data;

describe('semesters (spec 04)', () => {
  it('SEM-01 a super admin creates a draft semester and it is audited', async () => {
    const agent = await asSuper();
    const res = await agent.post('/api/admin/semesters').send(body());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Spring 2027',
      status: 'draft',
      start_date: '2027-04-04',
      end_date: '2027-09-30',
    });
    expect(await auditList({ action: 'semester.create' })).toHaveLength(1);
  });

  it('SEM-01 a taken name (any letter case) is a CONFLICT', async () => {
    const agent = await asSuper();
    const first = await draft(agent);
    await agent.post(`/api/admin/semesters/${first.id}/bootstrap-current`);
    const res = await agent.post('/api/admin/semesters').send(body({ name: 'spring 2027' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('SEM-02 creating a second draft while one exists is a CONFLICT, even when sent together', async () => {
    const agent = await asSuper();
    expect((await agent.post('/api/admin/semesters').send(body())).status).toBe(201);
    const second = await agent.post('/api/admin/semesters').send(body({ name: 'Fall 2027' }));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');

    await Semester.deleteMany({});
    const results = await Promise.all(
      ['A 2027', 'B 2027', 'C 2027', 'D 2027'].map((name) =>
        agent.post('/api/admin/semesters').send(body({ name })),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'CONFLICT')).toHaveLength(3);
    expect(await Semester.countDocuments({ status: 'draft' })).toBe(1);
  });

  it('SEM-02 the database refuses a second current semester', async () => {
    await Semester.create({
      name: 'A',
      status: 'current',
      start_date: '2027-01-01',
      end_date: '2027-06-01',
    });
    await expect(
      Semester.create({
        name: 'B',
        status: 'current',
        start_date: '2027-07-01',
        end_date: '2027-12-01',
      }),
    ).rejects.toMatchObject({ code: 11000 });
    // a current and a draft can exist side by side
    await expect(
      Semester.create({
        name: 'C',
        status: 'draft',
        start_date: '2028-01-01',
        end_date: '2028-06-01',
      }),
    ).resolves.toBeTruthy();
  });

  it('SEM-02 only draft, current and archived exist', async () => {
    await expect(
      Semester.create({
        name: 'X',
        status: 'open',
        start_date: '2027-01-01',
        end_date: '2027-06-01',
      }),
    ).rejects.toThrow();
  });

  it('SEM-03 an end date before the start date is a VALIDATION_ERROR', async () => {
    const agent = await asSuper();
    const res = await agent.post('/api/admin/semesters').send(body({ end_date: '2027-03-01' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const created = await draft(agent);
    const patch = await agent
      .patch(`/api/admin/semesters/${created.id}`)
      .send({ end_date: '2027-01-01' });
    expect(patch.status).toBe(400);
    expect(patch.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('SEM-03 a super admin edits a draft; the change is audited and sends no push', async () => {
    const sent = vi.fn();
    setEmitter(sent);
    const agent = await asSuper();
    const created = await draft(agent);
    const res = await agent
      .patch(`/api/admin/semesters/${created.id}`)
      .send({ name: 'Spring 2027 (new)', end_date: '2027-10-15' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Spring 2027 (new)', end_date: '2027-10-15' });
    expect(await auditList({ action: 'semester.update' })).toHaveLength(1);
    expect(sent).not.toHaveBeenCalled();
  });

  it('SEM-03 changing the current semester dates is audited and sends calendar.changed once', async () => {
    const agent = await asSuper();
    const created = await draft(agent);
    await agent.post(`/api/admin/semesters/${created.id}/bootstrap-current`);
    const sent = vi.fn();
    setEmitter(sent);
    const res = await agent
      .patch(`/api/admin/semesters/${created.id}`)
      .send({ end_date: '2027-10-15' });
    expect(res.status).toBe(200);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith('everyone', 'calendar.changed', {});
    expect(await auditList({ action: 'semester.update' })).toHaveLength(1);

    // a rename alone does not change live status, so nothing is pushed
    await agent.patch(`/api/admin/semesters/${created.id}`).send({ name: 'Spring 2027 B' });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('SEM-03 an archived semester cannot be edited', async () => {
    const agent = await asSuper();
    const s = await Semester.create({
      name: 'Old',
      status: 'archived',
      start_date: '2026-01-01',
      end_date: '2026-06-01',
    });
    const res = await agent.patch(`/api/admin/semesters/${s._id}`).send({ name: 'Older' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEMESTER_ARCHIVED');
  });

  it('SEM-04 an empty draft can be deleted, and it is audited', async () => {
    const agent = await asSuper();
    const created = await draft(agent);
    const res = await agent.delete(`/api/admin/semesters/${created.id}`);
    expect(res.status).toBe(204);
    expect(await Semester.countDocuments()).toBe(0);
    expect(await auditList({ action: 'semester.delete' })).toHaveLength(1);
  });

  it('SEM-04 a draft with something attached is SEMESTER_IN_USE', async () => {
    const agent = await asSuper();
    const created = await draft(agent);
    registerSemesterUsage({ inUse: async (id) => String(id) === created.id });
    const res = await agent.delete(`/api/admin/semesters/${created.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEMESTER_IN_USE');
    expect(await Semester.countDocuments()).toBe(1);
  });

  it('SEM-04 a current or archived semester cannot be deleted', async () => {
    const agent = await asSuper();
    const created = await draft(agent);
    await agent.post(`/api/admin/semesters/${created.id}/bootstrap-current`);
    const res = await agent.delete(`/api/admin/semesters/${created.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEMESTER_IN_USE');
  });

  it('SEM-05 currentSemester() and draftSemester() are the way other modules read them', async () => {
    expect(await currentSemester()).toBeNull();
    expect(await draftSemester()).toBeNull();
    const agent = await asSuper();
    const created = await draft(agent);
    expect(await draftSemester()).toMatchObject({ id: created.id, status: 'draft' });
    expect(await currentSemester()).toBeNull();
    await agent.post(`/api/admin/semesters/${created.id}/bootstrap-current`);
    expect(await currentSemester()).toMatchObject({ id: created.id, status: 'current' });
    expect(await draftSemester()).toBeNull();
  });

  it('SEM-06 a student, a teacher and an unconfirmed student never see a draft', async () => {
    const agent = await asSuper();
    await draft(agent);
    for (const user of [
      await makeUser({ kind: 'student', state: 'active' }),
      await makeUser({ kind: 'student', state: 'unconfirmed' }),
      await makeUser({ kind: 'teacher', state: 'active' }),
    ]) {
      const res = await (await loginAs(user, app)).get('/api/semesters/current');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    }
  });

  it('SEM-06 a student using a draft semester id gets NOT_FOUND on every endpoint', async () => {
    const agent = await asSuper();
    const created = await draft(agent);
    const student = await loginAs(await makeUser({ kind: 'student' }), app);
    const calls = [
      student.patch(`/api/admin/semesters/${created.id}`).send({ name: 'Hacked' }),
      student.delete(`/api/admin/semesters/${created.id}`),
      student.post(`/api/admin/semesters/${created.id}/bootstrap-current`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await Semester.findById(created.id)).status).toBe('draft');
  });

  it('SEM-06 any signed-in person reads only the name and dates of the current semester', async () => {
    const agent = await asSuper();
    const created = await draft(agent);
    await agent.post(`/api/admin/semesters/${created.id}/bootstrap-current`);
    const student = await loginAs(await makeUser({ kind: 'student', state: 'unconfirmed' }), app);
    const res = await student.get('/api/semesters/current');
    expect(res.body.data).toEqual({
      name: 'Spring 2027',
      start_date: '2027-04-04',
      end_date: '2027-09-30',
    });
    const anonymous = await loginAs(null, app);
    expect((await anonymous.get('/api/semesters/current')).status).toBe(401);
  });

  it('SEM-06 admins see the draft in the admin list, newest first', async () => {
    const agent = await asSuper();
    await Semester.create({
      name: 'Fall 2026',
      status: 'archived',
      start_date: '2026-08-01',
      end_date: '2027-01-31',
    });
    await draft(agent);
    for (const a of [agent, await asDeptAdmin()]) {
      const res = await a.get('/api/admin/semesters');
      expect(res.status).toBe(200);
      expect(res.body.data.map((s) => s.name)).toEqual(['Spring 2027', 'Fall 2026']);
    }
  });

  it('SEM-07 a super admin makes the very first semester current, and it is audited', async () => {
    const agent = await asSuper();
    const created = await draft(agent);
    const res = await agent.post(`/api/admin/semesters/${created.id}/bootstrap-current`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'current' });
    expect(res.body.data.made_current_at).toBeTruthy();
    expect(await auditList({ action: 'semester.bootstrap_current' })).toHaveLength(1);
  });

  it('SEM-02 two bootstrap calls at the same time leave exactly one current semester', async () => {
    const agent = await asSuper();
    const created = await draft(agent);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        agent.post(`/api/admin/semesters/${created.id}/bootstrap-current`),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'CONFLICT')).toHaveLength(3);
    expect(await Semester.countDocuments({ status: 'current' })).toBe(1);
    expect(await auditList({ action: 'semester.bootstrap_current' })).toHaveLength(1);
  });

  it('SEM-07 bootstrap is refused once any semester has been current', async () => {
    const agent = await asSuper();
    await Semester.create({
      name: 'Fall 2026',
      status: 'archived',
      made_current_at: new Date(),
      start_date: '2026-08-01',
      end_date: '2027-01-31',
    });
    const created = await draft(agent);
    const res = await agent.post(`/api/admin/semesters/${created.id}/bootstrap-current`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await Semester.findById(created.id)).status).toBe('draft');
  });

  it('SEM-07 bootstrap is refused while a current semester exists', async () => {
    const agent = await asSuper();
    await Semester.create({
      name: 'Fall 2026',
      status: 'current',
      start_date: '2026-08-01',
      end_date: '2027-01-31',
    });
    const created = await draft(agent);
    const res = await agent.post(`/api/admin/semesters/${created.id}/bootstrap-current`);
    expect(res.status).toBe(409);
  });

  it('SEM-01 an unknown or malformed id is NOT_FOUND or VALIDATION_ERROR', async () => {
    const agent = await asSuper();
    const missing = await agent.patch(`/api/admin/semesters/${makeId()}`).send({ name: 'Nope' });
    expect(missing.status).toBe(404);
    const bad = await agent.delete('/api/admin/semesters/not-an-id');
    expect(bad.status).toBe(400);
  });

  it('permissions: a department admin can list but not create, edit, delete or bootstrap', async () => {
    const root = await asSuper();
    const created = await draft(root);
    const dept = await asDeptAdmin();
    const calls = [
      dept.post('/api/admin/semesters').send(body({ name: 'Other' })),
      dept.patch(`/api/admin/semesters/${created.id}`).send({ name: 'Mine' }),
      dept.delete(`/api/admin/semesters/${created.id}`),
      dept.post(`/api/admin/semesters/${created.id}/bootstrap-current`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect((await dept.get('/api/admin/semesters')).status).toBe(200);
  });

  it('permissions: students, teachers and signed-out visitors cannot manage or list semesters', async () => {
    const root = await asSuper();
    await draft(root);
    for (const user of [
      await makeUser({ kind: 'student' }),
      await makeUser({ kind: 'teacher' }),
      await makeUser({ kind: 'student', state: 'unconfirmed' }),
    ]) {
      const a = await loginAs(user, app);
      expect((await a.get('/api/admin/semesters')).status).toBe(403);
      expect((await a.post('/api/admin/semesters').send(body({ name: 'X1' }))).status).toBe(403);
    }
    const anonymous = await loginAs(null, app);
    expect((await anonymous.get('/api/admin/semesters')).status).toBe(401);
  });

  it('permissions: a deactivated admin is signed out (401) and cannot manage or list', async () => {
    const user = await makeUser({
      kind: 'staff',
      state: 'deactivated',
      roles: [{ role: 'super_admin' }],
    });
    const a = await loginAs(user, app);
    const res = await a.post('/api/admin/semesters').send(body());
    expect(res.status).toBe(401);
    expect(await Semester.countDocuments()).toBe(0);
    expect((await a.get('/api/admin/semesters')).status).toBe(401);
  });

  it('SEM-03 renaming to a name that is already taken is a CONFLICT', async () => {
    const agent = await asSuper();
    await Semester.create({
      name: 'Fall 2026',
      status: 'archived',
      start_date: '2026-08-01',
      end_date: '2027-01-31',
    });
    const created = await draft(agent);
    const res = await agent.patch(`/api/admin/semesters/${created.id}`).send({ name: 'FALL 2026' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await Semester.findById(created.id)).name).toBe('Spring 2027');
  });

  it('SEM-02 a client cannot set the status or other fields (no mass assignment)', async () => {
    const agent = await asSuper();
    const create = await agent.post('/api/admin/semesters').send(body({ status: 'current' }));
    expect(create.status).toBe(400);
    expect(create.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Semester.countDocuments()).toBe(0);

    const created = await draft(agent);
    for (const extra of [{ status: 'current' }, { made_current_at: '2020-01-01' }, { _id: 'x' }]) {
      const res = await agent.patch(`/api/admin/semesters/${created.id}`).send(extra);
      expect(res.status).toBe(400);
    }
    const stored = await Semester.findById(created.id);
    expect(stored.status).toBe('draft');
    expect(stored.made_current_at).toBeUndefined();
  });

  it('SEM-01 operator objects in a body or id are rejected, not run as queries', async () => {
    const agent = await asSuper();
    const created = await draft(agent);
    const asName = await agent
      .patch(`/api/admin/semesters/${created.id}`)
      .send({ name: { $ne: null } });
    expect(asName.status).toBe(400);
    const asId = await agent.delete('/api/admin/semesters/%7B%22%24ne%22%3Anull%7D');
    expect(asId.status).toBe(400);
    expect(await Semester.countDocuments()).toBe(1);
  });
});

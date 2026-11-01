import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
} from '../../../../test/harness.js';
import { makeDepartment, makeUser } from '../../../../test/factories.js';
import { User } from '../auth.model.js';
import { AuditLog } from '../../audit/audit.model.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(clearDb);

const asUser = (user) => loginAs(user, app);
const PRIVATE_KEYS = [
  'level',
  'term',
  'section',
  'group',
  'phone',
  'email',
  'email_enc',
  'phone_enc',
];

describe('GET /api/users/:id (PRF-07)', () => {
  it('PRF-07 a teacher viewing a student gets only name, photo, department and role labels', async () => {
    const teacher = await makeUser({ kind: 'teacher', state: 'active' });
    const student = await makeUser({
      kind: 'student',
      name: 'Nila Rahman',
      phone: '+8801712345678',
      roles: [{ role: 'cr' }],
    });
    const res = await (await asUser(teacher)).get(`/api/users/${student._id}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual([
      'department_id',
      'full_name',
      'id',
      'photo_url',
      'roles',
    ]);
    for (const key of PRIVATE_KEYS) expect(res.body.data).not.toHaveProperty(key);
    expect(JSON.stringify(res.body)).not.toContain(student.email);
    expect(JSON.stringify(res.body)).not.toContain('1712345678');
    expect([...res.body.data.roles].sort()).toEqual(['cr', 'student']);
    expect(res.body.data.full_name).toBe('Nila Rahman');
  });

  it('PRF-07 a teacher profile shows the department and the teacher label', async () => {
    const dept = makeDepartment();
    const viewer = await makeUser({ kind: 'student', state: 'active' });
    const teacher = await makeUser({ kind: 'teacher', departmentId: dept._id });
    const res = await (await asUser(viewer)).get(`/api/users/${teacher._id}`);
    expect(res.body.data.department_id).toBe(String(dept._id));
    expect(res.body.data.roles).toEqual(['teacher']);
  });

  it.each([['unconfirmed'], ['graduated']])('PRF-07 a %s student can view', async (state) => {
    const viewer = await makeUser({ kind: 'student', state });
    const target = await makeUser({ kind: 'student' });
    expect((await (await asUser(viewer)).get(`/api/users/${target._id}`)).status).toBe(200);
  });

  it.each([
    ['student', 'email_unverified'],
    ['student', 'claim_pending'],
    ['teacher', 'pending'],
  ])('PRF-07 a %s in state %s cannot view profiles', async (kind, state) => {
    const viewer = await makeUser({ kind, state });
    const target = await makeUser({ kind: 'student' });
    const res = await (await asUser(viewer)).get(`/api/users/${target._id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('PRF-07 an unknown id and a hidden account both give NOT_FOUND', async () => {
    const viewer = await makeUser({ kind: 'teacher' });
    const hidden = await makeUser({ kind: 'student', state: 'deactivated' });
    const agent = await asUser(viewer);
    expect((await agent.get(`/api/users/${'a'.repeat(24)}`)).status).toBe(404);
    expect((await agent.get(`/api/users/${hidden._id}`)).status).toBe(404);
    expect((await agent.get('/api/users/not-an-id')).status).toBe(400);
  });

  it('PRF-07 the admin of a department can see a hidden account of that department only', async () => {
    const dept = makeDepartment();
    const admin = await makeUser({
      kind: 'staff',
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    });
    const pending = await makeUser({ kind: 'teacher', state: 'pending', departmentId: dept._id });
    const other = await makeUser({
      kind: 'teacher',
      state: 'pending',
      departmentId: makeDepartment()._id,
    });
    const agent = await asUser(admin);
    expect((await agent.get(`/api/users/${pending._id}`)).status).toBe(200);
    expect((await agent.get(`/api/users/${other._id}`)).status).toBe(404);
  });

  it('PRF-07 anonymous → 401', async () => {
    const target = await makeUser();
    expect((await (await asUser(null)).get(`/api/users/${target._id}`)).status).toBe(401);
  });
});

describe('PATCH /api/admin/users/:id/name (PRF-02, PRF-08)', () => {
  const dept = makeDepartment();
  const rename = (agent, id, full_name) =>
    agent.patch(`/api/admin/users/${id}/name`).send({ full_name });

  it('PRF-02 an admin of the teacher’s department renames them, and it is audited', async () => {
    const admin = await makeUser({
      kind: 'staff',
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    });
    const teacher = await makeUser({ kind: 'teacher', name: 'Old Name', departmentId: dept._id });
    const res = await rename(await asUser(admin), teacher._id, 'New Name');
    expect(res.status).toBe(200);
    expect((await User.findById(teacher._id).lean()).full_name).toBe('New Name');
    const [entry] = await AuditLog.find({ action: 'user.name_change' }).lean();
    expect(String(entry.scope_department_id)).toBe(String(dept._id));
    expect(entry.old_value).toEqual({ full_name: 'Old Name' });
    expect(entry.new_value).toEqual({ full_name: 'New Name' });
  });

  it('PRF-02 an admin of another department is refused (cross-scope)', async () => {
    const admin = await makeUser({
      kind: 'staff',
      roles: [{ role: 'dept_admin', department_id: makeDepartment()._id }],
    });
    const teacher = await makeUser({ kind: 'teacher', name: 'Keep', departmentId: dept._id });
    const res = await rename(await asUser(admin), teacher._id, 'Hacked');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await User.findById(teacher._id).lean()).full_name).toBe('Keep');
  });

  it('PRF-02 a super admin can rename anyone', async () => {
    const admin = await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] });
    const student = await makeUser({ kind: 'student', name: 'Before' });
    expect((await rename(await asUser(admin), student._id, 'After Name')).status).toBe(200);
  });

  it.each([['student'], ['teacher']])(
    'PRF-02 a %s cannot rename anyone, even themselves',
    async (kind) => {
      const me = await makeUser({ kind, name: 'Me Myself' });
      const res = await rename(await asUser(me), me._id, 'Someone Else');
      expect(res.status).toBe(403);
      expect((await User.findById(me._id).lean()).full_name).toBe('Me Myself');
    },
  );

  it('PRF-02 a dept admin cannot rename a student whose department is not known yet', async () => {
    const admin = await makeUser({
      kind: 'staff',
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    });
    const student = await makeUser({ kind: 'student' });
    expect((await rename(await asUser(admin), student._id, 'Blocked Name')).status).toBe(403);
  });

  it('PRF-02 unknown user → NOT_FOUND; bad name → VALIDATION_ERROR', async () => {
    const admin = await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] });
    const agent = await asUser(admin);
    expect((await rename(agent, 'b'.repeat(24), 'Valid Name')).status).toBe(404);
    expect((await rename(agent, 'b'.repeat(24), 'x')).status).toBe(400);
  });
});

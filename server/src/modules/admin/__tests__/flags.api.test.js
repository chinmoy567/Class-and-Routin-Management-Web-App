import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  fixClock,
  loginAs,
  resetClock,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { Semester } from '../../organisation/index.js';
import { Section } from '../../routine/index.js';
import { AuditLog } from '../../audit/index.js';
import { Flag } from '../../representatives/cr/flag.model.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearDb();
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
  const eeeSection = await Section.create({
    semester_id: sem._id,
    department_id: eee._id,
    level: 1,
    term: 'II',
    letter: 'B',
  });
  const cr = await makeUser({
    kind: 'student',
    state: 'active',
    name: 'Shahin CR',
    departmentId: cse._id,
    roles: [
      {
        role: 'cr',
        department_id: cse._id,
        section_id: section._id,
        semester_id: sem._id,
        is_representative: true,
      },
    ],
  });
  const cseAdmin = await makeUser({
    kind: 'teacher',
    state: 'active',
    name: 'CSE Admin',
    roles: [{ role: 'dept_admin', department_id: cse._id }],
  });
  const eeeAdmin = await makeUser({
    kind: 'teacher',
    state: 'active',
    name: 'EEE Admin',
    roles: [{ role: 'dept_admin', department_id: eee._id }],
  });
  const superAdmin = await makeUser({
    kind: 'staff',
    state: 'active',
    name: 'Super Admin',
    roles: [{ role: 'super_admin' }],
  });
  const cseFlag = await Flag.create({
    section_id: section._id,
    semester_id: sem._id,
    department_id: cse._id,
    raised_by: cr._id,
    category: 'wrong_group',
    description: 'A student is in the wrong lab group.',
    status: 'open',
  });
  const eeeFlag = await Flag.create({
    section_id: eeeSection._id,
    semester_id: sem._id,
    department_id: eee._id,
    raised_by: cr._id,
    category: 'routine_mistake',
    description: 'A lab is listed on the wrong day.',
    status: 'open',
  });
  return { cse, eee, sem, section, cr, cseAdmin, eeeAdmin, superAdmin, cseFlag, eeeFlag };
}

describe('ADM-18 flags list', () => {
  it('ADM-18 an admin sees open flags with who raised them, the section and when', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent.get('/api/admin/flags').query({ status: 'open' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      status: 'open',
      category: 'wrong_group',
      raised_by: { name: 'Shahin CR' },
      section: { label: '2-I-A' },
      department: { code: 'CSE' },
    });
    expect(res.body.data[0].created_at).toBeTruthy();
  });

  it('ADM-18 a CSE admin never lists EEE flags, and asking for them by department is a 403', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const all = await agent.get('/api/admin/flags');
    expect(all.body.data.map((f) => f.department.code)).toEqual(['CSE']);
    const asked = await agent.get('/api/admin/flags').query({ department_id: String(w.eee._id) });
    expect(asked.status).toBe(403);
  });

  it('ADM-18 a super admin lists flags of every department', async () => {
    const w = await world();
    const agent = await loginAs(w.superAdmin, app);
    const res = await agent.get('/api/admin/flags');
    expect(res.body.data.map((f) => f.department.code).sort()).toEqual(['CSE', 'EEE']);
  });

  it('ADM-18 a CR of the section is refused the admin list (403)', async () => {
    const w = await world();
    const agent = await loginAs(w.cr, app);
    expect((await agent.get('/api/admin/flags')).status).toBe(403);
  });
});

describe('ADM-18 resolving a flag', () => {
  it('ADM-18 an admin marks a flag fixed with a reply, and it is audited with the old and new status', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent
      .post(`/api/admin/flags/${w.cseFlag._id}/resolve`)
      .send({ status: 'fixed', reply: 'Moved the student to G2.' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'fixed', reply: 'Moved the student to G2.' });
    const stored = await Flag.findById(w.cseFlag._id).lean();
    expect(stored.status).toBe('fixed');
    expect(String(stored.resolved_by)).toBe(String(w.cseAdmin._id));
    const entry = await AuditLog.findOne({ action: 'flag.resolve' }).lean();
    expect(entry.old_value).toEqual({ status: 'open' });
    expect(entry.new_value).toEqual({ status: 'fixed', reply: 'Moved the student to G2.' });
    expect(String(entry.scope_department_id)).toBe(String(w.cse._id));
  });

  it('ADM-18 resolving a flag twice gives 409 ALREADY_DECIDED on the second', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    await agent
      .post(`/api/admin/flags/${w.cseFlag._id}/resolve`)
      .send({ status: 'rejected', reply: 'The record is correct.' });
    const again = await agent
      .post(`/api/admin/flags/${w.cseFlag._id}/resolve`)
      .send({ status: 'fixed', reply: 'Changed my mind.' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('X6 two admins resolving the same flag at once: exactly one 200 and one ALREADY_DECIDED', async () => {
    const w = await world();
    const a = await loginAs(w.cseAdmin, app);
    const b = await loginAs(w.superAdmin, app);
    const [first, second] = await Promise.all([
      a
        .post(`/api/admin/flags/${w.cseFlag._id}/resolve`)
        .send({ status: 'fixed', reply: 'Done by the department.' }),
      b
        .post(`/api/admin/flags/${w.cseFlag._id}/resolve`)
        .send({ status: 'rejected', reply: 'Not a problem.' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('ADM-18 the reply must be 1 to 1,000 characters', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const empty = await agent
      .post(`/api/admin/flags/${w.cseFlag._id}/resolve`)
      .send({ status: 'fixed', reply: '   ' });
    expect(empty.status).toBe(400);
    const long = await agent
      .post(`/api/admin/flags/${w.cseFlag._id}/resolve`)
      .send({ status: 'fixed', reply: 'x'.repeat(1001) });
    expect(long.status).toBe(400);
    expect((await Flag.findById(w.cseFlag._id).lean()).status).toBe('open');
  });

  it('ADM-18 an admin of another department cannot resolve the flag (404), and nothing changes', async () => {
    const w = await world();
    const agent = await loginAs(w.eeeAdmin, app);
    const res = await agent
      .post(`/api/admin/flags/${w.cseFlag._id}/resolve`)
      .send({ status: 'fixed', reply: 'Not my department.' });
    expect(res.status).toBe(404);
    expect((await Flag.findById(w.cseFlag._id).lean()).status).toBe('open');
  });

  it('ADM-18 the CR of the section sees the admin result in the overview', async () => {
    const w = await world();
    const admin = await loginAs(w.cseAdmin, app);
    await admin
      .post(`/api/admin/flags/${w.cseFlag._id}/resolve`)
      .send({ status: 'fixed', reply: 'Moved the student to G2.' });
    const cr = await loginAs(w.cr, app);
    const overview = await cr.get(`/api/cr/sections/${w.section._id}/overview`);
    expect(overview.status).toBe(200);
    expect(overview.body.data.flags[0]).toMatchObject({
      status: 'fixed',
      reply: 'Moved the student to G2.',
    });
  });

  it('ADM-18 a student cannot resolve a flag (404, the flag is hidden from them)', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const res = await cr
      .post(`/api/admin/flags/${w.cseFlag._id}/resolve`)
      .send({ status: 'fixed', reply: 'I fixed it myself.' });
    expect(res.status).toBe(404);
  });
});

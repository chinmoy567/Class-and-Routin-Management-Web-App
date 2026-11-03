import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
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
import { RoutineImport, Section } from '../../routine/index.js';
import { Enrolment, UvClaim } from '../../enrolments/index.js';
import { UserRole } from '../../auth/index.js';
import { AuditLog } from '../../audit/index.js';
import { Flag } from '../../representatives/cr/flag.model.js';
import { TeacherRegistration } from '../../teachers/teachers.model.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearDb();
  // Tuesday 2027-04-06 10:00 in Asia/Dhaka.
  fixClock('2027-04-06T04:00:00Z');
});
afterEach(resetClock);

/** CSE and EEE, the current semester Spring 2027, a past semester Fall 2026, and one admin of each. */
async function world({ madeCurrentDaysAgo = 0 } = {}) {
  const cse = await createDepartment({ code: 'CSE' });
  const eee = await createDepartment({ code: 'EEE' });
  const past = await Semester.create({
    name: 'Fall 2026',
    start_date: '2026-10-04',
    end_date: '2027-02-28',
    status: 'archived',
  });
  const sem = await Semester.create({
    name: 'Spring 2027',
    start_date: '2027-04-04',
    end_date: '2027-10-04',
    status: 'current',
    made_current_at: new Date(Date.parse('2027-04-06T04:00:00Z') - madeCurrentDaysAgo * 86400000),
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
  const student = await makeUser({ kind: 'student', state: 'active', departmentId: cse._id });
  const section = await Section.create({
    semester_id: sem._id,
    department_id: cse._id,
    level: 2,
    term: 'I',
    letter: 'A',
  });
  const lastSection = await Section.create({
    semester_id: past._id,
    department_id: cse._id,
    level: 1,
    term: 'II',
    letter: 'A',
  });
  const eeeSection = await Section.create({
    semester_id: sem._id,
    department_id: eee._id,
    level: 1,
    term: 'I',
    letter: 'A',
  });
  return {
    cse,
    eee,
    past,
    sem,
    cseAdmin,
    eeeAdmin,
    superAdmin,
    student,
    section,
    lastSection,
    eeeSection,
  };
}

async function dashboard(user, query = {}) {
  const agent = await loginAs(user, app);
  return agent.get('/api/admin/dashboard').query(query);
}

describe('ADM-11 dashboard scope', () => {
  it('ADM-11 a CSE admin passing the EEE department gets 403; the super admin sees both', async () => {
    const w = await world();
    const refused = await dashboard(w.cseAdmin, { department_id: String(w.eee._id) });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
    const all = await dashboard(w.superAdmin);
    expect(all.status).toBe(200);
    expect(all.body.data.scope.all).toBe(true);
  });

  it('ADM-11 a department admin without a department filter sees only their own department', async () => {
    const w = await world();
    await TeacherRegistration.create({
      user_id: (await makeUser({ kind: 'teacher', state: 'pending' }))._id,
      department_id: w.eee._id,
      requested_short_code: 'EEE01',
    });
    const res = await dashboard(w.cseAdmin);
    expect(res.status).toBe(200);
    expect(res.body.data.teacher_registrations.count).toBe(0);
    expect(res.body.data.scope.all).toBe(false);
  });

  it('ADM-11 a student or teacher without admin roles is refused (403), and anonymous is 401', async () => {
    const w = await world();
    expect((await dashboard(w.student)).status).toBe(403);
    const teacher = await makeUser({ kind: 'teacher', state: 'active' });
    expect((await dashboard(teacher)).status).toBe(403);
    const anon = await loginAs(null, app);
    expect((await anon.get('/api/admin/dashboard')).status).toBe(401);
  });

  it('ADM-11 the dashboard answers in one call with every card', async () => {
    const w = await world();
    const res = await dashboard(w.cseAdmin);
    for (const key of [
      'teacher_registrations',
      'id_claims',
      'flags',
      'rejections_and_appeals',
      'routine_problems',
      'semester',
      'unconfirmed',
      'recent_activity',
    ]) {
      expect(res.body.data).toHaveProperty(key);
    }
  });
});

describe('ADM-01 teacher registrations', () => {
  it('ADM-01 lists pending registrations in scope, without the teacher email', async () => {
    const w = await world();
    const cseTeacher = await makeUser({
      kind: 'teacher',
      state: 'pending',
      email: 'pending.cse@baiust.ac.bd',
    });
    await TeacherRegistration.create({
      user_id: cseTeacher._id,
      department_id: w.cse._id,
      requested_short_code: 'CSE07',
    });
    const eeeTeacher = await makeUser({ kind: 'teacher', state: 'pending' });
    await TeacherRegistration.create({
      user_id: eeeTeacher._id,
      department_id: w.eee._id,
      requested_short_code: 'EEE03',
    });
    const res = await dashboard(w.cseAdmin);
    const card = res.body.data.teacher_registrations;
    expect(card.count).toBe(1);
    expect(card.items[0]).toMatchObject({ requested_short_code: 'CSE07' });
    expect(JSON.stringify(res.body)).not.toContain('pending.cse@baiust.ac.bd');
  });
});

describe('ADM-02 ID claims that need the admin', () => {
  it('ADM-02 an escalated join request and a CR claim are listed for the admin of that department', async () => {
    const w = await world();
    const escalatedUser = await makeUser({
      kind: 'student',
      state: 'claim_pending',
      departmentId: w.cse._id,
    });
    await Enrolment.create({
      user_id: escalatedUser._id,
      semester_id: w.sem._id,
      section_id: w.section._id,
      department_id: w.cse._id,
      status: 'pending',
      escalated_at: new Date('2027-04-03T04:00:00Z'),
    });
    const crUser = await makeUser({ kind: 'student', state: 'active', departmentId: w.cse._id });
    await UvClaim.create({
      user_id: crUser._id,
      department_id: w.cse._id,
      uv_id_text: '1234567',
      uv_id_norm: '1234567',
      status: 'pending',
    });
    const res = await dashboard(w.cseAdmin);
    const card = res.body.data.id_claims;
    expect(card.count).toBe(2);
    expect(card.items.map((i) => i.kind).sort()).toEqual(['claim', 'escalated']);
    const eeeAdmin = await dashboard(w.eeeAdmin);
    expect(eeeAdmin.body.data.id_claims.count).toBe(0);
  });
});

describe('ADM-03 flags from CR and DCR', () => {
  it('ADM-03 open flags of the department are shown; closed ones are not', async () => {
    const w = await world();
    const common = {
      section_id: w.section._id,
      semester_id: w.sem._id,
      department_id: w.cse._id,
      raised_by: w.student._id,
      category: 'missing_student',
      description: 'A classmate is not on the roster.',
    };
    await Flag.create({ ...common, status: 'open' });
    await Flag.create({ ...common, status: 'fixed', reply: 'Added.', resolved_at: new Date() });
    const res = await dashboard(w.cseAdmin);
    expect(res.body.data.flags.count).toBe(1);
    expect(res.body.data.flags.items[0].status).toBe('open');
  });
});

describe('ADM-04 rejections and appeals', () => {
  it('ADM-04 open appeals come first, then the rejections', async () => {
    const w = await world();
    const rejectedUser = await makeUser({
      kind: 'student',
      state: 'claim_pending',
      departmentId: w.cse._id,
    });
    await Enrolment.create({
      user_id: rejectedUser._id,
      semester_id: w.sem._id,
      section_id: w.section._id,
      department_id: w.cse._id,
      status: 'rejected',
      reason: 'Wrong section',
    });
    const appealUser = await makeUser({
      kind: 'student',
      state: 'claim_pending',
      departmentId: w.cse._id,
    });
    await Enrolment.create({
      user_id: appealUser._id,
      semester_id: w.sem._id,
      section_id: w.section._id,
      department_id: w.cse._id,
      status: 'rejected',
      reason: 'Not sure',
      appeal: { at: new Date(), status: 'open' },
    });
    const res = await dashboard(w.cseAdmin);
    const items = res.body.data.rejections_and_appeals.items;
    expect(items.map((i) => i.kind)).toEqual(['appeal', 'rejected']);
    expect(items[0].reason).toBe('Not sure');
  });
});

describe('ADM-05 routine problems', () => {
  it("ADM-05 open issues of the latest import are shown for the department; another department's are not", async () => {
    const w = await world();
    const issue = { severity: 'error', code: 'UNKNOWN_ROOM', row: 3, message: 'Room not found.' };
    await RoutineImport.create({
      semester_id: w.sem._id,
      department_id: w.cse._id,
      status: 'checked',
      issues: [issue],
      counts: { rows: 1, errors: 1, warnings: 0 },
      uploaded_by: w.cseAdmin._id,
      uploaded_at: new Date('2027-04-05T04:00:00Z'),
    });
    await RoutineImport.create({
      semester_id: w.sem._id,
      department_id: w.eee._id,
      status: 'checked',
      issues: [{ ...issue, row: 9 }],
      counts: { rows: 1, errors: 1, warnings: 0 },
      uploaded_by: w.eeeAdmin._id,
      uploaded_at: new Date('2027-04-05T04:00:00Z'),
    });
    const res = await dashboard(w.cseAdmin);
    expect(res.body.data.routine_problems.count).toBe(1);
    expect(res.body.data.routine_problems.items[0]).toMatchObject({ row: 3, code: 'UNKNOWN_ROOM' });
  });

  it("ADM-05 a cross-department duplicate raised by another department's import is shown to this department", async () => {
    const w = await world();
    await RoutineImport.create({
      semester_id: w.sem._id,
      department_id: w.eee._id,
      status: 'checked',
      issues: [
        {
          severity: 'warning',
          code: 'CROSS_DEPARTMENT_DUPLICATE',
          row: 4,
          message: 'CSE already has CSE-101 for this section.',
          other_department: 'CSE',
        },
      ],
      counts: { rows: 1, errors: 0, warnings: 1 },
      uploaded_by: w.eeeAdmin._id,
      uploaded_at: new Date('2027-04-05T04:00:00Z'),
    });
    const res = await dashboard(w.cseAdmin);
    const cross = res.body.data.routine_problems.items.filter((i) => i.kind === 'cross_department');
    expect(cross).toHaveLength(1);
    expect(cross[0].other_department).toBe('CSE');
  });

  it("ADM-05 a section created by another department's import is noted (IMP-27)", async () => {
    const w = await world();
    await Section.create({
      semester_id: w.sem._id,
      department_id: w.cse._id,
      level: 3,
      term: 'II',
      letter: 'B',
      created_by_import_of: w.eee._id,
    });
    const res = await dashboard(w.cseAdmin);
    const row = res.body.data.routine_problems.items.find((i) => i.kind === 'created_by_other');
    expect(res.body.data.routine_problems.count).toBe(1);
    expect(row.created_by_department).toBe('EEE');
  });
});

describe('ADM-06 room requests are not released yet', () => {
  it('ADM-06 the room requests card is absent in R1, and the response says so', async () => {
    const w = await world();
    const res = await dashboard(w.cseAdmin);
    expect(res.body.data.released.room_requests).toBe(false);
    expect(res.body.data).not.toHaveProperty('room_requests');
  });
});

describe('ADM-07 current semester and readiness', () => {
  it("ADM-07 a department admin sees the current semester and only their own department's readiness", async () => {
    const w = await world();
    await Semester.create({
      name: 'Fall 2027',
      start_date: '2027-10-10',
      end_date: '2028-02-28',
      status: 'draft',
    });
    const res = await dashboard(w.cseAdmin);
    expect(res.body.data.semester.current).toMatchObject({
      name: 'Spring 2027',
      status: 'current',
    });
    expect(res.body.data.semester.draft).toMatchObject({ name: 'Fall 2027' });
    expect(res.body.data.semester.readiness.departments.map((d) => d.code)).toEqual(['CSE']);
    expect(res.body.data.semester.readiness.can_make_current).toBe(false);
  });

  it("ADM-07 a super admin sees every department's readiness and the Make current permission", async () => {
    const w = await world();
    await Semester.create({
      name: 'Fall 2027',
      start_date: '2027-10-10',
      end_date: '2028-02-28',
      status: 'draft',
    });
    const res = await dashboard(w.superAdmin);
    expect(res.body.data.semester.readiness.departments.map((d) => d.code).sort()).toEqual([
      'CSE',
      'EEE',
    ]);
    expect(res.body.data.semester.readiness.can_make_current).toBe(true);
  });
});

describe('ADM-08 departments without an admin (super admin only)', () => {
  it('ADM-08 the super admin sees EEE with no active admin, and a warning for fewer than two super admins', async () => {
    const w = await world();
    // EEE's only admin is removed, so EEE has no active admin.
    await UserRole.updateOne(
      { user_id: w.eeeAdmin._id, role: 'dept_admin' },
      { ended_at: new Date() },
    );
    const res = await dashboard(w.superAdmin);
    const missing = res.body.data.missing_admin;
    expect(missing.departments.items.map((d) => d.code)).toEqual(['EEE']);
    expect(missing.super_admin_count).toBe(1);
    expect(missing.fewer_than_two_super_admins).toBe(true);
  });

  it('ADM-08 a department admin never gets the card', async () => {
    const w = await world();
    const res = await dashboard(w.cseAdmin);
    expect(res.body.data).not.toHaveProperty('missing_admin');
  });
});

describe('ADM-09 unconfirmed students', () => {
  it('ADM-09 a student who is still unconfirmed 14 days after the semester became current is listed', async () => {
    const w = await world({ madeCurrentDaysAgo: 15 });
    const jamal = await makeUser({
      kind: 'student',
      state: 'unconfirmed',
      name: 'Jamal Mia',
      departmentId: w.cse._id,
    });
    await Enrolment.create({
      user_id: jamal._id,
      semester_id: w.past._id,
      section_id: w.lastSection._id,
      department_id: w.cse._id,
      status: 'accepted',
    });
    const res = await dashboard(w.cseAdmin);
    expect(res.body.data.unconfirmed.count).toBe(1);
    expect(res.body.data.unconfirmed.items[0].students.map((s) => s.name)).toEqual(['Jamal Mia']);
  });

  it('ADM-09 before day 14 the card is empty', async () => {
    const w = await world({ madeCurrentDaysAgo: 3 });
    const jamal = await makeUser({
      kind: 'student',
      state: 'unconfirmed',
      name: 'Jamal Mia',
      departmentId: w.cse._id,
    });
    await Enrolment.create({
      user_id: jamal._id,
      semester_id: w.past._id,
      section_id: w.lastSection._id,
      department_id: w.cse._id,
      status: 'accepted',
    });
    const res = await dashboard(w.cseAdmin);
    expect(res.body.data.unconfirmed.count).toBe(0);
  });
});

describe('ADM-10 recent activity', () => {
  it('ADM-10 shows the latest entries in scope, with the actor name and no other department', async () => {
    const w = await world();
    await AuditLog.create([
      {
        actor_id: w.cseAdmin._id,
        actor_roles: [],
        action: 'cse.thing',
        target_type: 'user',
        target_id: new mongoose.Types.ObjectId(),
        scope_department_id: w.cse._id,
        at: new Date('2027-04-06T03:00:00Z'),
      },
      {
        actor_id: w.eeeAdmin._id,
        actor_roles: [],
        action: 'eee.thing',
        target_type: 'user',
        target_id: new mongoose.Types.ObjectId(),
        scope_department_id: w.eee._id,
        at: new Date('2027-04-06T03:30:00Z'),
      },
    ]);
    const res = await dashboard(w.cseAdmin);
    const items = res.body.data.recent_activity.items;
    expect(items.map((i) => i.action)).toEqual(['cse.thing']);
    expect(items[0].actor_name).toBe('CSE Admin');
  });
});

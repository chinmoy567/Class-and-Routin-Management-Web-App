import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
  fixClock,
  resetClock,
} from '../../../../test/harness.js';
import { createDepartment, makeId, makeUser } from '../../../../test/factories.js';
import { Semester } from '../../organisation/index.js';
import { RoutineSlot, RoutineSlotTeacher, Section, SectionGroup } from '../../routine/index.js';
import { clearAll as clearRoutineCache } from '../../routine/routine-cache.js';
import { Enrolment, UvClaim } from '../../enrolments/index.js';
import { Teacher } from '../../teachers/index.js';
import { Room } from '../../rooms/index.js';
import { CalendarEvent } from '../../calendar/index.js';
import { User } from '../../auth/index.js';
import { getDashboard, registerDashboardCard, resetDashboardCards } from '../index.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(() => disconnectTestDb());
beforeEach(async () => {
  await clearDb();
  clearRoutineCache();
  // Tuesday 2027-04-06 10:00 in Asia/Dhaka. The semester runs 4 Apr to 4 Oct 2027.
  fixClock('2027-04-06T04:00:00Z');
});
afterEach(() => {
  resetClock();
  clearRoutineCache();
  resetDashboardCards();
});

// ── World ─────────────────────────────────────────────────────────────────────

async function addSlot(w, over, teachers) {
  const slot = await RoutineSlot.create({
    semester_id: w.sem._id,
    owner_department_id: w.dept._id,
    section_id: w.section._id,
    room_id: w.room._id,
    day_of_week: 2, // Tuesday, so it is today in the fixed clock
    start_min: 510,
    end_min: 565,
    course_code: 'CSE-301',
    published: true,
    source: 'manual',
    tba: false,
    version: 1,
    ...over,
  });
  for (const t of teachers) {
    await RoutineSlotTeacher.create({ slot_id: slot._id, teacher_id: t._id });
  }
  return slot;
}

/** CSE 2-I-A with groups G1 and G2, room R311, and CSE 2-I-B (nobody teaches it). */
async function world() {
  const dept = await createDepartment({ code: 'CSE' });
  const other = await createDepartment({ code: 'EEE' });
  const sem = await Semester.create({
    name: 'Spring 2027',
    start_date: '2027-04-04',
    end_date: '2027-10-04',
    status: 'current',
  });
  const section = await Section.create({
    semester_id: sem._id,
    department_id: dept._id,
    level: 2,
    term: 'I',
    letter: 'A',
  });
  const sectionB = await Section.create({
    semester_id: sem._id,
    department_id: dept._id,
    level: 2,
    term: 'I',
    letter: 'B',
  });
  const g1 = await SectionGroup.create({ section_id: section._id, label: 'G1' });
  const g2 = await SectionGroup.create({ section_id: section._id, label: 'G2' });
  const room = await Room.create({
    code: 'R311',
    code_norm: 'R311',
    type: 'classroom',
    owner_department_id: dept._id,
  });
  const ab = await Teacher.create({
    department_id: dept._id,
    short_code: 'AB',
    full_name: 'Arifur Bhuiyan',
    created_from: 'import',
  });
  const cd = await Teacher.create({
    department_id: dept._id,
    short_code: 'CD',
    full_name: 'Chinmoy Dey',
    created_from: 'import',
  });
  const w = { dept, other, sem, section, sectionB, g1, g2, room, ab, cd };
  // Whole-section theory, G1 lab taught by AB, G2 lab taught by CD (same course code).
  await addSlot(w, { course_code: 'CSE-301', start_min: 510, end_min: 565 }, [ab]);
  await addSlot(w, { course_code: 'CSE-422', group_id: g1._id, start_min: 600, end_min: 690 }, [
    ab,
  ]);
  await addSlot(w, { course_code: 'CSE-422', group_id: g2._id, start_min: 600, end_min: 690 }, [
    cd,
  ]);
  return w;
}

async function enrol(user, w, { section = w.section, group = null } = {}) {
  return Enrolment.create({
    user_id: user._id,
    semester_id: w.sem._id,
    section_id: section._id,
    department_id: w.dept._id,
    group_id: group ? group._id : undefined,
    status: 'accepted',
    decided_at: new Date(),
  });
}

async function claimUv(user, w, text) {
  return UvClaim.create({
    user_id: user._id,
    department_id: w.dept._id,
    uv_id_text: text,
    uv_id_norm: text.replace(/^0+/, ''),
    status: 'approved',
  });
}

const student = (w, opts = {}) =>
  makeUser({ kind: 'student', state: 'active', departmentId: w.dept._id, ...opts });

// Each call gets its own UV ID, because an approved ID belongs to one account only.
let uvCounter = 0;
async function activeStudent(w, group = w.g2) {
  const user = await student(w, { name: 'Rahim Uddin' });
  await enrol(user, w, { group });
  await claimUv(user, w, `08223102051${String(uvCounter++).padStart(5, '0')}`);
  return user;
}

async function activeTeacher(w, record = w.ab) {
  const user = await makeUser({
    kind: 'teacher',
    state: 'active',
    departmentId: w.dept._id,
    name: record.full_name,
  });
  await Teacher.updateOne({ _id: record._id }, { $set: { user_id: user._id } });
  return user;
}

const get = async (user, path = '/api/me/dashboard') => (await loginAs(user, app)).get(path);

// ── DSH-01: access ────────────────────────────────────────────────────────────

describe('DSH-01 access to the dashboard', () => {
  it('DSH-01 unauthenticated → 401', async () => {
    const res = await (await loginAs(null, app)).get('/api/me/dashboard');
    expect(res.status).toBe(401);
  });

  it.each([
    ['email_unverified', 'student'],
    ['claim_pending', 'student'],
    ['unconfirmed', 'student'],
    ['graduated', 'student'],
    ['pending', 'teacher'],
  ])('DSH-01 a %s %s is refused with STATE_NOT_ALLOWED', async (state, kind) => {
    const w = await world();
    const user = await makeUser({ kind, state, departmentId: w.dept._id });
    const res = await get(user);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('DSH-01 a suspended teacher is signed out at once (401), so the dashboard is never reached', async () => {
    const w = await world();
    const user = await makeUser({ kind: 'teacher', state: 'suspended', departmentId: w.dept._id });
    const res = await get(user);
    expect(res.status).toBe(401);
  });

  it('DSH-01 an admin account (staff) has no dashboard → 403 FORBIDDEN', async () => {
    const w = await world();
    const admin = await makeUser({
      kind: 'staff',
      state: 'active',
      roles: [{ role: 'dept_admin', department_id: w.dept._id }],
    });
    const res = await get(admin);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

// ── DSH-01, DSH-02: one call, release gating ──────────────────────────────────

describe('DSH-01 / DSH-02 one call and release gating', () => {
  it('DSH-01 an active student gets every R1 card in one response', async () => {
    const w = await world();
    const user = await activeStudent(w);
    const res = await get(user);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.kind).toBe('student');
    expect(d.semester).toMatchObject({ name: 'Spring 2027' });
    expect(d.section.name).toBe('CSE 2-I-A');
    expect(d.courses).toBeInstanceOf(Array);
    expect(d.upcoming_events).toBeInstanceOf(Array);
    expect(d.free_now).toHaveProperty('free_count');
    expect(d.reminders).toBeTruthy();
  });

  it('DSH-02 with R1 live, a messages card (R3) is not in the response for a student or teacher', async () => {
    const w = await world();
    const s = (await get(await activeStudent(w))).body.data;
    const t = (await get(await activeTeacher(w))).body.data;
    expect(s).not.toHaveProperty('messages');
    expect(t).not.toHaveProperty('messages');
  });

  it('DSH-02 a card for an unreleased feature is not built; it is built at its release', async () => {
    const w = await world();
    const user = await activeStudent(w);
    const build = vi.fn(async () => ({ unread: 3 }));
    registerDashboardCard({
      feature: 'dashboard.student.messages',
      key: 'messages',
      kinds: ['student'],
      build,
    });

    const atR1 = await getDashboard(user, { release: 'R1' });
    expect(build).not.toHaveBeenCalled();
    expect(atR1).not.toHaveProperty('messages');

    const atR3 = await getDashboard(user, { release: 'R3' });
    expect(build).toHaveBeenCalledTimes(1);
    expect(atR3.messages).toEqual({ unread: 3 });
  });

  it('DSH-02 a registered card for another kind is never built for this viewer', async () => {
    const w = await world();
    const user = await activeStudent(w);
    const build = vi.fn(async () => ({}));
    registerDashboardCard({
      feature: 'dashboard.teacher.messages',
      key: 'teacher_messages',
      kinds: ['teacher'],
      build,
    });
    await getDashboard(user, { release: 'R3' });
    expect(build).not.toHaveBeenCalled();
  });
});

// ── DSH-07, DSH-08, DSH-15: notices and rooms ─────────────────────────────────

describe('DSH-07 / DSH-08 / DSH-15 notices and rooms', () => {
  it('DSH-07 notices list only events in the next 14 days, university or own department', async () => {
    const w = await world();
    const event = (over) => CalendarEvent.create({ created_by: makeId(), ...over });
    await event({
      scope_department_id: null,
      from_date: '2027-04-08',
      to_date: '2027-04-08',
      kind: 'holiday',
      label: 'Eid holiday',
    });
    await event({
      scope_department_id: w.dept._id,
      from_date: '2027-04-10',
      to_date: '2027-04-10',
      kind: 'dept_event',
      label: 'CSE FEST',
    });
    await event({
      scope_department_id: w.other._id,
      from_date: '2027-04-11',
      to_date: '2027-04-11',
      kind: 'dept_event',
      label: 'EEE Day',
    });
    await event({
      scope_department_id: null,
      from_date: '2027-06-01',
      to_date: '2027-06-01',
      kind: 'exam',
      label: 'Far away',
    });
    const d = (await get(await activeStudent(w))).body.data;
    const labels = d.upcoming_events.map((e) => e.label);
    expect(labels).toEqual(['Eid holiday', 'CSE FEST']);
  });

  it('DSH-08 free rooms now list only the free rooms, with code and type and no class details', async () => {
    const w = await world();
    const d = (await get(await activeStudent(w))).body.data;
    expect(typeof d.free_now.free_count).toBe('number');
    for (const room of d.free_now.rooms) {
      expect(Object.keys(room).sort()).toEqual(['code', 'id', 'type']);
    }
  });

  it('DSH-15 a teacher sees the same 14-day notices', async () => {
    const w = await world();
    await CalendarEvent.create({
      created_by: makeId(),
      scope_department_id: null,
      from_date: '2027-04-12',
      to_date: '2027-04-12',
      kind: 'prep_leave',
      label: 'Prep leave',
    });
    const d = (await get(await activeTeacher(w))).body.data;
    expect(d.upcoming_events.map((e) => e.label)).toEqual(['Prep leave']);
  });
});

// ── DSH-09, DSH-10: the student's section and reminders ───────────────────────

describe('DSH-09 my section', () => {
  it('DSH-09 a G2 student sees the G2 lab teacher, not the G1 teacher, for CSE-422', async () => {
    const w = await world();
    const d = (await get(await activeStudent(w, w.g2))).body.data;
    const lab = d.courses.find((c) => c.course_code === 'CSE-422');
    expect(lab.teachers.map((t) => t.short_code)).toEqual(['CD']);
    // AB teaches the G1 lab and the whole-section lecture, but never the G2 lab.
    expect(lab.teachers.map((t) => t.full_name)).not.toContain('Arifur Bhuiyan');
  });

  it('DSH-09 a G1 student sees the G1 teacher for CSE-422', async () => {
    const w = await world();
    const d = (await get(await activeStudent(w, w.g1))).body.data;
    const lab = d.courses.find((c) => c.course_code === 'CSE-422');
    expect(lab.teachers.map((t) => t.full_name)).toEqual(['Arifur Bhuiyan']);
  });

  it('DSH-09 the CR and DCRs of the section are listed with their names and role', async () => {
    const w = await world();
    const cr = await student(w, { name: 'Karim CR' });
    await enrol(cr, w, { group: w.g1 });
    await UvClaim.create({ user_id: cr._id, uv_id_text: '1', uv_id_norm: '1', status: 'approved' });
    const { UserRole } = await import('../../auth/index.js');
    await UserRole.create({
      user_id: cr._id,
      role: 'cr',
      section_id: w.section._id,
      semester_id: w.sem._id,
      department_id: w.dept._id,
    });
    const viewer = await activeStudent(w, w.g2);
    const d = (await get(viewer)).body.data;
    expect(d.representatives).toEqual([expect.objectContaining({ role: 'cr', name: 'Karim CR' })]);
    expect(d.section.my_role).toBeNull();
  });

  it('DSH-09 a student who holds the CR role sees their own role on the section', async () => {
    const w = await world();
    const { UserRole } = await import('../../auth/index.js');
    const cr = await student(w, { name: 'Karim CR' });
    await enrol(cr, w, { group: w.g1 });
    await UserRole.create({
      user_id: cr._id,
      role: 'cr',
      section_id: w.section._id,
      semester_id: w.sem._id,
      department_id: w.dept._id,
    });
    const d = (await get(cr)).body.data;
    expect(d.section.my_role).toBe('cr');
  });
});

describe('DSH-10 profile reminders', () => {
  it('DSH-10 a student with no sessional group sees the group notice and only whole-section courses', async () => {
    const w = await world();
    const user = await activeStudent(w, null);
    const d = (await get(user)).body.data;
    expect(d.reminders.group_missing).toBe(true);
    expect(d.courses.map((c) => c.course_code)).toEqual(['CSE-301']);
  });

  it('DSH-10 a student with a group has no group notice', async () => {
    const w = await world();
    const d = (await get(await activeStudent(w, w.g1))).body.data;
    expect(d.reminders.group_missing).toBe(false);
  });

  it('DSH-10 a bouncing email and an unverified email are flagged', async () => {
    const w = await world();
    const bouncing = await activeStudent(w, w.g1);
    await User.updateOne({ _id: bouncing._id }, { $set: { email_bouncing: true } });
    expect((await get(bouncing)).body.data.reminders.email).toBe('bouncing');

    const unverified = await activeStudent(w, w.g1);
    await User.updateOne({ _id: unverified._id }, { $unset: { email_verified_at: 1 } });
    expect((await get(unverified)).body.data.reminders.email).toBe('unverified');
  });

  it('DSH-10 the semester badge reads "<semester> confirmed" for an accepted student', async () => {
    const w = await world();
    const d = (await get(await activeStudent(w, w.g1))).body.data;
    expect(d.reminders.semester_badge).toEqual({ semester: 'Spring 2027', confirmed: true });
  });

  it("DSH-10 and privacy: the dashboard never carries the owner's email or any phone", async () => {
    const w = await world();
    const user = await activeStudent(w, w.g1);
    const res = await get(user);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(user.email);
    expect(text).not.toMatch(/email_enc|phone_enc|email_hmac|password/);
  });
});

// ── DSH-16 and DSH-11 / DSH-12: the teacher ───────────────────────────────────

describe('DSH-16 teacher account', () => {
  it('DSH-16 an unlinked teacher has the not-linked notice and no sections', async () => {
    const w = await world();
    const unlinked = await makeUser({
      kind: 'teacher',
      state: 'active',
      departmentId: w.dept._id,
    });
    const res = await get(unlinked);
    expect(res.status).toBe(200);
    expect(res.body.data.teacher_link.linked).toBe(false);
    expect(res.body.data.sections_taught).toEqual([]);
  });

  it('DSH-16 a linked teacher sees their short code and name, and the sections they teach', async () => {
    const w = await world();
    const user = await activeTeacher(w, w.ab);
    const d = (await get(user)).body.data;
    expect(d.teacher_link).toEqual({
      linked: true,
      records: [{ short_code: 'AB', full_name: 'Arifur Bhuiyan' }],
    });
    expect(d.sections_taught).toEqual([
      expect.objectContaining({ name: 'CSE 2-I-A', student_count: 0 }),
    ]);
  });

  it('DSH-16 a teacher with no phone or photo gets the reminders', async () => {
    const w = await world();
    const d = (await get(await activeTeacher(w, w.ab))).body.data;
    expect(d.reminders).toMatchObject({ phone_missing: true, photo_missing: true });
  });

  it('DSH-11 the routine behind the card carries both teachers of a shared lab', async () => {
    const w = await world();
    const shared = await RoutineSlot.create({
      semester_id: w.sem._id,
      owner_department_id: w.dept._id,
      section_id: w.section._id,
      room_id: w.room._id,
      day_of_week: new Date('2027-04-08T00:00:00Z').getUTCDay(),
      start_min: 600,
      end_min: 690,
      course_code: 'CSE-400',
      published: true,
      source: 'manual',
      tba: false,
      version: 1,
    });
    await RoutineSlotTeacher.create({ slot_id: shared._id, teacher_id: w.ab._id });
    await RoutineSlotTeacher.create({ slot_id: shared._id, teacher_id: w.cd._id });
    const { getMyRoutine } = await import('../../routine/my-routine.service.js');
    const data = await getMyRoutine(
      { _id: (await activeTeacher(w, w.ab))._id, kind: 'teacher', department_id: w.dept._id },
      { from: '2027-04-08', to: '2027-04-08' },
    );
    const teachers = data.days[0].slots.find((s) => s.course_code === 'CSE-400').teachers;
    expect(teachers.map((t) => t.full_name).sort()).toEqual(['Arifur Bhuiyan', 'Chinmoy Dey']);
  });
});

// ── DSH-13: rosters ───────────────────────────────────────────────────────────

describe('DSH-13 section rosters', () => {
  async function rosterWorld() {
    const w = await world();
    const rahim = await student(w, { name: 'Rahim Uddin' });
    await enrol(rahim, w, { group: w.g1 });
    await claimUv(rahim, w, '0822310205101077');
    const karim = await student(w, { name: 'Karim Hasan' });
    await enrol(karim, w, { group: w.g2 });
    await claimUv(karim, w, '0822310205101078');
    return { w, rahim, karim };
  }

  it('DSH-13 a teacher of the section gets the roster: name, UV ID and group only', async () => {
    const { w } = await rosterWorld();
    const teacher = await activeTeacher(w, w.ab);
    const res = await (await loginAs(teacher, app)).get(`/api/sections/${w.section._id}/roster`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.name)).toEqual(['Karim Hasan', 'Rahim Uddin']);
    expect(res.body.data[1]).toMatchObject({ uv_id: '0822310205101077', group: 'G1' });
    for (const row of res.body.data) {
      expect(Object.keys(row).sort()).toEqual(['group', 'name', 'photo', 'user_id', 'uv_id']);
      expect(JSON.stringify(row)).not.toMatch(/email|phone|_enc|hmac/i);
    }
  });

  it('DSH-13 a teacher opening a section they do not teach → 404', async () => {
    const { w } = await rosterWorld();
    const teacher = await activeTeacher(w, w.ab);
    const res = await (await loginAs(teacher, app)).get(`/api/sections/${w.sectionB._id}/roster`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('DSH-13 a student cannot read any roster, not even their own section → 404', async () => {
    const { w, rahim } = await rosterWorld();
    const res = await (await loginAs(rahim, app)).get(`/api/sections/${w.section._id}/roster`);
    expect(res.status).toBe(404);
  });

  it('DSH-13 a department admin of another department gets 404 for this roster', async () => {
    const { w } = await rosterWorld();
    const eeeAdmin = await makeUser({
      kind: 'staff',
      state: 'active',
      roles: [{ role: 'dept_admin', department_id: w.other._id }],
    });
    const res = await (await loginAs(eeeAdmin, app)).get(`/api/sections/${w.section._id}/roster`);
    expect(res.status).toBe(404);
  });

  it("DSH-13 a department admin of the section's department reads the roster", async () => {
    const { w } = await rosterWorld();
    const admin = await makeUser({
      kind: 'staff',
      state: 'active',
      roles: [{ role: 'dept_admin', department_id: w.dept._id }],
    });
    const res = await (await loginAs(admin, app)).get(`/api/sections/${w.section._id}/roster`);
    expect(res.status).toBe(200);
  });

  it('DSH-13 a super admin reads any roster', async () => {
    const { w } = await rosterWorld();
    const sa = await makeUser({ kind: 'staff', state: 'active', roles: [{ role: 'super_admin' }] });
    const res = await (await loginAs(sa, app)).get(`/api/sections/${w.section._id}/roster`);
    expect(res.status).toBe(200);
  });

  it('DSH-13 a claim_pending student is refused with STATE_NOT_ALLOWED', async () => {
    const { w } = await rosterWorld();
    const pending = await makeUser({
      kind: 'student',
      state: 'claim_pending',
      departmentId: w.dept._id,
    });
    const res = await (await loginAs(pending, app)).get(`/api/sections/${w.section._id}/roster`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('DSH-13 a malformed section id → 400; an unknown one → 404', async () => {
    const { w } = await rosterWorld();
    const teacher = await activeTeacher(w, w.ab);
    const agent = await loginAs(teacher, app);
    expect((await agent.get('/api/sections/not-an-id/roster')).status).toBe(400);
    expect((await agent.get('/api/sections/000000000000000000000000/roster')).status).toBe(404);
  });
});

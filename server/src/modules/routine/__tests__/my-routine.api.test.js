import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
  fixClock,
  resetClock,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { Semester } from '../../organisation/index.js';
import {
  RoutineSlot,
  RoutineSlotTeacher,
  Section,
  SectionGroup,
  resetRoutineHooks,
} from '../../routine/index.js';
import { Enrolment } from '../../enrolments/index.js';
import { Teacher } from '../../teachers/index.js';
import { Room } from '../../rooms/index.js';
import { clearAll as clearRoutineCache } from '../routine-cache.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(() => disconnectTestDb());
beforeEach(async () => {
  await clearDb();
  clearRoutineCache();
});
afterEach(() => {
  resetRoutineHooks();
  resetClock();
  clearRoutineCache();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeSemester({ status = 'current', start = '2027-04-04', end = '2027-10-04' } = {}) {
  const sem = await Semester.create({
    name: `Sem-${Date.now()}`,
    start_date: start,
    end_date: end,
    status,
  });
  return { id: String(sem._id), _id: sem._id, name: sem.name, start_date: start, end_date: end };
}

async function makeRoom(dept) {
  const code = `RM${Date.now()}`;
  const room = await Room.create({
    code,
    code_norm: code.toUpperCase(),
    type: 'classroom',
    owner_department_id: dept._id,
  });
  return room;
}

async function makeSection(sem, dept, overrides = {}) {
  const sec = await Section.create({
    semester_id: sem._id,
    department_id: dept._id,
    level: 2,
    term: 'I',
    letter: 'A',
    ...overrides,
  });
  return sec;
}

async function makeGroup(sec, label = 'G1') {
  const g = await SectionGroup.create({ section_id: sec._id, label });
  return g;
}

async function makePublishedSlot(sem, dept, section, room, overrides = {}) {
  const slot = await RoutineSlot.create({
    semester_id: sem._id,
    owner_department_id: dept._id,
    section_id: section._id,
    room_id: room._id,
    day_of_week: 0, // Sunday
    start_min: 510,
    end_min: 565,
    course_code: 'CSE-421',
    published: true,
    source: 'manual',
    tba: true,
    version: 1,
    ...overrides,
  });
  return slot;
}

async function makeTeacher(dept, shortCode = `T${Date.now()}`) {
  const teacher = await Teacher.create({
    department_id: dept._id,
    short_code: shortCode,
    full_name: 'Test Teacher',
    created_from: 'import',
  });
  return teacher;
}

async function linkTeacher(slot, teacher) {
  return RoutineSlotTeacher.create({ slot_id: slot._id, teacher_id: teacher._id });
}

async function enrolStudent(user, sem, section, group = null) {
  return Enrolment.create({
    user_id: user._id,
    semester_id: sem._id,
    section_id: section._id,
    department_id: section.department_id,
    group_id: group ? group._id : undefined,
    status: 'accepted',
    decided_at: new Date(),
  });
}

async function asActiveStudent(dept) {
  return loginAs(
    await makeUser({ kind: 'student', state: 'active', departmentId: dept._id }),
    app,
  );
}

async function asActiveTeacher(dept) {
  return loginAs(
    await makeUser({ kind: 'teacher', state: 'active', departmentId: dept._id }),
    app,
  );
}

// ── RTN-04: permission checks ─────────────────────────────────────────────────

describe('RTN-04 access control', () => {
  it('RTN-04 unauthenticated → 401', async () => {
    const anon = await loginAs(null, app);
    const res = await anon.get('/api/me/routine');
    expect(res.status).toBe(401);
  });

  it('RTN-04 claim_pending student → 403', async () => {
    const dept = await createDepartment();
    const agent = await loginAs(
      await makeUser({ kind: 'student', state: 'claim_pending', departmentId: dept._id }),
      app,
    );
    const res = await agent.get('/api/me/routine');
    expect(res.status).toBe(403);
  });

  it('RTN-04 unconfirmed student → 403', async () => {
    const dept = await createDepartment();
    const agent = await loginAs(
      await makeUser({ kind: 'student', state: 'unconfirmed', departmentId: dept._id }),
      app,
    );
    const res = await agent.get('/api/me/routine');
    expect(res.status).toBe(403);
  });

  it('RTN-04 active student → 200', async () => {
    const dept = await createDepartment();
    const sem = await makeSemester();
    const agent = await asActiveStudent(dept);
    const res = await agent.get('/api/me/routine');
    expect(res.status).toBe(200);
  });

  it('RTN-04 active teacher → 200', async () => {
    const dept = await createDepartment();
    await makeSemester();
    const agent = await asActiveTeacher(dept);
    const res = await agent.get('/api/me/routine');
    expect(res.status).toBe(200);
  });
});

// ── RTN-06: response shape ────────────────────────────────────────────────────

describe('RTN-06 response shape', () => {
  it('RTN-06 response includes all required top-level fields', async () => {
    const dept = await createDepartment();
    await makeSemester();
    const agent = await asActiveStudent(dept);
    const res = await agent.get('/api/me/routine');
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data).toHaveProperty('server_time');
    expect(data).toHaveProperty('timezone', 'Asia/Dhaka');
    expect(data).toHaveProperty('semester');
    expect(data).toHaveProperty('week');
    expect(data).toHaveProperty('days');
    expect(data).toHaveProperty('bookings');
    expect(Array.isArray(data.bookings)).toBe(true);
    expect(data).toHaveProperty('events');
    expect(data).toHaveProperty('group_missing');
    expect(data).toHaveProperty('is_teacher');
  });

  it('RTN-06 range > 14 days → 400', async () => {
    const dept = await createDepartment();
    await makeSemester();
    const agent = await asActiveStudent(dept);
    const res = await agent.get('/api/me/routine?from=2027-04-04&to=2027-05-01');
    expect(res.status).toBe(400);
  });

  it('RTN-06 to before from → 400', async () => {
    const dept = await createDepartment();
    await makeSemester();
    const agent = await asActiveStudent(dept);
    const res = await agent.get('/api/me/routine?from=2027-04-10&to=2027-04-04');
    expect(res.status).toBe(400);
  });
});

// ── RTN-01: group-aware filtering ────────────────────────────────────────────

describe('RTN-01 group-aware filtering', () => {
  it('RTN-01 G1 student does not receive G2 lab slot, does receive whole-section slot', async () => {
    const dept = await createDepartment();
    const sem = await makeSemester();
    const section = await makeSection(sem, dept);
    const room = await makeRoom(dept);
    const g1 = await makeGroup(section, 'G1');
    const g2 = await makeGroup(section, 'G2');

    // Whole-section slot (no group)
    const wholeSlot = await makePublishedSlot(sem, dept, section, room, {
      day_of_week: 0,
      course_code: 'CSE-THEORY',
    });
    // G1 lab
    const g1Slot = await makePublishedSlot(sem, dept, section, room, {
      day_of_week: 1,
      group_id: g1._id,
      course_code: 'CSE-LAB-G1',
    });
    // G2 lab
    const g2Slot = await makePublishedSlot(sem, dept, section, room, {
      day_of_week: 2,
      group_id: g2._id,
      course_code: 'CSE-LAB-G2',
    });

    const user = await makeUser({ kind: 'student', state: 'active', departmentId: dept._id });
    await enrolStudent(user, sem, section, g1);

    // Fix clock to a Sunday inside the semester, request 7 days.
    fixClock('2027-04-06T04:00:00Z'); // 2027-04-06 = Monday. Use 2027-04-13 (Monday) or Apr 06.
    // Apr 4 = Sunday. Fix to Apr 4.
    fixClock('2027-04-04T04:00:00Z');

    const agent = await loginAs(user, app);
    const res = await agent.get('/api/me/routine?from=2027-04-04&to=2027-04-10');
    expect(res.status).toBe(200);

    const allCourseCodes = res.body.data.days.flatMap((d) =>
      d.slots.map((s) => s.course_code),
    );

    expect(allCourseCodes).toContain('CSE-THEORY');
    expect(allCourseCodes).toContain('CSE-LAB-G1');
    expect(allCourseCodes).not.toContain('CSE-LAB-G2');
  });

  it('RTN-01 student with no group sees only whole-section slots and group_missing: true', async () => {
    const dept = await createDepartment();
    const sem = await makeSemester();
    const section = await makeSection(sem, dept);
    const room = await makeRoom(dept);
    const g1 = await makeGroup(section, 'G1');

    await makePublishedSlot(sem, dept, section, room, { course_code: 'CSE-THEORY', day_of_week: 0 });
    await makePublishedSlot(sem, dept, section, room, {
      course_code: 'CSE-LAB-G1',
      day_of_week: 1,
      group_id: g1._id,
    });

    const user = await makeUser({ kind: 'student', state: 'active', departmentId: dept._id });
    await enrolStudent(user, sem, section, null); // no group

    fixClock('2027-04-04T04:00:00Z');
    const agent = await loginAs(user, app);
    const res = await agent.get('/api/me/routine?from=2027-04-04&to=2027-04-10');
    expect(res.status).toBe(200);
    expect(res.body.data.group_missing).toBe(true);

    const allCourseCodes = res.body.data.days.flatMap((d) => d.slots.map((s) => s.course_code));
    expect(allCourseCodes).toContain('CSE-THEORY');
    expect(allCourseCodes).not.toContain('CSE-LAB-G1');
  });
});

// ── RTN-05: cross-section isolation ──────────────────────────────────────────

describe('RTN-05 cross-section isolation', () => {
  it('RTN-05 student never receives another section\'s slots', async () => {
    const dept = await createDepartment();
    const sem = await makeSemester();
    const sectionA = await makeSection(sem, dept, { letter: 'A' });
    const sectionB = await makeSection(sem, dept, { letter: 'B' });
    const room = await makeRoom(dept);

    await makePublishedSlot(sem, dept, sectionA, room, { course_code: 'CSE-A', day_of_week: 0 });
    await makePublishedSlot(sem, dept, sectionB, room, { course_code: 'CSE-B', day_of_week: 0 });

    const user = await makeUser({ kind: 'student', state: 'active', departmentId: dept._id });
    await enrolStudent(user, sem, sectionA);

    fixClock('2027-04-04T04:00:00Z');
    const agent = await loginAs(user, app);
    const res = await agent.get('/api/me/routine?from=2027-04-04&to=2027-04-10');
    expect(res.status).toBe(200);

    const allCourseCodes = res.body.data.days.flatMap((d) => d.slots.map((s) => s.course_code));
    expect(allCourseCodes).toContain('CSE-A');
    expect(allCourseCodes).not.toContain('CSE-B');
  });
});

// ── RTN-03: teacher routine ───────────────────────────────────────────────────

describe('RTN-03 teacher routine', () => {
  it('RTN-03 teacher gets slots they are linked to via RoutineSlotTeacher', async () => {
    const dept = await createDepartment();
    const sem = await makeSemester();
    const section = await makeSection(sem, dept);
    const room = await makeRoom(dept);

    const user = await makeUser({ kind: 'teacher', state: 'active', departmentId: dept._id });
    const teacherRec = await makeTeacher(dept, 'TEACH');
    await Teacher.updateOne({ _id: teacherRec._id }, { $set: { user_id: user._id } });

    const slot = await makePublishedSlot(sem, dept, section, room, {
      course_code: 'CSE-TEACHER',
      tba: false,
    });
    await linkTeacher(slot, teacherRec);

    fixClock('2027-04-04T04:00:00Z');
    const agent = await loginAs(user, app);
    const res = await agent.get('/api/me/routine?from=2027-04-04&to=2027-04-10');
    expect(res.status).toBe(200);
    expect(res.body.data.is_teacher).toBe(true);

    const allCourseCodes = res.body.data.days.flatMap((d) => d.slots.map((s) => s.course_code));
    expect(allCourseCodes).toContain('CSE-TEACHER');
  });

  it('RTN-03 teacher does not receive slots they are not linked to', async () => {
    const dept = await createDepartment();
    const sem = await makeSemester();
    const section = await makeSection(sem, dept);
    const room = await makeRoom(dept);

    const user = await makeUser({ kind: 'teacher', state: 'active', departmentId: dept._id });
    // slot exists but teacher is NOT linked
    await makePublishedSlot(sem, dept, section, room, { course_code: 'CSE-UNLINKED' });

    fixClock('2027-04-04T04:00:00Z');
    const agent = await loginAs(user, app);
    const res = await agent.get('/api/me/routine?from=2027-04-04&to=2027-04-10');
    expect(res.status).toBe(200);

    const allCourseCodes = res.body.data.days.flatMap((d) => d.slots.map((s) => s.course_code));
    expect(allCourseCodes).not.toContain('CSE-UNLINKED');
  });
});

// ── RTN-07: TBA teacher ───────────────────────────────────────────────────────

describe('RTN-07 TBA teacher', () => {
  it('RTN-07 TBA slot shows "Teacher to be announced"', async () => {
    const dept = await createDepartment();
    const sem = await makeSemester();
    const section = await makeSection(sem, dept);
    const room = await makeRoom(dept);

    await makePublishedSlot(sem, dept, section, room, { tba: true, day_of_week: 0 });

    const user = await makeUser({ kind: 'student', state: 'active', departmentId: dept._id });
    await enrolStudent(user, sem, section);

    fixClock('2027-04-04T04:00:00Z');
    const agent = await loginAs(user, app);
    const res = await agent.get('/api/me/routine?from=2027-04-04&to=2027-04-06');
    expect(res.status).toBe(200);

    const slots = res.body.data.days.flatMap((d) => d.slots);
    const tbaSlot = slots.find((s) => s.tba !== false);
    expect(tbaSlot).toBeDefined();
    expect(tbaSlot.teachers[0].full_name).toBe('Teacher to be announced');
  });
});

// ── RTN-14: cache invalidation ────────────────────────────────────────────────

describe('RTN-14 cache', () => {
  it('RTN-14 second call returns cached result (same data)', async () => {
    const dept = await createDepartment();
    const sem = await makeSemester();
    const section = await makeSection(sem, dept);
    const room = await makeRoom(dept);
    await makePublishedSlot(sem, dept, section, room, { course_code: 'CSE-CACHED', day_of_week: 0 });

    const user = await makeUser({ kind: 'student', state: 'active', departmentId: dept._id });
    await enrolStudent(user, sem, section);

    fixClock('2027-04-04T04:00:00Z');
    const agent = await loginAs(user, app);

    const res1 = await agent.get('/api/me/routine?from=2027-04-04&to=2027-04-06');
    const res2 = await agent.get('/api/me/routine?from=2027-04-04&to=2027-04-06');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const codes1 = res1.body.data.days.flatMap((d) => d.slots.map((s) => s.course_code));
    const codes2 = res2.body.data.days.flatMap((d) => d.slots.map((s) => s.course_code));
    expect(codes1).toEqual(codes2);
  });

  it('RTN-14 clearAll() empties cache so next call reloads from DB', async () => {
    const dept = await createDepartment();
    const sem = await makeSemester();
    const section = await makeSection(sem, dept);
    const room = await makeRoom(dept);
    await makePublishedSlot(sem, dept, section, room, { course_code: 'CSE-BEFORE', day_of_week: 0 });

    const user = await makeUser({ kind: 'student', state: 'active', departmentId: dept._id });
    await enrolStudent(user, sem, section);

    fixClock('2027-04-04T04:00:00Z');
    const agent = await loginAs(user, app);

    await agent.get('/api/me/routine?from=2027-04-04&to=2027-04-06'); // warm cache

    // Add another slot directly (bypass cache clear mechanism).
    await makePublishedSlot(sem, dept, section, room, { course_code: 'CSE-AFTER', day_of_week: 1 });
    clearRoutineCache(); // simulate publish clearing the cache

    const res = await agent.get('/api/me/routine?from=2027-04-04&to=2027-04-07');
    const codes = res.body.data.days.flatMap((d) => d.slots.map((s) => s.course_code));
    expect(codes).toContain('CSE-AFTER');
  });
});

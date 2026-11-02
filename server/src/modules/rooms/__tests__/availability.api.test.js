import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
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
import { RoutineSlot, Section } from '../../routine/index.js';
import { CalendarEvent, ClassCancellation } from '../../calendar/index.js';
import { Room, RoomShare, availability, registerAvailabilityProvider } from '../index.js';

// The clock is fixed to Sunday 4 April 2027, 11:00 in Asia/Dhaka (05:00 UTC). Sunday is day 0.
const NOW = '2027-04-04T05:00:00Z';
const SUNDAY = '2027-04-04';
const at = (h, m = 0) => h * 60 + m;

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearDb();
  fixClock(NOW);
});
afterEach(() => resetClock());

// ── Helpers ───────────────────────────────────────────────────────────────────

const semesterCount = { n: 0 };
async function makeSemester({ start = '2027-03-28' } = {}) {
  semesterCount.n += 1;
  const sem = await Semester.create({
    name: `Spring ${semesterCount.n}`,
    start_date: start,
    end_date: '2027-10-04',
    status: 'current',
  });
  return { id: String(sem._id), _id: sem._id, start_date: sem.start_date, end_date: sem.end_date };
}

async function makeRoom(dept, { code = '311', type = 'classroom', retired = false } = {}) {
  return Room.create({
    code,
    code_norm: `${code.toLowerCase()}-${String(dept._id).slice(-6)}`,
    type,
    owner_department_id: dept._id,
    retired,
  });
}

async function shareRoom(room, dept) {
  await RoomShare.create({ room_id: room._id, department_id: dept._id });
}

let sectionSeq = 0;
async function makeSlot({ semester, dept, room, day = 0, start, end, code = 'CSE-301' }) {
  sectionSeq += 1;
  const section = await Section.create({
    semester_id: semester._id,
    department_id: dept._id,
    level: 4,
    term: 'I',
    letter: `S${sectionSeq}`,
  });
  return RoutineSlot.create({
    semester_id: semester._id,
    owner_department_id: dept._id,
    section_id: section._id,
    day_of_week: day,
    start_min: start,
    end_min: end,
    course_code: code,
    room_id: room._id,
    source: 'import',
    published: true,
  });
}

/**
 * Mark a department as having published its routine (FRV-02): one published slot in a retired
 * room, so the room does not appear in the listings the tests check.
 */
async function publish(semester, dept) {
  const room = await makeRoom(dept, { code: `pub-${dept.code}`, retired: true });
  return makeSlot({ semester, dept, room, start: at(8), end: at(9), code: 'PUB-100' });
}

const asStudent = async (state = 'active') =>
  loginAs(await makeUser({ kind: 'student', state }), app);

const query = (agent, params) => agent.get('/api/rooms/availability').query(params);
const base = { date: SUNDAY, from: String(at(11)), to: String(at(12)) };

const roomRow = (body, code) => body.data.rooms.find((r) => r.code === code);

describe('free-room view (spec 13)', () => {
  it('FRV-02 a room shared with a department that has not published shows "unknown"', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    const eee = await createDepartment({ code: 'EEE' });
    await publish(semester, cse);
    const room = await makeRoom(cse, { code: '309' });
    await shareRoom(room, eee);

    const res = await query(await asStudent(), base);
    expect(res.status).toBe(200);
    expect(roomRow(res.body, '309').status).toBe('unknown');
  });

  it('FRV-02 the same room is known once the sharing department has published', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    const eee = await createDepartment({ code: 'EEE' });
    await publish(semester, cse);
    await publish(semester, eee);
    const room = await makeRoom(cse, { code: '309' });
    await shareRoom(room, eee);

    const res = await query(await asStudent(), base);
    expect(roomRow(res.body, '309').status).toBe('free');
  });

  it('FRV-03 a room used 10:30-11:25 is busy for 11:00-12:00 and free for 11:35-12:30', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    const room = await makeRoom(cse, { code: '311' });
    await makeSlot({ semester, dept: cse, room, start: at(10, 30), end: at(11, 25) });
    const agent = await asStudent();

    const busy = await query(agent, { date: SUNDAY, from: at(11), to: at(12) });
    expect(roomRow(busy.body, '311').status).toBe('busy');

    const free = await query(agent, { date: SUNDAY, from: at(11, 35), to: at(12, 30) });
    expect(roomRow(free.body, '311').status).toBe('free');
  });

  it('FRV-03 a range that only touches the class end (11:25-11:35) is free', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    const room = await makeRoom(cse, { code: '311' });
    await makeSlot({ semester, dept: cse, room, start: at(10, 30), end: at(11, 25) });

    const res = await query(await asStudent(), { date: SUNDAY, from: at(11, 25), to: at(11, 35) });
    expect(roomRow(res.body, '311').status).toBe('free');
  });

  it('FRV-03 a slot cancelled for that date does not make the room busy', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    const room = await makeRoom(cse, { code: '311' });
    const slot = await makeSlot({ semester, dept: cse, room, start: at(10, 30), end: at(11, 25) });
    await ClassCancellation.create({
      slot_id: slot._id,
      date: SUNDAY,
      reason: 'Teacher away',
      created_by: makeId(),
    });

    const res = await query(await asStudent(), base);
    expect(roomRow(res.body, '311').status).toBe('free');
  });

  it('FRV-03 on an early-closing day (cutoff 12:00), an 11:35-12:30 class makes the room busy only until 12:00', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    const room = await makeRoom(cse, { code: '311' });
    await makeSlot({ semester, dept: cse, room, start: at(11, 35), end: at(12, 30) });
    await CalendarEvent.create({
      from_date: SUNDAY,
      to_date: SUNDAY,
      kind: 'early_closing',
      cutoff_min: at(12),
      label: 'Campus Day',
      created_by: makeId(),
    });
    const agent = await asStudent();

    const before = await query(agent, { date: SUNDAY, from: at(11, 50), to: at(12) });
    expect(roomRow(before.body, '311').status).toBe('busy');

    const after = await query(agent, { date: SUNDAY, from: at(12), to: at(13) });
    expect(roomRow(after.body, '311').status).toBe('free');
  });

  it('FRV-04 on a university exam day the response carries requests_allowed false and the label', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    await makeRoom(cse, { code: '311' });
    await CalendarEvent.create({
      from_date: SUNDAY,
      to_date: SUNDAY,
      kind: 'exam',
      label: 'Mid-term exam',
      created_by: makeId(),
    });

    const res = await query(await asStudent(), base);
    expect(res.body.data.requests_allowed).toBe(false);
    expect(res.body.data.day_label).toBe('Mid-term exam');
    expect(roomRow(res.body, '311').status).toBe('free');
  });

  it('FRV-04 on a Friday rooms are listed as free, with requests not allowed', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    await makeRoom(cse, { code: '311' });

    const res = await query(await asStudent(), { date: '2027-04-09', from: '660', to: '720' });
    expect(res.body.data.requests_allowed).toBe(false);
    expect(res.body.data.day_label).toBe('No classes today');
    expect(roomRow(res.body, '311').requests_allowed).toBe(false);
  });

  it('FRV-05 a busy room shows only status, never the section, course or teacher', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    const room = await makeRoom(cse, { code: '311' });
    await makeSlot({
      semester,
      dept: cse,
      room,
      start: at(10, 30),
      end: at(11, 25),
      code: 'CSE-301',
    });

    const res = await query(await asStudent(), base);
    const row = roomRow(res.body, '311');
    expect(row.status).toBe('busy');
    expect(Object.keys(row).sort()).toEqual(
      ['code', 'id', 'owner', 'requests_allowed', 'status', 'type'].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain('CSE-301');
  });

  it('FRV-05 each row has code, type, owner department code and status', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    await makeRoom(cse, { code: '311', type: 'lab' });

    const res = await query(await asStudent(), base);
    expect(roomRow(res.body, '311')).toMatchObject({
      code: '311',
      type: 'lab',
      owner: { code: 'CSE' },
      status: 'free',
    });
  });

  it('FRV-06 rooms can be filtered by type and by owner department, and retired rooms never appear', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    const eee = await createDepartment({ code: 'EEE' });
    await publish(semester, cse);
    await publish(semester, eee);
    await makeRoom(cse, { code: '311', type: 'classroom' });
    await makeRoom(cse, { code: 'LAB1', type: 'lab' });
    await makeRoom(eee, { code: '501', type: 'classroom' });
    await makeRoom(cse, { code: 'OLD', type: 'classroom', retired: true });
    const agent = await asStudent();

    const labs = await query(agent, { ...base, type: 'lab' });
    expect(labs.body.data.rooms.map((r) => r.code)).toEqual(['LAB1']);

    const eeeOnly = await query(agent, { ...base, department_id: eee.id });
    expect(eeeOnly.body.data.rooms.map((r) => r.code)).toEqual(['501']);

    const all = await query(agent, base);
    expect(all.body.data.rooms.map((r) => r.code)).not.toContain('OLD');
  });

  it('FRV-01 a date three weeks ahead is DATE_OUT_OF_RANGE', async () => {
    await makeSemester();
    const res = await query(await asStudent(), { ...base, date: '2027-04-25' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DATE_OUT_OF_RANGE');
  });

  it('FRV-01 next week (Sunday to Saturday) is accepted', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    await makeRoom(cse, { code: '311' });
    const res = await query(await asStudent(), { ...base, date: '2027-04-17' });
    expect(res.status).toBe(200);
  });

  it('FRV-01 a date before the current semester starts is DATE_OUT_OF_RANGE', async () => {
    await makeSemester({ start: '2027-04-05' });
    const res = await query(await asStudent(), base); // 4 April, the day before the semester
    expect(res.body.error.code).toBe('DATE_OUT_OF_RANGE');
  });

  it('FRV-01 a range that is not on 5-minute steps, or is backwards, is a VALIDATION_ERROR', async () => {
    await makeSemester();
    const agent = await asStudent();
    const odd = await query(agent, { date: SUNDAY, from: '601', to: '660' });
    expect(odd.body.error.code).toBe('VALIDATION_ERROR');
    const backwards = await query(agent, { date: SUNDAY, from: '660', to: '600' });
    expect(backwards.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('FRV-08 a claim_pending student gets STATE_NOT_ALLOWED', async () => {
    await makeSemester();
    const res = await query(await asStudent('claim_pending'), base);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('FRV-08 an active teacher and an active admin can use the view', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    await makeRoom(cse, { code: '311' });
    const teacher = await loginAs(await makeUser({ kind: 'teacher' }), app);
    const admin = await loginAs(
      await makeUser({ kind: 'staff', roles: [{ role: 'dept_admin', department_id: cse._id }] }),
      app,
    );
    expect((await query(teacher, base)).status).toBe(200);
    expect((await query(admin, base)).status).toBe(200);
  });

  it('FRV-07 free-now starts at now rounded down to 5 minutes and lasts 55 minutes', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    await makeRoom(cse, { code: '311' });
    fixClock('2027-04-04T05:02:00Z'); // 11:02 in Dhaka
    const res = await (await asStudent()).get('/api/rooms/free-now');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ date: SUNDAY, from: at(11), to: at(11) + 55 });
    expect(res.body.data.rooms.map((r) => r.code)).toEqual(['311']);
  });

  it('FRV-07 free-now lists no rooms outside 08:00 to 18:00', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    await makeRoom(cse, { code: '311' });
    fixClock('2027-04-04T13:00:00Z'); // 19:00 in Dhaka
    const res = await (await asStudent()).get('/api/rooms/free-now');
    expect(res.body.data.rooms).toEqual([]);
  });

  it('FRV-09 the availability service answers for booking without an HTTP request', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    const room = await makeRoom(cse, { code: '311' });
    await makeSlot({ semester, dept: cse, room, start: at(10, 30), end: at(11, 25) });

    const result = await availability({ date: SUNDAY, from: at(11), to: at(12) });
    expect(result.rooms.find((r) => r.code === '311').status).toBe('busy');
  });

  it('FRV-03 a room with an approved booking (spec 19 hook) is "booked", and shows nothing more', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    const room = await makeRoom(cse, { code: '311' });
    registerAvailabilityProvider({ bookedRoomIds: async () => [room._id] });

    const res = await query(await asStudent(), base);
    const row = roomRow(res.body, '311');
    expect(row.status).toBe('booked');
    expect(Object.keys(row)).not.toContain('requester');
  });

  it('FRV-10 a view of 150 rooms makes a bounded number of database calls, not one per room', async () => {
    const semester = await makeSemester();
    const cse = await createDepartment({ code: 'CSE' });
    await publish(semester, cse);
    const rooms = [];
    for (let i = 0; i < 150; i += 1) rooms.push(await makeRoom(cse, { code: `R${i}` }));
    for (const room of rooms.slice(0, 40)) {
      await makeSlot({ semester, dept: cse, room, start: at(10), end: at(11) });
    }

    const calls = [];
    const listener = (collection, method) => calls.push(`${collection}.${method}`);
    mongoose.set('debug', (collection, method) => listener(collection, method));
    try {
      const res = await query(await asStudent(), base);
      expect(res.body.data.rooms).toHaveLength(150);
    } finally {
      mongoose.set('debug', false);
    }
    // Fixed overhead only (sign-in, semester, rooms, calendar, shares, routine, departments),
    // never one query per room: 150 rooms cost the same as 5.
    expect(calls.length).toBeLessThanOrEqual(25);
  });
});

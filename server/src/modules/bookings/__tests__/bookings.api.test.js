import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
  fixClock,
  resetClock,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { Semester } from '../../organisation/index.js';
import { RoutineSlot, RoutineSlotTeacher, Section, SectionGroup } from '../../routine/index.js';
import { Room, RoomShare } from '../../rooms/index.js';
import { Teacher } from '../../teachers/index.js';
import { RoomRequest, RoomSlotLock, expireDueRequests, pendingRequestsSummary } from '../index.js';
import {
  applyBookingAction,
  bookingsForRoutine,
  findBookingClashes,
} from '../../routine/bookings.hooks.js';

// Sunday 4 April 2027, 11:00 in Asia/Dhaka. Wednesday 7 April is a teaching day inside the window.
const NOW = '2027-04-04T05:00:00Z';
const WED = '2027-04-07';
const at = (h, m = 0) => h * 60 + m;

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
  fixClock(NOW);
});
afterEach(() => resetClock());

// ── World ─────────────────────────────────────────────────────────────────────

let semesterSeq = 0;
async function makeSemester({ start = '2027-03-28', end = '2027-10-04' } = {}) {
  semesterSeq += 1;
  const sem = await Semester.create({
    name: `Term ${semesterSeq}`,
    start_date: start,
    end_date: end,
    status: 'current',
  });
  return sem;
}

async function makeRoom(dept, code = '311') {
  return Room.create({
    code,
    code_norm: `${code.toLowerCase()}-${String(dept._id).slice(-6)}`,
    type: 'classroom',
    owner_department_id: dept._id,
  });
}

async function makeSection(semester, dept, letter) {
  return Section.create({
    semester_id: semester._id,
    department_id: dept._id,
    level: 3,
    term: 'II',
    letter,
  });
}

/** A published class. `teacher` links the routine to a teacher record. */
async function makeClass({ semester, dept, room, section, day = 3, start, end, teacher }) {
  const slot = await RoutineSlot.create({
    semester_id: semester._id,
    owner_department_id: dept._id,
    section_id: section._id,
    day_of_week: day,
    start_min: start,
    end_min: end,
    course_code: 'CSE-301',
    room_id: room._id,
    source: 'import',
    published: true,
  });
  if (teacher) await RoutineSlotTeacher.create({ slot_id: slot._id, teacher_id: teacher._id });
  return slot;
}

/** Marks a department as having published its routine (FRV-02), via a retired room. */
async function publish(semester, dept) {
  const room = await Room.create({
    code: `pub-${String(dept._id).slice(-6)}`,
    code_norm: `pub-${String(dept._id)}`,
    type: 'classroom',
    owner_department_id: dept._id,
    retired: true,
  });
  const section = await makeSection(semester, dept, 'PUB');
  return makeClass({ semester, dept, room, section, start: at(8), end: at(9) });
}

/**
 * The usual world: CSE owns room 311 and has a published routine; section CSE 3-II-A has a CR; a
 * teacher ABC teaches a class elsewhere; an admin of CSE.
 */
async function world({ semester } = {}) {
  const sem = semester ?? (await makeSemester());
  const cse = await createDepartment({ code: 'CSE' });
  await publish(sem, cse);
  const room = await makeRoom(cse, '311');
  const sectionA = await makeSection(sem, cse, 'A');
  const sectionB = await makeSection(sem, cse, 'B');
  const teacher = await Teacher.create({
    department_id: cse._id,
    short_code: 'ABC',
    full_name: 'Teacher One',
  });
  const cr = await makeUser({
    kind: 'student',
    state: 'active',
    roles: [{ role: 'cr', section_id: sectionA._id, semester_id: sem._id }],
  });
  const crB = await makeUser({
    kind: 'student',
    state: 'active',
    roles: [{ role: 'cr', section_id: sectionB._id, semester_id: sem._id }],
  });
  const admin = await makeUser({
    kind: 'staff',
    roles: [{ role: 'dept_admin', department_id: cse._id }],
  });
  const teacherUser = await makeUser({
    kind: 'teacher',
    state: 'active',
    roles: [{ role: 'teacher', department_id: cse._id }],
  });
  await Teacher.updateOne({ _id: teacher._id }, { user_id: teacherUser._id });
  return { sem, cse, room, sectionA, sectionB, teacher, cr, crB, admin, teacherUser };
}

const body = (w, over = {}) => ({
  room_id: String(w.room._id),
  date: WED,
  start: at(11, 35),
  end: at(12, 30),
  note: 'Lab class for group G1',
  target_section_id: String(w.sectionA._id),
  ...over,
});

const send = (agent, data) => agent.post('/api/room-requests').send(data);
const decide = (agent, id, data) => agent.post(`/api/room-requests/${id}/decision`).send(data);

// ── Who can send ──────────────────────────────────────────────────────────────

describe('room booking (spec 19)', () => {
  it('BKG-01 a plain student cannot send a request (403)', async () => {
    const w = await world();
    const student = await loginAs(await makeUser({ kind: 'student', state: 'active' }), app);
    const res = await send(student, body(w));
    expect(res.status).toBe(403);
    expect(await RoomRequest.countDocuments()).toBe(0);
  });

  it('BKG-01 a CR of another section is refused (403)', async () => {
    const w = await world();
    const otherCr = await loginAs(w.crB, app);
    const res = await send(otherCr, body(w, { target_section_id: String(w.sectionA._id) }));
    expect(res.status).toBe(403);
  });

  it('BKG-01 a CR of the section sends and the system records who sent it (BKG-03)', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const res = await send(cr, body(w));
    expect(res.status).toBe(201);
    const doc = await RoomRequest.findById(res.body.data.id).lean();
    expect(String(doc.sent_by_user_id)).toBe(String(w.cr._id));
    expect(String(doc.requester_section_id)).toBe(String(w.sectionA._id));
    expect(doc.status).toBe('pending');
  });

  it('BKG-01 a teacher who teaches the target section can send on their own behalf', async () => {
    const w = await world();
    await makeClass({
      semester: w.sem,
      dept: w.cse,
      room: await makeRoom(w.cse, '999'),
      section: w.sectionA,
      start: at(9),
      end: at(10),
      teacher: w.teacher,
    });
    const teacher = await loginAs(w.teacherUser, app);
    const res = await send(teacher, body(w));
    expect(res.status).toBe(201);
    const doc = await RoomRequest.findById(res.body.data.id).lean();
    expect(String(doc.requester_teacher_id)).toBe(String(w.teacher._id));
  });

  it('BKG-01 a teacher who does not teach the section is refused (403)', async () => {
    const w = await world();
    const teacher = await loginAs(w.teacherUser, app);
    const res = await send(teacher, body(w));
    expect(res.status).toBe(403);
  });
});

// ── Send checks ───────────────────────────────────────────────────────────────

describe('send checks (BKG-04 to BKG-10)', () => {
  it('BKG-04 a room with a published class in the range is refused: ROOM_NOT_FREE', async () => {
    const w = await world();
    const other = await makeSection(w.sem, w.cse, 'Z');
    await makeClass({
      semester: w.sem,
      dept: w.cse,
      room: w.room,
      section: other,
      start: at(11),
      end: at(12),
    });
    const res = await send(await loginAs(w.cr, app), body(w));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROOM_NOT_FREE');
  });

  it('BKG-05 a room shared with a department that has not published: AVAILABILITY_UNKNOWN', async () => {
    const w = await world();
    const eee = await createDepartment({ code: 'EEE' });
    await RoomShare.create({ room_id: w.room._id, department_id: eee._id });
    const res = await send(await loginAs(w.cr, app), body(w));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AVAILABILITY_UNKNOWN');
  });

  it('BKG-06 a whole-section class of the target section blocks the request: TARGET_BUSY', async () => {
    const w = await world();
    const elsewhere = await makeRoom(w.cse, '400');
    await makeClass({
      semester: w.sem,
      dept: w.cse,
      room: elsewhere,
      section: w.sectionA,
      start: at(11),
      end: at(12),
    });
    const res = await send(await loginAs(w.cr, app), body(w));
    expect(res.body.error.code).toBe('TARGET_BUSY');
  });

  it('BKG-06 a lab of one group blocks a whole-section request for the same time', async () => {
    const w = await world();
    const elsewhere = await makeRoom(w.cse, '401');
    const group = await SectionGroup.create({
      section_id: w.sectionA._id,
      label: 'G1',
    });
    await RoutineSlot.create({
      semester_id: w.sem._id,
      owner_department_id: w.cse._id,
      section_id: w.sectionA._id,
      group_id: group._id,
      day_of_week: 3,
      start_min: at(11),
      end_min: at(12),
      course_code: 'LAB',
      room_id: elsewhere._id,
      source: 'import',
      published: true,
    });
    const res = await send(await loginAs(w.cr, app), body(w));
    expect(res.body.error.code).toBe('TARGET_BUSY');
  });

  it('BKG-07 the requesting teacher with a class at that time: TEACHER_BUSY', async () => {
    const w = await world();
    const elsewhere = await makeRoom(w.cse, '402');
    const other = await makeSection(w.sem, w.cse, 'Q');
    await makeClass({
      semester: w.sem,
      dept: w.cse,
      room: elsewhere,
      section: other,
      start: at(11),
      end: at(12),
      teacher: w.teacher,
    });
    await makeClass({
      semester: w.sem,
      dept: w.cse,
      room: await makeRoom(w.cse, '403'),
      section: w.sectionA,
      start: at(8),
      end: at(9),
      teacher: w.teacher,
    });
    const res = await send(await loginAs(w.teacherUser, app), body(w));
    expect(res.body.error.code).toBe('TEACHER_BUSY');
  });

  it('BKG-08 a Friday is not a teaching day: NOT_TEACHING_DAY', async () => {
    const w = await world();
    const res = await send(await loginAs(w.cr, app), body(w, { date: '2027-04-09' }));
    expect(res.body.error.code).toBe('NOT_TEACHING_DAY');
  });

  it('BKG-09 sent less than 12 hours before the start: TOO_LATE', async () => {
    const w = await world();
    const res = await send(
      await loginAs(w.cr, app),
      body(w, { date: '2027-04-04', start: at(11, 35), end: at(12, 30) }),
    );
    expect(res.body.error.code).toBe('TOO_LATE');
  });

  it('BKG-08 a university exam day: no room can be requested that day (PRD acceptance)', async () => {
    const w = await world();
    // Tuesday 1 June, 11:00 Dhaka: the window is 30 May to 12 June
    fixClock('2027-06-01T05:00:00Z');
    // A university-wide event is a super admin's to create
    const superAdmin = await loginAs(
      await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] }),
      app,
    );
    const event = await superAdmin.post('/api/calendar-events').send({
      scope: 'university',
      from_date: '2027-06-07', // Monday
      to_date: '2027-06-07',
      kind: 'exam',
      label: 'Final exam',
      confirm: true,
    });
    expect(event.status).toBe(201);
    const res = await send(await loginAs(w.cr, app), body(w, { date: '2027-06-07' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_TEACHING_DAY');
  });

  it('BKG-10 a date beyond next week: OUTSIDE_WINDOW', async () => {
    const w = await world();
    const res = await send(await loginAs(w.cr, app), body(w, { date: '2027-04-21' }));
    expect(res.body.error.code).toBe('OUTSIDE_WINDOW');
  });

  it('BKG-11 a fourth overlapping request from one section is refused: REQUEST_LIMIT', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const rooms = [];
    for (let i = 0; i < 4; i += 1) rooms.push(await makeRoom(w.cse, `50${i}`));
    const statuses = [];
    for (const room of rooms) {
      const res = await send(cr, body(w, { room_id: String(room._id) }));
      statuses.push(res.status);
    }
    expect(statuses).toEqual([201, 201, 201, 409]);
    expect(await RoomRequest.countDocuments({ status: 'pending' })).toBe(3);
  });

  it('BKG-11 four requests sent at the same moment give exactly 3 pending', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const rooms = [];
    for (let i = 0; i < 4; i += 1) rooms.push(await makeRoom(w.cse, `60${i}`));
    const results = await Promise.all(
      rooms.map((room) => send(cr, body(w, { room_id: String(room._id) }))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 409]);
    expect(await RoomRequest.countDocuments({ status: 'pending' })).toBe(3);
  });

  it('BKG-11 a request for a non-overlapping time is accepted', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    for (let i = 0; i < 3; i += 1) {
      await send(cr, body(w, { room_id: String((await makeRoom(w.cse, `70${i}`))._id) }));
    }
    const res = await send(cr, body(w, { start: at(14), end: at(15) }));
    expect(res.status).toBe(201);
  });
});

// ── The PRD example for the 12-hour rule ─────────────────────────────────────

describe('12-hour rule (PRD acceptance)', () => {
  it('BKG-09 accepted at 23:34 the evening before, blocked at 23:36', async () => {
    const sem = await makeSemester({ start: '2026-11-01', end: '2027-02-28' });
    const w = await world({ semester: sem });
    const cr = await loginAs(w.cr, app);
    fixClock('2026-11-10T17:34:00Z'); // 23:34 Tuesday 10 Nov, Dhaka
    const ok = await send(cr, body(w, { date: '2026-11-11' }));
    expect(ok.status).toBe(201);
    fixClock('2026-11-10T17:36:00Z'); // 23:36
    const blocked = await send(cr, body(w, { date: '2026-11-11' }));
    expect(blocked.body.error.code).toBe('TOO_LATE');
  });
});

// ── Deciding ──────────────────────────────────────────────────────────────────

describe('deciding (BKG-12 to BKG-16)', () => {
  it('BKG-12 a student cannot see or decide the queue (403)', async () => {
    const student = await loginAs(await makeUser({ kind: 'student', state: 'active' }), app);
    const res = await student.get('/api/admin/room-requests');
    expect(res.status).toBe(403);
  });

  it('BKG-13 approval inserts 5-minute locks, cancels the requester other overlapping requests and rejects other requesters for the room', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const admin = await loginAs(w.admin, app);
    const mine = await send(cr, body(w));
    const sameTime = await send(
      cr,
      body(w, { room_id: String((await makeRoom(w.cse, '800'))._id) }),
    );
    const theirs = await send(
      await loginAs(w.crB, app),
      body(w, { target_section_id: String(w.sectionB._id), start: at(11), end: at(12) }),
    );
    expect(theirs.status).toBe(201);

    const res = await decide(admin, mine.body.data.id, { decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');

    expect(await RoomSlotLock.countDocuments({ room_id: w.room._id, date: WED })).toBe(11);
    const cancelled = await RoomRequest.findById(sameTime.body.data.id).lean();
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.reason).toBe('another_request_approved');
    const rejected = await RoomRequest.findById(theirs.body.data.id).lean();
    expect(rejected.status).toBe('rejected');
    expect(rejected.reason).toBe('room_given_to_another');
  });

  it('BKG-13 two admins approving at the same moment: exactly one approved, the other ALREADY_DECIDED', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const crB = await loginAs(w.crB, app);
    const first = await send(cr, body(w));
    const second = await send(crB, body(w, { target_section_id: String(w.sectionB._id) }));
    const admin = await loginAs(w.admin, app);
    const results = await Promise.all([
      decide(admin, first.body.data.id, { decision: 'approve' }),
      decide(admin, second.body.data.id, { decision: 'approve' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser.body.error.code).toBe('ALREADY_DECIDED');
    expect(await RoomRequest.countDocuments({ status: 'approved' })).toBe(1);
  });

  it('BKG-13 touching ranges 10:00-11:00 and 11:00-12:00 are both approved', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const admin = await loginAs(w.admin, app);
    const first = await send(cr, body(w, { start: at(10), end: at(11) }));
    const second = await send(
      await loginAs(w.crB, app),
      body(w, { start: at(11), end: at(12), target_section_id: String(w.sectionB._id) }),
    );
    expect((await decide(admin, first.body.data.id, { decision: 'approve' })).status).toBe(200);
    expect((await decide(admin, second.body.data.id, { decision: 'approve' })).status).toBe(200);
  });

  it('BKG-14 reject needs no reason and is final', async () => {
    const w = await world();
    const admin = await loginAs(w.admin, app);
    const sent = await send(await loginAs(w.cr, app), body(w));
    expect((await decide(admin, sent.body.data.id, { decision: 'reject' })).status).toBe(200);
    const again = await decide(admin, sent.body.data.id, { decision: 'approve' });
    expect(again.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('BKG-15 a decision after the 2-hour cutoff is refused: DECISION_CUTOFF_PASSED', async () => {
    const w = await world();
    const sent = await send(await loginAs(w.cr, app), body(w));
    fixClock('2027-04-07T03:45:00Z'); // 09:45 Dhaka: 1h50m before 11:35
    const res = await decide(await loginAs(w.admin, app), sent.body.data.id, {
      decision: 'approve',
    });
    expect(res.body.error.code).toBe('DECISION_CUTOFF_PASSED');
  });

  it('BKG-12 an admin of an unrelated department cannot decide (403)', async () => {
    const w = await world();
    const sent = await send(await loginAs(w.cr, app), body(w));
    const other = await createDepartment({ code: 'EEE' });
    const outsider = await loginAs(
      await makeUser({ kind: 'staff', roles: [{ role: 'dept_admin', department_id: other._id }] }),
      app,
    );
    const res = await decide(outsider, sent.body.data.id, { decision: 'approve' });
    expect(res.status).toBe(403);
  });
});

// ── Effects, expiry and cancelling ───────────────────────────────────────────

describe('effects, expiry and cancelling (BKG-17, BKG-19, BKG-21)', () => {
  it('BKG-19 an approved booking makes the room booked in the free-room view, and a new request for it is refused', async () => {
    const w = await world();
    const sent = await send(await loginAs(w.cr, app), body(w));
    await decide(await loginAs(w.admin, app), sent.body.data.id, { decision: 'approve' });
    const view = await (
      await loginAs(w.cr, app)
    )
      .get('/api/rooms/availability')
      .query({ date: WED, from: String(at(11, 35)), to: String(at(12, 30)) });
    expect(view.body.data.rooms.find((r) => r.code === '311').status).toBe('booked');
    const again = await send(
      await loginAs(w.crB, app),
      body(w, { target_section_id: String(w.sectionB._id) }),
    );
    expect(again.body.error.code).toBe('ROOM_NOT_FREE');
  });

  it('BKG-17 a pending request with no decision by 2 hours before its start expires and the requester is emailed', async () => {
    const w = await world();
    const sent = await send(await loginAs(w.cr, app), body(w));
    fixClock('2027-04-07T03:45:00Z');
    expect(await expireDueRequests()).toBe(1);
    expect((await RoomRequest.findById(sent.body.data.id).lean()).status).toBe('expired');
    expect(await expireDueRequests()).toBe(0);
  });

  it('BKG-21 cancelling an approved booking deletes its locks, so the room is free at once', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const sent = await send(cr, body(w));
    await decide(await loginAs(w.admin, app), sent.body.data.id, { decision: 'approve' });
    expect(await RoomSlotLock.countDocuments({ room_id: w.room._id })).toBeGreaterThan(0);
    const res = await cr.post(`/api/room-requests/${sent.body.data.id}/cancel`).send({});
    expect(res.status).toBe(200);
    expect(await RoomSlotLock.countDocuments({ room_id: w.room._id })).toBe(0);
  });

  it('BKG-21 cancelling less than 6 hours before the start flags late_cancel', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const sent = await send(cr, body(w));
    await decide(await loginAs(w.admin, app), sent.body.data.id, { decision: 'approve' });
    fixClock('2027-04-07T04:00:00Z'); // 10:00 Dhaka, 1h35m before the start
    await cr.post(`/api/room-requests/${sent.body.data.id}/cancel`).send({});
    expect((await RoomRequest.findById(sent.body.data.id).lean()).late_cancel).toBe(true);
  });

  it('BKG-22 a decider cancelling an approved booking must give a reason', async () => {
    const w = await world();
    const sent = await send(await loginAs(w.cr, app), body(w));
    await decide(await loginAs(w.admin, app), sent.body.data.id, { decision: 'approve' });
    const admin = await loginAs(w.admin, app);
    const noReason = await admin.post(`/api/room-requests/${sent.body.data.id}/cancel`).send({});
    expect(noReason.status).toBe(400);
    const withReason = await admin
      .post(`/api/room-requests/${sent.body.data.id}/cancel`)
      .send({ reason: 'Room needed for an exam' });
    expect(withReason.status).toBe(200);
  });

  it('BKG-23 a no-show note is refused before the slot ends: TOO_EARLY', async () => {
    const w = await world();
    const sent = await send(await loginAs(w.cr, app), body(w));
    await decide(await loginAs(w.admin, app), sent.body.data.id, { decision: 'approve' });
    const res = await (
      await loginAs(w.admin, app)
    )
      .post(`/api/room-requests/${sent.body.data.id}/no-show`)
      .send({ note: 'Nobody came in.' });
    expect(res.body.error.code).toBe('TOO_EARLY');
  });
});

describe('approved bookings in the routine (BKG-18)', () => {
  it('BKG-18 an approved booking shows in the target section routine and the requesting teacher routine, not in another section', async () => {
    const w = await world();
    const sent = await send(await loginAs(w.cr, app), body(w));
    await decide(await loginAs(w.admin, app), sent.body.data.id, { decision: 'approve' });
    const base = { semesterId: w.sem._id, fromDate: WED, toDate: WED };

    const forSection = await bookingsForRoutine({
      ...base,
      sectionId: w.sectionA._id,
      groupId: null,
    });
    expect(forSection.map((b) => b.id)).toEqual([sent.body.data.id]);
    expect(forSection[0]).toMatchObject({
      date: WED,
      start_min: at(11, 35),
      end_min: at(12, 30),
      room_code: '311',
    });

    const otherSection = await bookingsForRoutine({
      ...base,
      sectionId: w.sectionB._id,
      groupId: null,
    });
    expect(otherSection).toEqual([]);

    // The booking was sent by the CR on behalf of the section, so no teacher record shows it here
    const teacherView = await bookingsForRoutine({
      ...base,
      userId: w.teacherUser._id,
      isTeacher: true,
    });
    expect(teacherView).toEqual([]);
  });

  it('BKG-18 a teacher who sent the request sees it in their own routine', async () => {
    const w = await world();
    const teacher = await loginAs(w.teacherUser, app);
    await makeClass({
      semester: w.sem,
      dept: w.cse,
      room: await makeRoom(w.cse, '999'),
      section: w.sectionA,
      start: at(9),
      end: at(10),
      teacher: w.teacher,
    });
    const sent = await send(teacher, body(w));
    await decide(await loginAs(w.admin, app), sent.body.data.id, { decision: 'approve' });
    const teacherView = await bookingsForRoutine({
      semesterId: w.sem._id,
      fromDate: WED,
      toDate: WED,
      userId: w.teacherUser._id,
      isTeacher: true,
    });
    expect(teacherView.map((b) => b.id)).toEqual([sent.body.data.id]);
  });
});

describe('routine and calendar hooks (BKG-24, CAL-13)', () => {
  it('BKG-24 a routine change that clashes with an approved booking is reported; cancel_booking cancels it', async () => {
    const w = await world();
    const sent = await send(await loginAs(w.cr, app), body(w));
    await decide(await loginAs(w.admin, app), sent.body.data.id, { decision: 'approve' });
    const place = {
      semester_id: w.sem._id,
      room_id: w.room._id,
      start_min: at(11),
      end_min: at(12),
    };
    const wed = await findBookingClashes([{ ...place, day_of_week: 3 }]);
    expect(wed.map((b) => b.id)).toEqual([sent.body.data.id]);
    expect(await findBookingClashes([{ ...place, day_of_week: 4 }])).toEqual([]); // Thursday: no clash

    await applyBookingAction({ action: 'keep_booking', bookings: wed, actor: w.admin });
    expect((await RoomRequest.findById(sent.body.data.id).lean()).status).toBe('approved');

    await applyBookingAction({ action: 'cancel_booking', bookings: wed, actor: w.admin });
    expect((await RoomRequest.findById(sent.body.data.id).lean()).status).toBe('cancelled');
    expect(await RoomSlotLock.countDocuments({ room_id: w.room._id })).toBe(0);
  });

  it('CAL-13 a holiday on the booked day cancels the approved booking and expires pending requests on it', async () => {
    const w = await world();
    const approved = await send(await loginAs(w.cr, app), body(w));
    await decide(await loginAs(w.admin, app), approved.body.data.id, { decision: 'approve' });
    const pending = await send(
      await loginAs(w.crB, app),
      body(w, { target_section_id: String(w.sectionB._id), start: at(9), end: at(10) }),
    );
    expect(pending.status).toBe(201);

    const admin = await loginAs(w.admin, app);
    const res = await admin.post('/api/calendar-events').send({
      scope: String(w.cse._id),
      from_date: WED,
      to_date: WED,
      kind: 'holiday',
      label: 'Holiday',
      confirm: true,
    });
    expect(res.status).toBe(201);

    expect((await RoomRequest.findById(approved.body.data.id).lean()).status).toBe('cancelled');
    expect((await RoomRequest.findById(pending.body.data.id).lean()).status).toBe('expired');
  });

  it('CAL-13 without confirmation the calendar previews the affected bookings and saves nothing', async () => {
    const w = await world();
    const approved = await send(await loginAs(w.cr, app), body(w));
    await decide(await loginAs(w.admin, app), approved.body.data.id, { decision: 'approve' });
    const admin = await loginAs(w.admin, app);
    const res = await admin.post('/api/calendar-events').send({
      scope: String(w.cse._id),
      from_date: WED,
      to_date: WED,
      kind: 'holiday',
      label: 'Holiday',
    });
    expect(res.body.saved).toBe(false);
    expect(res.body.affected_bookings).toHaveLength(1);
    expect((await RoomRequest.findById(approved.body.data.id).lean()).status).toBe('approved');
  });
});

describe('admin summary and digest (ADM-06, EML-08)', () => {
  it('ADM-06 the pending requests for the departments, earliest decision cutoff first, with a count', async () => {
    const w = await world();
    const first = await send(await loginAs(w.cr, app), body(w));
    const second = await send(
      await loginAs(w.crB, app),
      body(w, { target_section_id: String(w.sectionB._id), start: at(14), end: at(15) }),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const summary = await pendingRequestsSummary([String(w.cse._id)]);
    expect(summary.count).toBe(2);
    expect(summary.items.map((i) => i.id)).toEqual([first.body.data.id, second.body.data.id]);
    expect(summary.items[0].requester_label).toContain('3-II-A');
    expect(await pendingRequestsSummary([String(w.sem._id)])).toMatchObject({ count: 0 });
  });

  it('EML-08 the digest counts pending requests for the admin departments', async () => {
    const w = await world();
    await send(await loginAs(w.cr, app), body(w));
    const { buildDigest } = await import('../../notifications/index.js');
    const digest = await buildDigest({ departmentIds: [String(w.cse._id)] });
    expect(JSON.stringify(digest)).toContain('room_requests');
  });
});

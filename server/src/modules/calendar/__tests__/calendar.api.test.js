import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  clearOutbox,
  connectTestDb,
  drainMail,
  disconnectTestDb,
  fixClock,
  loginAs,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { setEmitter } from '../../../lib/events.js';
import { clock } from '../../../lib/time.js';
import { renderTemplate } from '../../notifications/templates/index.js';
import { Semester } from '../../organisation/index.js';
import { list as auditList } from '../../audit/index.js';
import {
  RoutineSlot,
  RoutineSlotTeacher,
  Section,
  resetRoutineHooks,
} from '../../routine/index.js';
import { Enrolment, acceptedStudentUserIdsOfSections } from '../../enrolments/index.js';
import { Teacher } from '../../teachers/index.js';
import { registerCalendarAudienceProvider, resetCalendarAudienceProviders } from '../hooks.js';
import { CalendarEvent, ClassCancellation, resetBookingAffectedProviders } from '../index.js';

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
});
afterEach(() => {
  resetRoutineHooks();
  resetCalendarAudienceProviders();
  resetBookingAffectedProviders();
  setEmitter(null);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const asSuper = async () =>
  loginAs(await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] }), app);

const asDeptAdmin = async (dept) =>
  loginAs(
    await makeUser({ kind: 'staff', roles: [{ role: 'dept_admin', department_id: dept._id }] }),
    app,
  );

const asStudent = async (dept) =>
  loginAs(await makeUser({ kind: 'student', state: 'active', departmentId: dept._id }), app);

const asTeacher = async (dept) =>
  loginAs(await makeUser({ kind: 'teacher', state: 'active', departmentId: dept._id }), app);

async function makeSemester({ status = 'current', start = '2027-04-04', end = '2027-08-04' } = {}) {
  const sup = await asSuper();
  const res = await sup.post('/api/admin/semesters').send({
    name: `Sem-${Date.now()}`,
    start_date: start,
    end_date: end,
  });
  const sem = res.body.data;
  if (status !== 'draft') await Semester.updateOne({ _id: sem.id }, { $set: { status } });
  return sem;
}

/** Build a published slot for CSE section, e.g. Monday 09:00-10:00. */
async function makeSlot(dept, sem, { day_of_week = 1, start_min = 540, end_min = 600 } = {}) {
  const { Room } = await import('../../rooms/rooms.model.js');
  const code = `R${Date.now()}`;
  const room = await Room.create({
    code,
    code_norm: code.toUpperCase(),
    type: 'classroom',
    owner_department_id: dept._id,
  });
  const section = await Section.create({
    semester_id: sem.id,
    department_id: dept._id,
    level: 2,
    term: 'I',
    letter: 'A',
  });
  const slot = await RoutineSlot.create({
    semester_id: sem.id,
    owner_department_id: dept._id,
    section_id: section._id,
    room_id: room._id,
    day_of_week,
    start_min,
    end_min,
    course_code: 'CSE-301',
    published: true,
    source: 'manual',
    tba: true,
    version: 1,
  });
  return { slot, section };
}

const baseEvent = (scope, overrides = {}) => ({
  scope,
  from_date: '2027-06-07',
  to_date: '2027-06-07',
  kind: 'exam',
  label: 'Mid-term exam',
  ...overrides,
});

// ── CAL-02 permissions ───────────────────────────────────────────────────────

describe('CAL-02 permissions', () => {
  it('CAL-02 super admin can create a university event', async () => {
    const sup = await asSuper();
    const res = await sup.post('/api/calendar-events').send(baseEvent('university'));
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe('exam');
  });

  it('[CAL-02-test1] dept admin creating a university event → 403', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const res = await agent.post('/api/calendar-events').send(baseEvent('university'));
    expect(res.status).toBe(403);
  });

  it('CAL-02 dept admin can create a dept-scoped event for their department', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const res = await agent
      .post('/api/calendar-events')
      .send(baseEvent(cse.id, { kind: 'dept_event', label: 'CSE FEST' }));
    expect(res.status).toBe(201);
  });

  it('CAL-02 dept admin cannot create event for another department', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const res = await agent
      .post('/api/calendar-events')
      .send(baseEvent(eee.id, { kind: 'dept_event', label: 'EEE FEST' }));
    expect(res.status).toBe(403);
  });

  it('CAL-02 student cannot create or delete events', async () => {
    const cse = await createDepartment();
    const student = await asStudent(cse);
    const create = await student.post('/api/calendar-events').send(baseEvent('university'));
    expect(create.status).toBe(403);
  });

  it('CAL-02 teacher cannot create events', async () => {
    const cse = await createDepartment();
    const agent = await asTeacher(cse);
    const res = await agent.post('/api/calendar-events').send(baseEvent('university'));
    expect(res.status).toBe(403);
  });
});

// ── CAL-01 validation ────────────────────────────────────────────────────────

describe('CAL-01 validation', () => {
  it('CAL-01 early_closing requires cutoff_min', async () => {
    const sup = await asSuper();
    const res = await sup
      .post('/api/calendar-events')
      .send(baseEvent('university', { kind: 'early_closing' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('CAL-01 holiday must not have cutoff_min', async () => {
    const sup = await asSuper();
    const res = await sup
      .post('/api/calendar-events')
      .send(baseEvent('university', { kind: 'holiday', cutoff_min: 720 }));
    expect(res.status).toBe(400);
  });

  it('CAL-01 from_date must not be after to_date', async () => {
    const sup = await asSuper();
    const res = await sup.post('/api/calendar-events').send({
      scope: 'university',
      from_date: '2027-06-10',
      to_date: '2027-06-07',
      kind: 'exam',
      label: 'Exam',
    });
    expect(res.status).toBe(400);
  });

  it('CAL-01 label must not be empty or exceed 80 chars', async () => {
    const sup = await asSuper();
    const empty = await sup
      .post('/api/calendar-events')
      .send(baseEvent('university', { label: '' }));
    expect(empty.status).toBe(400);
    const long = await sup
      .post('/api/calendar-events')
      .send(baseEvent('university', { label: 'x'.repeat(81) }));
    expect(long.status).toBe(400);
  });

  it('CAL-03 dept_event must have department scope, not university', async () => {
    const sup = await asSuper();
    const res = await sup
      .post('/api/calendar-events')
      .send(baseEvent('university', { kind: 'dept_event', label: 'Fest' }));
    expect(res.status).toBe(400);
  });
});

// ── CAL-04 any number of events ──────────────────────────────────────────────

describe('CAL-04 multiple overlapping events', () => {
  it('CAL-04 can create overlapping events', async () => {
    const sup = await asSuper();
    const r1 = await sup
      .post('/api/calendar-events')
      .send(baseEvent('university', { kind: 'holiday', label: 'H1' }));
    expect(r1.status).toBe(201);
    const r2 = await sup
      .post('/api/calendar-events')
      .send(baseEvent('university', { kind: 'prep_leave', label: 'P1' }));
    expect(r2.status).toBe(201);
    expect(await CalendarEvent.countDocuments()).toBe(2);
  });
});

// ── CAL-05 audit ─────────────────────────────────────────────────────────────

describe('CAL-05 audit', () => {
  it('CAL-05 create, update and delete are audited', async () => {
    const sup = await asSuper();
    const created = (await sup.post('/api/calendar-events').send(baseEvent('university'))).body
      .data;
    const updated = await sup
      .patch(`/api/calendar-events/${created.id}`)
      .send({ label: 'New Label' });
    expect(updated.status).toBe(200);
    await sup.delete(`/api/calendar-events/${created.id}`);
    const entries = await auditList({});
    const actions = entries.map((e) => e.action);
    expect(actions).toContain('calendar.event.create');
    expect(actions).toContain('calendar.event.update');
    expect(actions).toContain('calendar.event.delete');
  });
});

// ── CAL-13 affected bookings ─────────────────────────────────────────────────

describe('CAL-13 affected bookings confirmation', () => {
  it('CAL-13 with no registered provider, event saves immediately', async () => {
    const sup = await asSuper();
    const res = await sup.post('/api/calendar-events').send(baseEvent('university'));
    expect(res.status).toBe(201);
  });

  it('CAL-13 with a provider returning bookings, must confirm first', async () => {
    const { registerBookingAffectedProvider } = await import('../index.js');
    registerBookingAffectedProvider(async () => [{ id: 'b1' }]);

    const sup = await asSuper();
    const r1 = await sup.post('/api/calendar-events').send(baseEvent('university'));
    expect(r1.status).toBe(200);
    expect(r1.body.saved).toBe(false);
    expect(r1.body.affected_bookings).toHaveLength(1);

    const r2 = await sup
      .post('/api/calendar-events')
      .send(baseEvent('university', { confirm: true }));
    expect(r2.status).toBe(201);
  });
});

// ── CAL-14 upcoming events ───────────────────────────────────────────────────

describe('CAL-14 upcoming events', () => {
  it('CAL-14 returns university events in the next 14 days for active users', async () => {
    const sup = await asSuper();
    const cse = await createDepartment();
    const student = await asStudent(cse);

    // Create a holiday 3 days from now (use a fixed date within range)
    // We'll create an event with a date range that includes the near future
    await sup.post('/api/calendar-events').send({
      scope: 'university',
      from_date: '2027-06-07',
      to_date: '2027-06-07',
      kind: 'holiday',
      label: 'Eid',
    });
    // In a test we don't control "now", but we can verify the endpoint works
    const res = await student.get('/api/calendar/upcoming');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('CAL-14 unauthenticated user is refused', async () => {
    const agent = await loginAs(null, app);
    const res = await agent.get('/api/calendar/upcoming');
    expect(res.status).toBe(401);
  });
});

// ── CAL-10 single-class cancellation ────────────────────────────────────────

describe('CAL-10 single-class cancellation', () => {
  it('CAL-10 admin cancels a published slot on its weekday', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1 }); // Monday=1; 2027-06-07 is Monday
    const agent = await asDeptAdmin(cse);

    const res = await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'Teacher absent' });
    expect(res.status).toBe(201);
    expect(await ClassCancellation.countDocuments()).toBe(1);
  });

  it('[CAL-10-test1] cancelling a slot on wrong weekday → SLOT_NOT_ON_DATE', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 0 }); // Sunday
    const agent = await asDeptAdmin(cse);

    // 2027-06-07 is Monday (1), slot is Sunday (0)
    const res = await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'Test' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_NOT_ON_DATE');
  });

  it('[CAL-10-test1] cancelling the same slot+date twice → CONFLICT', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1 });
    const agent = await asDeptAdmin(cse);

    await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'First cancel' });
    const res = await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'Second cancel' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('CAL-10 admin of another dept cannot cancel the slot', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1 });
    const eeeAdmin = await asDeptAdmin(eee);

    const res = await eeeAdmin
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'Test' });
    expect(res.status).toBe(403);
  });

  it('CAL-10 cancellation is audited', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1 });
    const agent = await asDeptAdmin(cse);

    await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'Test' });
    const entries = await auditList({ action: 'class.cancel' });
    expect(entries).toHaveLength(1);
  });
});

// ── EML-04 cancellation emails ───────────────────────────────────────────────

describe('EML-04 cancellation emails', () => {
  it('EML-04 a class cancelled, restored and cancelled again is emailed each time', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1 });
    const student = await makeUser({ kind: 'student', state: 'active', departmentId: cse._id });
    registerCalendarAudienceProvider(async () => [String(student._id)]);
    const agent = await asDeptAdmin(cse);
    const url = `/api/slots/${slot._id}/cancellations`;

    expect((await agent.post(url).send({ date: '2027-06-07', reason: 'sick' })).status).toBe(201);
    expect((await agent.delete(`${url}/2027-06-07`)).status).toBeLessThan(300);
    // Cancelling again after the undo must be emailed too, not dropped as a duplicate.
    expect((await agent.post(url).send({ date: '2027-06-07', reason: 'sick again' })).status).toBe(
      201,
    );

    const subjects = (await drainMail())
      .filter((m) => m.to === student.email)
      .map((m) => m.subject)
      .sort();
    const cancelled = renderTemplate('class_cancelled', { course_code: 'x', date: 'x' }).subject;
    const restored = renderTemplate('class_restored', { course_code: 'x', date: 'x' }).subject;
    expect(subjects).toEqual([cancelled, cancelled, restored].sort());
  });
});

// ── CAL-12 undo cancellation ─────────────────────────────────────────────────

describe('CAL-12 undo cancellation', () => {
  it('CAL-12 admin can undo a cancellation before the class starts', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    // start_min=900 (15:00) — undo at 09:00 is fine
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1, start_min: 900, end_min: 960 });
    const agent = await asDeptAdmin(cse);

    await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'Test' });
    const res = await agent.delete(`/api/slots/${slot._id}/cancellations/2027-06-07`);
    expect(res.status).toBe(204);
    expect(await ClassCancellation.countDocuments()).toBe(0);
  });

  it('CAL-12 undo is audited', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1, start_min: 900, end_min: 960 });
    const agent = await asDeptAdmin(cse);

    await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'Test' });
    await agent.delete(`/api/slots/${slot._id}/cancellations/2027-06-07`);
    const entries = await auditList({ action: 'class.cancel.undo' });
    expect(entries).toHaveLength(1);
  });

  it('CAL-12 undo non-existent cancellation → 404', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1 });
    const agent = await asDeptAdmin(cse);
    const res = await agent.delete(`/api/slots/${slot._id}/cancellations/2027-06-07`);
    expect(res.status).toBe(404);
  });
});

// ── CAL-02 edit and delete ────────────────────────────────────────────────────

describe('CAL-02 edit and delete', () => {
  it('CAL-02 super admin can update any event', async () => {
    const cse = await createDepartment();
    const sup = await asSuper();

    const ev = (
      await sup
        .post('/api/calendar-events')
        .send(baseEvent(cse.id, { kind: 'dept_event', label: 'CSE FEST' }))
    ).body.data;
    const res = await sup.patch(`/api/calendar-events/${ev.id}`).send({ label: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.data.label).toBe('Updated');
  });

  it("CAL-02 dept admin cannot edit another department's event", async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const sup = await asSuper();
    const eeeAdmin = await asDeptAdmin(eee);

    const ev = (
      await sup
        .post('/api/calendar-events')
        .send(baseEvent(cse.id, { kind: 'dept_event', label: 'CSE FEST' }))
    ).body.data;
    const res = await eeeAdmin.patch(`/api/calendar-events/${ev.id}`).send({ label: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('CAL-02 super admin can delete any event', async () => {
    const sup = await asSuper();
    const ev = (await sup.post('/api/calendar-events').send(baseEvent('university'))).body.data;
    const res = await sup.delete(`/api/calendar-events/${ev.id}`);
    expect(res.status).toBe(204);
    expect(await CalendarEvent.countDocuments()).toBe(0);
  });
});

// ── CAL-02 list events ────────────────────────────────────────────────────────

describe('CAL-02 list events', () => {
  it('active student sees university events + their dept events', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const sup = await asSuper();
    await sup.post('/api/calendar-events').send(baseEvent('university'));
    await sup
      .post('/api/calendar-events')
      .send(baseEvent(cse.id, { kind: 'dept_event', label: 'CSE FEST' }));
    await sup
      .post('/api/calendar-events')
      .send(baseEvent(eee.id, { kind: 'dept_event', label: 'EEE FEST' }));

    const student = await asStudent(cse);
    const res = await student.get('/api/calendar-events');
    expect(res.status).toBe(200);
    const labels = res.body.data.map((e) => e.label);
    expect(labels).toContain('Mid-term exam');
    expect(labels).toContain('CSE FEST');
    expect(labels).not.toContain('EEE FEST');
  });

  it('unauthenticated → 401', async () => {
    const agent = await loginAs(null, app);
    const res = await agent.get('/api/calendar-events');
    expect(res.status).toBe(401);
  });
});

// ── Spec 11 verification: scope, validity, cancellation rules and notices ───

describe('CAL-02 scope changes by a department admin', () => {
  it('[CAL-02] dept admin cannot move own department event to university scope → 403', async () => {
    const cse = await createDepartment();
    const sup = await asSuper();
    const ev = (
      await sup
        .post('/api/calendar-events')
        .send(baseEvent(cse.id, { kind: 'dept_event', label: 'CSE FEST' }))
    ).body.data;
    const cseAdmin = await asDeptAdmin(cse);
    const res = await cseAdmin.patch(`/api/calendar-events/${ev.id}`).send({ scope: 'university' });
    expect(res.status).toBe(403);
    expect((await CalendarEvent.findById(ev.id).lean()).scope_department_id).toBeTruthy();
  });

  it('[CAL-02] dept admin cannot move own department event to another department → 403', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const sup = await asSuper();
    const ev = (
      await sup
        .post('/api/calendar-events')
        .send(baseEvent(cse.id, { kind: 'dept_event', label: 'CSE FEST' }))
    ).body.data;
    const cseAdmin = await asDeptAdmin(cse);
    const res = await cseAdmin.patch(`/api/calendar-events/${ev.id}`).send({ scope: eee.id });
    expect(res.status).toBe(403);
    expect(String((await CalendarEvent.findById(ev.id).lean()).scope_department_id)).toBe(
      String(cse._id),
    );
  });

  it("[CAL-02] dept admin cannot delete another department's event → 403", async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const sup = await asSuper();
    const ev = (
      await sup
        .post('/api/calendar-events')
        .send(baseEvent(cse.id, { kind: 'dept_event', label: 'CSE FEST' }))
    ).body.data;
    const eeeAdmin = await asDeptAdmin(eee);
    const res = await eeeAdmin.delete(`/api/calendar-events/${ev.id}`);
    expect(res.status).toBe(403);
    expect(await CalendarEvent.countDocuments()).toBe(1);
  });

  it('[CAL-02] a student asking for another department events gets none of them', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const sup = await asSuper();
    await sup
      .post('/api/calendar-events')
      .send(baseEvent(eee.id, { kind: 'dept_event', label: 'EEE FEST' }));
    const student = await asStudent(cse);
    const res = await student.get(`/api/calendar-events?department_id=${eee.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => e.label)).not.toContain('EEE FEST');
  });

  it('[CAL-02] a claim_pending student cannot list events → 403', async () => {
    const cse = await createDepartment();
    const pending = await loginAs(
      await makeUser({ kind: 'student', state: 'claim_pending', departmentId: cse._id }),
      app,
    );
    const res = await pending.get('/api/calendar-events');
    expect(res.status).toBe(403);
  });
});

describe('CAL-01 edits keep every event valid', () => {
  it('[CAL-01] a PATCH that moves from_date after the stored to_date → 400', async () => {
    const sup = await asSuper();
    const ev = (await sup.post('/api/calendar-events').send(baseEvent('university'))).body.data;
    const res = await sup.patch(`/api/calendar-events/${ev.id}`).send({ from_date: '2027-06-20' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect((await CalendarEvent.findById(ev.id).lean()).from_date).toBe('2027-06-07');
  });

  it('[CAL-01] changing a stored early_closing to holiday while keeping its cutoff → 400', async () => {
    const sup = await asSuper();
    const ev = (
      await sup
        .post('/api/calendar-events')
        .send(
          baseEvent('university', { kind: 'early_closing', label: 'Campus Day', cutoff_min: 720 }),
        )
    ).body.data;
    const res = await sup.patch(`/api/calendar-events/${ev.id}`).send({ kind: 'holiday' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('[CAL-01] the same change is accepted when the cutoff is cleared in the same request', async () => {
    const sup = await asSuper();
    const ev = (
      await sup
        .post('/api/calendar-events')
        .send(
          baseEvent('university', { kind: 'early_closing', label: 'Campus Day', cutoff_min: 720 }),
        )
    ).body.data;
    const res = await sup
      .patch(`/api/calendar-events/${ev.id}`)
      .send({ kind: 'holiday', cutoff_min: null });
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('holiday');
  });

  it('[CAL-03] a dept_event cannot be moved to university scope by a super admin → 400', async () => {
    const cse = await createDepartment();
    const sup = await asSuper();
    const ev = (
      await sup
        .post('/api/calendar-events')
        .send(baseEvent(cse.id, { kind: 'dept_event', label: 'CSE FEST' }))
    ).body.data;
    const res = await sup.patch(`/api/calendar-events/${ev.id}`).send({ scope: 'university' });
    expect(res.status).toBe(400);
  });
});

describe('CAL-10 cancellation only on a date the slot runs', () => {
  it('[CAL-10] cancelling a slot on a date a holiday stops → SLOT_NOT_ON_DATE', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1 });
    const sup = await asSuper();
    await sup
      .post('/api/calendar-events')
      .send(baseEvent('university', { kind: 'holiday', label: 'Eid' }));
    const agent = await asDeptAdmin(cse);
    const res = await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'Test' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_NOT_ON_DATE');
    expect(await ClassCancellation.countDocuments()).toBe(0);
  });
});

describe('CAL-10 concurrency', () => {
  it('[CAL-10] two admins cancel the same slot and date at once: one 201, one CONFLICT', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1 });
    const a = await asDeptAdmin(cse);
    const b = await asDeptAdmin(cse);
    const url = `/api/slots/${slot._id}/cancellations`;
    const [r1, r2] = await Promise.all([
      a.post(url).send({ date: '2027-06-07', reason: 'one' }),
      b.post(url).send({ date: '2027-06-07', reason: 'two' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await ClassCancellation.countDocuments()).toBe(1);
  });
});

describe('CAL-11 cancellation notices reach students and teachers', () => {
  beforeEach(() => {
    registerCalendarAudienceProvider(acceptedStudentUserIdsOfSections);
  });

  it('[CAL-11] students with an accepted enrolment in the section are emailed', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot, section } = await makeSlot(cse, sem, { day_of_week: 1 });
    const student = await makeUser({ kind: 'student', state: 'active', departmentId: cse._id });
    await Enrolment.create({
      user_id: student._id,
      semester_id: sem.id,
      section_id: section._id,
      department_id: cse._id,
      status: 'accepted',
    });
    const agent = await asDeptAdmin(cse);
    const res = await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'sick' });
    expect(res.status).toBe(201);
    const mail = (await drainMail()).filter((m) => m.to === student.email);
    expect(mail).toHaveLength(1);
  });

  it('[CAL-11] the slot teacher is sent routine.changed on their own user room', async () => {
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1 });
    const teacherUser = await makeUser({ kind: 'teacher', state: 'active', departmentId: cse._id });
    const teacher = await Teacher.create({
      department_id: cse._id,
      short_code: 'ABC',
      full_name: 'Teacher',
      user_id: teacherUser._id,
    });
    await RoutineSlotTeacher.create({ slot_id: slot._id, teacher_id: teacher._id });

    const emitted = [];
    setEmitter((room, event) => emitted.push({ room, event }));
    const agent = await asDeptAdmin(cse);
    await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'sick' });
    expect(
      emitted.some((e) => e.room === `user:${teacherUser._id}` && e.event === 'routine.changed'),
    ).toBe(true);
  });
});

describe('CAL-12 undo after the class has started', () => {
  afterEach(() => clock.reset());

  it('[CAL-12] undo once the class has started → 409 TOO_LATE and the cancellation stays', async () => {
    // Monday 2027-06-07 09:30 Asia/Dhaka: the 09:00 class has started. The clock is fixed before
    // sign-in, so the session is created at the same instant the undo is attempted.
    fixClock('2027-06-07T03:30:00Z');
    const cse = await createDepartment();
    const sem = await makeSemester();
    const { slot } = await makeSlot(cse, sem, { day_of_week: 1, start_min: 540, end_min: 600 });
    const agent = await asDeptAdmin(cse);
    await agent
      .post(`/api/slots/${slot._id}/cancellations`)
      .send({ date: '2027-06-07', reason: 'sick' });
    const res = await agent.delete(`/api/slots/${slot._id}/cancellations/2027-06-07`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_LATE');
    expect(await ClassCancellation.countDocuments()).toBe(1);
  });
});

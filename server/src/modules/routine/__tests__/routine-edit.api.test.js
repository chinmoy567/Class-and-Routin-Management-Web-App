import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  clearOutbox,
  connectTestDb,
  disconnectTestDb,
  drainMail,
  loginAs,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { setScanner } from '../../../lib/clamav.js';
import { setEmitter } from '../../../lib/events.js';
import { Semester } from '../../organisation/index.js';
import { Teacher } from '../../teachers/index.js';
import { list as auditList } from '../../audit/index.js';
import {
  RoutineSlot,
  RoutineSlotTeacher,
  Section,
  SectionGroup,
  registerAudienceProvider,
  registerBookingActionHandler,
  registerBookingClashProvider,
  registerGroupUsage,
  resetBookingHooks,
  resetGroupUsage,
  resetRoutineHooks,
} from '../index.js';
import { row, workbook } from './fixtures.js';

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
  setScanner(async () => ({ infected: false }));
});
afterEach(() => {
  resetRoutineHooks();
  resetBookingHooks();
  resetGroupUsage();
  setEmitter(null);
  setScanner();
});

const asAdmin = async (dept) =>
  loginAs(
    await makeUser({ kind: 'staff', roles: [{ role: 'dept_admin', department_id: dept._id }] }),
    app,
  );

const upload = (agent, w, dept, buffer) =>
  agent
    .post(`/api/semesters/${w.sem.id}/imports?department_id=${dept.id}`)
    .set('Content-Type', 'application/octet-stream')
    .send(buffer);

/**
 * CSE 4-I-A with slot S1 (Sunday 09:00-10:00, CSE-301, CSE:AB, room 311) and LAW 1-II-A with
 * slot L1 (Monday 09:00-10:00, LAW-101, LAW:XY, room 312), imported and published.
 */
async function world({ status = 'draft' } = {}) {
  const cse = await createDepartment({ code: 'CSE' });
  const law = await createDepartment({ code: 'LAW' });
  const eee = await createDepartment({ code: 'EEE' });
  const sup = await loginAs(
    await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] }),
    app,
  );
  const sem = (
    await sup.post('/api/admin/semesters').send({
      name: 'Spring 2027',
      start_date: '2027-04-04',
      end_date: '2027-08-04',
    })
  ).body.data;
  if (status !== 'draft') await Semester.updateOne({ _id: sem.id }, { $set: { status } });
  for (const code of ['311', '312', '313']) {
    await sup.post('/api/admin/rooms').send({ code, type: 'classroom', department_id: cse.id });
  }
  const cseAdmin = await asAdmin(cse);
  const lawAdmin = await asAdmin(law);
  const w = { cse, law, eee, sup, sem, cseAdmin, lawAdmin, eeeAdmin: await asAdmin(eee) };
  const publishFile = async (agent, dept, routine, teachers) => {
    const up = (await upload(agent, w, dept, await workbook({ routine, teachers }))).body.data;
    expect(up.counts.errors).toBe(0);
    const res = await agent.post(`/api/imports/${up.id}/publish`).send({ warnings_reviewed: true });
    expect(res.status).toBe(200);
  };
  await publishFile(cseAdmin, cse, [row('CSE')], [['CSE', 'AB', 'Ab Bar']]);
  await publishFile(
    lawAdmin,
    law,
    [
      row('LAW', {
        level: '1',
        term: 'II',
        code: 'LAW-101',
        teachers: 'LAW:XY',
        day: 'Monday',
        room: '312',
      }),
    ],
    [['LAW', 'XY', 'Xy Why']],
  );
  w.cseSection = await Section.findOne({ department_id: cse._id }).lean();
  w.lawSection = await Section.findOne({ department_id: law._id }).lean();
  w.s1 = await RoutineSlot.findOne({ owner_department_id: cse._id }).lean();
  w.l1 = await RoutineSlot.findOne({ owner_department_id: law._id }).lean();
  return w;
}

/** A valid new slot body for CSE 4-I-A: Monday 11:00-12:00, room 313. */
const body = (w, over = {}) => ({
  semester_id: w.sem.id,
  section_id: String(w.cseSection._id),
  day_of_week: 1,
  start: '11:00',
  end: '12:00',
  course_code: 'CSE-302',
  course_name: 'Databases',
  teachers: ['CSE:AB'],
  room: '313',
  ...over,
});
const add = (agent, b) => agent.post('/api/slots').send(b);
const count = () => RoutineSlot.countDocuments();

describe('grid (EDT-01)', () => {
  it('EDT-01 the grid lists other departments’ slots as read only with the owner code; any admin can view', async () => {
    const w = await world();
    await add(
      w.lawAdmin,
      body(w, { section_id: String(w.lawSection._id), day_of_week: 2, room: '313' }),
    );
    const mine = (await w.cseAdmin.get(`/api/admin/sections/${w.lawSection._id}/routine`)).body
      .data;
    expect(mine.slots).toHaveLength(2);
    expect(mine.slots.every((s) => s.editable === false && s.owner_department.code === 'LAW')).toBe(
      true,
    );
    expect(mine.slots[0]).toMatchObject({
      course_code: 'LAW-101',
      room: '312',
      teachers: ['Xy Why'],
      start: '09:00',
    });
    expect(JSON.stringify(mine)).not.toMatch(/@/); // no email
    const theirs = (await w.lawAdmin.get(`/api/admin/sections/${w.lawSection._id}/routine`)).body
      .data;
    expect(theirs.slots.every((s) => s.editable)).toBe(true);
    const other = await w.eeeAdmin.get(`/api/admin/sections/${w.lawSection._id}/routine`);
    expect(other.status).toBe(200);
    const list = await w.eeeAdmin.get(
      `/api/admin/semesters/${w.sem.id}/sections?department_id=${w.law.id}`,
    );
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ department_code: 'LAW', can_manage: false });
  });
});

describe('add (EDT-02, EDT-04, EDT-05)', () => {
  it('EDT-02 a CSE admin adds a slot to own and to LAW’s section; it is owned by CSE and published', async () => {
    const w = await world();
    const own = await add(w.cseAdmin, body(w));
    expect(own.status).toBe(201);
    expect(own.body.data.saved).toBe(true);
    const foreign = await add(
      w.cseAdmin,
      body(w, { section_id: String(w.lawSection._id), day_of_week: 3 }),
    );
    expect(foreign.status).toBe(201);
    const saved = await RoutineSlot.findById(foreign.body.data.slot.id).lean();
    expect(String(saved.owner_department_id)).toBe(w.cse.id);
    expect(saved).toMatchObject({
      published: true,
      source: 'manual',
      edited_by_hand: true,
      version: 1,
    });
    expect(await RoutineSlotTeacher.countDocuments({ slot_id: saved._id })).toBe(1);
  });

  it('EDT-04 errors return SLOT_INVALID with the list and change nothing', async () => {
    const w = await world();
    await Section.create({
      semester_id: w.sem.id,
      department_id: w.cse._id,
      level: 4,
      term: 'I',
      letter: 'Z',
    });
    const cases = [
      [{ room: '999' }, 'UNKNOWN_ROOM'],
      [{ course_code: '' }, 'MISSING_FIELD'],
      [{ start: undefined }, 'MISSING_FIELD'],
      [{ day_of_week: 5 }, 'INVALID_DAY'],
      [{ day_of_week: 9 }, 'INVALID_DAY'],
      [{ start: '25:00' }, 'INVALID_TIME'],
      [{ start: '12:00', end: '11:00' }, 'INVALID_TIME'],
      [{ end: '11:00' }, 'INVALID_TIME'],
      [{ teachers: ['CSE:ZZ'] }, 'UNKNOWN_TEACHER'],
      [{ group: 'G9' }, 'UNKNOWN_GROUP'],
    ];
    const before = await count();
    for (const [over, code] of cases) {
      const res = await add(w.cseAdmin, body(w, over));
      expect(res.status, code).toBe(400);
      expect(res.body.error.code).toBe('SLOT_INVALID');
      expect(res.body.error.issues.map((i) => i.code)).toContain(code);
    }
    expect(await count()).toBe(before);
  });

  it('EDT-04 warnings return saved:false and save only with confirm_warnings', async () => {
    const w = await world();
    const warn = async (over, code, extra = {}) => {
      const res = await add(w.cseAdmin, body(w, over));
      expect(res.status, code).toBe(200);
      expect(res.body.data.saved).toBe(false);
      expect(res.body.data.warnings.map((x) => x.code)).toContain(code);
      const before = await count();
      const ok = await add(w.cseAdmin, body(w, { ...over, confirm_warnings: true, ...extra }));
      expect(ok.status, code).toBe(201);
      expect(await count()).toBe(before + 1);
      await RoutineSlot.deleteOne({ _id: ok.body.data.slot.id });
    };
    // S1 is Sunday 09:00-10:00, 311, CSE:AB, in CSE 4-I-A.
    await warn(
      { day_of_week: 0, start: '09:30', end: '10:30', room: '313', course_code: 'X-1' },
      'TEACHER_OVERLAP',
    );
    await warn(
      {
        day_of_week: 0,
        start: '09:30',
        end: '10:30',
        room: '311',
        teachers: 'TBA',
        course_code: 'X-1',
      },
      'ROOM_OVERLAP',
    );
    await warn(
      {
        day_of_week: 0,
        start: '09:30',
        end: '10:30',
        room: '313',
        teachers: 'TBA',
        course_code: 'X-1',
      },
      'SECTION_OVERLAP',
    );
    await warn({ teachers: 'TBA' }, 'TEACHER_TBA');
    await warn({ start: '07:00', end: '08:00' }, 'OUTSIDE_HOURS');
    await warn(
      { day_of_week: 0, start: '14:00', end: '15:00', course_code: 'CSE-301' },
      'DUPLICATE_COURSE_DAY',
    );
    // LAW-101 is in LAW 1-II-A on Monday 09:00-10:00; CSE adds the same course at the same time.
    await warn(
      {
        section_id: String(w.lawSection._id),
        start: '09:00',
        end: '10:00',
        course_code: 'LAW-101',
        teachers: 'TBA',
        room: '313',
      },
      'CROSS_DEPARTMENT_DUPLICATE',
    );
  });

  it('EDT-04 an identical overlapping slot offers combined; confirming shares the key and never edits the other slot', async () => {
    const w = await world();
    const b = await (async () => {
      await w.cseAdmin
        .post('/api/admin/sections')
        .send({ semester_id: w.sem.id, level: 4, term: 'I', letter: 'B' });
      return Section.findOne({ letter: 'B' }).lean();
    })();
    const same = body(w, {
      section_id: String(b._id),
      day_of_week: 0,
      start: '09:00',
      end: '10:00',
      room: '311',
      course_code: 'CSE-301',
    });
    const first = await add(w.cseAdmin, same);
    const offer = first.body.data.warnings.find((x) => x.offer_combined);
    expect(offer.other_slot_id).toBe(String(w.s1._id));
    const bad = await add(w.cseAdmin, { ...same, combine_with_slot_id: String(w.l1._id) });
    expect(bad.body.error.code).toBe('SLOT_INVALID');
    const done = await add(w.cseAdmin, { ...same, combine_with_slot_id: String(w.s1._id) });
    expect(done.status).toBe(201);
    const created = await RoutineSlot.findById(done.body.data.slot.id).lean();
    expect(created.combined_key).toBeTruthy();
    const untouched = await RoutineSlot.findById(w.s1._id).lean();
    expect(untouched.version).toBe(w.s1.version ?? 1);
    expect(untouched.combined_key).toBeUndefined();
  });

  it('EDT-05 booking clashes are listed, and need a booking_action', async () => {
    const w = await world();
    const calls = [];
    registerBookingClashProvider(async () => [
      { id: 'b1', requester_name: 'Rita', date: '2027-05-02' },
    ]);
    registerBookingActionHandler(async (c) => calls.push(c.action));
    const first = await add(w.cseAdmin, body(w));
    expect(first.status).toBe(200);
    expect(first.body.data.saved).toBe(false);
    expect(first.body.data.booking_clashes[0]).toMatchObject({ requester_name: 'Rita' });
    expect(await count()).toBe(2);
    const second = await add(w.cseAdmin, body(w, { booking_action: 'cancel_booking' }));
    expect(second.status).toBe(201);
    expect(calls).toEqual(['cancel_booking']);
  });

  it('EDT-05 with no provider (before spec 19) nothing is returned', async () => {
    const w = await world();
    const res = await add(w.cseAdmin, body(w));
    expect(res.body.data.booking_clashes).toBeUndefined();
  });
});

describe('edit and delete (EDT-03, EDT-06, EDT-09)', () => {
  const put = (agent, id, b) => agent.put(`/api/slots/${id}`).send(b);
  const edit = (w, over = {}) => ({
    ...body(w, {
      section_id: String(w.cseSection._id),
      day_of_week: 0,
      start: '09:00',
      end: '10:00',
      room: '311',
      course_code: 'CSE-301',
    }),
    semester_id: undefined,
    version: 1,
    ...over,
  });

  it('EDT-03 a CSE admin cannot edit or delete a LAW-owned slot (403, unchanged)', async () => {
    const w = await world();
    const b = { ...edit(w), section_id: String(w.lawSection._id) };
    delete b.semester_id;
    expect((await put(w.cseAdmin, w.l1._id, b)).status).toBe(403);
    expect((await w.cseAdmin.delete(`/api/slots/${w.l1._id}`).send({ version: 1 })).status).toBe(
      403,
    );
    const after = await RoutineSlot.findById(w.l1._id).lean();
    expect(after.course_code).toBe('LAW-101');
    expect(after.version ?? 1).toBe(1);
  });

  it('EDT-06 editing an imported slot sets edited_by_hand and bumps the version', async () => {
    const w = await world();
    expect(w.s1.edited_by_hand).toBe(false);
    const b = edit(w, { course_name: 'Algorithms II' });
    delete b.semester_id;
    const res = await put(w.cseAdmin, w.s1._id, b);
    expect(res.status).toBe(200);
    const after = await RoutineSlot.findById(w.s1._id).lean();
    expect(after).toMatchObject({
      edited_by_hand: true,
      source: 'import',
      course_name: 'Algorithms II',
      version: 2,
    });
    expect(await RoutineSlot.findById(w.s1._id).select('semester_id').lean()).toBeTruthy();
  });

  it('EDT-09 a stale version on PUT and DELETE is CONFLICT; two admins: the second gets 409', async () => {
    const w = await world();
    const b = edit(w, { course_name: 'One' });
    delete b.semester_id;
    expect((await put(w.cseAdmin, w.s1._id, b)).status).toBe(200);
    const second = await put(await asAdmin(w.cse), w.s1._id, { ...b, course_name: 'Two' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
    const del = await w.cseAdmin.delete(`/api/slots/${w.s1._id}`).send({ version: 1 });
    expect(del.status).toBe(409);
    expect((await RoutineSlot.findById(w.s1._id).lean()).course_name).toBe('One');
    expect((await w.cseAdmin.delete(`/api/slots/${w.s1._id}`).send({ version: 2 })).status).toBe(
      204,
    );
    expect(await RoutineSlot.findById(w.s1._id)).toBeNull();
    expect(await RoutineSlotTeacher.countDocuments({ slot_id: w.s1._id })).toBe(0);
  });

  it('EDT-04 an edit does not clash with itself, but runs the checks', async () => {
    const w = await world();
    const b = edit(w);
    delete b.semester_id;
    expect((await put(w.cseAdmin, w.s1._id, b)).body.data.saved).toBe(true);
    const bad = await put(w.cseAdmin, w.s1._id, { ...b, version: 2, room: '999' });
    expect(bad.body.error.code).toBe('SLOT_INVALID');
  });

  it('concurrency: two simultaneous PUTs with the same version give one 200 and one 409', async () => {
    const w = await world();
    const b = edit(w);
    delete b.semester_id;
    const other = await asAdmin(w.cse);
    const [x, y] = await Promise.all([
      put(w.cseAdmin, w.s1._id, { ...b, course_name: 'X' }),
      put(other, w.s1._id, { ...b, course_name: 'Y' }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect((await RoutineSlot.findById(w.s1._id).lean()).version).toBe(2);
  });
});

describe('sections and groups (EDT-07)', () => {
  it('EDT-07 add a section by hand; a duplicate is CONFLICT; LAW cannot add a CSE section', async () => {
    const w = await world();
    const make = (agent, b) =>
      agent
        .post('/api/admin/sections')
        .send({ semester_id: w.sem.id, level: 2, term: 'I', letter: 'a', ...b });
    expect((await make(w.cseAdmin, {})).status).toBe(201);
    expect((await make(w.cseAdmin, {})).body.error.code).toBe('CONFLICT');
    expect((await make(w.lawAdmin, { department_id: w.cse.id, letter: 'C' })).status).toBe(403);
    expect((await make(w.sup, { letter: 'D' })).status).toBe(400); // must name a department
    expect((await make(w.sup, { letter: 'D', department_id: w.cse.id })).status).toBe(201);
    const [r] = await Promise.all(
      [make(w.cseAdmin, { letter: 'Q' }), make(w.cseAdmin, { letter: 'Q' })].map((p) =>
        p.then((x) => x.status),
      ),
    );
    expect([201, 409]).toContain(r);
    expect(await Section.countDocuments({ letter: 'Q' })).toBe(1);
  });

  it('EDT-07 add, rename and remove groups; a duplicate is CONFLICT; in use is GROUP_IN_USE', async () => {
    const w = await world();
    const sid = String(w.cseSection._id);
    const g1 = (await w.cseAdmin.post(`/api/admin/sections/${sid}/groups`).send({ label: 'G1' }))
      .body.data;
    expect(
      (await w.cseAdmin.post(`/api/admin/sections/${sid}/groups`).send({ label: 'g1' })).body.error
        .code,
    ).toBe('CONFLICT');
    const g2 = (await w.cseAdmin.post(`/api/admin/sections/${sid}/groups`).send({ label: 'G2' }))
      .body.data;
    expect(
      (await w.cseAdmin.patch(`/api/admin/groups/${g2.id}`).send({ label: 'G1' })).body.error.code,
    ).toBe('CONFLICT');
    expect(
      (await w.cseAdmin.patch(`/api/admin/groups/${g2.id}`).send({ label: 'G3' })).body.data.label,
    ).toBe('G3');
    // other department: 403
    expect(
      (await w.lawAdmin.post(`/api/admin/sections/${sid}/groups`).send({ label: 'G5' })).status,
    ).toBe(403);
    expect(
      (await w.lawAdmin.patch(`/api/admin/groups/${g1.id}`).send({ label: 'G5' })).status,
    ).toBe(403);
    expect((await w.lawAdmin.delete(`/api/admin/groups/${g1.id}`)).status).toBe(403);
    // in use by a slot
    expect((await add(w.cseAdmin, body(w, { group: 'G1' }))).status).toBe(201);
    const used = await w.cseAdmin.delete(`/api/admin/groups/${g1.id}`);
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe('GROUP_IN_USE');
    // in use by an accepted enrolment (fake provider)
    registerGroupUsage({ inUse: async (id) => id === g2.id });
    expect((await w.cseAdmin.delete(`/api/admin/groups/${g2.id}`)).body.error.code).toBe(
      'GROUP_IN_USE',
    );
    const free = (await w.cseAdmin.post(`/api/admin/sections/${sid}/groups`).send({ label: 'G4' }))
      .body.data;
    expect((await w.cseAdmin.delete(`/api/admin/groups/${free.id}`)).status).toBe(204);
    expect(await SectionGroup.findById(free.id)).toBeNull();
  });
});

describe('side effects (EDT-08)', () => {
  it('EDT-08 audit entries carry old and new values', async () => {
    const w = await world();
    const created = (await add(w.cseAdmin, body(w))).body.data.slot;
    const b = { ...body(w, { course_name: 'New name' }), version: 1 };
    delete b.semester_id;
    await w.cseAdmin.put(`/api/slots/${created.id}`).send(b);
    await w.cseAdmin.delete(`/api/slots/${created.id}`).send({ version: 2 });
    const entries = await auditList({ action: /^slot\./ });
    const byAction = Object.fromEntries(entries.map((e) => [e.action, e]));
    expect(byAction['slot.create'].new_value.course_code).toBe('CSE-302');
    expect(byAction['slot.update'].old_value.course_name).toBe('Databases');
    expect(byAction['slot.update'].new_value.course_name).toBe('New name');
    expect(byAction['slot.delete'].old_value.course_code).toBe('CSE-302');
    expect(String(byAction['slot.create'].scope_department_id)).toBe(w.cse.id);
  });

  it('EDT-08 an edit emits routine.changed to the section and the teacher, and batches the hourly email', async () => {
    const w = await world({ status: 'current' });
    const teacherUser = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'teacher', department_id: w.cse._id }],
    });
    await Teacher.updateOne({ short_code: 'AB' }, { $set: { user_id: teacherUser._id } });
    const students = [await makeUser({ kind: 'student' }), await makeUser({ kind: 'student' })];
    registerAudienceProvider(async () => students.map((s) => String(s._id)));
    const sent = [];
    setEmitter((room, event) => sent.push([room, event]));
    clearOutbox();
    expect((await add(w.cseAdmin, body(w))).status).toBe(201);
    expect(
      (await add(w.cseAdmin, body(w, { day_of_week: 2, course_code: 'CSE-303' }))).status,
    ).toBe(201);
    expect(sent).toContainEqual([`section:${w.cseSection._id}`, 'routine.changed']);
    expect(sent).toContainEqual([`user:${teacherUser._id}`, 'routine.changed']);
    const mails = (await drainMail()).filter((m) => m.subject.includes('routine'));
    for (const s of students) expect(mails.filter((m) => m.to === s.email)).toHaveLength(1);
  });

  it('EDT-08 a draft semester emits events but sends no email', async () => {
    const w = await world();
    const student = await makeUser({ kind: 'student' });
    registerAudienceProvider(async () => [String(student._id)]);
    const sent = [];
    setEmitter((room, event) => sent.push([room, event]));
    clearOutbox();
    await add(w.cseAdmin, body(w));
    expect(sent.length).toBeGreaterThan(0);
    expect(await drainMail()).toHaveLength(0);
  });

  it('EDT-08 moving a slot between sections notifies both', async () => {
    const w = await world();
    const sent = [];
    setEmitter((room) => sent.push(room));
    const b = {
      ...body(w, {
        section_id: String(w.lawSection._id),
        day_of_week: 0,
        start: '09:00',
        end: '10:00',
        room: '311',
        course_code: 'CSE-301',
      }),
      version: 1,
    };
    delete b.semester_id;
    const res = await w.cseAdmin.put(`/api/slots/${w.s1._id}`).send(b);
    expect(res.status).toBe(200);
    expect(sent).toEqual(
      expect.arrayContaining([`section:${w.cseSection._id}`, `section:${w.lawSection._id}`]),
    );
  });
});

describe('access and state (EDT-10)', () => {
  it('EDT-10 CR, teacher, student and an inactive admin get 403 on every route', async () => {
    const w = await world();
    const people = [
      await makeUser({ kind: 'student', roles: [{ role: 'cr', department_id: w.cse._id }] }),
      await makeUser({ kind: 'teacher', roles: [{ role: 'teacher', department_id: w.cse._id }] }),
      await makeUser({ kind: 'student' }),
      await makeUser({
        kind: 'staff',
        state: 'deactivated',
        roles: [{ role: 'dept_admin', department_id: w.cse._id }],
      }),
    ];
    const upd = { ...body(w), version: 1 };
    delete upd.semester_id;
    for (const p of people) {
      const a = await loginAs(p, app);
      const sid = String(w.cseSection._id);
      const res = [
        await a.get(`/api/admin/semesters/${w.sem.id}/sections`),
        await a.get(`/api/admin/sections/${sid}/routine`),
        await add(a, body(w)),
        await a.put(`/api/slots/${w.s1._id}`).send(upd),
        await a.delete(`/api/slots/${w.s1._id}`).send({ version: 1 }),
        await a
          .post('/api/admin/sections')
          .send({ semester_id: w.sem.id, level: 2, term: 'I', letter: 'A' }),
        await a.post(`/api/admin/sections/${sid}/groups`).send({ label: 'G1' }),
      ];
      // A deactivated account has no session at all (401); the others are refused (403).
      const want = p.state === 'deactivated' ? 401 : 403;
      expect(res.map((r) => r.status)).toEqual(Array(7).fill(want));
    }
    expect(await count()).toBe(2);
  });

  it('EDT-10 a super admin works on any department’s slot, acting as its owner', async () => {
    const w = await world();
    const b = {
      ...body(w, {
        section_id: String(w.lawSection._id),
        day_of_week: 1,
        start: '09:00',
        end: '10:00',
        course_code: 'LAW-101',
        teachers: ['LAW:XY'],
        room: '312',
        course_name: 'Law',
      }),
      version: 1,
    };
    delete b.semester_id;
    expect((await w.sup.put(`/api/slots/${w.l1._id}`).send(b)).status).toBe(200);
    expect(String((await RoutineSlot.findById(w.l1._id).lean()).owner_department_id)).toBe(
      w.law.id,
    );
    expect((await add(w.sup, body(w))).status).toBe(400); // must name a department
    expect((await add(w.sup, body(w, { department_id: w.cse.id }))).status).toBe(201);
  });

  it('an archived semester is SEMESTER_ARCHIVED on every write', async () => {
    const w = await world();
    await Semester.updateOne({ _id: w.sem.id }, { $set: { status: 'archived' } });
    const upd = { ...body(w), version: 1 };
    delete upd.semester_id;
    expect((await add(w.cseAdmin, body(w))).body.error.code).toBe('SEMESTER_ARCHIVED');
    expect((await w.cseAdmin.put(`/api/slots/${w.s1._id}`).send(upd)).body.error.code).toBe(
      'SEMESTER_ARCHIVED',
    );
    expect(
      (await w.cseAdmin.delete(`/api/slots/${w.s1._id}`).send({ version: 1 })).body.error.code,
    ).toBe('SEMESTER_ARCHIVED');
    const sec = await w.cseAdmin
      .post('/api/admin/sections')
      .send({ semester_id: w.sem.id, level: 2, term: 'I', letter: 'A' });
    expect(sec.body.error.code).toBe('SEMESTER_ARCHIVED');
  });

  it('malformed ids and bodies are VALIDATION_ERROR', async () => {
    const w = await world();
    expect((await w.cseAdmin.get('/api/admin/sections/xyz/routine')).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect((await w.cseAdmin.put('/api/slots/xyz').send({ version: 1 })).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect((await w.cseAdmin.put(`/api/slots/${w.s1._id}`).send({})).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect((await add(w.cseAdmin, { ...body(w), extra: 1 })).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect((await add(w.cseAdmin, { ...body(w), day_of_week: 'x' })).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect((await w.cseAdmin.delete(`/api/slots/${w.s1._id}`).send({})).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      (await w.cseAdmin.post(`/api/admin/sections/${w.cseSection._id}/groups`).send({ label: 'x' }))
        .body.error.code,
    ).toBe('VALIDATION_ERROR');
  });
});

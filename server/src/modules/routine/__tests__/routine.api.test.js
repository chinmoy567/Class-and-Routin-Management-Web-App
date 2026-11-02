import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
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
import { Semester } from '../../organisation/index.js';
import { Teacher } from '../../teachers/index.js';
import { list as auditList } from '../../audit/index.js';
import {
  RoutineImport,
  RoutineSlot,
  RoutineSlotTeacher,
  Section,
  SectionGroup,
  registerAudienceProvider,
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
  setScanner();
});

const asSuper = async () =>
  loginAs(await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] }), app);
const asDeptAdmin = async (dept) =>
  loginAs(
    await makeUser({ kind: 'staff', roles: [{ role: 'dept_admin', department_id: dept._id }] }),
    app,
  );

/** Departments, a draft semester and a room `311` (alias `RN: 311`) owned by CSE. */
async function world({ status = 'draft' } = {}) {
  const cse = await createDepartment({ code: 'CSE' });
  const law = await createDepartment({ code: 'LAW' });
  const eee = await createDepartment({ code: 'EEE' });
  const sup = await asSuper();
  const sem = (
    await sup.post('/api/admin/semesters').send({
      name: 'Spring 2027',
      start_date: '2027-04-04',
      end_date: '2027-08-04',
    })
  ).body.data;
  if (status !== 'draft') await Semester.updateOne({ _id: sem.id }, { $set: { status } });
  const room = (await sup.post('/api/admin/rooms').send({ code: '311', type: 'classroom', department_id: cse.id })).body.data;
  await sup.post(`/api/admin/rooms/${room.id}/aliases`).send({ alias: 'RN: 311' });
  await sup.post('/api/admin/rooms').send({ code: '312', type: 'classroom', department_id: cse.id });
  return { cse, law, eee, sup, sem, room, cseAdmin: await asDeptAdmin(cse), lawAdmin: await asDeptAdmin(law) };
}

const TEACHERS = [['CSE', 'AB', 'Ab Bar']];
const upload = (agent, w, dept, buffer) =>
  agent
    .post(`/api/semesters/${w.sem.id}/imports?department_id=${dept.id}`)
    .set('Content-Type', 'application/octet-stream')
    .send(buffer);
const uploadRows = async (agent, w, dept, routine, teachers = TEACHERS) =>
  upload(agent, w, dept, await workbook({ routine, teachers }));
const preview = (agent, id) => agent.get(`/api/imports/${id}/preview`);
const publish = (agent, id, body = { warnings_reviewed: true }) =>
  agent.post(`/api/imports/${id}/publish`).send(body);
const issuesOf = async (agent, id, code) =>
  (await preview(agent, id)).body.data.issues.filter((i) => i.code === code);

describe('template (IMP-01)', () => {
  it('IMP-01 the template has Routine, Teachers and instructions sheets, text cells and drop-downs', async () => {
    const w = await world();
    const res = await w.cseAdmin
      .get(`/api/admin/imports/template?department_id=${w.cse.id}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const names = wb.worksheets.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Instructions', 'Routine', 'Teachers']));
    const routine = wb.getWorksheet('Routine');
    expect(routine.getRow(1).values.slice(1)).toEqual([
      'Department',
      'Level',
      'Term',
      'Section',
      'Group',
      'Day',
      'Start',
      'End',
      'Course code',
      'Course name',
      'Teachers',
      'Room',
    ]);
    expect(routine.getCell('C2').numFmt).toBe('@'); // so `4-I` stays text
    expect(routine.getCell('B2').dataValidation.formulae[0]).toBe('"1,2,3,4"');
    expect(routine.getCell('F2').dataValidation.formulae[0]).toContain('Thursday');
    expect(routine.getCell('A2').dataValidation.type).toBe('list');
    const lists = wb.getWorksheet('Lists');
    const rooms = lists.getColumn(2).values.slice(2);
    expect(rooms).toEqual(expect.arrayContaining(['311', 'RN: 311', '312']));
    const depts = lists.getColumn(1).values.slice(2);
    expect(depts).toEqual(expect.arrayContaining(['CSE', 'LAW']));
  });

  it('IMP-01 a student cannot download it', async () => {
    await world();
    const student = await loginAs(await makeUser({ kind: 'student' }), app);
    expect((await student.get('/api/admin/imports/template')).status).toBe(403);
  });
});

describe('upload (IMP-02, IMP-03)', () => {
  it('IMP-02 an .xlsm file is refused with FILE_TYPE_NOT_ALLOWED', async () => {
    const w = await world();
    const buf = Buffer.concat([
      Buffer.from([0x50, 0x4b, 3, 4]),
      Buffer.from('xl/workbook.xml\0xl/vbaProject.bin', 'latin1'),
    ]);
    const res = await upload(w.cseAdmin, w, w.cse, buf);
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('IMP-02 a text file renamed to xlsx is refused (the type comes from the content)', async () => {
    const w = await world();
    const res = await upload(w.cseAdmin, w, w.cse, Buffer.from('not a workbook'));
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('IMP-02 a file over 5 MB is refused with FILE_TOO_LARGE', async () => {
    const w = await world();
    const res = await upload(w.cseAdmin, w, w.cse, Buffer.alloc(5 * 1024 * 1024 + 10, 1));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('IMP-02 an infected file is FILE_INFECTED and no import is created', async () => {
    const w = await world();
    setScanner(async () => ({ infected: true, signature: 'Eicar-Test-Signature' }));
    const res = await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FILE_INFECTED');
    expect(await RoutineImport.countDocuments()).toBe(0);
  });

  it('IMP-02 an archived semester is refused with SEMESTER_ARCHIVED', async () => {
    const w = await world({ status: 'archived' });
    const res = await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEMESTER_ARCHIVED');
  });

  it('IMP-03 a good upload is a checked import and changes nothing students can see', async () => {
    const w = await world();
    const res = await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')]);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'checked', counts: { rows: 1, errors: 0 } });
    expect(await RoutineSlot.countDocuments()).toBe(0);
    expect(await Section.countDocuments()).toBe(0);
  });

  it('IMP-03 a file that is not the template is a failed import', async () => {
    const w = await world();
    const bad = await workbook({ routineHeader: ['A', 'B'] });
    const res = await upload(w.cseAdmin, w, w.cse, bad);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('failed');
    expect((await publish(w.cseAdmin, res.body.data.id)).body.error.code).toBe('IMPORT_HAS_ERRORS');
  });

  it('IMP-03/32 a second upload replaces the open import, and the list returns the open one', async () => {
    const w = await world();
    const first = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    const second = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { day: 'Monday' })])).body.data;
    const list = (
      await w.cseAdmin.get(`/api/semesters/${w.sem.id}/imports?department_id=${w.cse.id}`)
    ).body.data;
    expect(list.open_import_id).toBe(second.id);
    expect(list.imports.map((i) => [i.id, i.status])).toEqual([
      [second.id, 'checked'],
      [first.id, 'replaced'],
    ]);
    expect(list.imports[0].uploaded_by.full_name).toBeTruthy();
  });
});

describe('checks (IMP-04 … IMP-22)', () => {
  it('IMP-08 an unknown teacher is an error and publishing is IMPORT_HAS_ERRORS', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { teachers: 'CSE:AA' })])).body.data;
    const found = await issuesOf(w.cseAdmin, up.id, 'UNKNOWN_TEACHER');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'error', row: 2 });
    const res = await publish(w.cseAdmin, up.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IMPORT_HAS_ERRORS');
  });

  it('IMP-08 a teacher already in the saved directory is not unknown', async () => {
    const w = await world();
    await Teacher.create({ department_id: w.cse._id, short_code: 'ZZ', full_name: 'Zed Zee' });
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { teachers: 'CSE:ZZ' })], [])).body.data;
    expect(up.counts.errors).toBe(0);
  });

  it('IMP-09 the same short code twice with different names is an error', async () => {
    const w = await world();
    const up = (
      await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')], [...TEACHERS, ['CSE', 'AB', 'Someone Else']])
    ).body.data;
    expect(await issuesOf(w.cseAdmin, up.id, 'DUPLICATE_TEACHER')).toHaveLength(1);
  });

  it('IMP-10 a room alias imports into the room, and an unknown room blocks publishing', async () => {
    const w = await world();
    const ok = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { room: 'RN: 311' })])).body.data;
    const view = (await preview(w.cseAdmin, ok.id)).body.data;
    expect(view.sections[0].rows[0].room_code).toBe('311');
    expect(ok.counts.errors).toBe(0);

    const bad = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { room: 'NOPE' })])).body.data;
    expect(await issuesOf(w.cseAdmin, bad.id, 'UNKNOWN_ROOM')).toHaveLength(1);
    expect((await publish(w.cseAdmin, bad.id)).body.error.code).toBe('IMPORT_HAS_ERRORS');
  });

  it('IMP-11 a missing field is an error', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { room: '' })])).body.data;
    expect(await issuesOf(w.cseAdmin, up.id, 'MISSING_FIELD')).toHaveLength(1);
  });

  it('IMP-16 a duplicated course and group in one day is a warning; IMP-15 and IMP-17 too', async () => {
    const w = await world();
    const up = (
      await uploadRows(w.cseAdmin, w, w.cse, [
        row('CSE', { code: 'CSE-301', group: 'G1', start: '9:00', end: '10:00', room: '311' }),
        row('CSE', { code: 'CSE-301', group: 'G1', start: '11:00', end: '12:00', room: '312', teachers: 'TBA' }),
        row('CSE', { code: 'CSE-302', group: 'G2', start: '7:00', end: '8:00', room: '312', day: 'Monday' }),
      ])
    ).body.data;
    expect(await issuesOf(w.cseAdmin, up.id, 'DUPLICATE_COURSE_DAY')).toHaveLength(1);
    expect(await issuesOf(w.cseAdmin, up.id, 'TEACHER_TBA')).toHaveLength(1);
    expect(await issuesOf(w.cseAdmin, up.id, 'OUTSIDE_HOURS')).toHaveLength(1);
  });

  it('IMP-04 level 5 and day Fri are errors', async () => {
    const w = await world();
    const up = (
      await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { level: '5' }), row('CSE', { day: 'Fri' })])
    ).body.data;
    expect(up.counts.errors).toBe(2);
  });

  it('IMP-20 a changed teacher name is a warning, and publishing updates the record (IMP-07)', async () => {
    const w = await world();
    await Teacher.create({ department_id: w.cse._id, short_code: 'AB', full_name: 'Old Name' });
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    expect(await issuesOf(w.cseAdmin, up.id, 'TEACHER_NAME_CHANGED')).toHaveLength(1);
    expect((await publish(w.cseAdmin, up.id)).status).toBe(200);
    expect((await Teacher.findOne({ short_code: 'AB' })).full_name).toBe('Ab Bar');
  });

  it('IMP-22 overlaps are also checked against another department’s published slots', async () => {
    const w = await world();
    const lawUp = (
      await uploadRows(
        w.lawAdmin,
        w,
        w.law,
        [row('LAW', { teachers: 'LAW:XY', room: '311' })],
        [['LAW', 'XY', 'Xy Why']],
      )
    ).body.data;
    expect((await publish(w.lawAdmin, lawUp.id)).status).toBe(200);
    const cseUp = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { room: '311' })])).body.data;
    const found = await issuesOf(w.cseAdmin, cseUp.id, 'ROOM_OVERLAP');
    expect(found).toHaveLength(1);
    expect(found[0].other_department).toBe('LAW');
  });

  it('IMP-18 a cross-department duplicate (same section, day, time, course) is a warning', async () => {
    const w = await world();
    const mk = (admin, dept, up) => up;
    void mk;
    const lawUp = (
      await uploadRows(
        w.lawAdmin,
        w,
        w.law,
        [row('LAW', { teachers: 'LAW:XY', room: '312' })],
        [['LAW', 'XY', 'Xy Why']],
      )
    ).body.data;
    await publish(w.lawAdmin, lawUp.id);
    const cseUp = (
      await uploadRows(w.cseAdmin, w, w.cse, [row('LAW', { teachers: 'CSE:AB', room: '311' })])
    ).body.data;
    expect(await issuesOf(w.cseAdmin, cseUp.id, 'CROSS_DEPARTMENT_DUPLICATE')).toHaveLength(1);
  });
});

describe('combined class (IMP-21)', () => {
  it('IMP-21 two sections with the same teacher, room and time warn; confirming shares a combined_key', async () => {
    const w = await world();
    const up = (
      await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { section: 'A' }), row('CSE', { section: 'B' })])
    ).body.data;
    expect(up.counts.warnings).toBeGreaterThanOrEqual(2);
    const warnings = await issuesOf(w.cseAdmin, up.id, 'ROOM_OVERLAP');
    expect(warnings[0].offer_combined).toBe(true);

    const res = await w.cseAdmin.post(`/api/imports/${up.id}/issues/${warnings[0].id}/confirm`);
    expect(res.status).toBe(200);
    expect((await w.cseAdmin.post(`/api/imports/${up.id}/issues/${warnings[0].id}/confirm`)).body.error.code).toBe('ALREADY_DECIDED');
    // the teacher overlap for the same two rows is confirmed with it
    const view = (await preview(w.cseAdmin, up.id)).body.data;
    expect(view.issues.filter((i) => i.offer_combined).every((i) => i.confirmed)).toBe(true);

    expect((await publish(w.cseAdmin, up.id)).status).toBe(200);
    const slots = await RoutineSlot.find().lean();
    expect(slots).toHaveLength(2);
    expect(slots[0].combined_key).toBeTruthy();
    expect(slots[0].combined_key).toBe(slots[1].combined_key);
  });

  it('IMP-21 an issue that is not a combined-class offer cannot be confirmed', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { teachers: 'TBA' })])).body.data;
    const tba = (await issuesOf(w.cseAdmin, up.id, 'TEACHER_TBA'))[0];
    const res = await w.cseAdmin.post(`/api/imports/${up.id}/issues/${tba.id}/confirm`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('preview (IMP-23)', () => {
  it('IMP-23 rows are grouped per section with sections and groups to create', async () => {
    const w = await world();
    const up = (
      await uploadRows(w.cseAdmin, w, w.cse, [
        row('CSE', { group: 'G1' }),
        row('CSE', { group: 'G2', day: 'Monday', room: '312', code: 'CSE-302' }),
        row('CSE', { level: '3', term: '2', day: 'Tuesday', room: '312', code: 'CSE-201' }),
      ])
    ).body.data;
    const view = (await preview(w.cseAdmin, up.id)).body.data;
    expect(view.sections).toHaveLength(2);
    const s4 = view.sections.find((s) => s.level === 4);
    expect(s4).toMatchObject({ term: 'I', letter: 'A', new: true, department_code: 'CSE' });
    expect(s4.groups.map((g) => g.label)).toEqual(['G1', 'G2']);
    expect(view.sections.find((s) => s.level === 3).term).toBe('II');
    expect(view.diff).toBeNull();
  });
});

describe('publish (IMP-25 … IMP-30)', () => {
  it('IMP-26 publishing creates sections, groups, teachers and slots, and audits the counts', async () => {
    const w = await world();
    const up = (
      await uploadRows(w.cseAdmin, w, w.cse, [
        row('CSE', { group: 'G1', teachers: 'CSE:AB+CSE:CD' }),
        row('CSE', { day: 'Monday', teachers: 'TBA', room: '312' }),
      ], [...TEACHERS, ['CSE', 'CD', 'Cd Dee']])
    ).body.data;
    const res = await publish(w.cseAdmin, up.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ added: 2, removed: 0, changed: 0 });
    expect(await Section.countDocuments()).toBe(1);
    expect(await SectionGroup.countDocuments()).toBe(1);
    expect(await Teacher.countDocuments()).toBe(2);
    const slots = await RoutineSlot.find().lean();
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.published && s.source === 'import')).toBe(true);
    expect(slots.every((s) => String(s.owner_department_id) === w.cse.id)).toBe(true); // IMP-30
    expect(slots.find((s) => s.tba)).toBeTruthy();
    expect(await RoutineSlotTeacher.countDocuments()).toBe(2); // the TBA slot has no teacher rows
    expect((await RoutineImport.findById(up.id)).status).toBe('published');
    const audit = await auditList({ action: 'routine.publish' });
    expect(audit).toHaveLength(1);
    expect(audit[0].new_value).toMatchObject({ added: 2, removed: 0, changed: 0 });
  });

  it('IMP-25 warnings must be reviewed before publishing', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { teachers: 'TBA' })])).body.data;
    const res = await publish(w.cseAdmin, up.id, {});
    expect(res.status).toBe(400);
    expect(res.body.error.fields.warnings_reviewed).toBeTruthy();
    expect((await publish(w.cseAdmin, up.id)).status).toBe(200);
  });

  it('IMP-26 a CSE file with LAW 1-II-A rows creates that section, shown as created by CSE (IMP-27)', async () => {
    const w = await world();
    const up = (
      await uploadRows(w.cseAdmin, w, w.cse, [row('LAW', { level: '1', term: 'II', section: 'A', teachers: 'CSE:AB' })])
    ).body.data;
    expect((await publish(w.cseAdmin, up.id)).status).toBe(200);
    const section = await Section.findOne().lean();
    expect(String(section.department_id)).toBe(w.law.id);
    expect(section).toMatchObject({ level: 1, term: 'II', letter: 'A' });
    expect(String(section.created_by_import_of)).toBe(w.cse.id);
  });

  it('IMP-26/30 a LAW re-import leaves CSE’s slot for LAW 1-II untouched, and the section shows both', async () => {
    const w = await world();
    const cseUp = (
      await uploadRows(w.cseAdmin, w, w.cse, [
        row('LAW', { level: '1', term: 'II', teachers: 'CSE:AB', code: 'CSE-101', room: '311' }),
      ])
    ).body.data;
    await publish(w.cseAdmin, cseUp.id);
    const lawUp = (
      await uploadRows(
        w.lawAdmin,
        w,
        w.law,
        [row('LAW', { level: '1', term: 'II', teachers: 'LAW:XY', code: 'LAW-101', day: 'Monday', room: '312' })],
        [['LAW', 'XY', 'Xy Why']],
      )
    ).body.data;
    expect(lawUp.counts.errors).toBe(0);
    const res = await publish(w.lawAdmin, lawUp.id);
    expect(res.body.data).toMatchObject({ added: 1, removed: 0 });
    const slots = await RoutineSlot.find().lean();
    expect(slots).toHaveLength(2);
    expect(new Set(slots.map((s) => String(s.section_id))).size).toBe(1); // one LAW 1-II section
    expect(slots.find((s) => s.course_code === 'CSE-101').owner_department_id.equals(w.cse._id)).toBe(true);
    // a LAW re-import of an empty-ish file removes only LAW's own slot
    const again = (
      await uploadRows(w.lawAdmin, w, w.law, [row('LAW', { level: '2', teachers: 'LAW:XY' })], [['LAW', 'XY', 'Xy Why']])
    ).body.data;
    await publish(w.lawAdmin, again.id);
    const left = await RoutineSlot.find({ course_code: 'CSE-101' }).lean();
    expect(left).toHaveLength(1);
  });

  it('IMP-29 an import whose semester was archived before publishing is SEMESTER_ARCHIVED', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    await Semester.updateOne({ _id: w.sem.id }, { $set: { status: 'archived' } });
    const res = await publish(w.cseAdmin, up.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEMESTER_ARCHIVED');
  });

  it('ROOM-06 a room used by a published slot cannot be retired', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    await publish(w.cseAdmin, up.id);
    const res = await w.cseAdmin.post(`/api/admin/rooms/${w.room.id}/retire`);
    expect(res.body.error.code).toBe('ROOM_IN_USE');
  });

  it('IMP-33/concurrency two publishes of the same import at once: one wins, one is ALREADY_DECIDED', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    const results = await Promise.all([publish(w.cseAdmin, up.id), publish(w.cseAdmin, up.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('ALREADY_DECIDED');
    expect(await RoutineSlot.countDocuments()).toBe(1);
    expect(await auditList({ action: 'routine.publish' })).toHaveLength(1);
  });

  it('IMP-33 confirm, keep-choices and publish on a published import are ALREADY_DECIDED', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    await publish(w.cseAdmin, up.id);
    expect((await publish(w.cseAdmin, up.id)).body.error.code).toBe('ALREADY_DECIDED');
    expect((await w.cseAdmin.put(`/api/imports/${up.id}/keep-choices`).send({})).body.error.code).toBe('ALREADY_DECIDED');
    expect((await w.cseAdmin.post(`/api/imports/${up.id}/issues/0/confirm`)).body.error.code).toBe('ALREADY_DECIDED');
    const list = (await w.cseAdmin.get(`/api/semesters/${w.sem.id}/imports?department_id=${w.cse.id}`)).body.data;
    expect(list.open_import_id).toBeNull();
    expect(list.imports[0].status).toBe('published');
  });
});

describe('re-import diff (IMP-24)', () => {
  async function publishedWithHandEdit() {
    const w = await world();
    const first = (
      await uploadRows(w.cseAdmin, w, w.cse, [
        row('CSE'),
        row('CSE', { day: 'Monday', code: 'CSE-302', room: '312' }),
      ])
    ).body.data;
    await publish(w.cseAdmin, first.id);
    const hand = await RoutineSlot.findOne({ course_code: 'CSE-302' });
    await RoutineSlot.updateOne({ _id: hand._id }, { $set: { edited_by_hand: true, source: 'manual' } });
    return { w, hand };
  }

  it('IMP-24 a re-import that drops a hand-edited slot shows it as edited by hand; keep (default) lets it survive', async () => {
    const { w, hand } = await publishedWithHandEdit();
    const again = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE', { room: '312' })])).body.data;
    const view = (await preview(w.cseAdmin, again.id)).body.data;
    expect(view.diff.changed).toHaveLength(1); // CSE-301 moved room
    expect(view.diff.removed).toHaveLength(1);
    expect(view.diff.removed[0]).toMatchObject({ id: String(hand._id), edited_by_hand: true, choice: 'keep' });
    expect((await publish(w.cseAdmin, again.id)).body.data).toMatchObject({ changed: 1, removed: 0 });
    expect(await RoutineSlot.findById(hand._id)).toBeTruthy();
  });

  it('IMP-24 choosing replace deletes the hand-edited slot', async () => {
    const { w, hand } = await publishedWithHandEdit();
    const again = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    const put = await w.cseAdmin.put(`/api/imports/${again.id}/keep-choices`).send({ [String(hand._id)]: 'replace' });
    expect(put.status).toBe(200);
    expect((await publish(w.cseAdmin, again.id)).body.data).toMatchObject({ removed: 1, added: 0 });
    expect(await RoutineSlot.findById(hand._id)).toBeNull();
  });

  it('IMP-24 keep choices only accept hand-edited slots of the diff', async () => {
    const { w } = await publishedWithHandEdit();
    const again = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    const plain = await RoutineSlot.findOne({ course_code: 'CSE-301' });
    const res = await w.cseAdmin.put(`/api/imports/${again.id}/keep-choices`).send({ [String(plain._id)]: 'keep' });
    expect(res.status).toBe(400);
    expect((await w.cseAdmin.put(`/api/imports/${again.id}/keep-choices`).send({ x: 'keep' })).status).toBe(400);
  });
});

describe('routine-change notification (IMP-28)', () => {
  it('IMP-28 publishing in the current semester sends exactly one email per affected student', async () => {
    const w = await world({ status: 'current' });
    const students = [await makeUser({ kind: 'student' }), await makeUser({ kind: 'student' })];
    registerAudienceProvider(async () => students.map((s) => String(s._id)));
    const up = (
      await uploadRows(w.cseAdmin, w, w.cse, [
        row('CSE'),
        row('CSE', { day: 'Monday', room: '312' }),
        row('CSE', { day: 'Tuesday', room: '312' }),
      ])
    ).body.data;
    expect((await publish(w.cseAdmin, up.id)).status).toBe(200);
    const mails = (await drainMail()).filter((m) => m.subject.includes('routine'));
    for (const s of students) {
      expect(mails.filter((m) => m.to === s.email)).toHaveLength(1);
    }
  });

  it('IMP-28 a draft semester sends no email', async () => {
    const w = await world();
    const student = await makeUser({ kind: 'student' });
    registerAudienceProvider(async () => [String(student._id)]);
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    await publish(w.cseAdmin, up.id);
    expect(await drainMail()).toHaveLength(0);
  });
});

describe('access and scope', () => {
  it('IMP-32 an EEE admin opening or listing a CSE import gets 404', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    const eee = await asDeptAdmin(w.eee);
    expect((await preview(eee, up.id)).status).toBe(404);
    expect((await eee.get(`/api/semesters/${w.sem.id}/imports?department_id=${w.cse.id}`)).status).toBe(404);
    expect((await publish(eee, up.id)).status).toBe(404);
    expect((await eee.post(`/api/imports/${up.id}/issues/0/confirm`)).status).toBe(404);
    expect((await eee.put(`/api/imports/${up.id}/keep-choices`).send({})).status).toBe(404);
    expect((await RoutineImport.findById(up.id)).status).toBe('checked');
  });

  it('IMP-02 an EEE admin cannot upload for CSE', async () => {
    const w = await world();
    const eee = await asDeptAdmin(w.eee);
    expect((await uploadRows(eee, w, w.cse, [row('CSE')])).status).toBe(403);
  });

  it('IMP-32 a super admin can open any department’s import', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    expect((await preview(w.sup, up.id)).status).toBe(200);
    const list = await w.sup.get(`/api/semesters/${w.sem.id}/imports?department_id=${w.cse.id}`);
    expect(list.body.data.open_import_id).toBe(up.id);
  });

  it('a student, a teacher and a CR get 403 on every import endpoint', async () => {
    const w = await world();
    const up = (await uploadRows(w.cseAdmin, w, w.cse, [row('CSE')])).body.data;
    const people = [
      await makeUser({ kind: 'student' }),
      await makeUser({ kind: 'teacher', roles: [{ role: 'teacher', department_id: w.cse._id }] }),
      await makeUser({ kind: 'student', roles: [{ role: 'cr', department_id: w.cse._id }] }),
    ];
    for (const person of people) {
      const agent = await loginAs(person, app);
      const responses = [
        await agent.get('/api/admin/imports/template'),
        await agent.get(`/api/semesters/${w.sem.id}/imports?department_id=${w.cse.id}`),
        await upload(agent, w, w.cse, await workbook({})),
        await preview(agent, up.id),
        await publish(agent, up.id),
        await agent.post(`/api/imports/${up.id}/issues/0/confirm`),
        await agent.put(`/api/imports/${up.id}/keep-choices`).send({}),
      ];
      expect(responses.map((r) => r.status)).toEqual(Array(7).fill(403));
    }
  });

  it('an anonymous caller gets 401', async () => {
    const w = await world();
    const anon = await loginAs(null, app);
    expect((await anon.get(`/api/semesters/${w.sem.id}/imports`)).status).toBe(401);
  });
});

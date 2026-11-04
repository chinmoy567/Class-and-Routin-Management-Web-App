import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  fixClock,
  loginAs,
  resetClock,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { createDepartment, makeId, makeUser } from '../../../../test/factories.js';
import { User, UserRole } from '../../auth/index.js';
import { Semester } from '../../organisation/index.js';
import { RoutineImport, Section } from '../../routine/index.js';
import { Enrolment } from '../../enrolments/index.js';
import { Room } from '../../rooms/index.js';
import { isOpen } from '../../representatives/index.js';
import { list as auditList } from '../../audit/index.js';
import { registerRolloverHook, resetRolloverHooks } from '../index.js';
import { getSectionSlots, setSectionSlots } from '../../routine/routine-cache.js';

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
  fixClock('2026-07-01T06:00:00Z');
});
afterEach(() => {
  resetClock();
  resetRolloverHooks();
});

const as = (user) => loginAs(user, app);

/**
 * Fall 2026 is current with an old CR and three active students. Spring 2027 is the draft:
 * CSE is ready (a CR, a published clean routine, a room); EEE is not (no routine, no CR).
 */
async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const eee = await createDepartment({ code: 'EEE' });
  const old = await Semester.create({
    name: 'Fall 2026',
    status: 'current',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
    made_current_at: new Date('2026-07-01T00:00:00Z'),
  });
  const draft = await Semester.create({
    name: 'Spring 2027',
    status: 'draft',
    start_date: '2027-01-10',
    end_date: '2027-06-30',
  });
  const section = (dept, semester, letter = 'A') =>
    Section.create({
      semester_id: semester._id,
      department_id: dept._id,
      level: 2,
      term: 'I',
      letter,
    });
  const importFor = (dept, semester, { status = 'published', errors = 0 } = {}) =>
    RoutineImport.create({
      semester_id: semester._id,
      department_id: dept._id,
      status,
      counts: { rows: 1, errors, warnings: 0 },
      uploaded_by: makeId(),
      uploaded_at: new Date(),
    });
  const room = (dept, code) =>
    Room.create({
      code,
      code_norm: code.toLowerCase(),
      type: 'classroom',
      owner_department_id: dept._id,
    });
  const repOf = (sec, dept, semester, role, state = 'active') =>
    makeUser({
      kind: 'student',
      state,
      name: `${role.toUpperCase()} of ${sec.letter}`,
      roles: [
        {
          role,
          department_id: dept._id,
          section_id: sec._id,
          semester_id: semester._id,
          is_representative: true,
        },
      ],
    });

  // Fall 2026: CSE section with an old CR (ends at rollover), and three active students.
  const oldSection = await section(cse, old);
  const oldCr = await repOf(oldSection, cse, old, 'cr');
  const students = [];
  for (let i = 0; i < 3; i += 1) {
    const s = await makeUser({ kind: 'student', state: 'active', name: `Student ${i}` });
    await User.updateOne({ _id: s._id }, { $set: { confirmed_semester_id: old._id } });
    students.push(s);
  }

  // Spring 2027 (draft): CSE ready, EEE not.
  const cseSection = await section(cse, draft);
  const draftCr = await repOf(cseSection, cse, draft, 'cr', 'claim_pending');
  await importFor(cse, draft);
  await room(cse, '301');
  const eeeSection = await section(eee, draft);
  await room(eee, 'EEE-LAB');

  const superAdmin = await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] });
  const cseAdmin = await makeUser({
    kind: 'staff',
    roles: [{ role: 'dept_admin', department_id: cse._id }],
  });
  return {
    cse,
    eee,
    old,
    draft,
    oldSection,
    oldCr,
    students,
    cseSection,
    draftCr,
    eeeSection,
    superAdmin,
    cseAdmin,
    importFor,
    room,
    section,
    repOf,
  };
}

const readiness = (agent, semesterId) => agent.get(`/api/admin/semesters/${semesterId}/readiness`);
const makeCurrent = (agent, semesterId, body = {}) =>
  agent.post(`/api/admin/semesters/${semesterId}/make-current`).send(body);

describe('the readiness checklist (ROL-01, ROL-02)', () => {
  it('ROL-01 each department has four checks with counts, and a ready department says so', async () => {
    const w = await world();
    const res = await readiness(await as(w.superAdmin), w.draft._id);
    expect(res.status).toBe(200);
    const cse = res.body.data.departments.find((d) => d.code === 'CSE');
    const eee = res.body.data.departments.find((d) => d.code === 'EEE');
    expect(cse.ready).toBe(true);
    expect(cse.reasons).toEqual([]);
    expect(cse.items.sections).toEqual({ ok: true, count: 1 });
    expect(cse.items.import.ok).toBe(true);
    expect(cse.items.cr).toEqual({ ok: true, total: 1, without_cr: 0 });
    expect(cse.items.rooms).toEqual({ ok: true, count: 1 });
    expect(eee.ready).toBe(false);
    expect(eee.reasons).toEqual(['no_import', 'sections_without_cr']);
    expect(eee.items.cr.without_cr).toBe(1);
  });

  it('ROL-01 a department with no sections, no import and no rooms is not ready', async () => {
    const w = await world();
    const sales = await createDepartment({ code: 'SAL' });
    const res = await readiness(await as(w.superAdmin), w.draft._id);
    const row = res.body.data.departments.find((d) => d.id === String(sales._id));
    expect(row.ready).toBe(false);
    expect(row.reasons).toEqual(['no_sections', 'no_import', 'no_rooms']);
  });

  it('ROL-01 a routine import with errors does not count as published', async () => {
    const w = await world();
    await w.importFor(w.eee, w.draft, { errors: 2 });
    const res = await readiness(await as(w.superAdmin), w.draft._id);
    const eee = res.body.data.departments.find((d) => d.code === 'EEE');
    expect(eee.items.import.ok).toBe(false);
  });

  it('ROL-02 a department admin sees only their own department; the super admin sees all', async () => {
    const w = await world();
    const cseOnly = await readiness(await as(w.cseAdmin), w.draft._id);
    expect(cseOnly.status).toBe(200);
    expect(cseOnly.body.data.departments.map((d) => d.code)).toEqual(['CSE']);
    expect(cseOnly.body.data.can_make_current).toBe(false);
    const all = await readiness(await as(w.superAdmin), w.draft._id);
    expect(all.body.data.departments.map((d) => d.code).sort()).toEqual(['CSE', 'EEE']);
    expect(all.body.data.can_make_current).toBe(true);
  });

  it('ROL-02 a CR, a student and a teacher cannot see the checklist', async () => {
    const w = await world();
    const crAgent = await as(w.draftCr);
    expect((await readiness(crAgent, w.draft._id)).status).toBe(403);
    const student = await as(await makeUser({ kind: 'student', state: 'active' }));
    expect((await readiness(student, w.draft._id)).status).toBe(403);
    const teacher = await as(await makeUser({ kind: 'teacher', state: 'active' }));
    expect((await readiness(teacher, w.draft._id)).status).toBe(403);
  });

  it('ROL-02 the checklist is only for a draft semester', async () => {
    const w = await world();
    const res = await readiness(await as(w.superAdmin), w.old._id);
    expect(res.status).toBe(404);
  });
});

describe('make current (ROL-03 to ROL-05, [PRD] rollover)', () => {
  it('ROL-03 a not-ready department blocks the change and is named', async () => {
    const w = await world();
    const res = await makeCurrent(await as(w.superAdmin), w.draft._id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_READY_UNCONFIRMED');
    expect(res.body.error.departments).toEqual([
      { code: 'EEE', reasons: ['no_import', 'sections_without_cr'] },
    ]);
    expect((await Semester.findById(w.old._id)).status).toBe('current');
    expect((await Semester.findById(w.draft._id)).status).toBe('draft');
  });

  it('[PRD] Spring 2027 with CSE ready and EEE not: after confirming, the rollover runs', async () => {
    const w = await world();
    const res = await makeCurrent(await as(w.superAdmin), w.draft._id, {
      confirm_not_ready: ['EEE'],
    });
    expect(res.status).toBe(200);

    // The old semester is archived and its CR role ends.
    expect((await Semester.findById(w.old._id)).status).toBe('archived');
    const oldRole = await UserRole.findOne({ user_id: w.oldCr._id, role: 'cr' });
    expect(oldRole.ended_at).toBeTruthy();
    expect(oldRole.ended_reason).toBe('semester_ended');

    // Every active student becomes unconfirmed, and keeps the old confirmed semester.
    for (const s of w.students) {
      const row = await User.findById(s._id).lean();
      expect(row.state).toBe('unconfirmed');
      expect(String(row.confirmed_semester_id)).toBe(String(w.old._id));
    }

    // CSE sections open; EEE stays closed.
    expect((await Semester.findById(w.draft._id)).status).toBe('current');
    expect(await isOpen(w.cseSection._id)).toBe(true);
    expect(await isOpen(w.eeeSection._id)).toBe(false);
  });

  it('ROL-04(5) a draft CR is active with an accepted enrolment right after the rollover', async () => {
    const w = await world();
    await makeCurrent(await as(w.superAdmin), w.draft._id, { confirm_not_ready: ['EEE'] });
    const cr = await User.findById(w.draftCr._id).lean();
    expect(cr.state).toBe('active');
    expect(String(cr.confirmed_semester_id)).toBe(String(w.draft._id));
    const enrolment = await Enrolment.findOne({
      user_id: w.draftCr._id,
      semester_id: w.draft._id,
      status: 'accepted',
    }).lean();
    expect(String(enrolment.section_id)).toBe(String(w.cseSection._id));
  });

  it('ROL-04 the response and the stored summary count what changed', async () => {
    const w = await world();
    const res = await makeCurrent(await as(w.superAdmin), w.draft._id, {
      confirm_not_ready: ['EEE'],
    });
    expect(res.body.data).toMatchObject({
      id: String(w.draft._id),
      status: 'current',
      archived_semester_id: String(w.old._id),
      students_unconfirmed: 4, // three students and the old CR
      roles_ended: 1,
      roles_started: 1,
      roles_skipped: 0,
      requests_withdrawn: 0,
    });
    const stored = await Semester.findById(w.draft._id).lean();
    expect(stored.rollover_summary.students_unconfirmed).toBe(4);
  });

  it('ROL-04 an audit entry records the rollover with its counts', async () => {
    const w = await world();
    await makeCurrent(await as(w.superAdmin), w.draft._id, { confirm_not_ready: ['EEE'] });
    const [entry] = await auditList({ action: 'semester.make_current' });
    expect(String(entry.actor_id)).toBe(String(w.superAdmin._id));
    expect(entry.new_value).toMatchObject({ students_unconfirmed: 4, roles_started: 1 });
  });

  it('ROL-04 the post-commit hook runs once, after the change is saved', async () => {
    const w = await world();
    const seen = [];
    registerRolloverHook(async (info) => {
      seen.push((await Semester.findById(w.draft._id).lean()).status);
      expect(info.current_semester_id).toBe(String(w.draft._id));
    });
    await makeCurrent(await as(w.superAdmin), w.draft._id, { confirm_not_ready: ['EEE'] });
    expect(seen).toEqual(['current']);
  });

  it('RTN-14 making a semester current clears the cached weekly patterns (spec 12)', async () => {
    const w = await world();
    setSectionSlots(String(w.draft._id), String(w.cseSection._id), [{ slot_id: 'stale' }]);
    expect(getSectionSlots(String(w.draft._id), String(w.cseSection._id))).not.toBeNull();

    const res = await makeCurrent(await as(w.superAdmin), w.draft._id, {
      confirm_not_ready: ['EEE'],
    });
    expect(res.status).toBe(200);

    expect(getSectionSlots(String(w.draft._id), String(w.cseSection._id))).toBeNull();
  });

  it('ROL-04 if any step fails, nothing changes: the old semester is current and students are active', async () => {
    const w = await world();
    // A second CSE section where the draft CR already holds an accepted enrolment. The CR cannot
    // then move to the section they were named for, so the rollover must fail after its earlier
    // steps and roll them back.
    const other = await w.section(w.cse, w.draft, 'B');
    await Enrolment.create({
      user_id: w.draftCr._id,
      semester_id: w.draft._id,
      section_id: other._id,
      status: 'accepted',
    });
    const res = await makeCurrent(await as(w.superAdmin), w.draft._id, {
      confirm_not_ready: ['EEE', 'CSE'],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    expect((await Semester.findById(w.old._id)).status).toBe('current');
    expect((await Semester.findById(w.draft._id)).status).toBe('draft');
    for (const s of w.students) {
      expect((await User.findById(s._id).lean()).state).toBe('active');
    }
    const oldRole = await UserRole.findOne({ user_id: w.oldCr._id, role: 'cr' }).lean();
    expect(oldRole.ended_at).toBeFalsy();
    expect(await auditList({ action: 'semester.make_current' })).toHaveLength(0);
  });

  it('ROL-05 two make-current requests at the same time: one succeeds, one gets ALREADY_DECIDED', async () => {
    const w = await world();
    const agent = await as(w.superAdmin);
    const [a, b] = await Promise.all([
      makeCurrent(agent, w.draft._id, { confirm_not_ready: ['EEE'] }),
      makeCurrent(agent, w.draft._id, { confirm_not_ready: ['EEE'] }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('ALREADY_DECIDED');
    expect(await auditList({ action: 'semester.make_current' })).toHaveLength(1);
  });

  it('ROL-05 a second press after the change gets ALREADY_DECIDED', async () => {
    const w = await world();
    const agent = await as(w.superAdmin);
    await makeCurrent(agent, w.draft._id, { confirm_not_ready: ['EEE'] });
    const again = await makeCurrent(agent, w.draft._id, { confirm_not_ready: ['EEE'] });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('ROL-07 the student state change is one bulk write, not one write per student', async () => {
    const w = await world();
    const many = vi.spyOn(User, 'updateMany');
    const one = vi.spyOn(User, 'updateOne');
    try {
      await makeCurrent(await as(w.superAdmin), w.draft._id, { confirm_not_ready: ['EEE'] });
      const bulk = many.mock.calls.filter(([filter, update]) => {
        return filter?.state === 'active' && update?.$set?.state === 'unconfirmed';
      });
      expect(bulk).toHaveLength(1);
      const perStudent = one.mock.calls.filter(
        ([, update]) => update?.$set?.state === 'unconfirmed',
      );
      expect(perStudent).toHaveLength(0);
    } finally {
      many.mockRestore();
      one.mockRestore();
    }
  });

  it('ROL-06 a department that was not ready opens each section as soon as it gets a CR', async () => {
    const w = await world();
    await makeCurrent(await as(w.superAdmin), w.draft._id, { confirm_not_ready: ['EEE'] });
    expect(await isOpen(w.eeeSection._id)).toBe(false);
    const eeeCr = await makeUser({ kind: 'student', state: 'claim_pending', name: 'EEE CR' });
    const res = await (
      await as(w.superAdmin)
    )
      .post(`/api/admin/sections/${w.eeeSection._id}/representatives`)
      .send({ user_id: String(eeeCr._id), role: 'cr' });
    expect(res.status).toBe(201);
    expect(await isOpen(w.eeeSection._id)).toBe(true);
  });

  it('D2 a pending join request on the old semester is withdrawn so the student can apply again', async () => {
    const w = await world();
    const waiting = await makeUser({ kind: 'student', state: 'active' });
    const pending = await Enrolment.create({
      user_id: waiting._id,
      semester_id: w.old._id,
      section_id: w.oldSection._id,
      status: 'pending',
    });
    const res = await makeCurrent(await as(w.superAdmin), w.draft._id, {
      confirm_not_ready: ['EEE'],
    });
    expect(res.body.data.requests_withdrawn).toBe(1);
    expect((await Enrolment.findById(pending._id).lean()).status).toBe('withdrawn');
  });

  it('ROL-03 and the permissions: only a super admin can make a semester current', async () => {
    const w = await world();
    const attempts = [
      await as(w.cseAdmin),
      await as(w.draftCr),
      await as(await makeUser({ kind: 'student', state: 'active' })),
      await as(await makeUser({ kind: 'teacher', state: 'active' })),
    ];
    for (const agent of attempts) {
      const res = await makeCurrent(agent, w.draft._id, { confirm_not_ready: ['EEE'] });
      expect(res.status).toBe(403);
    }
    expect((await Semester.findById(w.draft._id)).status).toBe('draft');
  });
});

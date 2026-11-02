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
import { User, UserRole, loadRequestUser } from '../../auth/index.js';
import { Semester } from '../../organisation/index.js';
import { Section } from '../../routine/index.js';
import { Enrolment } from '../../enrolments/index.js';
import { list as auditList } from '../../audit/index.js';
import {
  crDcrOf,
  endRolesOfSemester,
  isOpen,
  registerCrAssignedHook,
  resetCrAssignedHooks,
} from '../index.js';

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
afterEach(resetCrAssignedHooks);

/** Archived, current and draft semesters, and one department with sections in each. */
async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const eee = await createDepartment({ code: 'EEE' });
  const archived = await Semester.create({
    name: 'Spring 2026',
    status: 'archived',
    start_date: '2026-01-01',
    end_date: '2026-06-30',
  });
  const current = await Semester.create({
    name: 'Fall 2026',
    status: 'current',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
  });
  const draft = await Semester.create({
    name: 'Spring 2027',
    status: 'draft',
    start_date: '2027-01-01',
    end_date: '2027-06-30',
  });
  const section = (sem, dept, level, term, letter = 'A') =>
    Section.create({
      semester_id: sem._id,
      department_id: dept._id,
      level,
      term,
      letter,
    });
  return { cse, eee, archived, current, draft, section };
}

const asDeptAdmin = async (dept) =>
  loginAs(
    await makeUser({ kind: 'staff', roles: [{ role: 'dept_admin', department_id: dept._id }] }),
    app,
  );
const asSuper = async () =>
  loginAs(await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] }), app);
const student = (extra = {}) => makeUser({ kind: 'student', state: 'claim_pending', ...extra });
const assign = (agent, sectionId, user, role = 'cr') =>
  agent
    .post(`/api/admin/sections/${sectionId}/representatives`)
    .send({ user_id: String(user._id), role });
const reps = (sectionId) =>
  UserRole.find({ section_id: sectionId, ended_at: null, is_representative: true }).lean();

describe('assigning (CRD-01 to CRD-05)', () => {
  it('CRD-01/02/04 assigns a CR and a DCR in a current section, scoped by section, semester and department', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const admin = await asDeptAdmin(w.cse);
    const a = await assign(admin, sec.id, await student(), 'cr');
    expect(a.status).toBe(201);
    const b = await assign(admin, sec.id, await student(), 'dcr');
    expect(b.status).toBe(201);
    const rows = await reps(sec._id);
    expect(rows).toHaveLength(2);
    expect(String(rows[0].semester_id)).toBe(String(w.current._id));
    expect(String(rows[0].department_id)).toBe(String(w.cse._id));
  });

  it('CRD-02 a second CR and a third DCR return ROLE_LIMIT; ending a role frees the slot', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const admin = await asDeptAdmin(w.cse);
    const cr = await student();
    expect((await assign(admin, sec.id, cr, 'cr')).status).toBe(201);
    const second = await assign(admin, sec.id, await student(), 'cr');
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'ROLE_LIMIT',
      message: 'This section already has a CR',
    });
    expect((await assign(admin, sec.id, await student(), 'dcr')).status).toBe(201);
    expect((await assign(admin, sec.id, await student(), 'dcr')).status).toBe(201);
    const third = await assign(admin, sec.id, await student(), 'dcr');
    expect(third.body.error).toMatchObject({ code: 'ROLE_LIMIT' });
    expect(third.body.error.message).toContain('two DCRs');
    const role = await UserRole.findOne({ user_id: cr._id, role: 'cr' });
    expect((await admin.delete(`/api/admin/representatives/${role._id}`)).status).toBe(204);
    expect((await assign(admin, sec.id, await student(), 'cr')).status).toBe(201);
  });

  it('CRD-03 the same student cannot be DCR of two sections in a semester, but may hold a draft and a current role', async () => {
    const w = await world();
    const s1 = await w.section(w.current, w.cse, 2, 'II', 'A');
    const s2 = await w.section(w.current, w.cse, 2, 'II', 'B');
    const d1 = await w.section(w.draft, w.cse, 3, 'I', 'A');
    const admin = await asDeptAdmin(w.cse);
    const u = await student();
    expect((await assign(admin, s1.id, u, 'dcr')).status).toBe(201);
    const res = await assign(admin, s2.id, u, 'dcr');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await assign(admin, d1.id, u, 'cr')).status).toBe(201);
  });

  it('CRD-01 ineligible accounts get USER_NOT_ELIGIBLE; the three allowed states are accepted; no UV ID is needed', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const admin = await asDeptAdmin(w.cse);
    const bad = [
      await makeUser({ kind: 'student', state: 'deactivated' }),
      await makeUser({ kind: 'student', state: 'graduated' }),
      await makeUser({ kind: 'student', state: 'email_unverified' }),
      await makeUser({ kind: 'teacher', state: 'active' }),
      await makeUser({ kind: 'staff', state: 'active' }),
    ];
    for (const u of bad) {
      const res = await assign(admin, sec.id, u, 'dcr');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('USER_NOT_ELIGIBLE');
    }
    expect((await assign(admin, sec.id, await makeUser({ state: 'active' }), 'cr')).status).toBe(
      201,
    );
    expect(
      (await assign(admin, sec.id, await makeUser({ state: 'unconfirmed' }), 'dcr')).status,
    ).toBe(201);
    expect((await assign(admin, sec.id, await student(), 'dcr')).status).toBe(201);
  });

  it('CRD-04 a claim_pending student made CR in the current semester becomes active with an accepted enrolment', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const other = await w.section(w.current, w.cse, 2, 'II', 'B');
    const u = await student();
    await Enrolment.create({
      user_id: u._id,
      semester_id: w.current._id,
      section_id: other._id,
      status: 'pending',
    });
    const res = await assign(await asDeptAdmin(w.cse), sec.id, u, 'cr');
    expect(res.status).toBe(201);
    const user = await User.findById(u._id).lean();
    expect(user.state).toBe('active');
    expect(String(user.confirmed_semester_id)).toBe(String(w.current._id));
    const accepted = await Enrolment.find({ user_id: u._id, status: 'accepted' }).lean();
    expect(accepted).toHaveLength(1);
    expect(String(accepted[0].section_id)).toBe(String(sec._id));
    expect(accepted[0].group_id).toBeUndefined();
    expect((await Enrolment.findOne({ section_id: other._id })).status).toBe('withdrawn');
  });

  it('CRD-04 a student already accepted in another current section is refused; in their own section the enrolment is kept', async () => {
    const w = await world();
    const s1 = await w.section(w.current, w.cse, 2, 'II', 'A');
    const s2 = await w.section(w.current, w.cse, 2, 'II', 'B');
    const admin = await asDeptAdmin(w.cse);
    const u = await makeUser({ state: 'active' });
    await Enrolment.create({
      user_id: u._id,
      semester_id: w.current._id,
      section_id: s1._id,
      status: 'accepted',
    });
    const refused = await assign(admin, s2.id, u, 'dcr');
    expect(refused.body.error.code).toBe('CONFLICT');
    expect((await assign(admin, s1.id, u, 'dcr')).status).toBe(201);
    expect(await Enrolment.countDocuments({ user_id: u._id, status: 'accepted' })).toBe(1);
  });

  it('CRD-05 a draft assignment is stored but has no effect', async () => {
    const w = await world();
    const sec = await w.section(w.draft, w.cse, 3, 'I');
    const u = await student();
    const res = await assign(await asDeptAdmin(w.cse), sec.id, u, 'cr');
    expect(res.status).toBe(201);
    const row = await UserRole.findOne({ user_id: u._id });
    expect(String(row.semester_id)).toBe(String(w.draft._id));
    expect(await Enrolment.countDocuments({ user_id: u._id })).toBe(0);
    expect((await User.findById(u._id)).state).toBe('claim_pending');
    const rq = await loadRequestUser(u._id);
    expect(rq.roles.some((r) => r.role === 'cr')).toBe(false);
  });

  it('CRD-13 an archived semester returns SEMESTER_ARCHIVED; bad ids and bodies return VALIDATION_ERROR', async () => {
    const w = await world();
    const sec = await w.section(w.archived, w.cse, 2, 'I');
    const admin = await asDeptAdmin(w.cse);
    const res = await assign(admin, sec.id, await student(), 'cr');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEMESTER_ARCHIVED');
    expect(
      (await admin.post('/api/admin/sections/nope/representatives').send({})).body.error.code,
    ).toBe('VALIDATION_ERROR');
    const bad = await admin
      .post(`/api/admin/sections/${sec.id}/representatives`)
      .send({ user_id: 'x', role: 'boss' });
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('openness (CRD-06) and removal (CRD-08)', () => {
  it('CRD-06 a section is open only with a CR in effect in the current semester', async () => {
    const w = await world();
    const none = await w.section(w.current, w.cse, 2, 'II', 'A');
    const withCr = await w.section(w.current, w.cse, 2, 'II', 'B');
    const draft = await w.section(w.draft, w.cse, 3, 'I');
    const closed = await w.section(w.current, w.cse, 2, 'II', 'C');
    const admin = await asDeptAdmin(w.cse);
    await assign(admin, withCr.id, await student(), 'cr');
    await assign(admin, draft.id, await student(), 'cr');
    await assign(admin, closed.id, await student(), 'cr');
    await Section.updateOne({ _id: closed._id }, { $set: { closed_at: new Date() } });
    expect(await isOpen(none.id)).toBe(false);
    expect(await isOpen(withCr.id)).toBe(true);
    expect(await isOpen(draft.id)).toBe(false);
    expect(await isOpen(closed.id)).toBe(false);
    expect((await crDcrOf(withCr.id)).map((r) => r.role)).toEqual(['cr']);
    expect(await crDcrOf(draft.id)).toEqual([]);
  });

  it('CRD-08 removing a role ends it, keeps the enrolment; removing the only CR closes the section and escalates pending requests, a DCR does not', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const admin = await asDeptAdmin(w.cse);
    const cr = await student();
    const dcr = await student();
    await assign(admin, sec.id, cr, 'cr');
    await assign(admin, sec.id, dcr, 'dcr');
    const applicant = await student();
    await Enrolment.create({
      user_id: applicant._id,
      semester_id: w.current._id,
      section_id: sec._id,
      status: 'pending',
    });

    const dcrRole = await UserRole.findOne({ user_id: dcr._id });
    expect((await admin.delete(`/api/admin/representatives/${dcrRole._id}`)).status).toBe(204);
    expect((await Enrolment.findOne({ user_id: applicant._id })).escalated_at).toBeUndefined();
    expect((await loadRequestUser(dcr._id)).roles.some((r) => r.role === 'dcr')).toBe(false);

    const crRole = await UserRole.findOne({ user_id: cr._id });
    expect((await admin.delete(`/api/admin/representatives/${crRole._id}`)).status).toBe(204);
    const stored = await UserRole.findById(crRole._id).lean();
    expect(stored.ended_at).toBeTruthy();
    expect(String(stored.ended_by)).toBeTruthy();
    expect(await Enrolment.countDocuments({ user_id: cr._id, status: 'accepted' })).toBe(1);
    expect(await isOpen(sec.id)).toBe(false);
    expect((await Enrolment.findOne({ user_id: applicant._id })).escalated_at).toBeTruthy();
    expect((await admin.delete(`/api/admin/representatives/${crRole._id}`)).status).toBe(404);
  });
});

describe('re-appointing (CRD-07)', () => {
  it('CRD-07 shows last semester people in the matching section and re-appoints them, skipping with reasons', async () => {
    const w = await world();
    const last = await w.section(w.current, w.cse, 2, 'I', 'A');
    const next = await w.section(w.draft, w.cse, 2, 'II', 'A');
    const admin = await asDeptAdmin(w.cse);
    const cr = await student({ name: 'Cara CR' });
    const dcr = await makeUser({ kind: 'student', state: 'graduated', name: 'Gina Grad' });
    const removed = await student({ name: 'Rita Removed' });
    const mk = (u, role, extra = {}) =>
      UserRole.create({
        user_id: u._id,
        role,
        department_id: w.cse._id,
        section_id: last._id,
        semester_id: w.current._id,
        is_representative: true,
        ...extra,
      });
    await mk(cr, 'cr');
    await mk(dcr, 'dcr');
    await mk(removed, 'dcr', { ended_at: new Date(), ended_reason: 'removed' });

    const view = await admin.get(`/api/admin/sections/${next.id}/representatives`);
    expect(view.status).toBe(200);
    expect(view.body.data.semester_status).toBe('draft');
    expect(view.body.data.last_semester.representatives.map((r) => r.full_name).sort()).toEqual([
      'Cara CR',
      'Gina Grad',
    ]);

    const res = await admin.post(`/api/admin/sections/${next.id}/representatives/reappoint`);
    expect(res.status).toBe(200);
    expect(res.body.data.assigned.map((r) => r.full_name)).toEqual(['Cara CR']);
    expect(res.body.data.skipped).toEqual([
      expect.objectContaining({ full_name: 'Gina Grad', reason: 'USER_NOT_ELIGIBLE' }),
    ]);
    const again = await admin.post(`/api/admin/sections/${next.id}/representatives/reappoint`);
    expect(again.body.data.skipped.find((s) => s.full_name === 'Cara CR').reason).toBe(
      'ALREADY_ASSIGNED',
    );
    const entries = await auditList({ action: 'representative.assign' });
    expect(entries.some((e) => e.new_value.via === 'reappoint')).toBe(true);
  });
});

describe('audit, email, privacy, profile, hooks (CRD-09 to CRD-11)', () => {
  it('CRD-09 assign and remove are audited and emailed; responses hold no email or phone', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const admin = await asDeptAdmin(w.cse);
    const u = await student({ phone: '+8801712345678', name: 'Mina Mia' });
    const res = await assign(admin, sec.id, u, 'cr');
    const dump = JSON.stringify([
      res.body,
      (await admin.get(`/api/admin/sections/${sec.id}/representatives`)).body,
      (await admin.get(`/api/admin/students/search?q=Mina&department_id=${w.cse.id}`)).body,
    ]);
    expect(dump).not.toContain(u.email);
    expect(dump).not.toContain('8801712345678');
    const role = await UserRole.findOne({ user_id: u._id });
    await admin.delete(`/api/admin/representatives/${role._id}`);
    const entries = await auditList({});
    const assigned = entries.find((e) => e.action === 'representative.assign');
    const removed = entries.find((e) => e.action === 'representative.remove');
    expect(String(assigned.scope_department_id)).toBe(w.cse.id);
    expect(assigned.new_value).toMatchObject({ role: 'cr', via: 'manual' });
    expect(removed).toBeTruthy();
    const mail = await drainMail();
    expect(mail.map((m) => m.subject)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('now CR'),
        expect.stringContaining('removed'),
      ]),
    );
    expect(mail.every((m) => m.to === u.email)).toBe(true);
  });

  it('CRD-09 the owner sees the role on their own profile; a draft or ended role does not show', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const draftSec = await w.section(w.draft, w.cse, 3, 'I');
    const admin = await asDeptAdmin(w.cse);
    const u = await student();
    const d = await student();
    await assign(admin, sec.id, u, 'cr');
    await assign(admin, draftSec.id, d, 'cr');
    const own = await (await loginAs(u, app)).get('/api/me/profile');
    expect(own.body.data.representative).toMatchObject({
      role: 'cr',
      section_name: 'CSE 2-II-A',
      semester_name: 'Fall 2026',
    });
    const draftOwn = await (await loginAs(d, app)).get('/api/me/profile');
    expect(draftOwn.body.data.representative).toBeNull();
    const other = await (await loginAs(await student(), app)).get('/api/me/profile');
    expect(other.body.data.representative).toBeNull();
    const role = await UserRole.findOne({ user_id: u._id });
    await admin.delete(`/api/admin/representatives/${role._id}`);
    const after = await (await loginAs(u, app)).get('/api/me/profile');
    expect(after.body.data.representative).toBeNull();
  });

  it('CRD-10 endRolesOfSemester ends the active roles of that semester only', async () => {
    const w = await world();
    const cur = await w.section(w.current, w.cse, 2, 'II');
    const dr = await w.section(w.draft, w.cse, 3, 'I');
    const admin = await asDeptAdmin(w.cse);
    await assign(admin, cur.id, await student(), 'cr');
    await assign(admin, dr.id, await student(), 'cr');
    expect(await endRolesOfSemester(w.current._id)).toBe(1);
    expect(await reps(cur._id)).toHaveLength(0);
    expect(await reps(dr._id)).toHaveLength(1);
  });

  it('CRD-15 onCrAssigned fires once for a current CR, not for a DCR or a draft CR', async () => {
    const w = await world();
    const cur = await w.section(w.current, w.cse, 2, 'II');
    const dr = await w.section(w.draft, w.cse, 3, 'I');
    const calls = [];
    registerCrAssignedHook(async (s) => calls.push(s.id));
    const admin = await asDeptAdmin(w.cse);
    await assign(admin, cur.id, await student(), 'dcr');
    await assign(admin, dr.id, await student(), 'cr');
    expect(calls).toEqual([]);
    await assign(admin, cur.id, await student(), 'cr');
    expect(calls).toEqual([cur.id]);
  });
});

describe('summary and search', () => {
  it('lists sections without a CR, and searches only eligible students', async () => {
    const w = await world();
    const a = await w.section(w.current, w.cse, 2, 'II', 'A');
    await w.section(w.current, w.cse, 2, 'II', 'B');
    const admin = await asDeptAdmin(w.cse);
    await assign(admin, a.id, await student(), 'cr');
    const res = await admin.get(
      `/api/admin/semesters/${w.current.id}/representatives/summary?department_id=${w.cse.id}`,
    );
    expect(res.body.data.map((r) => [r.name, r.has_cr])).toEqual([
      ['CSE 2-II-A', true],
      ['CSE 2-II-B', false],
    ]);
    await makeUser({ kind: 'student', state: 'graduated', name: 'Zed Grad' });
    await makeUser({ kind: 'student', state: 'active', name: 'Zed Active' });
    await makeUser({ kind: 'teacher', state: 'active', name: 'Zed Teacher' });
    const found = await admin.get('/api/admin/students/search?q=zed');
    expect(found.body.data.map((s) => s.full_name)).toEqual(['Zed Active']);
    expect(found.body.data[0]).toEqual(expect.objectContaining({ uv_id: null }));
    expect((await admin.get('/api/admin/students/search?q=z')).status).toBe(400);
  });
});

describe('permissions', () => {
  it('a department admin is refused for another department; a super admin may act anywhere', async () => {
    const w = await world();
    const eeeSec = await w.section(w.current, w.eee, 2, 'II');
    const cse = await asDeptAdmin(w.cse);
    const u = await student();
    expect((await cse.get(`/api/admin/sections/${eeeSec.id}/representatives`)).status).toBe(403);
    expect((await assign(cse, eeeSec.id, u)).status).toBe(403);
    expect(
      (await cse.post(`/api/admin/sections/${eeeSec.id}/representatives/reappoint`)).status,
    ).toBe(403);
    expect(
      (await cse.get(`/api/admin/students/search?q=ab&department_id=${w.eee.id}`)).status,
    ).toBe(403);
    expect(
      (
        await cse.get(
          `/api/admin/semesters/${w.current.id}/representatives/summary?department_id=${w.eee.id}`,
        )
      ).status,
    ).toBe(403);
    const sup = await asSuper();
    expect((await assign(sup, eeeSec.id, u)).status).toBe(201);
    const role = await UserRole.findOne({ user_id: u._id });
    expect((await cse.delete(`/api/admin/representatives/${role._id}`)).status).toBe(403);
    expect((await sup.delete(`/api/admin/representatives/${role._id}`)).status).toBe(204);
  });

  it('students, CRs, DCRs, teachers, inactive admins and pending teachers are refused on every route', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const target = await student();
    const crUser = await makeUser({
      kind: 'student',
      state: 'active',
      roles: [
        { role: 'cr', department_id: w.cse._id, section_id: sec._id, semester_id: w.current._id },
      ],
    });
    const dcrUser = await makeUser({
      kind: 'student',
      state: 'active',
      roles: [
        { role: 'dcr', department_id: w.cse._id, section_id: sec._id, semester_id: w.current._id },
      ],
    });
    const others = [
      await makeUser({ kind: 'student', state: 'active' }),
      crUser,
      dcrUser,
      await makeUser({
        kind: 'teacher',
        state: 'active',
        roles: [{ role: 'teacher', department_id: w.cse._id }],
      }),
      await makeUser({
        kind: 'staff',
        state: 'deactivated',
        roles: [{ role: 'dept_admin', department_id: w.cse._id }],
      }),
      await makeUser({ kind: 'teacher', state: 'pending' }),
    ];
    const role = await UserRole.create({
      user_id: target._id,
      role: 'dcr',
      department_id: w.cse._id,
      section_id: sec._id,
      semester_id: w.current._id,
      is_representative: true,
    });
    for (const user of others) {
      const agent = await loginAs(user, app);
      const codes = [
        (await agent.get(`/api/admin/sections/${sec.id}/representatives`)).status,
        (await assign(agent, sec.id, target)).status,
        (await agent.post(`/api/admin/sections/${sec.id}/representatives/reappoint`)).status,
        (await agent.delete(`/api/admin/representatives/${role._id}`)).status,
        (await agent.get('/api/admin/students/search?q=ab')).status,
      ];
      expect(codes.every((c) => c === 403 || c === 401)).toBe(true);
    }
    expect(await UserRole.countDocuments({ user_id: target._id, ended_at: null })).toBe(1);
  });
});

describe('concurrency', () => {
  it('two admins assigning a CR at the same moment: exactly one succeeds', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const [a1, a2] = [await asDeptAdmin(w.cse), await asSuper()];
    const [u1, u2] = [await student(), await student()];
    const res = await Promise.all([assign(a1, sec.id, u1, 'cr'), assign(a2, sec.id, u2, 'cr')]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409).body.error.code).toBe('ROLE_LIMIT');
    expect(await UserRole.countDocuments({ section_id: sec._id, role: 'cr', ended_at: null })).toBe(
      1,
    );
  });

  it('three simultaneous DCR assigns with two free slots: two succeed, one ROLE_LIMIT', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const admin = await asDeptAdmin(w.cse);
    const users = [await student(), await student(), await student()];
    const res = await Promise.all(users.map((u) => assign(admin, sec.id, u, 'dcr')));
    expect(res.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    expect(res.find((r) => r.status === 409).body.error.code).toBe('ROLE_LIMIT');
  });

  it('the same student assigned to two sections at once: one 201 and one CONFLICT', async () => {
    const w = await world();
    const s1 = await w.section(w.current, w.cse, 2, 'II', 'A');
    const s2 = await w.section(w.current, w.cse, 2, 'II', 'B');
    const admin = await asDeptAdmin(w.cse);
    const u = await student();
    const res = await Promise.all([assign(admin, s1.id, u, 'dcr'), assign(admin, s2.id, u, 'dcr')]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409).body.error.code).toBe('CONFLICT');
    expect(await UserRole.countDocuments({ user_id: u._id, ended_at: null })).toBe(1);
  });

  it('an assign racing a remove of the same section stays consistent', async () => {
    const w = await world();
    const sec = await w.section(w.current, w.cse, 2, 'II');
    const admin = await asDeptAdmin(w.cse);
    const cr = await student();
    await assign(admin, sec.id, cr, 'cr');
    const role = await UserRole.findOne({ user_id: cr._id });
    const next = await student();
    const [rm, add] = await Promise.all([
      admin.delete(`/api/admin/representatives/${role._id}`),
      assign(admin, sec.id, next, 'cr'),
    ]);
    expect(rm.status).toBe(204);
    expect([201, 409]).toContain(add.status);
    expect(await UserRole.countDocuments({ section_id: sec._id, role: 'cr', ended_at: null })).toBe(
      add.status === 201 ? 1 : 0,
    );
  });
});

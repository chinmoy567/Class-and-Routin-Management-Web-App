import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { liveStatus } from '@crm/shared';
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
import { RoutineSlot, Section, SectionGroup } from '../../routine/index.js';
import { clearAll as clearRoutineCache } from '../../routine/routine-cache.js';
import { Enrolment, UvClaim } from '../../enrolments/index.js';
import { Room } from '../../rooms/index.js';
import { User, UserRole } from '../../auth/index.js';
import { AuditLog } from '../../audit/index.js';
import { getAgenda } from '../../../lib/jobs.js';
import { ReminderLog } from '../cr/reminder.model.js';
import { Flag } from '../cr/flag.model.js';
import { FlagQuota } from '../cr/flag-quota.model.js';
import { countOpenFlags } from '../cr/cr.flags.service.js';

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
  clearRoutineCache();
  // Tuesday 2027-04-06 10:00 in Asia/Dhaka. The current semester runs 4 Apr to 4 Oct 2027.
  fixClock('2027-04-06T04:00:00Z');
});
afterEach(() => {
  resetClock();
  clearRoutineCache();
});

// ── World ─────────────────────────────────────────────────────────────────────

async function addSlot(w, over) {
  return RoutineSlot.create({
    semester_id: w.sem._id,
    owner_department_id: w.dept._id,
    section_id: w.section._id,
    room_id: w.room._id,
    day_of_week: 2, // Tuesday
    start_min: 510,
    end_min: 565,
    course_code: 'CSE-301',
    published: true,
    source: 'manual',
    tba: false,
    version: 1,
    ...over,
  });
}

/**
 * CSE 2-I-A (groups G1 and G2) in the current semester, CSE 2-I-B beside it, and CSE 1-II-A last
 * semester. Today: a whole-section class 8:30–9:25, a G1 lab 10:00–11:30 and a G2 lab 12:00–13:30.
 */
async function world() {
  const dept = await createDepartment({ code: 'CSE' });
  const other = await createDepartment({ code: 'EEE' });
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
  });
  const lastSection = await Section.create({
    semester_id: past._id,
    department_id: dept._id,
    level: 1,
    term: 'II',
    letter: 'A',
  });
  const lastOtherSection = await Section.create({
    semester_id: past._id,
    department_id: dept._id,
    level: 1,
    term: 'II',
    letter: 'B',
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
  const w = {
    dept,
    other,
    past,
    sem,
    lastSection,
    lastOtherSection,
    section,
    sectionB,
    g1,
    g2,
    room,
  };
  await addSlot(w, { course_code: 'CSE-301', start_min: 510, end_min: 565 });
  await addSlot(w, { course_code: 'CSE-422', group_id: g1._id, start_min: 600, end_min: 690 });
  await addSlot(w, { course_code: 'CSE-422', group_id: g2._id, start_min: 720, end_min: 810 });
  return w;
}

const enrol = (user, w, { section = w.section, group = null, status = 'accepted' } = {}) =>
  Enrolment.create({
    user_id: user._id,
    semester_id: w.sem._id,
    section_id: section._id,
    department_id: w.dept._id,
    group_id: group ? group._id : undefined,
    status,
    decided_at: status === 'accepted' ? new Date() : undefined,
  });

const enrolLast = (user, w, section = w.lastSection) =>
  Enrolment.create({
    user_id: user._id,
    semester_id: w.past._id,
    section_id: section._id,
    department_id: w.dept._id,
    status: 'accepted',
    decided_at: new Date(),
  });

const repRole = (user, w, role, section = w.section) =>
  UserRole.create({
    user_id: user._id,
    role,
    section_id: section._id,
    semester_id: w.sem._id,
    department_id: w.dept._id,
  });

/** A complete cast for the section: CR, DCR, roster, unconfirmed students and other people. */
async function cast(w) {
  const cr = await makeUser({ state: 'active', name: 'Karim CR' });
  await repRole(cr, w, 'cr');
  const dcr = await makeUser({ state: 'active', name: 'Rana DCR' });
  await repRole(dcr, w, 'dcr');
  const crB = await makeUser({ state: 'active', name: 'Sadia CR-B' });
  await repRole(crB, w, 'cr', w.sectionB);

  const rosterA = await makeUser({ state: 'active', name: 'Anika Roster' });
  await enrol(rosterA, w, { group: w.g2 });
  await enrolLast(rosterA, w);
  await UvClaim.create({
    user_id: rosterA._id,
    department_id: w.dept._id,
    uv_id_text: '2112345',
    uv_id_norm: '2112345',
    status: 'approved',
  });
  const rosterB = await makeUser({ state: 'active', name: 'Bashir Roster' });
  await enrol(rosterB, w);

  const unconfirmed = await makeUser({ state: 'unconfirmed', name: 'Chandan Due' });
  await enrolLast(unconfirmed, w);
  const notEnrolled = await makeUser({ state: 'unconfirmed', name: 'Dilara Away' });
  await enrolLast(notEnrolled, w);
  await User.updateOne({ _id: notEnrolled._id }, { $set: { not_enrolled_semester_id: w.sem._id } });
  const graduated = await makeUser({ state: 'graduated', name: 'Emon Done' });
  await enrolLast(graduated, w);
  const otherSectionLast = await makeUser({ state: 'unconfirmed', name: 'Farhan Elsewhere' });
  await enrolLast(otherSectionLast, w, w.lastOtherSection);
  const applicant = await makeUser({ state: 'claim_pending', name: 'Gulshan Applicant' });
  await enrol(applicant, w, { status: 'pending' });
  const escalated = await makeUser({ state: 'claim_pending', name: 'Hasan Escalated' });
  await Enrolment.create({
    user_id: escalated._id,
    semester_id: w.sem._id,
    section_id: w.section._id,
    department_id: w.dept._id,
    status: 'pending',
    escalated_at: new Date(),
  });
  const rejected = await makeUser({ state: 'claim_pending', name: 'Imran Rejected' });
  await enrol(rejected, w, { status: 'rejected' });

  const teacher = await makeUser({ kind: 'teacher', state: 'active' });
  const deptAdmin = await makeUser({
    kind: 'staff',
    state: 'active',
    roles: [{ role: 'dept_admin', department_id: w.dept._id }],
  });
  const otherAdmin = await makeUser({
    kind: 'staff',
    state: 'active',
    roles: [{ role: 'dept_admin', department_id: w.other._id }],
  });
  const superAdmin = await makeUser({
    kind: 'staff',
    state: 'active',
    roles: [{ role: 'super_admin' }],
  });
  const plainStudent = await makeUser({ state: 'active', name: 'Jamil Plain' });
  await enrol(plainStudent, w, { group: w.g1 });

  return {
    cr,
    dcr,
    crB,
    rosterA,
    rosterB,
    unconfirmed,
    notEnrolled,
    graduated,
    otherSectionLast,
    applicant,
    escalated,
    rejected,
    teacher,
    deptAdmin,
    otherAdmin,
    superAdmin,
    plainStudent,
  };
}

const overviewPath = (w) => `/api/cr/sections/${w.section.id}/overview`;

// ── CRD-DSH-01, CRD-DSH-02: access ───────────────────────────────────────────

describe('CRD-DSH-01 / CRD-DSH-02 access to the section dashboard', () => {
  it('CRD-DSH-01 the CR of the section opens its overview; my_role says CR', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get(overviewPath(w));
    expect(res.status).toBe(200);
    expect(res.body.data.my_role).toBe('cr');
    expect(res.body.data.section.name).toBe('CSE 2-I-A');
  });

  it('CRD-DSH-01 a DCR of the section opens the same dashboard; my_role says DCR', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.dcr, app)).get(overviewPath(w));
    expect(res.status).toBe(200);
    expect(res.body.data.my_role).toBe('dcr');
  });

  it('CRD-DSH-01 after the admin ends the CR role, the next overview call is 404', async () => {
    const w = await world();
    const c = await cast(w);
    const agent = await loginAs(c.cr, app);
    expect((await agent.get(overviewPath(w))).status).toBe(200);
    await UserRole.updateOne({ user_id: c.cr._id, role: 'cr' }, { $set: { ended_at: new Date() } });
    const res = await agent.get(overviewPath(w));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('CRD-DSH-02 a CR of 2-I-B opening 2-I-A gets 404 and no roster in the body', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.crB, app)).get(overviewPath(w));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Anika Roster');
  });

  it('CRD-DSH-02 a CR of 2-I-A opening the other section 2-I-B gets 404', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get(`/api/cr/sections/${w.sectionB.id}/overview`);
    expect(res.status).toBe(404);
  });

  it('CRD-DSH-01 an active student with no role, a teacher, an unconfirmed student and another dept admin get 404', async () => {
    const w = await world();
    const c = await cast(w);
    for (const user of [c.plainStudent, c.teacher, c.unconfirmed, c.otherAdmin]) {
      const res = await (await loginAs(user, app)).get(overviewPath(w));
      expect(res.status).toBe(404);
    }
  });

  it('CRD-DSH-01 a section of a past semester is 404 even for its own CR', async () => {
    const w = await world();
    const old = await Section.create({
      semester_id: w.past._id,
      department_id: w.dept._id,
      level: 2,
      term: 'I',
      letter: 'Z',
    });
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get(`/api/cr/sections/${old.id}/overview`);
    expect(res.status).toBe(404);
  });

  it('CRD-DSH-01 a department admin of the section department and a super admin may read it', async () => {
    const w = await world();
    const c = await cast(w);
    expect((await (await loginAs(c.deptAdmin, app)).get(overviewPath(w))).status).toBe(200);
    expect((await (await loginAs(c.superAdmin, app)).get(overviewPath(w))).status).toBe(200);
  });

  it('CRD-DSH-01 an anonymous request gets 401', async () => {
    const w = await world();
    const res = await (await loginAs(null, app)).get(overviewPath(w));
    expect(res.status).toBe(401);
  });

  it('CRD-DSH-02 a malformed section id is a validation error', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get('/api/cr/sections/not-an-id/overview');
    expect(res.status).toBe(400);
  });
});

// ── CRD-DSH-03: roster ───────────────────────────────────────────────────────

describe('CRD-DSH-03 roster', () => {
  it('CRD-DSH-03 every accepted student has name, UV ID, group and confirmation', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get(overviewPath(w));
    const roster = res.body.data.roster;
    expect(roster.map((r) => r.name).sort()).toEqual(
      ['Anika Roster', 'Bashir Roster', 'Jamil Plain'].sort(),
    );
    const anika = roster.find((r) => r.name === 'Anika Roster');
    expect(anika).toMatchObject({ uv_id: '2112345', group: 'G2', confirmed: true });
    const bashir = roster.find((r) => r.name === 'Bashir Roster');
    expect(bashir).toMatchObject({ uv_id: null, group: null });
  });

  it('CRD-DSH-03 the roster, unconfirmed list, flags and read-only requests never carry a phone or an email', async () => {
    const w = await world();
    const c = await cast(w);
    await User.updateOne({ _id: c.rosterA._id }, { $set: { phone_enc: 'enc-phone-9999' } });
    const res = await (await loginAs(c.cr, app)).get(overviewPath(w));
    const { join_requests: joinRequests, ...rest } = res.body.data;
    const text = JSON.stringify({ rest, read_only: joinRequests.read_only });
    expect(text).not.toMatch(/@baiust|@gmail|@example|enc-phone|"email"|"phone"/);
    for (const r of res.body.data.roster) {
      expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['email', 'phone']));
    }
  });

  it('CRD-DSH-09 the pending join list keeps spec 10 behaviour: the CR sees the applicant email, never a phone', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get(overviewPath(w));
    const pending = res.body.data.join_requests.pending;
    expect(pending).toHaveLength(1);
    expect(Object.keys(pending[0])).not.toContain('phone');
    expect(JSON.stringify(res.body)).not.toContain('enc-phone');
  });
});

// ── CRD-DSH-04: unconfirmed students and reminders ───────────────────────────

describe('CRD-DSH-04 unconfirmed students', () => {
  it('CRD-DSH-04 lists last semester students and applicants; excludes accepted, not-enrolled and graduated', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get(overviewPath(w));
    const names = res.body.data.unconfirmed.map((u) => u.name);
    expect(names).toContain('Chandan Due');
    expect(names).toContain('Gulshan Applicant');
    expect(names).toContain('Hasan Escalated');
    expect(names).not.toContain('Anika Roster'); // accepted this semester
    expect(names).not.toContain('Dilara Away'); // chose "not enrolled"
    expect(names).not.toContain('Emon Done'); // graduated
    expect(names).not.toContain('Farhan Elsewhere'); // was in another section
  });

  it('CRD-DSH-04 only a student in state unconfirmed can be reminded; an applicant is not', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get(overviewPath(w));
    const byName = (n) => res.body.data.unconfirmed.find((u) => u.name === n);
    expect(byName('Chandan Due').can_remind).toBe(true);
    expect(byName('Gulshan Applicant').can_remind).toBe(false);
    expect(byName('Gulshan Applicant').applied).toBe(true);
  });

  it('CRD-DSH-04 the CR sends a reminder: 202, one reminder row, one email queued, audited', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (
      await loginAs(c.cr, app)
    )
      .post(`/api/cr/sections/${w.section.id}/reminders`)
      .send({ student_id: String(c.unconfirmed._id) });
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({
      student_id: String(c.unconfirmed._id),
      date: '2027-04-06',
    });
    expect(await ReminderLog.countDocuments({ student_id: c.unconfirmed._id })).toBe(1);
    const jobs = await getAgenda().jobs({
      name: 'email.send',
      'data.template': 'semester_update_reminder',
    });
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    const audit = await AuditLog.find({ action: 'cr.reminder' }).lean();
    expect(audit).toHaveLength(1);
    expect(String(audit[0].actor_id)).toBe(String(c.cr._id));
    expect(audit[0].at).toBeTruthy();
  });

  it('CRD-DSH-04 the CR and the DCR reminding the same student on the same day: the second gets 429', async () => {
    const w = await world();
    const c = await cast(w);
    const path = `/api/cr/sections/${w.section.id}/reminders`;
    const body = { student_id: String(c.unconfirmed._id) };
    expect((await (await loginAs(c.cr, app)).post(path).send(body)).status).toBe(202);
    const second = await (await loginAs(c.dcr, app)).post(path).send(body);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
  });

  it('CRD-DSH-04 CR and DCR reminding the same student at the same moment: exactly one 202', async () => {
    const w = await world();
    const c = await cast(w);
    const path = `/api/cr/sections/${w.section.id}/reminders`;
    const body = { student_id: String(c.unconfirmed._id) };
    const agents = [await loginAs(c.cr, app), await loginAs(c.dcr, app)];
    const results = await Promise.all(agents.map((a) => a.post(path).send(body)));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([202, 429]);
    expect(await ReminderLog.countDocuments({ student_id: c.unconfirmed._id })).toBe(1);
  });

  it('CRD-DSH-04 a reminder to an applicant is 409, to a student of another section is 404', async () => {
    const w = await world();
    const c = await cast(w);
    const agent = await loginAs(c.cr, app);
    const applicant = await agent
      .post(`/api/cr/sections/${w.section.id}/reminders`)
      .send({ student_id: String(c.applicant._id) });
    expect(applicant.status).toBe(409);
    const elsewhere = await agent
      .post(`/api/cr/sections/${w.section.id}/reminders`)
      .send({ student_id: String(c.otherSectionLast._id) });
    expect(elsewhere.status).toBe(404);
  });

  it('CRD-DSH-04 a department admin of the section department may send a reminder too (permissions table)', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (
      await loginAs(c.deptAdmin, app)
    )
      .post(`/api/cr/sections/${w.section.id}/reminders`)
      .send({ student_id: String(c.unconfirmed._id) });
    expect(res.status).toBe(202);
  });

  it('CRD-DSH-04 a DCR of another section cannot remind a student of this section (404)', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (
      await loginAs(c.crB, app)
    )
      .post(`/api/cr/sections/${w.section.id}/reminders`)
      .send({ student_id: String(c.unconfirmed._id) });
    expect(res.status).toBe(404);
    expect(await ReminderLog.countDocuments({})).toBe(0);
  });
});

// ── CRD-DSH-05, CRD-DSH-06: routine and live status ──────────────────────────

describe('CRD-DSH-05 / CRD-DSH-06 section routine and live status', () => {
  it('CRD-DSH-05 the section routine starts with today and carries every group block', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get(`/api/cr/sections/${w.section.id}/routine`);
    expect(res.status).toBe(200);
    const { section, groups } = res.body.data;
    expect(section.today).toBe('2027-04-06');
    expect(section.days[0].date).toBe('2027-04-06');
    expect(section.days[0].slots.map((s) => s.course_code).sort()).toEqual([
      'CSE-301',
      'CSE-422',
      'CSE-422',
    ]);
    expect(groups.map((g) => g.label)).toEqual(['G1', 'G2']);
  });

  it('CRD-DSH-06 in a lab period for G1 only: G1 is in class, G2 is free, the section is in class', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get(`/api/cr/sections/${w.section.id}/routine`);
    const now = Date.parse('2027-04-06T04:00:00Z'); // 10:00 Dhaka
    const { section, groups } = res.body.data;
    const g1 = groups.find((g) => g.label === 'G1').routine;
    const g2 = groups.find((g) => g.label === 'G2').routine;
    expect(liveStatus(g1, now).kind).toBe('in_class');
    expect(liveStatus(g2, now).kind).toBe('free');
    expect(liveStatus(section, now).kind).toBe('in_class');
  });

  it('CRD-DSH-02 the routine of another section is 404 for this CR', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.cr, app)).get(`/api/cr/sections/${w.sectionB.id}/routine`);
    expect(res.status).toBe(404);
  });
});

// ── CRD-DSH-08, CRD-DSH-09, CRD-DSH-10, CRD-DSH-13: monitoring and acting ────

describe('CRD-DSH-09 join request inbox', () => {
  it('CRD-DSH-09 pending requests are listed for the CR; escalated and rejected ones are read-only', async () => {
    const w = await world();
    const c = await cast(w);
    const data = (await (await loginAs(c.cr, app)).get(overviewPath(w))).body.data;
    expect(data.join_requests.pending.map((p) => p.full_name)).toEqual(['Gulshan Applicant']);
    const readOnly = data.join_requests.read_only.map((p) => [p.full_name, p.status, p.escalated]);
    expect(readOnly).toEqual(
      expect.arrayContaining([
        ['Hasan Escalated', 'pending', true],
        ['Imran Rejected', 'rejected', false],
      ]),
    );
  });

  it('CRD-DSH-09 the CR rejects an applicant through the spec 10 endpoint; the inbox moves them to read-only', async () => {
    const w = await world();
    const c = await cast(w);
    const agent = await loginAs(c.cr, app);
    const enrolment = await Enrolment.findOne({
      user_id: c.applicant._id,
      status: 'pending',
    }).lean();
    const res = await agent
      .post(`/api/enrolments/${enrolment._id}/decision`)
      .send({ decision: 'reject', reason: 'Not in this section' });
    expect(res.status).toBe(200);
    const data = (await agent.get(overviewPath(w))).body.data;
    expect(data.join_requests.pending).toHaveLength(0);
    expect(data.join_requests.read_only.map((p) => p.full_name)).toContain('Gulshan Applicant');
  });
});

describe('CRD-DSH-10 change group', () => {
  it('CRD-DSH-10 the CR changes a roster student to G1; the change is audited with old and new group', async () => {
    const w = await world();
    const c = await cast(w);
    const agent = await loginAs(c.cr, app);
    const roster = (await agent.get(overviewPath(w))).body.data.roster;
    const anika = roster.find((r) => r.name === 'Anika Roster');
    const res = await agent
      .patch(`/api/enrolments/${anika.enrolment_id}/group`)
      .send({ group_id: String(w.g1._id) });
    expect(res.status).toBe(200);
    const updated = (await agent.get(overviewPath(w))).body.data.roster.find(
      (r) => r.name === 'Anika Roster',
    );
    expect(updated.group).toBe('G1');
    const audit = await AuditLog.findOne({ action: 'join.group_change' }).lean();
    expect(audit.old_value).toEqual({ group_id: String(w.g2._id) });
    expect(audit.new_value).toMatchObject({ group_id: String(w.g1._id), set_by: 'cr' });
  });
});

describe('CRD-DSH-08 / CRD-DSH-13 flags', () => {
  const flagPath = (w) => `/api/cr/sections/${w.section.id}/flags`;
  const goodFlag = (over = {}) => ({
    category: 'wrong_group',
    description: 'Imran is in G1 but sits in G2 labs',
    ...over,
  });

  it('CRD-DSH-08 the flag list shows the status and the admin reply, for this section and semester only', async () => {
    const w = await world();
    const c = await cast(w);
    const created = await (await loginAs(c.cr, app)).post(flagPath(w)).send(goodFlag());
    expect(created.status).toBe(201);
    await Flag.updateOne(
      { _id: created.body.data.id },
      { $set: { status: 'fixed', reply: 'Moved to G2', resolved_at: new Date() } },
    );
    const data = (await (await loginAs(c.cr, app)).get(overviewPath(w))).body.data;
    expect(data.flags).toHaveLength(1);
    expect(data.flags[0]).toMatchObject({
      status: 'fixed',
      reply: 'Moved to G2',
      raised_by_me: true,
    });
  });

  it('CRD-DSH-13 a flag stays visible to the remaining DCR after the CR loses the role', async () => {
    const w = await world();
    const c = await cast(w);
    await (await loginAs(c.cr, app)).post(flagPath(w)).send(goodFlag());
    await UserRole.updateOne({ user_id: c.cr._id, role: 'cr' }, { $set: { ended_at: new Date() } });
    const data = (await (await loginAs(c.dcr, app)).get(overviewPath(w))).body.data;
    expect(data.flags).toHaveLength(1);
    expect(data.flags[0].raised_by_me).toBe(false);
    expect(data.counts.open_flags).toBe(1);
  });
});

// ── CRD-DSH-11, CRD-DSH-12: raising flags ────────────────────────────────────

describe('CRD-DSH-11 / CRD-DSH-12 raising a flag', () => {
  const flagPath = (w) => `/api/cr/sections/${w.section.id}/flags`;
  const goodFlag = (over = {}) => ({
    category: 'routine_mistake',
    description: 'The G2 lab is shown on Thursday',
    ...over,
  });

  it('CRD-DSH-11 a flag is created open, with the category and a roster student', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (
      await loginAs(c.cr, app)
    )
      .post(flagPath(w))
      .send(goodFlag({ category: 'wrong_section', student_id: String(c.rosterA._id) }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      category: 'wrong_section',
      status: 'open',
      student_id: String(c.rosterA._id),
    });
    expect(await Flag.countDocuments({ section_id: w.section._id })).toBe(1);
  });

  it('CRD-DSH-11 the 6th flag in a day gets 429 FLAG_LIMIT', async () => {
    const w = await world();
    const c = await cast(w);
    const agent = await loginAs(c.cr, app);
    for (let i = 0; i < 5; i++) {
      expect((await agent.post(flagPath(w)).send(goodFlag())).status).toBe(201);
    }
    const sixth = await agent.post(flagPath(w)).send(goodFlag());
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('FLAG_LIMIT');
    expect(await Flag.countDocuments({})).toBe(5);
  });

  it('CRD-DSH-11 seven flags sent at the same moment: exactly five are created', async () => {
    const w = await world();
    const c = await cast(w);
    const agent = await loginAs(c.cr, app);
    const results = await Promise.all(
      Array.from({ length: 7 }, () => agent.post(flagPath(w)).send(goodFlag())),
    );
    const codes = results.map((r) => r.status);
    expect(codes.filter((s) => s === 201)).toHaveLength(5);
    expect(codes.filter((s) => s === 429)).toHaveLength(2);
    expect(await Flag.countDocuments({})).toBe(5);
    expect((await FlagQuota.findOne({ user_id: c.cr._id }).lean()).count).toBe(5);
  });

  it('CRD-DSH-11 the limit is per CR/DCR: a DCR still has their own five', async () => {
    const w = await world();
    const c = await cast(w);
    const agent = await loginAs(c.cr, app);
    for (let i = 0; i < 5; i++) await agent.post(flagPath(w)).send(goodFlag());
    const dcrRes = await (await loginAs(c.dcr, app)).post(flagPath(w)).send(goodFlag());
    expect(dcrRes.status).toBe(201);
  });

  it('CRD-DSH-11 a description of 9 or 1,001 characters is a validation error', async () => {
    const w = await world();
    const c = await cast(w);
    const agent = await loginAs(c.cr, app);
    const short = await agent.post(flagPath(w)).send(goodFlag({ description: '123456789' }));
    expect(short.status).toBe(400);
    expect(short.body.error.fields.description).toBeTruthy();
    const long = await agent.post(flagPath(w)).send(goodFlag({ description: 'x'.repeat(1001) }));
    expect(long.status).toBe(400);
  });

  it('CRD-DSH-11 an unknown category, or a student not on the roster, is a validation error', async () => {
    const w = await world();
    const c = await cast(w);
    const agent = await loginAs(c.cr, app);
    expect((await agent.post(flagPath(w)).send(goodFlag({ category: 'bogus' }))).status).toBe(400);
    const outsider = await agent
      .post(flagPath(w))
      .send(goodFlag({ student_id: String(c.unconfirmed._id) }));
    expect(outsider.status).toBe(400);
    expect(outsider.body.error.fields.student_id).toBeTruthy();
  });

  it('CRD-DSH-11 only the CR or DCR raises a flag: the department admin gets 404', async () => {
    const w = await world();
    const c = await cast(w);
    const res = await (await loginAs(c.deptAdmin, app)).post(flagPath(w)).send(goodFlag());
    expect(res.status).toBe(404);
  });

  it('CRD-DSH-12 raising a flag writes an audit entry with who and when', async () => {
    const w = await world();
    const c = await cast(w);
    await (await loginAs(c.cr, app)).post(flagPath(w)).send(goodFlag());
    const entry = await AuditLog.findOne({ action: 'cr.flag_raise' }).lean();
    expect(String(entry.actor_id)).toBe(String(c.cr._id));
    expect(entry.at).toBeTruthy();
    expect(entry.target_type).toBe('flag');
  });

  it('spec 15 digest: open flags of the department are counted for its admins', async () => {
    const w = await world();
    const c = await cast(w);
    await (await loginAs(c.cr, app)).post(flagPath(w)).send(goodFlag());
    expect(await countOpenFlags({ departmentIds: [String(w.dept._id)] })).toBe(1);
    expect(await countOpenFlags({ departmentIds: [String(w.other._id)] })).toBe(0);
    expect(await countOpenFlags({ departmentIds: null })).toBe(1);
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import {
  buildTestApp,
  clearDb,
  clearOutbox,
  connectTestDb,
  disconnectTestDb,
  drainMail,
  fixClock,
  loginAs,
  resetClock,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { User, UserRole } from '../../auth/index.js';
import { Semester } from '../../organisation/index.js';
import { Section, SectionGroup } from '../../routine/index.js';
import { Enrolment, UvClaim } from '../../enrolments/index.js';
import { list as auditList } from '../../audit/index.js';
import {
  escalateStaleRequests,
  registerJoinAcceptedHook,
  resetJoinAcceptedHooks,
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
afterEach(() => {
  resetClock();
  resetJoinAcceptedHooks();
});

const ID_A = '0822310205101077';
const ID_B = '822310205101077';

/** A current semester, two departments, and CSE 2-II-A with a CR and a DCR. */
async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const eee = await createDepartment({ code: 'EEE' });
  const current = await Semester.create({
    name: 'Fall 2026',
    status: 'current',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
  });
  const section = async (dept, letter = 'A', term = 'II') =>
    Section.create({
      semester_id: current._id,
      department_id: dept._id,
      level: 2,
      term,
      letter,
    });
  const rep = (sec, dept, role) =>
    makeUser({
      kind: 'student',
      state: 'active',
      name: `${role.toUpperCase()} of ${sec.letter}`,
      roles: [
        {
          role,
          department_id: dept._id,
          section_id: sec._id,
          semester_id: current._id,
          is_representative: true,
        },
      ],
    });
  const secA = await section(cse, 'A');
  const cr = await rep(secA, cse, 'cr');
  const dcr = await rep(secA, cse, 'dcr');
  return { cse, eee, current, section, rep, secA, cr, dcr };
}

const student = (extra = {}) =>
  makeUser({ kind: 'student', state: 'claim_pending', name: 'Rahim Uddin', ...extra });
const as = (user) => loginAs(user, app);
const asAdmin = async (dept) =>
  as(await makeUser({ kind: 'staff', roles: [{ role: 'dept_admin', department_id: dept._id }] }));
const join = (agent, sectionId, extra = {}) =>
  agent.post('/api/enrolments').send({ section_id: String(sectionId), uv_id: ID_A, ...extra });
const decide = (agent, id, body) => agent.post(`/api/enrolments/${id}/decision`).send(body);
const accept = (agent, id, extra = {}) => decide(agent, id, { decision: 'accept', ...extra });
const reject = (agent, id, reason = 'Not in this batch') =>
  decide(agent, id, { decision: 'reject', reason });
const makeGroup = (sec, label) => SectionGroup.create({ section_id: sec._id, label });

/** A student with a pending request in `sec`. */
async function applicant(w, sec = w.secA, uv = ID_A, extra = {}) {
  const user = await student(extra);
  const agent = await as(user);
  const res = await join(agent, sec._id, { uv_id: uv });
  expect(res.status).toBe(201);
  return { user, agent, id: res.body.data.id };
}

describe('the join form (JR-01 to JR-04)', () => {
  it('JR-03 options list open sections with groups and mark departments still setting up', async () => {
    const w = await world();
    await makeGroup(w.secA, 'G1');
    await w.section(w.cse, 'B'); // no CR: not open
    const agent = await as(await student());
    const res = await agent.get('/api/join/options');
    expect(res.status).toBe(200);
    const cse = res.body.data.departments.find((d) => d.code === 'CSE');
    const eee = res.body.data.departments.find((d) => d.code === 'EEE');
    expect(cse.setting_up).toBe(false);
    expect(cse.sections.map((s) => s.label)).toEqual(['2-II-A']);
    expect(cse.sections[0].groups.map((g) => g.label)).toEqual(['G1']);
    expect(eee.setting_up).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/@baiust/);
  });

  it('JR-01 a claim_pending student sends a request with name, UV ID and group', async () => {
    const w = await world();
    const g = await makeGroup(w.secA, 'G1');
    const user = await student({ name: 'Old Name' });
    const agent = await as(user);
    const res = await join(agent, w.secA._id, {
      full_name: 'Rahim Uddin',
      group_id: String(g._id),
    });
    expect(res.status).toBe(201);
    const e = await Enrolment.findById(res.body.data.id).lean();
    expect(e.status).toBe('pending');
    expect(String(e.group_id)).toBe(String(g._id));
    expect(String(e.department_id)).toBe(String(w.cse._id));
    const claim = await UvClaim.findById(e.uv_claim_id).lean();
    expect(claim).toMatchObject({ status: 'pending', uv_id_text: ID_A, uv_id_norm: ID_B });
    expect((await User.findById(user._id).lean()).full_name).toBe('Rahim Uddin');
  });

  it('JR-01 a UV ID is required until a claim is approved, and must be 1 to 20 digits', async () => {
    const w = await world();
    const agent = await as(await student());
    const none = await agent.post('/api/enrolments').send({ section_id: String(w.secA._id) });
    expect(none.status).toBe(400);
    expect(none.body.error.fields.uv_id).toBeTruthy();
    const bad = await join(agent, w.secA._id, { uv_id: '12ab' });
    expect(bad.status).toBe(400);
  });

  it('JR-01 an unconfirmed student with an approved UV ID needs no UV ID and can join again', async () => {
    const w = await world();
    const user = await makeUser({ kind: 'student', state: 'unconfirmed' });
    await UvClaim.create({
      user_id: user._id,
      department_id: w.cse._id,
      uv_id_text: ID_A,
      uv_id_norm: ID_B,
      status: 'approved',
    });
    const agent = await as(user);
    const res = await agent.post('/api/enrolments').send({ section_id: String(w.secA._id) });
    expect(res.status).toBe(201);
    expect((await Enrolment.findById(res.body.data.id).lean()).uv_claim_id).toBeUndefined();
    expect((await accept(await as(w.cr), res.body.data.id)).status).toBe(200);
    expect((await User.findById(user._id).lean()).state).toBe('active');
  });

  it('JR-01 a group of another section is refused, and a closed section returns SECTION_CLOSED', async () => {
    const w = await world();
    const closed = await w.section(w.cse, 'B');
    const other = await makeGroup(closed, 'X1');
    const agent = await as(await student());
    expect((await join(agent, w.secA._id, { group_id: String(other._id) })).status).toBe(400);
    const res = await join(agent, closed._id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SECTION_CLOSED');
  });

  it('JR-02 only one pending request; withdraw frees the slot', async () => {
    const w = await world();
    const a = await applicant(w);
    const second = await join(a.agent, w.secA._id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REQUEST_ALREADY_OPEN');
    const out = await a.agent.post(`/api/enrolments/${a.id}/withdraw`);
    expect(out.status).toBe(200);
    expect(await UvClaim.countDocuments({ user_id: a.user._id })).toBe(0);
    expect((await join(a.agent, w.secA._id)).status).toBe(201);
    const again = await a.agent.post(`/api/enrolments/${a.id}/withdraw`);
    expect(again.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('JR-02 two requests at the same moment: one 201, one REQUEST_ALREADY_OPEN', async () => {
    const w = await world();
    const agent = await as(await student());
    const results = await Promise.all([join(agent, w.secA._id), join(agent, w.secA._id)]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409]);
    expect(await Enrolment.countDocuments({ status: 'pending' })).toBe(1);
  });

  it('JR-04 an active student gets STATE_NOT_ALLOWED; teachers and admins are refused', async () => {
    const w = await world();
    const active = await as(await makeUser({ kind: 'student', state: 'active' }));
    const res = await join(active, w.secA._id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
    const teacher = await as(await makeUser({ kind: 'teacher', state: 'active' }));
    expect((await join(teacher, w.secA._id)).status).toBe(403);
    expect((await (await asAdmin(w.cse)).get('/api/join/options')).status).toBe(403);
  });

  it('JR-01 a student not signed in is refused', async () => {
    const res = await (await loginAs(null, app)).get('/api/join/options');
    expect(res.status).toBe(401);
  });

  it('JR-13 the request is audited', async () => {
    const w = await world();
    const a = await applicant(w);
    const log = await auditList({ action: 'join.request' });
    expect(log).toHaveLength(1);
    expect(String(log[0].actor_id)).toBe(String(a.user._id));
  });
});

describe('UV ID rules (JR-06 to JR-08)', () => {
  it('JR-06 an ID approved for another account is refused and the admin is told; a pending claim reserves nothing', async () => {
    const w = await world();
    const admin = await makeUser({
      kind: 'staff',
      roles: [{ role: 'dept_admin', department_id: w.cse._id }],
    });
    const a = await applicant(w);
    // B's pending claim for the same ID is allowed while A is only pending.
    const b = await student();
    expect((await join(await as(b), w.secA._id, { uv_id: ID_B })).status).toBe(201);
    expect((await accept(await as(w.cr), a.id)).status).toBe(200);
    clearOutbox();
    const c = await as(await student());
    const res = await join(c, w.secA._id, { uv_id: ID_B });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UV_ID_TAKEN');
    const mail = await drainMail();
    expect(mail.some((m) => m.to === admin.email && /UV ID claim/.test(m.subject))).toBe(true);
  });

  it('JR-07 and [PRD] two pending claims for the same ID both show the duplicate badge', async () => {
    const w = await world();
    await applicant(w, w.secA, ID_A);
    await applicant(w, w.secA, ID_B);
    const res = await (
      await as(w.cr)
    ).get(`/api/sections/${w.secA.id}/join-requests?status=pending`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((r) => r.duplicate_pending_claim === true)).toBe(true);
  });

  it('JR-07 a unique pending claim has no badge', async () => {
    const w = await world();
    await applicant(w, w.secA, ID_A);
    await applicant(w, w.secA, '999');
    const res = await (await as(w.cr)).get(`/api/sections/${w.secA.id}/join-requests`);
    expect(res.body.data.some((r) => r.duplicate_pending_claim)).toBe(false);
  });

  it('JR-08 the fifth rejection blocks claims for 24 hours, then the count starts again', async () => {
    const w = await world();
    fixClock('2026-08-01T06:00:00Z');
    const user = await student();
    const agent = await as(user);
    const cr = await as(w.cr);
    for (let i = 0; i < 5; i += 1) {
      const sent = await join(agent, w.secA._id, { uv_id: `70${i}` });
      expect(sent.status).toBe(201);
      expect((await reject(cr, sent.body.data.id)).status).toBe(200);
    }
    const blocked = await join(agent, w.secA._id, { uv_id: '799' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('CLAIM_BLOCKED');
    expect(new Date(blocked.body.error.blocked_until).toISOString()).toBe(
      '2026-08-02T06:00:00.000Z',
    );
    fixClock('2026-08-02T06:00:01Z');
    expect((await join(agent, w.secA._id, { uv_id: '799' })).status).toBe(201);
    expect((await User.findById(user._id).lean()).claim_rejections.count).toBe(0);
  });
});

describe('deciding (JR-09 to JR-12)', () => {
  it('JR-09 the CR sees name, email, photo field, UV ID, section and requested group', async () => {
    const w = await world();
    const g = await makeGroup(w.secA, 'G2');
    const user = await student({ name: 'Karim Ali' });
    await join(await as(user), w.secA._id, { group_id: String(g._id) });
    const res = await (await as(w.cr)).get(`/api/sections/${w.secA.id}/join-requests`);
    const row = res.body.data[0];
    expect(row).toMatchObject({
      full_name: 'Karim Ali',
      email: user.email,
      uv_id: ID_A,
      department: 'CSE',
      section: { level: 2, term: 'II', letter: 'A' },
      group: { label: 'G2' },
    });
    expect(row).toHaveProperty('photo_url');
  });

  it('JR-09 the admin list for the same section never carries an email', async () => {
    const w = await world();
    await applicant(w);
    const res = await (await asAdmin(w.cse)).get(`/api/sections/${w.secA.id}/join-requests`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/@baiust/);
  });

  it('JR-11 and [PRD] accepting makes the student active with an enrolment, group and approved claim', async () => {
    const w = await world();
    const g1 = await makeGroup(w.secA, 'G1');
    const g2 = await makeGroup(w.secA, 'G2');
    const a = await applicant(w);
    await Enrolment.updateOne({ _id: a.id }, { group_id: g1._id });
    const seen = [];
    registerJoinAcceptedHook(async (info) => seen.push(info));
    const res = await accept(await as(w.cr), a.id, { group_id: String(g2._id) });
    expect(res.status).toBe(200);
    const e = await Enrolment.findById(a.id).lean();
    expect(e).toMatchObject({ status: 'accepted', group_set_by: 'cr' });
    expect(String(e.group_id)).toBe(String(g2._id));
    const u = await User.findById(a.user._id).lean();
    expect(u.state).toBe('active');
    expect(String(u.confirmed_semester_id)).toBe(String(w.current._id));
    expect(String(u.department_id)).toBe(String(w.cse._id));
    expect((await UvClaim.findById(e.uv_claim_id).lean()).status).toBe('approved');
    expect(seen).toEqual([
      {
        user_id: String(a.user._id),
        section_id: w.secA.id,
        semester_id: String(w.current._id),
        group_id: String(g2._id),
      },
    ]);
    const mail = await drainMail();
    expect(mail.some((m) => m.to === a.user.email && /joined/.test(m.subject))).toBe(true);
    const actions = (await auditList({})).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['join.accept', 'uv_claim.approve']));
  });

  it('JR-11 without a corrected group the requested group is kept', async () => {
    const w = await world();
    const g1 = await makeGroup(w.secA, 'G1');
    const user = await student();
    const sent = await join(await as(user), w.secA._id, { group_id: String(g1._id) });
    await accept(await as(w.cr), sent.body.data.id);
    const e = await Enrolment.findById(sent.body.data.id).lean();
    expect(String(e.group_id)).toBe(String(g1._id));
    expect(e.group_set_by).toBeUndefined();
  });

  it('JR-11 and [PRD] accepting A rejects B (same ID) automatically and tells the admin', async () => {
    const w = await world();
    const admin = await makeUser({
      kind: 'staff',
      roles: [{ role: 'dept_admin', department_id: w.cse._id }],
    });
    const a = await applicant(w, w.secA, ID_A);
    const b = await applicant(w, w.secA, ID_B);
    expect((await accept(await as(w.cr), a.id)).status).toBe(200);
    const rowB = await Enrolment.findById(b.id).lean();
    expect(rowB).toMatchObject({ status: 'rejected', reason: 'ID approved for another account' });
    expect((await UvClaim.findById(rowB.uv_claim_id).lean()).status).toBe('rejected');
    expect((await User.findById(b.user._id).lean()).state).toBe('claim_pending');
    // an automatic rejection is not a decider's rejection
    expect((await User.findById(b.user._id).lean()).claim_rejections?.count ?? 0).toBe(0);
    const mail = await drainMail();
    expect(mail.some((m) => m.to === admin.email && /UV ID claim/.test(m.subject))).toBe(true);
    expect(mail.some((m) => m.to === b.user.email && /not accepted/.test(m.subject))).toBe(true);
  });

  it('JR-10 CR and DCR accepting at the same moment: one 200, one ALREADY_DECIDED', async () => {
    const w = await world();
    const a = await applicant(w);
    const [cr, dcr] = [await as(w.cr), await as(w.dcr)];
    const results = await Promise.all([accept(cr, a.id), accept(dcr, a.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const lost = results.find((r) => r.status === 409);
    expect(lost.body.error.code).toBe('ALREADY_DECIDED');
    expect(await Enrolment.countDocuments({ status: 'accepted' })).toBe(1);
  });

  it('JR-10 a second decision after the first returns ALREADY_DECIDED', async () => {
    const w = await world();
    const a = await applicant(w);
    expect((await reject(await as(w.cr), a.id)).status).toBe(200);
    const res = await accept(await as(w.dcr), a.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('JR-10 a rejection reason must be 5 to 500 characters', async () => {
    const w = await world();
    const a = await applicant(w);
    const cr = await as(w.cr);
    expect((await reject(cr, a.id, 'no')).status).toBe(400);
    expect((await reject(cr, a.id, 'x'.repeat(501))).status).toBe(400);
    expect((await decide(cr, a.id, { decision: 'reject' })).status).toBe(400);
  });

  it('JR-12 rejecting keeps the student waiting, emails the reason and lists it for the admin', async () => {
    const w = await world();
    const a = await applicant(w);
    expect((await reject(await as(w.cr), a.id, 'Wrong batch')).status).toBe(200);
    expect((await User.findById(a.user._id).lean()).state).toBe('claim_pending');
    const mail = await drainMail();
    const m = mail.find((x) => x.to === a.user.email);
    expect(m.text).toContain('Wrong batch');
    const list = await (await asAdmin(w.cse)).get('/api/admin/join-requests?view=rejected');
    expect(list.body.data.map((r) => r.id)).toEqual([a.id]);
    expect(list.body.data[0].reason).toBe('Wrong batch');
    expect(JSON.stringify(list.body)).not.toMatch(/@baiust/);
  });

  it('JR-11 two accepts of the same UV ID in different sections: one 200, one UV_ID_TAKEN', async () => {
    const w = await world();
    const secB = await w.section(w.cse, 'B');
    const crB = await w.rep(secB, w.cse, 'cr');
    const a = await applicant(w, w.secA, ID_A);
    const b = await applicant(w, secB, ID_B);
    const results = await Promise.all([accept(await as(w.cr), a.id), accept(await as(crB), b.id)]);
    const statuses = results.map((r) => r.status).sort();
    // The second transaction either sees the first's auto-rejection or hits the unique index.
    expect(statuses[0]).toBe(200);
    expect([409]).toContain(statuses[1]);
    expect(await UvClaim.countDocuments({ status: 'approved' })).toBe(1);
  });
});

describe('who may decide (cross-scope refusals)', () => {
  it('a CR of another section gets 404 on the list and on the decision', async () => {
    const w = await world();
    const secB = await w.section(w.cse, 'B');
    const crB = await as(await w.rep(secB, w.cse, 'cr'));
    const a = await applicant(w);
    const list = await crB.get(`/api/sections/${w.secA.id}/join-requests`);
    expect(list.status).toBe(404);
    expect((await accept(crB, a.id)).status).toBe(404);
    expect((await crB.patch(`/api/enrolments/${a.id}/group`).send({ group_id: null })).status).toBe(
      404,
    );
  });

  it('an admin of another department gets 403; a student and a teacher get 403', async () => {
    const w = await world();
    const a = await applicant(w);
    const eeeAdmin = await asAdmin(w.eee);
    expect((await eeeAdmin.get(`/api/sections/${w.secA.id}/join-requests`)).status).toBe(403);
    expect((await accept(eeeAdmin, a.id)).status).toBe(403);
    const other = await as(await makeUser({ kind: 'student', state: 'active' }));
    expect((await accept(other, a.id)).status).toBe(403);
    expect((await other.get(`/api/sections/${w.secA.id}/join-requests`)).status).toBe(403);
    const teacher = await as(await makeUser({ kind: 'teacher', state: 'active' }));
    expect((await accept(teacher, a.id)).status).toBe(403);
    // an applicant cannot decide their own request
    expect((await accept(a.agent, a.id)).status).toBe(403);
    expect((await Enrolment.findById(a.id).lean()).status).toBe('pending');
  });

  it('a suspended or deactivated admin is refused', async () => {
    const w = await world();
    const a = await applicant(w);
    const off = await as(
      await makeUser({
        kind: 'staff',
        state: 'deactivated',
        roles: [{ role: 'dept_admin', department_id: w.cse._id }],
      }),
    );
    // A deactivated account cannot even hold a session.
    expect([401, 403]).toContain((await accept(off, a.id)).status);
  });

  it('a super admin can decide in any department; malformed ids return 400', async () => {
    const w = await world();
    const a = await applicant(w);
    const sup = await as(await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] }));
    expect((await accept(sup, a.id)).status).toBe(200);
    expect((await sup.get('/api/sections/not-an-id/join-requests')).status).toBe(400);
    expect((await accept(sup, 'f'.repeat(24))).status).toBe(404);
  });

  it('an operator-injected body is rejected by Zod', async () => {
    const w = await world();
    const a = await applicant(w);
    const cr = await as(w.cr);
    expect((await decide(cr, a.id, { decision: { $ne: 'x' } })).status).toBe(400);
    expect((await decide(cr, a.id, { decision: 'accept', status: 'accepted' })).status).toBe(400);
  });
});

describe('escalation (JR-14, JR-15)', () => {
  const age = (id, hours) =>
    mongoose.connection.db
      .collection('enrolment')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $set: { created_at: new Date(Date.now() - hours * 3600_000) } },
      );

  it('JR-14 after 72 hours the request is escalated: the CR gets 403, the admin decides', async () => {
    const w = await world();
    const fresh = await applicant(w, w.secA, '111');
    const stale = await applicant(w, w.secA, '222');
    await age(stale.id, 73);
    expect(await escalateStaleRequests()).toBe(1);
    expect(await escalateStaleRequests()).toBe(0); // idempotent
    expect((await Enrolment.findById(fresh.id).lean()).escalated_at).toBeUndefined();
    const cr = await as(w.cr);
    const denied = await accept(cr, stale.id);
    expect(denied.status).toBe(403);
    const crList = await cr.get(`/api/sections/${w.secA.id}/join-requests`);
    expect(crList.body.data.map((r) => r.id)).toEqual([fresh.id]);
    const admin = await asAdmin(w.cse);
    const card = await admin.get('/api/admin/join-requests?view=escalated');
    expect(card.body.data.map((r) => r.id)).toEqual([stale.id]);
    const adminList = await admin.get(`/api/sections/${w.secA.id}/join-requests`);
    expect(adminList.body.data).toHaveLength(2);
    expect((await accept(admin, stale.id)).status).toBe(200);
  });

  it('JR-14 a request younger than 72 hours is not escalated', async () => {
    const w = await world();
    const a = await applicant(w);
    await age(a.id, 71);
    expect(await escalateStaleRequests()).toBe(0);
  });

  it('JR-15 removing the last CR escalates pending requests at once', async () => {
    const w = await world();
    const a = await applicant(w);
    const admin = await asAdmin(w.cse);
    const role = await UserRole.findOne({ user_id: w.cr._id, role: 'cr' });
    expect((await admin.delete(`/api/admin/representatives/${role._id}`)).status).toBe(204);
    expect((await Enrolment.findById(a.id).lean()).escalated_at).toBeTruthy();
    expect((await accept(await as(w.dcr), a.id)).status).toBe(403);
    const closed = await join(await as(await student()), w.secA._id);
    expect(closed.body.error.code).toBe('SECTION_CLOSED');
  });
});

describe('groups (JR-16, JR-17)', () => {
  async function accepted(w) {
    const a = await applicant(w);
    await accept(await as(w.cr), a.id);
    return a;
  }

  it('JR-16 the CR changes and clears the group; the student is emailed', async () => {
    const w = await world();
    const g = await makeGroup(w.secA, 'G3');
    const a = await accepted(w);
    clearOutbox();
    const cr = await as(w.cr);
    const res = await cr.patch(`/api/enrolments/${a.id}/group`).send({ group_id: String(g._id) });
    expect(res.status).toBe(200);
    expect(await Enrolment.findById(a.id).lean()).toMatchObject({ group_set_by: 'cr' });
    const mail = await drainMail();
    expect(mail.some((m) => m.to === a.user.email && /group/i.test(m.subject))).toBe(true);
    const cleared = await cr.patch(`/api/enrolments/${a.id}/group`).send({ group_id: null });
    expect(cleared.status).toBe(200);
    expect((await Enrolment.findById(a.id).lean()).group_id).toBeUndefined();
    expect((await auditList({ action: 'join.group_change' })).length).toBe(2);
  });

  it('JR-17 an admin override is stored as group_set_by admin; a group of another section is refused', async () => {
    const w = await world();
    const g = await makeGroup(w.secA, 'G3');
    const secB = await w.section(w.cse, 'B');
    const foreign = await makeGroup(secB, 'Z1');
    const a = await accepted(w);
    const admin = await asAdmin(w.cse);
    expect(
      (await admin.patch(`/api/enrolments/${a.id}/group`).send({ group_id: String(foreign._id) }))
        .status,
    ).toBe(400);
    const ok = await admin.patch(`/api/enrolments/${a.id}/group`).send({ group_id: String(g._id) });
    expect(ok.status).toBe(200);
    expect((await Enrolment.findById(a.id).lean()).group_set_by).toBe('admin');
  });

  it('JR-16 a pending request has no group to change (404), and EDT-07 a used group cannot be removed', async () => {
    const w = await world();
    const g = await makeGroup(w.secA, 'G9');
    const a = await applicant(w);
    const cr = await as(w.cr);
    expect((await cr.patch(`/api/enrolments/${a.id}/group`).send({ group_id: null })).status).toBe(
      404,
    );
    await Enrolment.updateOne({ _id: a.id }, { group_id: g._id });
    const admin = await asAdmin(w.cse);
    const del = await admin.delete(`/api/admin/groups/${g.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('GROUP_IN_USE');
  });
});

describe('revocation and appeals (JR-19, JR-20)', () => {
  it('JR-19 revoking sends the wrong account back to waiting and lets the real owner claim', async () => {
    const w = await world();
    const wrong = await applicant(w, w.secA, ID_A);
    await accept(await as(w.cr), wrong.id);
    const claim = await UvClaim.findOne({ user_id: wrong.user._id }).lean();
    const admin = await asAdmin(w.cse);
    expect(
      (await admin.post(`/api/admin/uv-claims/${claim._id}/revoke`).send({ reason: 'x' })).status,
    ).toBe(400);
    const res = await admin
      .post(`/api/admin/uv-claims/${claim._id}/revoke`)
      .send({ reason: 'Owner came in person' });
    expect(res.status).toBe(200);
    expect((await UvClaim.findById(claim._id).lean()).status).toBe('revoked');
    expect((await Enrolment.findById(wrong.id).lean()).status).toBe('revoked');
    expect((await User.findById(wrong.user._id).lean()).state).toBe('claim_pending');
    const owner = await applicant(w, w.secA, ID_B);
    expect((await accept(await as(w.cr), owner.id)).status).toBe(200);
    expect(await UvClaim.countDocuments({ status: 'approved', uv_id_norm: ID_B })).toBe(1);
    expect((await auditList({ action: 'uv_claim.revoke' })).length).toBe(1);
    // revoking again is refused
    const again = await admin
      .post(`/api/admin/uv-claims/${claim._id}/revoke`)
      .send({ reason: 'again again' });
    expect(again.status).toBe(409);
  });

  it('JR-19 only an admin of that department can revoke', async () => {
    const w = await world();
    const a = await applicant(w);
    await accept(await as(w.cr), a.id);
    const claim = await UvClaim.findOne({ user_id: a.user._id }).lean();
    const body = { reason: 'Because reasons' };
    expect(
      (await (await asAdmin(w.eee)).post(`/api/admin/uv-claims/${claim._id}/revoke`).send(body))
        .status,
    ).toBe(403);
    expect(
      (await (await as(w.cr)).post(`/api/admin/uv-claims/${claim._id}/revoke`).send(body)).status,
    ).toBe(403);
    expect((await UvClaim.findById(claim._id).lean()).status).toBe('approved');
  });

  it('JR-20 a rejected student appeals once; the admin upholds', async () => {
    const w = await world();
    const a = await applicant(w);
    await reject(await as(w.cr), a.id);
    expect((await a.agent.post(`/api/enrolments/${a.id}/appeal`)).status).toBe(200);
    const twice = await a.agent.post(`/api/enrolments/${a.id}/appeal`);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('CONFLICT');
    const admin = await asAdmin(w.cse);
    const open = await admin.get('/api/admin/join-requests?view=appeals');
    expect(open.body.data.map((r) => r.id)).toEqual([a.id]);
    const res = await admin
      .post(`/api/admin/enrolments/${a.id}/appeal-decision`)
      .send({ decision: 'uphold' });
    expect(res.status).toBe(200);
    expect((await Enrolment.findById(a.id).lean()).appeal.status).toBe('upheld');
    const late = await admin
      .post(`/api/admin/enrolments/${a.id}/appeal-decision`)
      .send({ decision: 'uphold' });
    expect(late.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('JR-20 reversing an appeal accepts the student as the admin', async () => {
    const w = await world();
    const a = await applicant(w);
    await reject(await as(w.cr), a.id);
    await a.agent.post(`/api/enrolments/${a.id}/appeal`);
    const admin = await asAdmin(w.cse);
    const res = await admin
      .post(`/api/admin/enrolments/${a.id}/appeal-decision`)
      .send({ decision: 'reverse' });
    expect(res.status).toBe(200);
    expect(await Enrolment.findById(a.id).lean()).toMatchObject({
      status: 'accepted',
      appeal: { status: 'reversed' },
    });
    expect((await User.findById(a.user._id).lean()).state).toBe('active');
    expect((await UvClaim.findOne({ user_id: a.user._id }).lean()).status).toBe('approved');
  });

  it('JR-20 only the owner can appeal, and only a rejected request', async () => {
    const w = await world();
    const a = await applicant(w);
    expect((await a.agent.post(`/api/enrolments/${a.id}/appeal`)).status).toBe(404);
    await reject(await as(w.cr), a.id);
    const other = await as(await student());
    expect((await other.post(`/api/enrolments/${a.id}/appeal`)).status).toBe(404);
    const cr = await as(w.cr);
    expect((await cr.post(`/api/enrolments/${a.id}/appeal`)).status).toBe(404);
  });

  it('JR-20 a CR cannot decide appeals', async () => {
    const w = await world();
    const a = await applicant(w);
    await reject(await as(w.cr), a.id);
    await a.agent.post(`/api/enrolments/${a.id}/appeal`);
    const res = await (
      await as(w.cr)
    )
      .post(`/api/admin/enrolments/${a.id}/appeal-decision`)
      .send({ decision: 'reverse' });
    expect(res.status).toBe(403);
  });
});

describe('a CR or DCR own claim (JR-18)', () => {
  it('JR-18 goes to the admin only; the admin approves it', async () => {
    const w = await world();
    const cr = await as(w.cr);
    const res = await cr.post('/api/me/uv-claim').send({ uv_id: '555 777' });
    expect(res.status).toBe(201);
    expect(await Enrolment.countDocuments({ user_id: w.cr._id, status: 'pending' })).toBe(0);
    expect((await cr.post('/api/me/uv-claim').send({ uv_id: '555 778' })).status).toBe(409);
    // the CR cannot decide it
    const claimId = res.body.data.id;
    const own = await cr
      .post(`/api/admin/uv-claims/${claimId}/decision`)
      .send({ decision: 'approve' });
    expect(own.status).toBe(403);
    const admin = await asAdmin(w.cse);
    const list = await admin.get('/api/admin/join-requests?view=claims');
    expect(list.body.data.map((c) => c.id)).toEqual([claimId]);
    const ok = await admin
      .post(`/api/admin/uv-claims/${claimId}/decision`)
      .send({ decision: 'approve' });
    expect(ok.status).toBe(200);
    expect((await UvClaim.findById(claimId).lean()).status).toBe('approved');
  });

  it('JR-18 a student without a CR or DCR role cannot use it', async () => {
    const w = await world();
    void w;
    const res = await (
      await as(await makeUser({ kind: 'student', state: 'active' }))
    )
      .post('/api/me/uv-claim')
      .send({ uv_id: '123' });
    expect(res.status).toBe(403);
  });

  it('JR-18 an ID approved for another account is refused', async () => {
    const w = await world();
    const a = await applicant(w, w.secA, '4242');
    await accept(await as(w.cr), a.id);
    const res = await (await as(w.dcr)).post('/api/me/uv-claim').send({ uv_id: '04242' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UV_ID_TAKEN');
  });
});

describe('the waiting screen (JR-21) and account states', () => {
  it('JR-21 returns the latest request, the reason and the CR/DCR card', async () => {
    const w = await world();
    const a = await applicant(w);
    const pending = await a.agent.get('/api/me/join-request');
    expect(pending.status).toBe(200);
    expect(pending.body.data).toMatchObject({ status: 'pending', section: { name: 'CSE 2-II-A' } });
    expect(pending.body.data.representatives.map((r) => r.role).sort()).toEqual(['cr', 'dcr']);
    expect(JSON.stringify(pending.body)).not.toMatch(/@baiust/);
    await reject(await as(w.cr), a.id, 'Wrong batch');
    const rejected = await a.agent.get('/api/me/join-request');
    expect(rejected.body.data).toMatchObject({ status: 'rejected', reason: 'Wrong batch' });
  });

  it('JR-21 a student with no request gets null; an admin is refused', async () => {
    const w = await world();
    const none = await (await as(await student())).get('/api/me/join-request');
    expect(none.status).toBe(200);
    expect(none.body.data).toBeNull();
    expect((await (await asAdmin(w.cse)).get('/api/me/join-request')).status).toBe(403);
  });

  it('[PRD] the next screen is the form, then waiting once a request exists', async () => {
    const w = await world();
    const user = await student();
    const agent = await as(user);
    const before = await agent.get('/api/auth/me');
    expect(before.body.data.next).toBe('join-form');
    await join(agent, w.secA._id);
    const after = await agent.get('/api/auth/me');
    expect(after.body.data.next).toBe('waiting-approval');
  });

  it('[PRD] a claim_pending student is refused (403) on pages that need an active account', async () => {
    const w = await world();
    const a = await applicant(w);
    const mate = await makeUser({ kind: 'student', state: 'active' });
    const res = await a.agent.get(`/api/users/${mate._id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('[PRD] a claim_pending student is refused (403) on My routine and the free-room view', async () => {
    const w = await world();
    const a = await applicant(w);
    const routine = await a.agent.get('/api/me/routine');
    expect(routine.status).toBe(403);
    expect(routine.body.error.code).toBe('STATE_NOT_ALLOWED');
    const rooms = await a.agent.get('/api/rooms/availability').query({
      date: '2026-07-05',
      from: '660',
      to: '720',
    });
    expect(rooms.status).toBe(403);
    expect(rooms.body.error.code).toBe('STATE_NOT_ALLOWED');
  });
});

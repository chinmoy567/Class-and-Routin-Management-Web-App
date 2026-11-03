import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  fixClock,
  loginAs,
  resetClock,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { User, UserRole } from '../../auth/index.js';
import { Semester } from '../../organisation/index.js';
import { Section } from '../../routine/index.js';
import { Enrolment } from '../../enrolments/index.js';
import { list as auditList } from '../../audit/index.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(async () => {
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
  fixClock('2026-07-08T04:00:00Z');
});
afterEach(() => resetClock());

const as = (user) => loginAs(user, app);
const update = (agent) => agent.get('/api/me/semester-update');

/** Fall 2026 is current. CSE has a section for each level and term the tests need. */
async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const current = await Semester.create({
    name: 'Fall 2026',
    status: 'current',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
    made_current_at: new Date('2026-07-01T00:00:00Z'),
  });
  let n = 0;
  const section = (level, term) =>
    Section.create({
      semester_id: current._id,
      department_id: cse._id,
      level,
      term,
      letter: `L${(n += 1)}`,
    });
  // A student whose last confirmed section is `level`-`term`, now unconfirmed.
  const unconfirmedIn = async (level, term, extra = {}) => {
    const sec = await section(level, term);
    const user = await makeUser({ kind: 'student', state: 'unconfirmed', name: 'Rahim Uddin' });
    await User.updateOne(
      { _id: user._id },
      { $set: { confirmed_semester_id: current._id, ...extra } },
    );
    await Enrolment.create({
      user_id: user._id,
      semester_id: current._id,
      section_id: sec._id,
      status: 'accepted',
    });
    return { user, section: sec };
  };
  return { cse, current, section, unconfirmedIn };
}

describe('the semester update screen (ROL-08)', () => {
  it('ROL-08 a student last confirmed in 2-II gets 3-I suggested, with the department and letter', async () => {
    const w = await world();
    const { user, section } = await w.unconfirmedIn(2, 'II');
    const res = await update(await as(user));
    expect(res.status).toBe(200);
    expect(res.body.data.prefill).toEqual({
      department_id: String(w.cse._id),
      letter: section.letter,
      level: 3,
      term: 'I',
    });
    expect(res.body.data.last_section).toEqual({ level: 2, term: 'II', letter: section.letter });
    expect(res.body.data.can_graduate).toBe(false);
    expect(res.body.data.semester.name).toBe('Fall 2026');
  });

  it('ROL-08 a student last confirmed in 2-I gets 2-II suggested', async () => {
    const w = await world();
    const { user } = await w.unconfirmedIn(2, 'I');
    const res = await update(await as(user));
    expect(res.body.data.prefill).toMatchObject({ level: 2, term: 'II' });
  });

  it('ROL-08 the screen says nothing before the student has ever been confirmed', async () => {
    await world();
    const user = await makeUser({ kind: 'student', state: 'unconfirmed' });
    const res = await update(await as(user));
    expect(res.body.data.prefill).toBeNull();
    expect(res.body.data.last_section).toBeNull();
  });
});

describe('graduation (ROL-09)', () => {
  it('ROL-09 a student whose last term was 4-II can choose to graduate, with no join request', async () => {
    const w = await world();
    const { user } = await w.unconfirmedIn(4, 'II');
    const agent = await as(user);
    expect((await update(agent)).body.data.can_graduate).toBe(true);
    const res = await agent.post('/api/me/graduate');
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('graduated');
    const row = await User.findById(user._id).lean();
    expect(row.state).toBe('graduated');
    expect(row.graduated_at).toBeTruthy();
    expect(await Enrolment.countDocuments({ user_id: user._id, status: 'pending' })).toBe(0);
    const [entry] = await auditList({ action: 'student.graduate' });
    expect(String(entry.actor_id)).toBe(String(user._id));
  });

  it('ROL-09 a 3-I student calling graduate gets NOT_FINAL_TERM', async () => {
    const w = await world();
    const { user } = await w.unconfirmedIn(3, 'I');
    const res = await (await as(user)).post('/api/me/graduate');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_FINAL_TERM');
    expect((await User.findById(user._id).lean()).state).toBe('unconfirmed');
  });
});

describe('not enrolled this semester (ROL-10)', () => {
  it('ROL-10 the choice keeps the student unconfirmed and is shown on the screen', async () => {
    const w = await world();
    const { user } = await w.unconfirmedIn(2, 'I');
    const agent = await as(user);
    const res = await agent.post('/api/me/not-enrolled');
    expect(res.status).toBe(200);
    const row = await User.findById(user._id).lean();
    expect(row.state).toBe('unconfirmed');
    expect(String(row.not_enrolled_semester_id)).toBe(String(w.current._id));
    expect((await update(agent)).body.data.not_enrolled).toBe(true);
  });

  it('ROL-10 sending a join request ends the "not enrolled" choice', async () => {
    const w = await world();
    const { user } = await w.unconfirmedIn(2, 'I');
    const open = await w.section(2, 'II');
    await UserRole.create({
      user_id: (await makeUser({ kind: 'student', state: 'active' }))._id,
      role: 'cr',
      department_id: w.cse._id,
      section_id: open._id,
      semester_id: w.current._id,
      is_representative: true,
    });
    const agent = await as(user);
    await agent.post('/api/me/not-enrolled');
    const sent = await agent.post('/api/enrolments').send({
      section_id: String(open._id),
      uv_id: '0822310205101077',
    });
    expect(sent.status).toBe(201);
    const row = await User.findById(user._id).lean();
    expect(row.not_enrolled_semester_id).toBeUndefined();
  });
});

describe('what an unconfirmed student may use (ROL-11)', () => {
  it('ROL-11 an unconfirmed student cannot open free rooms or My routine, but can see the profile', async () => {
    const w = await world();
    const { user } = await w.unconfirmedIn(2, 'I');
    const agent = await as(user);
    const freeNow = await agent.get('/api/rooms/free-now');
    expect(freeNow.status).toBe(403);
    expect(freeNow.body.error.code).toBe('STATE_NOT_ALLOWED');
    const routine = await agent.get('/api/me/routine');
    expect(routine.status).toBe(403);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.next).toBe('semester-update');
  });
});

describe('who may use the screen', () => {
  it('ROL-08 an active student, a waiting student, a teacher and an admin are all refused', async () => {
    await world();
    const others = [
      await makeUser({ kind: 'student', state: 'active' }),
      await makeUser({ kind: 'student', state: 'claim_pending' }),
      await makeUser({ kind: 'teacher', state: 'active' }),
      await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] }),
    ];
    for (const user of others) {
      const agent = await as(user);
      const res = await update(agent);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
      expect((await agent.post('/api/me/graduate')).status).toBe(403);
      expect((await agent.post('/api/me/not-enrolled')).status).toBe(403);
    }
  });
});

describe('the next screen (D6)', () => {
  it('D6 an unconfirmed student with a request waiting is shown the waiting screen', async () => {
    const w = await world();
    const { user, section } = await w.unconfirmedIn(2, 'I');
    await Enrolment.create({
      user_id: user._id,
      semester_id: w.current._id,
      section_id: section._id,
      status: 'pending',
    });
    const me = await (await as(user)).get('/api/auth/me');
    expect(me.body.data.next).toBe('waiting-approval');
  });
});

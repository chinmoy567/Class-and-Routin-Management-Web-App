import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
} from '../../../../test/harness.js';
import { makeDepartment, makeUser } from '../../../../test/factories.js';
import { User } from '../auth.model.js';
import { AuditLog } from '../../audit/audit.model.js';
import { registerProfileExtras } from '../index.js';
import { Semester } from '../../organisation/index.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(clearDb);

const asUser = (user) => loginAs(user, app);

describe('GET /api/me/profile (PRF-01)', () => {
  it('PRF-01 a student sees own email, phone, kind, roles and the student block', async () => {
    // A CR role only counts while its semester is the current one (CRD-05).
    const sem = await Semester.create({
      name: 'Fall 2026',
      status: 'current',
      start_date: '2026-07-01',
      end_date: '2026-12-31',
    });
    const me = await makeUser({
      kind: 'student',
      name: 'Rafi Ahmed',
      phone: '+8801712345678',
      roles: [{ role: 'cr', semester_id: sem._id }],
    });
    const res = await (await asUser(me)).get('/api/me/profile');
    expect(res.status).toBe(200);
    const p = res.body.data;
    expect(p).toMatchObject({
      full_name: 'Rafi Ahmed',
      email: me.email,
      phone: '+8801712345678',
      kind: 'student',
      photo: { url: null, status: 'none' },
    });
    expect(p.roles.map((r) => r.role)).toEqual(['cr']);
    expect(p.student).toEqual({
      department_id: null,
      level: null,
      term: null,
      section: null,
      group: null,
      confirmed_semester: null,
    });
    expect(p.teacher).toBeUndefined();
  });

  it('PRF-01 a teacher sees the department and "not linked yet"', async () => {
    const dept = makeDepartment();
    const me = await makeUser({ kind: 'teacher', departmentId: dept._id });
    const p = (await (await asUser(me)).get('/api/me/profile')).body.data;
    expect(p.teacher).toEqual({ department_id: String(dept._id), short_code: null, linked: false });
    expect(p.phone).toBeNull();
  });

  it('PRF-01 the student block comes from the registered provider (spec 10)', async () => {
    registerProfileExtras({
      student: async () => ({ department_id: 'd', level: 2, term: 'II', section: 'A' }),
    });
    const me = await makeUser({ kind: 'student' });
    const p = (await (await asUser(me)).get('/api/me/profile')).body.data;
    expect(p.student).toMatchObject({ level: 2, term: 'II', section: 'A' });
    registerProfileExtras({
      student: async () => ({
        department_id: null,
        level: null,
        term: null,
        section: null,
        group: null,
        confirmed_semester: null,
      }),
    });
  });

  it('PRF-01 the owner id comes from the session: a user_id in the query is ignored', async () => {
    const me = await makeUser({ name: 'Me' });
    const other = await makeUser({ name: 'Other' });
    const res = await (
      await asUser(me)
    )
      .get('/api/me/profile')
      .query({ user_id: String(other._id) });
    expect(res.body.data.full_name).toBe('Me');
  });

  it('PRF-01 anonymous → 401', async () => {
    expect((await (await asUser(null)).get('/api/me/profile')).status).toBe(401);
  });
});

describe('PATCH /api/me/profile (PRF-02, PRF-03, PRF-08, PRF-09)', () => {
  it('PRF-03 01712345678 is stored encrypted as +8801712345678', async () => {
    const me = await makeUser();
    const res = await (await asUser(me)).patch('/api/me/profile').send({ phone: '01712345678' });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('+8801712345678');
    const raw = await User.findById(me._id).select('+phone_enc').lean();
    expect(raw.phone_enc).toBeTruthy();
    expect(raw.phone_enc).not.toContain('1712345678');
  });

  it('PRF-03 12345 → VALIDATION_ERROR', async () => {
    const me = await makeUser();
    const res = await (await asUser(me)).patch('/api/me/profile').send({ phone: '12345' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.phone).toBeTruthy();
  });

  it('PRF-03 null clears the phone', async () => {
    const me = await makeUser({ phone: '+8801712345678' });
    const res = await (await asUser(me)).patch('/api/me/profile').send({ phone: null });
    expect(res.body.data.phone).toBeNull();
    const raw = await User.findById(me._id).select('+phone_enc').lean();
    expect(raw.phone_enc).toBeUndefined();
  });

  it('PRF-02 a user cannot rename themselves through the profile', async () => {
    const me = await makeUser({ name: 'Original' });
    const res = await (
      await asUser(me)
    )
      .patch('/api/me/profile')
      .send({ phone: null, full_name: 'Changed' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect((await User.findById(me._id).lean()).full_name).toBe('Original');
  });

  it('PRF-08 phone changes are audited without the number', async () => {
    const me = await makeUser();
    await (await asUser(me)).patch('/api/me/profile').send({ phone: '01712345678' });
    const entries = await AuditLog.find({ action: 'user.phone_change' }).lean();
    expect(entries).toHaveLength(1);
    expect(String(entries[0].actor_id)).toBe(String(me._id));
    expect(JSON.stringify(entries[0])).not.toMatch(/1712345678/);
  });

  it('PRF-09 email_unverified → 403 STATE_NOT_ALLOWED on read and edit', async () => {
    const me = await makeUser({ state: 'email_unverified' });
    const agent = await asUser(me);
    for (const res of [
      await agent.get('/api/me/profile'),
      await agent.patch('/api/me/profile').send({ phone: null }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
    }
  });

  it.each([
    ['student', 'claim_pending'],
    ['student', 'active'],
    ['student', 'unconfirmed'],
    ['student', 'graduated'],
    ['teacher', 'pending'],
    ['teacher', 'active'],
  ])('PRF-09 a %s in state %s can edit the profile', async (kind, state) => {
    const me = await makeUser({ kind, state });
    const res = await (await asUser(me)).patch('/api/me/profile').send({ phone: '01712345678' });
    expect(res.status).toBe(200);
  });
});

describe('the optional profile UV ID (PRF-10, spec 24 OS-05)', () => {
  const patch = async (user, body) => (await asUser(user)).patch('/api/me/profile').send(body);

  it('OS-05 saving "08 22-3102" stores 08223102, keeps the zero, and the owner sees it', async () => {
    const me = await makeUser({ kind: 'student', state: 'claim_pending' });
    const res = await patch(me, { uv_id: '08 22-3102' });
    expect(res.status).toBe(200);
    expect(res.body.data.uv_id).toBe('08223102');
    expect((await User.findById(me._id).lean()).uv_id).toBe('08223102');
    const own = await (await asUser(me)).get('/api/me/profile');
    expect(own.body.data.uv_id).toBe('08223102');
  });

  it('OS-05 21 digits or letters → VALIDATION_ERROR, and nothing is stored', async () => {
    const me = await makeUser({ kind: 'student' });
    for (const bad of ['1'.repeat(21), '12ab']) {
      const res = await patch(me, { uv_id: bad });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await User.findById(me._id).lean()).uv_id).toBeUndefined();
  });

  it('OS-05 two students may save the same UV ID (not unique)', async () => {
    const a = await makeUser({ kind: 'student' });
    const b = await makeUser({ kind: 'student' });
    expect((await patch(a, { uv_id: '0822310205101077' })).status).toBe(200);
    expect((await patch(b, { uv_id: '0822310205101077' })).status).toBe(200);
    expect(await User.countDocuments({ uv_id: '0822310205101077' })).toBe(2);
  });

  it('OS-05 the student can change and clear it at any time (null or empty)', async () => {
    const me = await makeUser({ kind: 'student', uv_id: '111' });
    expect((await patch(me, { uv_id: '222' })).body.data.uv_id).toBe('222');
    expect((await patch(me, { uv_id: '' })).body.data.uv_id).toBeNull();
    await patch(me, { uv_id: '333' });
    expect((await patch(me, { uv_id: null })).body.data.uv_id).toBeNull();
    expect((await User.findById(me._id).lean()).uv_id).toBeUndefined();
  });

  it('PRF-10 changing the UV ID leaves the phone alone, and the reverse', async () => {
    const me = await makeUser({ kind: 'student', phone: '+8801712345678' });
    const res = await patch(me, { uv_id: '42' });
    expect(res.body.data).toMatchObject({ uv_id: '42', phone: '+8801712345678' });
    expect((await patch(me, { phone: null })).body.data.uv_id).toBe('42');
  });

  it('PRF-10 a teacher or a staff account cannot set a UV ID', async () => {
    for (const kind of ['teacher', 'staff']) {
      const res = await patch(await makeUser({ kind, state: 'active' }), { uv_id: '42' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('PRF-10 an empty body is refused; an email_unverified student cannot edit it', async () => {
    expect((await patch(await makeUser({ kind: 'student' }), {})).status).toBe(400);
    const res = await patch(await makeUser({ kind: 'student', state: 'email_unverified' }), {
      uv_id: '42',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('PRF-08 a UV ID change is audited without the value', async () => {
    const me = await makeUser({ kind: 'student' });
    await patch(me, { uv_id: '98765' });
    const entry = await AuditLog.findOne({ action: 'user.uv_id_change' }).lean();
    expect(entry.new_value).toEqual({ has_uv_id: true });
    expect(JSON.stringify(entry)).not.toContain('98765');
  });
});

describe('GET /api/auth/me (PRF-06)', () => {
  it('PRF-06 email_action_required is true while the email is bouncing', async () => {
    const me = await makeUser();
    const agent = await asUser(me);
    expect((await agent.get('/api/auth/me')).body.data.email_action_required).toBe(false);
    await User.updateOne({ _id: me._id }, { $set: { email_bouncing: true } });
    expect((await agent.get('/api/auth/me')).body.data.email_action_required).toBe(true);
  });
});

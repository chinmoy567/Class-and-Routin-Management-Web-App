// Spec 22, SAF-01 to SAF-03: blocking. Every test is named after its requirement ID.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
  resetClock,
} from '../../../../test/harness.js';
import { list as auditList } from '../../audit/index.js';
import { world, openDirect, send } from './world.js';

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
});
afterEach(() => {
  resetClock();
});

const block = (agent, other) => agent.post('/api/chat/blocks').send({ user_id: String(other._id) });

describe('SAF-01: block, unblock and the one-way refusal', () => {
  it('SAF-01 a blocked user’s message → BLOCKED with a neutral message; after unblock → delivered', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const teacher = await loginAs(w.teacher, app);
    const conv = (await openDirect(student, w.teacher)).body.data;

    expect((await block(teacher, w.studentA)).status).toBe(201);

    const refused = await send(student, conv.id, 'hello');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('BLOCKED');
    // The text never says that a block exists.
    expect(refused.body.error.message).not.toMatch(/block/i);

    // One way only: the blocker can still message the blocked person.
    expect((await send(teacher, conv.id, 'hi')).status).toBe(201);

    expect((await teacher.delete(`/api/chat/blocks/${w.studentA._id}`)).status).toBe(204);
    expect((await send(student, conv.id, 'hello again')).status).toBe(201);
  });

  it('SAF-01 a blocked user cannot open a new chat with the blocker (neutral CHAT_NOT_ALLOWED)', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const teacher = await loginAs(w.teacher, app);
    await block(teacher, w.studentA);
    const res = await openDirect(student, w.teacher);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHAT_NOT_ALLOWED');
  });

  it('SAF-01 the block list shows only the blocker’s own blocks, names and photos only', async () => {
    const w = await world();
    const teacher = await loginAs(w.teacher, app);
    await block(teacher, w.studentA);
    const res = await teacher.get('/api/chat/blocks');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ user_id: String(w.studentA._id), full_name: 'Rahim Ahmed' }),
    ]);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      ['full_name', 'photo_url', 'user_id'].sort(),
    );
    const other = await loginAs(w.studentA, app);
    expect((await other.get('/api/chat/blocks')).body.data).toEqual([]);
  });

  it('SAF-01 blocking twice → CONFLICT; blocking yourself → VALIDATION_ERROR; unknown person → NOT_FOUND', async () => {
    const w = await world();
    const teacher = await loginAs(w.teacher, app);
    expect((await block(teacher, w.studentA)).status).toBe(201);
    const twice = await block(teacher, w.studentA);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('CONFLICT');
    expect((await block(teacher, w.teacher)).status).toBe(400);
    const ghost = await teacher.post('/api/chat/blocks').send({
      user_id: '64b000000000000000000000',
    });
    expect(ghost.status).toBe(404);
  });
});

describe('SAF-02: admins cannot be blocked; groups are unaffected', () => {
  it('SAF-02 blocking an admin → CANNOT_BLOCK_ADMIN (department admin and super admin)', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    for (const admin of [w.cseAdmin, w.superAdmin]) {
      const res = await block(student, admin);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CANNOT_BLOCK_ADMIN');
    }
  });

  it('SAF-02 a block does not stop a section group message', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const student = await loginAs(w.studentA, app);
    // The CR blocks the student, and the student still posts in the section group.
    await block(cr, w.studentA);
    const groupConv = (await student.get('/api/chat/conversations')).body.data.find(
      (c) => c.type === 'section_group',
    );
    expect(groupConv).toBeTruthy();
    expect((await send(student, groupConv.id, 'in the group')).status).toBe(201);
  });
});

describe('SAF-03: blocked people are hidden from search, both ways', () => {
  it('SAF-03 the blocked person and the blocker do not find each other in search', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const teacher = await loginAs(w.teacher, app);
    expect(
      (await student.get('/api/chat/people?q=Teacher')).body.data.map((p) => p.full_name),
    ).toContain('Teacher T');

    await block(teacher, w.studentA);

    expect(
      (await student.get('/api/chat/people?q=Teacher')).body.data.map((p) => p.full_name),
    ).not.toContain('Teacher T');
    expect(
      (await teacher.get('/api/chat/people?q=Rahim')).body.data.map((p) => p.full_name),
    ).not.toContain('Rahim Ahmed');
  });
});

const suspend = (agent, user, hours = 1, reason = 'Spam in the group') =>
  agent.post('/api/admin/chat/suspensions').send({ user_id: String(user._id), hours, reason });
const liftOf = (agent, id) => agent.post(`/api/admin/chat/suspensions/${id}/lift`);

describe('SAF-10: chat suspension from sending', () => {
  it('SAF-10 a suspended user can read but sending → CHAT_SUSPENDED with the end time', async () => {
    const w = await world();
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const student = await loginAs(w.studentA, app);
    const teacher = await loginAs(w.teacher, app);
    const conv = (await openDirect(student, w.teacher)).body.data;
    await send(teacher, conv.id, 'before');

    const made = await suspend(cseAdmin, w.studentA, 2);
    expect(made.status).toBe(201);

    const refused = await send(student, conv.id, 'nope');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CHAT_SUSPENDED');
    expect(new Date(refused.body.error.fields.until).getTime()).toBeGreaterThan(Date.now());

    // Reading still works.
    const read = await student.get(`/api/chat/conversations/${conv.id}/messages`);
    expect(read.status).toBe(200);
    expect(read.body.data.map((m) => m.body)).toContain('before');
  });

  it('SAF-10 the rest of the app keeps working during a suspension (routine)', async () => {
    const w = await world();
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const student = await loginAs(w.studentA, app);
    await suspend(cseAdmin, w.studentA);
    const routine = await student.get('/api/me/routine?from=2026-07-05&to=2026-07-11');
    expect(routine.status).toBe(200);
  });

  it('SAF-10 the admin can lift early; the first lift wins and a second is ALREADY_DECIDED', async () => {
    const w = await world();
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const student = await loginAs(w.studentA, app);
    const teacher = await loginAs(w.teacher, app);
    const conv = (await openDirect(student, w.teacher)).body.data;
    const id = (await suspend(cseAdmin, w.studentA, 24)).body.data.id;

    const results = await Promise.all([liftOf(cseAdmin, id), liftOf(cseAdmin, id)]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('ALREADY_DECIDED');

    expect((await send(student, conv.id, 'back again')).status).toBe(201);
    expect((await send(teacher, conv.id, 'welcome back')).status).toBe(201);
  });

  it('SAF-10 duration must be 1 hour to 90 days', async () => {
    const w = await world();
    const cseAdmin = await loginAs(w.cseAdmin, app);
    expect((await suspend(cseAdmin, w.studentA, 0)).status).toBe(400);
    expect((await suspend(cseAdmin, w.studentA, 2161)).status).toBe(400);
    expect((await suspend(cseAdmin, w.studentA, 2160)).status).toBe(201);
  });

  it('SAF-10 each suspension and each lift is audited, with no message text', async () => {
    const w = await world();
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const id = (await suspend(cseAdmin, w.studentA, 1, 'Harassment')).body.data.id;
    await liftOf(cseAdmin, id);
    expect(await auditList({ action: 'chat.suspended' })).toHaveLength(1);
    expect(await auditList({ action: 'chat.suspension_lifted' })).toHaveLength(1);
    const [entry] = await auditList({ action: 'chat.suspended' });
    expect(JSON.stringify(entry.new_value)).not.toMatch(/Harassment/);
  });
});

describe('SAF-11: suspension scope', () => {
  it('SAF-11 an admin of another department cannot suspend a CSE user (FORBIDDEN)', async () => {
    const w = await world();
    const eeeAdmin = await loginAs(w.eeeAdmin, app);
    const res = await suspend(eeeAdmin, w.studentA);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('SAF-11 a super admin cannot suspend themselves; a department admin of the right department can', async () => {
    const w = await world();
    const superAdmin = await loginAs(w.superAdmin, app);
    const cseAdmin = await loginAs(w.cseAdmin, app);
    expect((await suspend(superAdmin, w.superAdmin)).body.error.code).toBe('FORBIDDEN');
    expect((await suspend(cseAdmin, w.cseAdmin)).body.error.code).toBe('FORBIDDEN');
    expect((await suspend(superAdmin, w.teacher)).status).toBe(201);
  });

  it('SAF-11 people who are not admins cannot suspend anyone (every role refused)', async () => {
    const w = await world();
    for (const user of [w.cr, w.studentA, w.teacher]) {
      const agent = await loginAs(user, app);
      const res = await suspend(agent, w.studentA2);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('SAF-10: the admin can see the running suspensions of a person', () => {
  it('SAF-10 the active suspensions are listed for the admin of the department; other departments get 403', async () => {
    const w = await world();
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const eeeAdmin = await loginAs(w.eeeAdmin, app);
    const id = (await suspend(cseAdmin, w.studentA, 5)).body.data.id;
    const mine = await cseAdmin.get(`/api/admin/chat/suspensions?user_id=${w.studentA._id}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((s) => s.id)).toEqual([id]);
    const theirs = await eeeAdmin.get(`/api/admin/chat/suspensions?user_id=${w.studentA._id}`);
    expect(theirs.status).toBe(403);
  });
});

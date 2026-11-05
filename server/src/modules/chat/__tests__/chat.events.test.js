import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { Semester } from '../../organisation/index.js';
import { Section } from '../../routine/index.js';
import { Enrolment } from '../../enrolments/index.js';
import { UserRole } from '../../auth/index.js';
import { list as auditList } from '../../audit/index.js';
import { ConversationMember, Conversation } from '../chat.model.js';
import { onRepAssigned, onRollover, onMembershipRemoved } from '../chat.group.service.js';
import { setEmitter } from '../../../lib/events.js';
import { chatPolicy } from '../chat.policy.js';
import { chatRouter, chatAdminRouter } from '../chat.routes.js';

let app;
let emitted;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(async () => {
  setEmitter(null);
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
  emitted = [];
  setEmitter((room, event, payload) => emitted.push({ room, event, payload }));
});
afterEach(() => setEmitter(null));

/** CSE 2-II-A with a CR, a DCR, an accepted student and a second accepted student. */
async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const sem = await Semester.create({
    name: 'Fall 2026',
    status: 'current',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
  });
  const sec = await Section.create({
    semester_id: sem._id,
    department_id: cse._id,
    level: 2,
    term: 'II',
    letter: 'A',
  });
  const rep = (role) =>
    makeUser({
      kind: 'student',
      state: 'active',
      name: role.toUpperCase(),
      roles: [
        {
          role,
          department_id: cse._id,
          section_id: sec._id,
          semester_id: sem._id,
          is_representative: true,
        },
      ],
    });
  const accepted = async (name) => {
    const u = await makeUser({ kind: 'student', state: 'active', name, departmentId: cse._id });
    await Enrolment.create({
      user_id: u._id,
      semester_id: sem._id,
      section_id: sec._id,
      department_id: cse._id,
      status: 'accepted',
    });
    return u;
  };
  const w = {
    cse,
    sem,
    sec,
    cr: await rep('cr'),
    dcr: await rep('dcr'),
    s1: await accepted('Student One'),
    s2: await accepted('Student Two'),
  };
  await onRepAssigned({ id: String(sec._id) });
  w.group = await Conversation.findOne({ type: 'section_group', section_id: sec._id }).lean();
  return w;
}

const send = (agent, convId, body) =>
  agent.post(`/api/chat/conversations/${convId}/messages`).send({ body });

describe('CHT-14 real-time events carry ids only and go to the right room', () => {
  it('a one-to-one message is pushed to the other participant user room', async () => {
    const w = await world();
    const a = await loginAs(w.s1, app);
    const opened = await a.post('/api/chat/direct').send({ user_id: String(w.s2._id) });
    emitted = [];
    const res = await send(a, opened.body.data.id, 'hello');
    expect(res.status).toBe(201);
    const push = emitted.find((e) => e.event === 'message.new');
    expect(push.room).toBe(`user:${w.s2._id}`);
    expect(Object.keys(push.payload).sort()).toEqual(['conversation_id', 'message_id']);
    expect(JSON.stringify(push.payload)).not.toContain('hello');
  });

  it('a group message is pushed to the conversation room', async () => {
    const w = await world();
    const a = await loginAs(w.s1, app);
    emitted = [];
    await send(a, w.group._id, 'group hello');
    const push = emitted.find((e) => e.event === 'message.new');
    expect(push.room).toBe(`conversation:${w.group._id}`);
  });

  it('read and delivered send message.status to the sender, ids and status only', async () => {
    const w = await world();
    const a = await loginAs(w.s1, app);
    const b = await loginAs(w.s2, app);
    const opened = await a.post('/api/chat/direct').send({ user_id: String(w.s2._id) });
    const conv = opened.body.data.id;
    const sent = await send(a, conv, 'status test');
    emitted = [];
    await b.post(`/api/chat/messages/${sent.body.data.id}/delivered`);
    const delivered = emitted.find((e) => e.event === 'message.status');
    expect(delivered.room).toBe(`user:${w.s1._id}`);
    expect(delivered.payload.status).toBe('delivered');
    emitted = [];
    await b.post(`/api/chat/conversations/${conv}/read`);
    const seen = emitted.find((e) => e.event === 'message.status');
    expect(seen.room).toBe(`user:${w.s1._id}`);
    expect(seen.payload.status).toBe('seen');
  });
});

describe('CHT-21 events are sent only after the write', () => {
  it('CHT-21 no message.new is emitted when the send is refused', async () => {
    const w = await world();
    const stranger = await makeUser({ kind: 'teacher', state: 'active', name: 'Teacher' });
    emitted = [];
    const refused = await send(await loginAs(stranger, app), w.group._id, 'teacher');
    expect(refused.status).toBe(404);
    expect(emitted.filter((e) => e.event === 'message.new')).toHaveLength(0);
  });
});

describe('CHT-11 an ended CR/DCR role stops owner rights, membership stays', () => {
  it('after the CR role ends the CR still reads but cannot remove a member or delete', async () => {
    const w = await world();
    const cr = await loginAs(w.cr, app);
    const student = await loginAs(w.s1, app);
    const sent = await send(student, w.group._id, 'from student');
    await UserRole.updateMany(
      { user_id: w.cr._id, role: 'cr' },
      { $set: { ended_at: new Date() } },
    );
    expect((await cr.get(`/api/chat/conversations/${w.group._id}/messages`)).status).toBe(200);
    expect((await cr.delete(`/api/chat/messages/${sent.body.data.id}`)).status).toBe(403);
    expect(
      (await cr.delete(`/api/chat/conversations/${w.group._id}/members/${w.s2._id}`)).status,
    ).toBe(403);
  });
});

describe('CHT-12 an unconfirmed student keeps read-only access to the old group', () => {
  it('after rollover an unconfirmed member reads the history and gets GROUP_CLOSED on send', async () => {
    const w = await world();
    await loginAs(w.s1, app);
    await mongooseUpdateState(w.s1._id, 'unconfirmed');
    await onRollover({ archived_semester_id: String(w.sem._id) });
    const agent = await loginAs(w.s1, app);
    expect((await agent.get(`/api/chat/conversations/${w.group._id}/messages`)).status).toBe(200);
    const res = await send(agent, w.group._id, 'after rollover');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GROUP_CLOSED');
  });
});

describe('CHT-22 owner deletion audit records the action without the text', () => {
  it('an owner deletes a member message: chat.message_deleted_by_owner is audited, no body', async () => {
    const w = await world();
    const sent = await send(await loginAs(w.s1, app), w.group._id, 'secret words');
    const cr = await loginAs(w.cr, app);
    expect((await cr.delete(`/api/chat/messages/${sent.body.data.id}`)).status).toBe(204);
    const entries = await auditList({ action: 'chat.message_deleted_by_owner' });
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0])).not.toContain('secret words');
  });

  it('CHT-22 the removal hook audits chat.member_removed when it is given the acting admin (spec 10 does not pass one yet: open decision)', async () => {
    const w = await world();
    const admin = await makeUser({
      kind: 'staff',
      state: 'active',
      name: 'Admin',
      roles: [{ role: 'dept_admin', department_id: w.cse._id }],
    });
    await onMembershipRemoved({
      user_id: String(w.s2._id),
      section_id: String(w.sec._id),
      semester_id: String(w.sem._id),
      actor: admin,
    });
    const entries = await auditList({ action: 'chat.member_removed' });
    expect(entries).toHaveLength(1);
    expect(String(entries[0].actor_id)).toBe(String(admin._id));
    const row = await ConversationMember.findOne({
      conversation_id: w.group._id,
      user_id: w.s2._id,
    }).lean();
    expect(row.removed_at).toBeTruthy();
  });
});

describe('CHT-02a policy names', () => {
  it('registers exactly the seven chat actions the spec names', () => {
    expect(Object.keys(chatPolicy).sort()).toEqual(
      [
        'chat.admin_appeals',
        'chat.appeal',
        'chat.delete_own',
        'chat.moderate_group',
        'chat.open_direct',
        'chat.read',
        'chat.restore_member',
        'chat.search',
        'chat.send',
      ].sort(),
    );
  });
});

describe('CHT-19 no chat route returns message bodies (route scan)', () => {
  it('lists every chat route; only the appeals list and the restore are admin routes', () => {
    const paths = (router) =>
      router.stack
        .filter((layer) => layer.route)
        .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
    const admin = paths(chatAdminRouter);
    expect(admin.sort()).toEqual(
      ['GET /chat/appeals', 'POST /chat/members/:memberId/restore'].sort(),
    );
    for (const p of paths(chatRouter)) expect(p).not.toMatch(/admin/);
  });

  it('the admin appeals list response carries no message body field', async () => {
    const w = await world();
    const sent = await send(await loginAs(w.s1, app), w.group._id, 'private body');
    expect(sent.status).toBe(201);
    const admin = await loginAs(
      await makeUser({
        kind: 'staff',
        state: 'active',
        name: 'Super',
        roles: [{ role: 'super_admin' }],
      }),
      app,
    );
    const res = await admin.get('/api/admin/chat/appeals');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('private body');
    expect(JSON.stringify(res.body)).not.toMatch(/body_enc/);
  });
});

async function mongooseUpdateState(userId, state) {
  const mongoose = (await import('mongoose')).default;
  await mongoose.connection.db.collection('user').updateOne({ _id: userId }, { $set: { state } });
}

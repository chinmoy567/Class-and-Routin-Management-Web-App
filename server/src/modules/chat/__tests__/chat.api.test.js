import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
  resetClock,
} from '../../../../test/harness.js';
import { makeUser } from '../../../../test/factories.js';
import { Enrolment } from '../../enrolments/index.js';
import { list as auditList } from '../../audit/index.js';
import { Conversation, ConversationMember, Message } from '../chat.model.js';
import { onAccepted, onRollover } from '../chat.group.service.js';
import { world, openDirect, send, groupOf } from './world.js';
import { decrypt } from '../../../lib/crypto.js';

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

describe('CHT-01, CHT-02: who can chat', () => {
  it('CHT-01 active student and active teacher can message each other', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const open = await openDirect(a, w.teacher);
    expect(open.status).toBe(201);
    const sent = await send(a, open.body.data.id, 'Good morning sir');
    expect(sent.status).toBe(201);
    expect(sent.body.data.body).toBe('Good morning sir');
  });

  it('CHT-01 an unconfirmed student can send a one-to-one message', async () => {
    const w = await world();
    const u = await loginAs(w.unconfirmed, app);
    const open = await openDirect(u, w.studentA);
    expect(open.status).toBe(201);
    expect((await send(u, open.body.data.id, 'hello')).status).toBe(201);
  });

  it('CHT-01 a claim_pending student can message only the CR and DCRs of the section they applied to', async () => {
    const w = await world();
    const c = await loginAs(w.claimPending, app);
    const toCr = await openDirect(c, w.cr);
    expect(toCr.status).toBe(201);
    expect((await send(c, toCr.body.data.id, 'please add me')).status).toBe(201);
    const toDcr = await openDirect(c, w.dcr);
    expect(toDcr.status).toBe(201);
    const toStudent = await openDirect(c, w.studentA);
    expect(toStudent.status).toBe(403);
    expect(toStudent.body.error.code).toBe('CHAT_NOT_ALLOWED');
    const toOtherCr = await openDirect(c, w.crB);
    expect(toOtherCr.body.error.code).toBe('CHAT_NOT_ALLOWED');
  });

  it('CHT-01 email_unverified, pending and suspended accounts cannot open chat (STATE_NOT_ALLOWED)', async () => {
    const w = await world();
    const unverified = await loginAs(w.unverified, app);
    const res = await unverified.get('/api/chat/people?q=ra');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
    const pending = await loginAs(w.pendingTeacher, app);
    expect((await openDirect(pending, w.studentA)).body.error.code).toBe('STATE_NOT_ALLOWED');
  });

  it('CHT-02 a removed account can no longer send (checked on every send, CHT-02)', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const open = await openDirect(a, w.teacher);
    const conv = open.body.data.id;
    await mongoose.connection.db
      .collection('user')
      .updateOne({ _id: w.teacher._id }, { $set: { state: 'suspended' } });
    const res = await send(a, conv, 'still there?');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHAT_NOT_ALLOWED');
  });
});

describe('CHT-03, CHT-04, CHT-05: people and direct conversations', () => {
  it('CHT-03 search needs at least 2 characters and returns no section, phone or email keys', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    expect((await a.get('/api/chat/people?q=r')).status).toBe(400);
    const res = await a.get('/api/chat/people?q=ka');
    expect(res.status).toBe(200);
    const row = res.body.data.find((p) => p.full_name === 'Karim Hossain');
    expect(row).toBeTruthy();
    const keys = Object.keys(row).join(',');
    expect(keys).not.toMatch(/section|level|term|letter|group|uv|phone|email/i);
    expect(row.role_labels).toContain('student');
    // CHT-03: a prefix of any word, not only of the whole name.
    const second = await a.get('/api/chat/people?q=hos');
    expect(second.body.data.map((p) => p.full_name)).toContain('Karim Hossain');
  });

  it('CHT-03 search returns at most 20 people', async () => {
    const w = await world();
    for (let i = 0; i < 25; i += 1) {
      await makeUser({
        kind: 'student',
        state: 'active',
        name: 'Zarin Test' + i,
        departmentId: w.cse._id,
      });
    }
    const a = await loginAs(w.studentA, app);
    const res = await a.get('/api/chat/people?q=zarin');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(20);
  });

  it('CHT-03 search shows the CR label and hides people the caller may not message', async () => {
    const w = await world();
    const c = await loginAs(w.claimPending, app);
    const res = await c.get('/api/chat/people?q=ra');
    const names = res.body.data.map((p) => p.full_name);
    expect(names).not.toContain('Rahim Ahmed');
    const cr = await loginAs(w.studentA, app);
    const found = await cr.get('/api/chat/people?q=CR');
    const crRow = found.body.data.find((p) => p.full_name === 'CR A');
    expect(crRow.role_labels).toContain('CR');
  });

  it('CHT-05 two "start chat" calls for the same pair return one conversation (concurrent)', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const [x, y] = await Promise.all([openDirect(a, w.studentA2), openDirect(a, w.studentA2)]);
    expect(x.status).toBe(201);
    expect(y.status).toBe(201);
    expect(x.body.data.id).toBe(y.body.data.id);
    const count = await Conversation.countDocuments({ type: 'direct' });
    expect(count).toBe(1);
  });
});

describe('CHT-06, CHT-07, CHT-15: messages, delete, unread', () => {
  it('CHT-06 CHT-18 stores the body encrypted, enforces 4,000 characters, and lists in order', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const conv = (await openDirect(a, w.studentA2)).body.data.id;
    expect((await send(a, conv, 'x'.repeat(4001))).status).toBe(400);
    const sent = await send(a, conv, 'hello there');
    const stored = await Message.findById(sent.body.data.id).lean();
    expect(stored.body_enc).toBeTruthy();
    expect(stored.body_enc).not.toContain('hello there');
    expect(decrypt(stored.body_enc)).toBe('hello there');
    const list = await a.get(`/api/chat/conversations/${conv}/messages`);
    expect(list.body.data.map((m) => m.body)).toEqual(['hello there']);
  });

  it('CHT-07 the sender deletes a message for everyone: both sides see "deleted" with no body', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const b = await loginAs(w.studentA2, app);
    const conv = (await openDirect(a, w.studentA2)).body.data.id;
    const sent = await send(a, conv, 'secret text');
    expect((await a.delete(`/api/chat/messages/${sent.body.data.id}`)).status).toBe(204);
    for (const agent of [a, b]) {
      const list = await agent.get(`/api/chat/conversations/${conv}/messages`);
      expect(list.body.data[0].deleted).toBe(true);
      expect(list.body.data[0].body).toBeNull();
    }
    // SAF-13: hidden from view at once, but the stored text stays until the retention job erases it
    // 30 days later (or while a report holds it). The view above is what users and admins see.
    const stored = await Message.findById(sent.body.data.id).lean();
    expect(stored.deleted_at).toBeInstanceOf(Date);
    expect(stored.body_enc).toBeDefined();
  });

  it('CHT-07 a non-sender cannot delete a one-to-one message (FORBIDDEN, not 404: they are a member)', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const b = await loginAs(w.studentA2, app);
    const conv = (await openDirect(a, w.studentA2)).body.data.id;
    const sent = await send(a, conv, 'mine');
    const res = await b.delete(`/api/chat/messages/${sent.body.data.id}`);
    expect(res.status).toBe(403);
  });

  it('CHT-15 unread counts go up with new messages and reset when the conversation is opened', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const b = await loginAs(w.studentA2, app);
    const conv = (await openDirect(a, w.studentA2)).body.data.id;
    await send(a, conv, 'one');
    await send(a, conv, 'two');
    const before = await b.get('/api/chat/unread');
    expect(before.body.data.total).toBe(2);
    expect(before.body.data.per_conversation[conv]).toBe(2);
    await b.post(`/api/chat/conversations/${conv}/read`);
    expect((await b.get('/api/chat/unread')).body.data.total).toBe(0);
  });

  it('CHT-06 status goes sent, then delivered, then seen for the sender (one-to-one only)', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const b = await loginAs(w.studentA2, app);
    const conv = (await openDirect(a, w.studentA2)).body.data.id;
    const sent = await send(a, conv, 'status please');
    const status = async () =>
      (await a.get(`/api/chat/conversations/${conv}/messages`)).body.data.find(
        (m) => m.id === sent.body.data.id,
      ).status;
    expect(await status()).toBe('sent');
    await b.post(`/api/chat/messages/${sent.body.data.id}/delivered`);
    expect(await status()).toBe('delivered');
    await b.post(`/api/chat/conversations/${conv}/read`);
    expect(await status()).toBe('seen');
  });

  it('CHT-06 (API rate limit) sending 31 messages in one minute gives RATE_LIMITED on the 31st', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const conv = (await openDirect(a, w.studentA2)).body.data.id;
    for (let i = 0; i < 30; i += 1) expect((await send(a, conv, `m${i}`)).status).toBe(201);
    const res = await send(a, conv, 'one too many');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('CHT-08, CHT-09, CHT-12, CHT-13: section groups', () => {
  it('CHT-08 CHT-09 a CR taking effect creates "CSE 2-II-A · Fall 2026" with owners and accepted students', async () => {
    const w = await world();
    const g = await groupOf(w.secA);
    expect(g.name).toBe('CSE 2-II-A · Fall 2026');
    const members = await ConversationMember.find({ conversation_id: g._id }).lean();
    const ids = members.map((m) => String(m.user_id));
    expect(ids).toEqual(
      expect.arrayContaining([String(w.cr._id), String(w.dcr._id), String(w.studentA._id)]),
    );
    expect(ids).not.toContain(String(w.teacher._id));
    const owner = members.find((m) => String(m.user_id) === String(w.cr._id));
    expect(owner.role).toBe('owner');
  });

  it('CHT-09 a group member reads and sends; a teacher gets 404 for the group (CHT-09)', async () => {
    const w = await world();
    const g = await groupOf(w.secA);
    const s = await loginAs(w.studentA, app);
    expect((await s.get(`/api/chat/conversations/${g._id}/messages`)).status).toBe(200);
    expect((await send(s, g._id, 'hi group')).status).toBe(201);
    const t = await loginAs(w.teacher, app);
    expect((await t.get(`/api/chat/conversations/${g._id}/messages`)).status).toBe(404);
    expect((await send(t, g._id, 'intruder')).status).toBe(404);
  });

  it('CHT-09 a student who is accepted later joins the group (spec 10 hook)', async () => {
    const w = await world();
    const late = await makeUser({ kind: 'student', state: 'active', name: 'Late Joiner' });
    const enrol = await Enrolment.create({
      user_id: late._id,
      semester_id: w.sem._id,
      section_id: w.secA._id,
      department_id: w.cse._id,
      status: 'accepted',
    });
    await onAccepted({
      user_id: String(late._id),
      section_id: String(w.secA._id),
      semester_id: String(w.sem._id),
      group_id: null,
    });
    expect(enrol).toBeTruthy();
    const g = await groupOf(w.secA);
    const row = await ConversationMember.findOne({
      conversation_id: g._id,
      user_id: late._id,
    }).lean();
    expect(row).toBeTruthy();
    expect(row.removed_at).toBeNull();
  });

  it('CHT-13 a group message shows no delivered or seen status (CHT-13)', async () => {
    const w = await world();
    const g = await groupOf(w.secA);
    const s = await loginAs(w.studentA, app);
    const sent = await send(s, g._id, 'group msg');
    expect(sent.body.data.status).toBeNull();
  });

  it('CHT-12 at rollover the group closes: GROUP_CLOSED on send, history still readable (CHT-12)', async () => {
    const w = await world();
    const g = await groupOf(w.secA);
    await onRollover({ archived_semester_id: String(w.sem._id) });
    const s = await loginAs(w.studentA, app);
    const res = await send(s, g._id, 'after rollover');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GROUP_CLOSED');
    expect((await s.get(`/api/chat/conversations/${g._id}/messages`)).status).toBe(200);
  });

  it('CHT-10 an owner of section A cannot remove a member or delete a message in section B (404)', async () => {
    const w = await world();
    const gB = await groupOf(w.secB);
    const crA = await loginAs(w.cr, app);
    expect(
      (await crA.delete(`/api/chat/conversations/${gB._id}/members/${w.studentB._id}`)).status,
    ).toBe(404);
    const sB = await loginAs(w.studentB, app);
    const sent = await send(sB, gB._id, 'in B');
    expect((await crA.delete(`/api/chat/messages/${sent.body.data.id}`)).status).toBe(404);
  });

  it('CHT-10b members list: owners see removed members and roles, ordinary members see names only (CHT-10b)', async () => {
    const w = await world();
    const g = await groupOf(w.secA);
    const cr = await loginAs(w.cr, app);
    const owners = await cr.get(`/api/chat/conversations/${g._id}/members`);
    expect(owners.status).toBe(200);
    expect(owners.body.data.find((m) => m.full_name === 'Rahim Ahmed')).toHaveProperty('removed');
    const s = await loginAs(w.studentA, app);
    const names = await s.get(`/api/chat/conversations/${g._id}/members`);
    expect(names.body.data.length).toBeGreaterThan(0);
    for (const row of names.body.data) {
      expect(Object.keys(row).sort()).toEqual(['full_name', 'photo_url', 'user_id']);
    }
    const raw = JSON.stringify(owners.body.data);
    expect(raw).not.toMatch(/email|phone|uv_id/i);
  });
});

describe('CHT-10, CHT-10a: removal, appeal and admin restore', () => {
  it('CHT-10 CHT-10a owner removes a member; the member can no longer read; one appeal only; restore re-opens (concurrent restores)', async () => {
    const w = await world();
    const g = await groupOf(w.secA);
    const cr = await loginAs(w.cr, app);
    const member = w.studentA2;
    expect((await cr.delete(`/api/chat/conversations/${g._id}/members/${member._id}`)).status).toBe(
      204,
    );

    const removed = await loginAs(member, app);
    expect((await removed.get(`/api/chat/conversations/${g._id}/messages`)).status).toBe(404);
    expect((await send(removed, g._id, 'hi')).status).toBe(404);

    const first = await removed
      .post(`/api/chat/conversations/${g._id}/appeal`)
      .send({ text: 'please' });
    expect(first.status).toBe(201);
    const second = await removed
      .post(`/api/chat/conversations/${g._id}/appeal`)
      .send({ text: 'again' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');

    const memberRow = await ConversationMember.findOne({
      conversation_id: g._id,
      user_id: member._id,
    }).lean();
    const admin = await loginAs(w.cseAdmin, app);
    const [r1, r2] = await Promise.all([
      admin.post(`/api/admin/chat/members/${memberRow._id}/restore`),
      admin.post(`/api/admin/chat/members/${memberRow._id}/restore`),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect((await removed.get(`/api/chat/conversations/${g._id}/messages`)).status).toBe(200);
    const audit = await auditList({ action: 'chat.member_restored' });
    expect(audit).toHaveLength(1);
  });

  it('CHT-10a an admin of another department cannot restore a CSE member (404)', async () => {
    const w = await world();
    const g = await groupOf(w.secA);
    await ConversationMember.updateOne(
      { conversation_id: g._id, user_id: w.studentA2._id },
      { $set: { removed_at: new Date() } },
    );
    const row = await ConversationMember.findOne({
      conversation_id: g._id,
      user_id: w.studentA2._id,
    }).lean();
    const eee = await loginAs(w.eeeAdmin, app);
    expect((await eee.post(`/api/admin/chat/members/${row._id}/restore`)).status).toBe(404);
  });

  it('CHT-22 a removal writes a chat.member_removed audit entry', async () => {
    const w = await world();
    const g = await groupOf(w.secA);
    const cr = await loginAs(w.cr, app);
    await cr.delete(`/api/chat/conversations/${g._id}/members/${w.studentA2._id}`);
    const entries = await auditList({ action: 'chat.member_removed' });
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0].new_value)).not.toMatch(/body|text/i);
  });

  it('CHT-10a the admin appeals list shows the appeal to a department admin of that department only', async () => {
    const w = await world();
    const g = await groupOf(w.secA);
    const cr = await loginAs(w.cr, app);
    await cr.delete(`/api/chat/conversations/${g._id}/members/${w.studentA2._id}`);
    const removed = await loginAs(w.studentA2, app);
    await removed
      .post(`/api/chat/conversations/${g._id}/appeal`)
      .send({ text: 'I was added by mistake' });
    const cse = await loginAs(w.cseAdmin, app);
    const list = await cse.get('/api/admin/chat/appeals');
    expect(list.status).toBe(200);
    expect(list.body.data[0].appeal_text).toBe('I was added by mistake');
    const eee = await loginAs(w.eeeAdmin, app);
    expect((await eee.get('/api/admin/chat/appeals')).body.data).toEqual([]);
  });
});

describe('CHT-02a, cross-scope: no pair or group can be read by an outsider (404)', () => {
  it("CHT-02a every role gets 404 for another pair's conversation", async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const conv = (await openDirect(a, w.studentA2)).body.data.id;
    const outsiders = [w.claimPending, w.teacher, w.cr, w.cseAdmin, w.superAdmin, w.studentB];
    for (const u of outsiders) {
      const agent = await loginAs(u, app);
      expect((await agent.get(`/api/chat/conversations/${conv}/messages`)).status).toBe(404);
      expect((await send(agent, conv, 'nope')).status).toBe(404);
    }
  });

  it('CHT-19 no admin route returns message bodies (CHT-19)', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const conv = (await openDirect(a, w.studentA2)).body.data.id;
    await send(a, conv, 'private words');
    const admin = await loginAs(w.superAdmin, app);
    for (const path of ['/api/admin/chat/appeals']) {
      const res = await admin.get(path);
      expect(JSON.stringify(res.body)).not.toContain('private words');
    }
  });
});

describe('Chat list', () => {
  it('CHT-15 lists conversations with names and unread counts, without exposing contact details', async () => {
    const w = await world();
    const a = await loginAs(w.studentA, app);
    const b = await loginAs(w.studentA2, app);
    const conv = (await openDirect(a, w.studentA2)).body.data.id;
    await send(a, conv, 'hi');
    const list = await b.get('/api/chat/conversations');
    expect(list.status).toBe(200);
    const row = list.body.data.find((c) => c.id === conv);
    expect(row.name).toBe('Rahim Ahmed');
    expect(row.unread).toBe(1);
    expect(JSON.stringify(list.body)).not.toMatch(/email|phone/i);
    const group = list.body.data.find((c) => c.type === 'section_group');
    expect(group.name).toBe('CSE 2-II-A · Fall 2026');
  });
});

// Sanity: the 'chat' policy names are the ones the spec lists (CHT-02a).
describe('policy registry', () => {
  it('CHT-02a registers every chat action named in CHT-02a', async () => {
    const { can } = await import('../../../policy/index.js');
    const actions = [
      'chat.search',
      'chat.open_direct',
      'chat.send',
      'chat.read',
      'chat.delete_own',
      'chat.moderate_group',
      'chat.restore_member',
    ];
    for (const action of actions) {
      try {
        can({ _id: 'x', state: 'active', roles: [] }, action, {});
      } catch (err) {
        expect(err.message).not.toMatch(/Unregistered policy action/);
      }
    }
  });
});

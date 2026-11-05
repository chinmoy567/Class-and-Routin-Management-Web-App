// Spec 22, SAF-04 to SAF-08: reports, routing, the admin view and the close. Named after requirement IDs.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
  resetClock,
} from '../../../../test/harness.js';
import { makeUser } from '../../../../test/factories.js';
import { list as auditList } from '../../audit/index.js';
import { Report, Message } from '../chat.model.js';
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

const report = (agent, body) => agent.post('/api/chat/reports').send(body);
const viewOf = (agent, id) => agent.get(`/api/admin/chat/reports/${id}`);
const closeOf = (agent, id, body) => agent.post(`/api/admin/chat/reports/${id}/close`).send(body);
const listOf = (agent, status = 'open') => agent.get(`/api/admin/chat/reports?status=${status}`);

/** A teacher's direct chat with a student, `count` messages from the teacher, and their ids. */
async function thread(w, count) {
  const student = await loginAs(w.studentA, app);
  const teacher = await loginAs(w.teacher, app);
  const conv = (await openDirect(student, w.teacher)).body.data;
  const ids = [];
  for (let i = 1; i <= count; i += 1) {
    const res = await send(teacher, conv.id, `message ${i}`);
    ids.push(res.body.data.id);
  }
  return { student, teacher, conv, ids };
}

describe('SAF-04: making a report', () => {
  it('SAF-04 a reason outside the five categories, or a note over 500 characters, is refused', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const bad = await report(student, { target_user_id: String(w.teacher._id), category: 'rude' });
    expect(bad.status).toBe(400);
    const long = await report(student, {
      target_user_id: String(w.teacher._id),
      category: 'spam',
      note: 'x'.repeat(501),
    });
    expect(long.status).toBe(400);
  });

  it('SAF-04 a message report needs a conversation the reporter is in (else 404)', async () => {
    const w = await world();
    const { ids } = await thread(w, 1);
    const outsider = await loginAs(w.studentA2, app);
    const res = await report(outsider, {
      target_user_id: String(w.teacher._id),
      message_id: ids[0],
      category: 'harassment',
    });
    expect(res.status).toBe(404);
  });

  it('SAF-04 the message must come from the named person (else 404)', async () => {
    const w = await world();
    const { student, ids } = await thread(w, 1);
    const res = await report(student, {
      target_user_id: String(w.studentA2._id),
      message_id: ids[0],
      category: 'other',
    });
    expect(res.status).toBe(404);
  });

  it('SAF-04 at most 10 reports per person per day: the 11th → RATE_LIMITED', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    for (let i = 0; i < 10; i += 1) {
      expect(
        (await report(student, { target_user_id: String(w.teacher._id), category: 'spam' })).status,
      ).toBe(201);
    }
    const eleventh = await report(student, {
      target_user_id: String(w.teacher._id),
      category: 'spam',
    });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error.code).toBe('RATE_LIMITED');
  });

  it('SAF-04 eleven reports sent at once store at most 10', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const results = await Promise.all(
      Array.from({ length: 11 }, () =>
        report(student, { target_user_id: String(w.teacher._id), category: 'spam' }),
      ),
    );
    expect(results.filter((r) => r.status === 201).length).toBeLessThanOrEqual(10);
    expect(await Report.countDocuments({ reporter_id: w.studentA._id })).toBeLessThanOrEqual(10);
  });

  it('SAF-04 the reporter sees "open" and then "reviewed" (never the outcome)', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const made = await report(student, { target_user_id: String(w.teacher._id), category: 'spam' });
    let mine = (await student.get('/api/chat/reports/mine')).body.data;
    expect(mine).toEqual([expect.objectContaining({ id: made.body.data.id, status: 'open' })]);
    await closeOf(cseAdmin, made.body.data.id, { outcome: 'warned' });
    mine = (await student.get('/api/chat/reports/mine')).body.data;
    expect(mine[0].status).toBe('reviewed');
    expect(JSON.stringify(mine)).not.toMatch(/warned|outcome/);
  });
});

describe('SAF-05: routing', () => {
  it('SAF-05 a report on a CSE teacher goes to the CSE admin; the EEE admin cannot open it (404)', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const made = await report(student, { target_user_id: String(w.teacher._id), category: 'spam' });
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const eeeAdmin = await loginAs(w.eeeAdmin, app);
    expect((await listOf(cseAdmin)).body.data.map((r) => r.id)).toContain(made.body.data.id);
    expect((await listOf(eeeAdmin)).body.data.map((r) => r.id)).not.toContain(made.body.data.id);
    expect((await viewOf(eeeAdmin, made.body.data.id)).status).toBe(404);
  });

  it('SAF-05 a report on an EEE teacher is hidden from a CSE admin (404)', async () => {
    const w = await world();
    const eeeTeacher = await makeUser({
      kind: 'teacher',
      state: 'active',
      name: 'EEE Teacher',
      departmentId: w.eee._id,
    });
    const student = await loginAs(w.studentA, app);
    const made = await report(student, {
      target_user_id: String(eeeTeacher._id),
      category: 'spam',
    });
    const cseAdmin = await loginAs(w.cseAdmin, app);
    expect((await viewOf(cseAdmin, made.body.data.id)).status).toBe(404);
  });

  it('SAF-05 a report on an admin goes only to super admins', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const made = await report(student, {
      target_user_id: String(w.cseAdmin._id),
      category: 'other',
    });
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const superAdmin = await loginAs(w.superAdmin, app);
    expect((await viewOf(cseAdmin, made.body.data.id)).status).toBe(404);
    expect((await viewOf(superAdmin, made.body.data.id)).status).toBe(200);
  });
});

describe('SAF-06: what the admin may see', () => {
  it('SAF-06 the view has at most 11 messages, all from that conversation, centred on the reported one', async () => {
    const w = await world();
    const { student, ids, conv } = await thread(w, 13);
    // A second conversation of the teacher with another student: none of its messages may appear.
    const other = await loginAs(w.studentA2, app);
    const teacher = await loginAs(w.teacher, app);
    const otherConv = (await openDirect(other, w.teacher)).body.data;
    await send(teacher, otherConv.id, 'private to someone else');

    const made = await report(student, {
      target_user_id: String(w.teacher._id),
      message_id: ids[6],
      category: 'inappropriate',
    });
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const res = await viewOf(cseAdmin, made.body.data.id);
    expect(res.status).toBe(200);
    const { messages } = res.body.data;
    expect(messages.length).toBeLessThanOrEqual(11);
    expect(messages).toHaveLength(11);
    expect(messages.map((m) => m.id)).toEqual(ids.slice(1, 12));
    expect(messages.find((m) => m.reported).id).toBe(ids[6]);
    expect(messages.map((m) => m.body)).not.toContain('private to someone else');
    expect(messages.every((m) => m.sender_name)).toBe(true);
    expect(conv.id).toBeTruthy();
  });

  it('SAF-06 a person report shows the reason and note only, no messages', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const made = await report(student, {
      target_user_id: String(w.teacher._id),
      category: 'spam',
      note: 'keeps sending links',
    });
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const res = await viewOf(cseAdmin, made.body.data.id);
    expect(res.body.data.messages).toEqual([]);
    expect(res.body.data.category).toBe('spam');
    expect(res.body.data.note).toBe('keeps sending links');
  });

  it('SAF-06 a student, a teacher or another department admin cannot open a report (404) and the list is empty', async () => {
    const w = await world();
    const { student, ids } = await thread(w, 2);
    const made = await report(student, {
      target_user_id: String(w.teacher._id),
      message_id: ids[0],
      category: 'other',
    });
    const id = made.body.data.id;
    for (const user of [w.studentA, w.teacher, w.cr, w.eeeAdmin]) {
      const agent = await loginAs(user, app);
      expect((await viewOf(agent, id)).status).toBe(404);
      expect((await listOf(agent)).body.data).toEqual([]);
    }
  });
});

describe('SAF-07: every view is audited', () => {
  it('SAF-07 each opening writes one chat.report_view entry with the admin, report and time', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const made = await report(student, { target_user_id: String(w.teacher._id), category: 'spam' });
    const cseAdmin = await loginAs(w.cseAdmin, app);
    await viewOf(cseAdmin, made.body.data.id);
    await viewOf(cseAdmin, made.body.data.id);
    const entries = await auditList({ action: 'chat.report_view' });
    expect(entries).toHaveLength(2);
    expect(String(entries[0].actor_id)).toBe(String(w.cseAdmin._id));
    expect(entries[0].at).toBeInstanceOf(Date);
  });
});

describe('SAF-08: closing a report', () => {
  it('SAF-08 a second close → ALREADY_DECIDED; parallel closes → exactly one wins', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const made = await report(student, { target_user_id: String(w.teacher._id), category: 'spam' });
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const id = made.body.data.id;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => closeOf(cseAdmin, id, { outcome: 'warned' })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('ALREADY_DECIDED');
    expect((await auditList({ action: 'chat.report_closed' })).length).toBe(1);
  });

  it('SAF-08 closing as "message_removed" deletes the message for both sides and is audited', async () => {
    const w = await world();
    const { student, teacher, conv, ids } = await thread(w, 1);
    const made = await report(student, {
      target_user_id: String(w.teacher._id),
      message_id: ids[0],
      category: 'harassment',
    });
    const cseAdmin = await loginAs(w.cseAdmin, app);
    expect(
      (await closeOf(cseAdmin, made.body.data.id, { outcome: 'message_removed' })).status,
    ).toBe(200);
    for (const agent of [student, teacher]) {
      const msgs = (await agent.get(`/api/chat/conversations/${conv.id}/messages`)).body.data;
      expect(msgs[0].deleted).toBe(true);
      expect(msgs[0].body).toBeNull();
    }
    expect((await auditList({ action: 'chat.message_removed_by_report' })).length).toBe(1);
  });

  it('SAF-08 the outcome must be one of the four values', async () => {
    const w = await world();
    const student = await loginAs(w.studentA, app);
    const made = await report(student, { target_user_id: String(w.teacher._id), category: 'spam' });
    const cseAdmin = await loginAs(w.cseAdmin, app);
    const res = await closeOf(cseAdmin, made.body.data.id, { outcome: 'banned' });
    expect(res.status).toBe(400);
  });
});

describe('SAF-09: holds set when the report is made', () => {
  it('SAF-09 the reported message and its window are held while the report is open', async () => {
    const w = await world();
    const { student, ids } = await thread(w, 13);
    await report(student, {
      target_user_id: String(w.teacher._id),
      message_id: ids[6],
      category: 'other',
    });
    const held = await Message.find({ hold_open: true }).lean();
    expect(held).toHaveLength(11);
    expect(held.map((m) => String(m._id)).sort()).toEqual(ids.slice(1, 12).sort());
  });
});

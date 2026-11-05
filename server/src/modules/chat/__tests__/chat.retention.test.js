// Spec 22, SAF-09, SAF-12 to SAF-14: retention, holds and permanent erasure. The clock is moved
// with clock.set; the nightly job is run directly by calling runRetention().
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
  resetClock,
} from '../../../../test/harness.js';
import { clock } from '../../../lib/time.js';
import { encrypt } from '../../../lib/crypto.js';
import { Conversation, Message } from '../chat.model.js';
import { runRetention } from '../chat.retention.service.js';
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
  clock.reset();
});

const DAY = 24 * 60 * 60 * 1000;
const at = (base, days) => new Date(base.getTime() + days * DAY);

/** A teacher's message to a student, and the conversation. */
async function oneMessage(w) {
  const student = await loginAs(w.studentA, app);
  const teacher = await loginAs(w.teacher, app);
  const conv = (await openDirect(student, w.teacher)).body.data;
  const sent = await send(teacher, conv.id, 'hello there');
  return { student, teacher, conv, id: sent.body.data.id };
}

const report = (agent, body) => agent.post('/api/chat/reports').send(body);
const closeOf = (agent, id, body) => agent.post(`/api/admin/chat/reports/${id}/close`).send(body);

describe('SAF-12: the 12-month purge', () => {
  it('SAF-12 a message 12 months and 1 day old is gone after the nightly job; one 11 months old remains', async () => {
    const w = await world();
    const { id: oldId, conv } = await oneMessage(w);
    const { id: recentId } = (await send(await loginAs(w.teacher, app), conv.id, 'recent')).body
      .data;
    const now = new Date();
    await Message.updateOne({ _id: oldId }, { $set: { created_at: at(now, -366) } });
    await Message.updateOne({ _id: recentId }, { $set: { created_at: at(now, -335) } });

    await runRetention();

    expect(await Message.findById(oldId).lean()).toBeNull();
    expect(await Message.findById(recentId).lean()).not.toBeNull();
  });

  it('SAF-12 the conversation record is kept even when it has no messages left (SAF-14)', async () => {
    const w = await world();
    const { id, conv } = await oneMessage(w);
    await Message.updateOne({ _id: id }, { $set: { created_at: at(new Date(), -400) } });
    await runRetention();
    expect(await Message.countDocuments({ conversation_id: conv.id })).toBe(0);
    expect(await Conversation.findById(conv.id).lean()).not.toBeNull();
  });
});

describe('SAF-13: a deleted message is erased 30 days after the deletion', () => {
  it('SAF-13 the text stays stored for 30 days, then is erased; the tombstone stays', async () => {
    const w = await world();
    const { teacher, id } = await oneMessage(w);
    const deletedAt = new Date();
    clock.set(deletedAt);
    expect((await teacher.delete(`/api/chat/messages/${id}`)).status).toBe(204);

    clock.set(at(deletedAt, 29));
    await runRetention();
    expect((await Message.findById(id).lean()).body_enc).toBeDefined();

    clock.set(at(deletedAt, 31));
    await runRetention();
    const row = await Message.findById(id).lean();
    expect(row.body_enc).toBeUndefined();
    expect(row.deleted_at).toBeInstanceOf(Date);
  });
});

describe('SAF-09: holds from a report', () => {
  it('SAF-09 a reported message deleted by its sender still exists 31 days later while the report is open', async () => {
    const w = await world();
    const { student, teacher, id, conv } = await oneMessage(w);
    expect(
      (
        await report(student, {
          target_user_id: String(w.teacher._id),
          message_id: id,
          category: 'harassment',
        })
      ).status,
    ).toBe(201);
    expect((await teacher.delete(`/api/chat/messages/${id}`)).status).toBe(204);

    clock.set(at(new Date(), 31));
    await runRetention();
    const row = await Message.findById(id).lean();
    expect(row).not.toBeNull();
    expect(row.body_enc).toBeDefined();
    expect(conv.id).toBeTruthy();
  });

  it('SAF-09 the message is erased 90 days after the report is closed', async () => {
    const w = await world();
    const { student, teacher, id } = await oneMessage(w);
    const made = await report(student, {
      target_user_id: String(w.teacher._id),
      message_id: id,
      category: 'harassment',
    });
    expect((await teacher.delete(`/api/chat/messages/${id}`)).status).toBe(204);

    const cseAdmin = await loginAs(w.cseAdmin, app);
    const closedAt = new Date();
    clock.set(closedAt);
    expect((await closeOf(cseAdmin, made.body.data.id, { outcome: 'warned' })).status).toBe(200);

    clock.set(at(closedAt, 89));
    await runRetention();
    expect((await Message.findById(id).lean()).body_enc).toBeDefined();

    clock.set(at(closedAt, 91));
    await runRetention();
    expect((await Message.findById(id).lean()).body_enc).toBeUndefined();
  });
});

describe('SAF-14: batches and idempotence', () => {
  it('SAF-14 2,500 old messages are purged in batches; a second run changes nothing', async () => {
    const w = await world();
    const { conv, id } = await oneMessage(w);
    const old = at(new Date(), -400);
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      conversation_id: conv.id,
      sender_id: w.teacher._id,
      body_enc: encrypt(`old ${i}`),
      created_at: old,
    }));
    await Message.insertMany(rows);
    await Message.updateOne({ _id: id }, { $set: { created_at: old } });

    const first = await runRetention();
    expect(first.purged).toBe(2501);
    expect(await Message.countDocuments({ conversation_id: conv.id })).toBe(0);

    const second = await runRetention();
    expect(second.purged).toBe(0);
    expect(second.erased).toBe(0);
  });
});

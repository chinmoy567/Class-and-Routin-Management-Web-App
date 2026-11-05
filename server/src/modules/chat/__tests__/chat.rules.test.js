import mongoose from 'mongoose';
import { describe, it, expect } from 'vitest';
import { pairAllowed, chatPolicy } from '../chat.policy.js';

// CHT-01: who may talk one-to-one, state by state. No database needed.
const side = (id, state, pendingRepIds = []) => ({ id, state, pendingRepIds });

describe('CHT-01 pairAllowed', () => {
  it.each([
    ['active', 'active', true],
    ['active', 'unconfirmed', true],
    ['graduated', 'active', true],
    ['email_unverified', 'active', false],
    ['pending', 'active', false],
    ['deactivated', 'active', false],
    ['suspended', 'active', false],
    ['claim_pending', 'claim_pending', false],
  ])('%s with %s -> %s', (a, b, expected) => {
    expect(pairAllowed(side('1', a), side('2', b))).toBe(expected);
  });

  it('CHT-01 a claim_pending student reaches only the CR/DCR of their open request', () => {
    const claimer = side('c', 'claim_pending', ['cr1', 'dcr1']);
    expect(pairAllowed(claimer, side('cr1', 'active'))).toBe(true);
    expect(pairAllowed(side('cr1', 'active'), claimer)).toBe(true);
    expect(pairAllowed(claimer, side('someone', 'active'))).toBe(false);
  });

  it('CHT-01 a claim_pending student with no open request reaches nobody', () => {
    expect(pairAllowed(side('c', 'claim_pending', []), side('cr1', 'active'))).toBe(false);
  });
});

describe('CHT-02a chat.send for groups', () => {
  const group = { type: 'section_group' };
  const member = { user_id: 'u', removed_at: null };
  const user = { _id: 'u', state: 'active' };
  it('CHT-02a members of an open group may send; a closed group refuses everyone', () => {
    expect(chatPolicy['chat.send'](user, { conversation: group, member, closed: false })).toBe(
      true,
    );
    expect(chatPolicy['chat.send'](user, { conversation: group, member, closed: true })).toBe(
      false,
    );
  });
  it('CHT-09 a removed member may not send', () => {
    const removed = { ...member, removed_at: new Date() };
    expect(
      chatPolicy['chat.send'](user, { conversation: group, member: removed, closed: false }),
    ).toBe(false);
  });
});

describe('CHT-20 socket rooms', () => {
  it('CHT-20 joins only open group rooms the user may read (server side, no client join)', async () => {
    const { joinOwnRooms } = await import('../chat.sockets.js');
    const { Conversation, ConversationMember } = await import('../chat.model.js');
    const { clearDb, connectTestDb, disconnectTestDb } =
      await import('../../../../test/harness.js');
    const { makeUser } = await import('../../../../test/factories.js');
    await connectTestDb();
    try {
      await clearDb();
      const user = await makeUser({ kind: 'student', state: 'active' });
      const open = await Conversation.create({
        type: 'section_group',
        section_id: new mongoose.Types.ObjectId(),
        semester_id: new mongoose.Types.ObjectId(),
        name: 'open',
        closed_at: null,
        created_at: new Date(),
      });
      const closed = await Conversation.create({
        type: 'section_group',
        section_id: new mongoose.Types.ObjectId(),
        semester_id: new mongoose.Types.ObjectId(),
        name: 'closed',
        closed_at: new Date(),
        created_at: new Date(),
      });
      const removed = await Conversation.create({
        type: 'section_group',
        section_id: new mongoose.Types.ObjectId(),
        semester_id: new mongoose.Types.ObjectId(),
        name: 'removed',
        closed_at: null,
        created_at: new Date(),
      });
      await ConversationMember.create([
        { conversation_id: open._id, user_id: user._id, role: 'member' },
        { conversation_id: closed._id, user_id: user._id, role: 'member' },
        { conversation_id: removed._id, user_id: user._id, role: 'member', removed_at: new Date() },
      ]);
      const joined = [];
      await joinOwnRooms({ data: { userId: String(user._id) }, join: (room) => joined.push(room) });
      expect(joined).toEqual([`conversation:${open._id}`]);
    } finally {
      await disconnectTestDb();
    }
  });
});

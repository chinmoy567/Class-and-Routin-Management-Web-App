// Spec 20: messages (CHT-06, CHT-07, CHT-13, CHT-14, CHT-15, CHT-19), read marks, delivered
// marks and unread counts. Message text is never written to the audit log or to logs (CHT-22).
import { notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { emitAfterCommit } from '../../lib/events.js';
import { SOCKET_EVENTS } from '@crm/shared';
import { assertCan } from '../../policy/index.js';
import { record } from '../audit/index.js';
import { getSectionBrief } from '../routine/index.js';
import { peopleById } from '../auth/index.js';
import { Conversation, ConversationMember, Message } from './chat.model.js';
import {
  assertCanSend,
  assertChatState,
  assertUnderSendLimit,
  encryptBody,
  isOwnerOf,
  loadConversation,
  membershipOf,
  otherMemberOf,
  readable,
  viewMessage,
} from './chat.context.js';
import { fileViewsFor } from './chat.files.view.js';

const PAGE = 50;

/** CHT-01, CHT-02, CHT-14: send a text message. Every send runs the full rule set. */
export async function sendMessage(me, conversationId, text) {
  assertChatState(me);
  const { conversation, member } = await readable(me, conversationId);
  const { other } = await assertCanSend(me, conversation, member);
  await assertUnderSendLimit(me._id);

  const now = clock.now();
  const message = await Message.create({
    conversation_id: conversation._id,
    sender_id: me._id,
    body_enc: encryptBody(text),
    created_at: now,
  });
  await Conversation.updateOne({ _id: conversation._id }, { $set: { last_message_at: now } });
  await ConversationMember.updateOne({ _id: member._id }, { $set: { last_read_at: now } });
  // CHT-14, CHT-21: ids only, after the write is done.
  const payload = { conversation_id: String(conversation._id), message_id: String(message._id) };
  if (other) emitAfterCommit(`user:${other.user_id}`, SOCKET_EVENTS.MESSAGE_NEW, payload);
  else emitAfterCommit(`conversation:${conversation._id}`, SOCKET_EVENTS.MESSAGE_NEW, payload);
  return viewMessage(message.toObject(), {
    viewerId: me._id,
    direct: conversation.type === 'direct',
    other,
  });
}

/** CHT-06: a page of 50, newest first on the page, shown oldest first. */
export async function listMessages(me, conversationId, before) {
  const { conversation } = await readable(me, conversationId);
  const filter = { conversation_id: conversation._id };
  if (before) {
    const cursor = await Message.findOne({ _id: before, conversation_id: conversation._id }).lean();
    if (!cursor) throw notFound();
    filter.$or = [
      { created_at: { $lt: cursor.created_at } },
      { created_at: cursor.created_at, _id: { $lt: cursor._id } },
    ];
  }
  const rows = await Message.find(filter)
    .sort({ created_at: -1, _id: -1 })
    .limit(PAGE + 1)
    .lean();
  const hasMore = rows.length > PAGE;
  const page = rows.slice(0, PAGE).reverse();
  const direct = conversation.type === 'direct';
  const other = await otherMemberOf(conversation, me._id);
  const files = await fileViewsFor(page);
  const messages = page.map((m) =>
    viewMessage(m, { viewerId: me._id, direct, other, file: files.get(String(m._id)) ?? null }),
  );
  return { messages, next: hasMore ? String(page[0]._id) : null };
}

/** CHT-07, CHT-10, CHT-22: the sender deletes for everyone; a group owner deletes any message. */
export async function deleteMessage(me, messageId) {
  const message = await Message.findById(messageId).lean();
  if (!message) throw notFound();
  const conversation = await loadConversation(message.conversation_id);
  if (String(message.sender_id) !== String(me._id)) {
    // Not the sender: the caller must be a member of this conversation (else 404), and an owner.
    const member = await membershipOf(conversation._id, me._id);
    assertCan(me, 'chat.read', { member });
    const isOwner = await isOwnerOf(me._id, conversation);
    assertCan(me, 'chat.moderate_group', { conversation, isOwner });
    const section = await getSectionBrief(conversation.section_id);
    await erase(message);
    await record({
      actor: me,
      action: 'chat.message_deleted_by_owner',
      scope_department_id: section?.department_id,
      target: { type: 'message', id: message._id },
      new_value: { conversation_id: String(conversation._id) },
    });
    return;
  }
  assertCan(me, 'chat.delete_own', { message });
  await erase(message);
}

async function erase(message) {
  await Message.updateOne(
    { _id: message._id, deleted_at: null },
    { $set: { deleted_at: clock.now() }, $unset: { body_enc: 1 } },
  );
}

/** CHT-15: opening a conversation marks it read. One-to-one: the other side sees "seen". */
export async function markRead(me, conversationId) {
  const { conversation, member } = await readable(me, conversationId);
  const now = clock.now();
  await ConversationMember.updateOne({ _id: member._id }, { $set: { last_read_at: now } });
  const other = await otherMemberOf(conversation, me._id);
  if (other) {
    emitAfterCommit(`user:${other.user_id}`, SOCKET_EVENTS.MESSAGE_STATUS, {
      conversation_id: String(conversation._id),
      status: 'seen',
    });
  }
}

/** CHT-06: the recipient's client received a message. */
export async function markDelivered(me, messageId) {
  const message = await Message.findById(messageId).lean();
  if (!message) throw notFound();
  const { conversation, member } = await readable(me, message.conversation_id);
  if (conversation.type !== 'direct' || String(message.sender_id) === String(me._id)) return;
  await ConversationMember.updateOne(
    { _id: member._id },
    { $max: { last_delivered_at: clock.now() } },
  );
  emitAfterCommit(`user:${message.sender_id}`, SOCKET_EVENTS.MESSAGE_STATUS, {
    conversation_id: String(conversation._id),
    message_id: String(message._id),
    status: 'delivered',
  });
}

/** CHT-15: unread messages from others in one conversation. */
async function unreadIn(conversationId, member, userId) {
  const filter = { conversation_id: conversationId, sender_id: { $ne: userId }, deleted_at: null };
  if (member.last_read_at) filter.created_at = { $gt: member.last_read_at };
  return Message.countDocuments(filter);
}

/** CHT-15: total and per conversation, for the dashboard card and the list. */
export async function unreadSummary(me) {
  assertChatState(me);
  const members = await ConversationMember.find({ user_id: me._id, removed_at: null }).lean();
  const perConversation = {};
  let total = 0;
  for (const member of members) {
    const n = await unreadIn(member.conversation_id, member, me._id);
    perConversation[String(member.conversation_id)] = n;
    total += n;
  }
  return { total, per_conversation: perConversation };
}

/** The chat list: name, photo, closed flag, last message time and unread count per conversation. */
export async function listConversations(me) {
  assertChatState(me);
  // A removed member still sees the group (flagged) so they can reach the appeal (CHT-10a).
  const members = await ConversationMember.find({ user_id: me._id }).lean();
  const conversations = await Conversation.find({
    _id: { $in: members.map((m) => m.conversation_id) },
  }).lean();
  const byId = new Map(conversations.map((c) => [String(c._id), c]));
  const rows = [];
  for (const member of members) {
    const conversation = byId.get(String(member.conversation_id));
    if (!conversation) continue;
    let name = conversation.name ?? null;
    let photo_url = null;
    let other_user_id = null;
    if (conversation.type === 'direct') {
      const other = await otherMemberOf(conversation, me._id);
      other_user_id = other ? String(other.user_id) : null;
      const person = other_user_id ? (await peopleById([other_user_id])).get(other_user_id) : null;
      name = person?.full_name ?? null;
      photo_url = person?.photo_url ?? null;
    }
    rows.push({
      id: String(conversation._id),
      type: conversation.type,
      name,
      photo_url,
      other_user_id,
      closed: Boolean(conversation.closed_at),
      removed: Boolean(member.removed_at),
      last_message_at: conversation.last_message_at ?? null,
      unread: member.removed_at ? 0 : await unreadIn(conversation._id, member, me._id),
    });
  }
  return rows.sort((a, b) => {
    const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return tb - ta;
  });
}

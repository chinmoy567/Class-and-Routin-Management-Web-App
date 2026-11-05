// Spec 20: shared helpers for the chat services. Reads other modules only through their index.
import { AppError, notFound, rateLimited } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { can } from '../../policy/index.js';
import { peopleById } from '../auth/index.js';
import { pendingEnrolmentOf } from '../enrolments/index.js';
import { crDcrOf } from '../representatives/index.js';
import { getSectionBrief } from '../routine/index.js';
import { departmentNames, getSemester } from '../organisation/index.js';
import { Conversation, ConversationMember, Message } from './chat.model.js';

export const SEND_LIMIT_PER_MINUTE = 30; // CHT, sending is rate limited

/** One side of a pair as the policy sees it. `pendingRepIds` only for a claim_pending student. */
export async function sideFor(userId, state) {
  const side = { id: String(userId), state, pendingRepIds: [] };
  if (state === 'claim_pending') {
    const e = await pendingEnrolmentOf(userId);
    if (e) side.pendingRepIds = (await crDcrOf(e.section_id)).map((r) => r.user_id);
  }
  return side;
}

/** The side for an account by id, or null when no such account. */
export async function sideOfUserId(userId) {
  const person = (await peopleById([userId])).get(String(userId));
  return person ? sideFor(userId, person.state) : null;
}

/** CHT-02a: the caller's own state must allow chat, else STATE_NOT_ALLOWED. */
export function assertChatState(me) {
  if (!can(me, 'chat.search', {})) {
    throw new AppError(403, 'STATE_NOT_ALLOWED', 'This account cannot use chat yet.');
  }
}

/** The conversation, or 404. */
export async function loadConversation(id) {
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) throw notFound();
  return conversation;
}

/** The caller's membership row of a conversation (may be removed), or null. */
export const membershipOf = (conversationId, userId) =>
  ConversationMember.findOne({ conversation_id: conversationId, user_id: userId }).lean();

/** CR/DCR in effect for the section of a group, and a current member (CHT-10). */
export async function isOwnerOf(userId, conversation) {
  if (conversation.type !== 'section_group') return false;
  const reps = await crDcrOf(conversation.section_id);
  return reps.some((r) => r.user_id === String(userId));
}

/** "CSE 2-II-A · Fall 2026" (CHT-08). */
export async function groupName(sectionId, semesterId) {
  const section = await getSectionBrief(sectionId);
  const semester = await getSemester(semesterId);
  const names = await departmentNames([section.department_id]);
  const code = names.get(String(section.department_id))?.code ?? '';
  return `${code} ${section.level}-${section.term}-${section.letter} · ${semester?.name ?? ''}`.trim();
}

/** CHT-06: sent, delivered or seen, from the other side's read and delivered marks. */
export function statusOf(createdAt, other) {
  if (other?.last_read_at && other.last_read_at >= createdAt) return 'seen';
  if (other?.last_delivered_at && other.last_delivered_at >= createdAt) return 'delivered';
  return 'sent';
}

/** Public shape of a message. Deleted messages carry no body (CHT-07). */
export function viewMessage(m, { viewerId, direct, other }) {
  const deleted = Boolean(m.deleted_at);
  const mine = String(m.sender_id) === String(viewerId);
  return {
    id: String(m._id),
    conversation_id: String(m.conversation_id),
    sender_id: String(m.sender_id),
    mine,
    deleted,
    body: deleted ? null : decrypt(m.body_enc),
    created_at: m.created_at,
    // CHT-13: only one-to-one messages show status, and only to their sender.
    status: direct && mine && !deleted ? statusOf(m.created_at, other) : null,
  };
}

export const encryptBody = (text) => encrypt(text);

/** CHT: 30 messages per minute per user, counted from the message collection. */
export async function assertUnderSendLimit(userId) {
  const since = new Date(clock.now().getTime() - 60_000);
  const count = await Message.countDocuments({ sender_id: userId, created_at: { $gte: since } });
  if (count >= SEND_LIMIT_PER_MINUTE) throw rateLimited(60);
}

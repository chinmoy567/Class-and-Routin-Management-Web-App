// Spec 20, CHT-01, CHT-05: one-to-one conversations. One per pair, continuing across semesters.
import { AppError } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { can } from '../../policy/index.js';
import { Conversation, ConversationMember } from './chat.model.js';
import { assertChatState, sideFor, sideOfUserId } from './chat.context.js';

const DUPLICATE_KEY = 11000;

/** The pair key: the two ids sorted, so both orders give the same conversation. */
export const pairKeyOf = (a, b) => [String(a), String(b)].sort().join(':');

/** Add a member row if there is none; `role` is set on the row when given. */
export async function upsertMember(conversationId, userId, role = 'member') {
  const filter = { conversation_id: conversationId, user_id: userId };
  try {
    await ConversationMember.updateOne(
      filter,
      { $setOnInsert: { ...filter, role, last_read_at: null, last_delivered_at: null } },
      { upsert: true },
    );
  } catch (err) {
    if (err.code !== DUPLICATE_KEY) throw err;
  }
}

/** CHT-05: find or create the conversation. A race on the unique key re-reads the winner. */
export async function upsertDirect(pairKey, userIds) {
  let conversation;
  try {
    conversation = await Conversation.findOneAndUpdate(
      { type: 'direct', pair_key: pairKey },
      {
        $setOnInsert: {
          type: 'direct',
          pair_key: pairKey,
          closed_at: null,
          created_at: clock.now(),
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
  } catch (err) {
    if (err.code !== DUPLICATE_KEY) throw err;
    conversation = await Conversation.findOne({ type: 'direct', pair_key: pairKey }).lean();
  }
  for (const userId of userIds) await upsertMember(conversation._id, userId, 'member');
  return conversation;
}

/**
 * CHT-01, CHT-05: start (or reopen) a one-to-one chat. The other side is checked with the same
 * policy every send uses.
 */
export async function openDirect(me, otherId) {
  assertChatState(me);
  if (String(otherId) === String(me._id)) {
    throw new AppError(403, 'CHAT_NOT_ALLOWED', 'You cannot start a chat with yourself.');
  }
  const other = await sideOfUserId(otherId);
  const meSide = await sideFor(me._id, me.state);
  if (!other || !can(me, 'chat.open_direct', { me: meSide, other })) {
    throw new AppError(403, 'CHAT_NOT_ALLOWED', 'You cannot chat with this person.');
  }
  const conversation = await upsertDirect(pairKeyOf(me._id, otherId), [me._id, otherId]);
  return { id: String(conversation._id), type: 'direct', other_user_id: String(otherId) };
}

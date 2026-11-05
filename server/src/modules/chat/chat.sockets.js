// Spec 20, CHT-20: which socket rooms a connection joins. The server decides; a client request to
// join a room is never handled (no listener exists for one).
import { onSocketConnect } from '../../lib/socket.js';
import { loadRequestUser } from '../auth/index.js';
import { can } from '../../policy/index.js';
import { Conversation, ConversationMember } from './chat.model.js';

/**
 * On connect: join `conversation:<id>` for each open section group the user is a current member
 * of and may read. Closed groups and removed memberships are left out (CHT-12, CHT-20).
 */
export async function joinOwnRooms(socket) {
  const user = await loadRequestUser(socket.data.userId);
  if (!user) return;
  const members = await ConversationMember.find({ user_id: user._id, removed_at: null }).lean();
  if (!members.length) return;
  const groups = await Conversation.find({
    _id: { $in: members.map((m) => m.conversation_id) },
    type: 'section_group',
    closed_at: null,
  })
    .select('_id')
    .lean();
  const open = new Set(groups.map((g) => String(g._id)));
  for (const member of members) {
    if (!open.has(String(member.conversation_id))) continue;
    if (!can(user, 'chat.read', { member })) continue;
    socket.join(`conversation:${member.conversation_id}`);
  }
}

onSocketConnect(joinOwnRooms);

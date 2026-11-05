import { api, apiBody, uploadForm } from '@/lib/api';

// Spec 20. The server checks every rule again on each call; these are thin wrappers.

/** CHT-15: the chat list, with names, unread counts and the removed flag. */
export const fetchConversations = () => api('/chat/conversations');

/** CHT-15: total and per conversation. */
export const fetchUnread = () => api('/chat/unread');

/** CHT-03: people the caller may message (at least 2 characters). */
export const fetchPeople = (q) => api(`/chat/people?q=${encodeURIComponent(q)}`);

/** CHT-05: start or reopen a one-to-one chat. */
export const openDirect = (userId) =>
  api('/chat/direct', { method: 'POST', body: { user_id: userId } });

/** CHT-06: a page of 50. `before` is the id of the oldest message already shown. */
export async function fetchMessagePage(conversationId, before) {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  const body = await apiBody(`/chat/conversations/${conversationId}/messages${query}`);
  return { messages: body.data, next: body.page?.next ?? null };
}

/** CHT-06: send text (1 to 4,000 characters). */
export const sendMessage = ({ conversationId, body }) =>
  api(`/chat/conversations/${conversationId}/messages`, { method: 'POST', body: { body } });

/** CHT-07: the sender deletes for everyone; a group owner may delete any message. */
export const deleteMessage = (messageId) =>
  api(`/chat/messages/${messageId}`, { method: 'DELETE' });

/** CHT-15: opening a conversation marks it read. */
export const markRead = (conversationId) =>
  api(`/chat/conversations/${conversationId}/read`, { method: 'POST' });

/** CHT-10b: the member list (names only for ordinary members). */
export const fetchMembers = (conversationId) =>
  api(`/chat/conversations/${conversationId}/members`);

/** CHT-10: an owner removes a member. */
export const removeMember = ({ conversationId, userId }) =>
  api(`/chat/conversations/${conversationId}/members/${userId}`, { method: 'DELETE' });

/** CHT-10a: a removed member appeals once. */
export const appealRemoval = ({ conversationId, text }) =>
  api(`/chat/conversations/${conversationId}/appeal`, { method: 'POST', body: { text } });

/** Spec 21, FIL-04: a file in a conversation, with an optional caption. Reports progress 0 to 1. */
export function uploadChatFile({ conversationId, file, caption, onProgress }) {
  const form = new FormData();
  form.append('file', file, file.name);
  if (caption) form.append('caption', caption);
  return uploadForm(`/chat/conversations/${conversationId}/files`, form, { onProgress });
}

/** Spec 21, FIL-08: a 5-minute signed link. The page then starts the download itself. */
export const fetchFileLink = (fileId) => api(`/chat/files/${fileId}/link`, { method: 'POST' });

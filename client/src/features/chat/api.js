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

// Spec 22, SAF-01: blocking. The server checks every rule; these are thin wrappers.
/** SAF-01: the people the caller has blocked (names and photos only). */
export const fetchBlocks = () => api('/chat/blocks');

/** SAF-01: block someone. Admins can't be blocked (the server says so). */
export const blockUser = (userId) =>
  api('/chat/blocks', { method: 'POST', body: { user_id: userId } });

/** SAF-01: unblock at any time. */
export const unblockUser = (userId) => api(`/chat/blocks/${userId}`, { method: 'DELETE' });

// Spec 22, SAF-04: reports of a message (with message_id) or of a person.
/** SAF-04: send a report. */
export const createReport = (body) => api('/chat/reports', { method: 'POST', body });

/** SAF-04: the caller's own reports, with "open" or "reviewed" only. */
export const fetchMyReports = () => api('/chat/reports/mine');

// Spec 22, SAF-05 to SAF-08: the admin's side. The server checks routing and scope each time.
/** SAF-05: reports routed to the caller. No message text in the list. */
export const fetchAdminReports = (status) => api(`/admin/chat/reports?status=${status}`);

/** SAF-06, SAF-07: a report with its context. The server writes an audit entry for the view. */
export const fetchAdminReport = (id) => api(`/admin/chat/reports/${id}`);

/** SAF-08: close with an outcome. */
export const closeReport = ({ id, outcome, note }) =>
  api(`/admin/chat/reports/${id}/close`, { method: 'POST', body: { outcome, note } });

// Spec 22, SAF-10: chat suspension.
/** SAF-10: the suspensions still running for a person. */
export const fetchSuspensions = (userId) => api(`/admin/chat/suspensions?user_id=${userId}`);

/** SAF-10: suspend from sending, for 1 to 2,160 hours, with a reason. */
export const suspendUser = ({ user_id, hours, reason }) =>
  api('/admin/chat/suspensions', { method: 'POST', body: { user_id, hours, reason } });

/** SAF-10: lift early. */
export const liftSuspension = (id) => api(`/admin/chat/suspensions/${id}/lift`, { method: 'POST' });

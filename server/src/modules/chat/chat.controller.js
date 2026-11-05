// Spec 20: HTTP to service. No logic here (see api-module).
import * as people from './chat.people.service.js';
import * as direct from './chat.direct.service.js';
import * as messages from './chat.messages.service.js';
import * as groups from './chat.group.service.js';
import * as files from './chat.files.service.js';

export const searchPeople = async (r, res) =>
  res.json({ data: await people.searchPeople(r.user, r.query.q) });

export const openDirect = async (r, res) =>
  res.status(201).json({ data: await direct.openDirect(r.user, r.body.user_id) });

export const listConversations = async (r, res) =>
  res.json({ data: await messages.listConversations(r.user) });

export const listMessages = async (r, res) => {
  const { messages: data, next } = await messages.listMessages(r.user, r.params.id, r.query.before);
  res.json({ data, page: { next } });
};

export const sendMessage = async (r, res) =>
  res.status(201).json({ data: await messages.sendMessage(r.user, r.params.id, r.body.body) });

export const deleteMessage = async (r, res) => {
  await messages.deleteMessage(r.user, r.params.id);
  res.status(204).end();
};

export const markRead = async (r, res) => {
  await messages.markRead(r.user, r.params.id);
  res.status(204).end();
};

export const markDelivered = async (r, res) => {
  await messages.markDelivered(r.user, r.params.id);
  res.status(204).end();
};

export const unread = async (r, res) => res.json({ data: await messages.unreadSummary(r.user) });

export const listMembers = async (r, res) =>
  res.json({ data: await groups.listMembers(r.user, r.params.id) });

export const removeMember = async (r, res) => {
  await groups.removeMember(r.user, r.params.id, r.params.userId);
  res.status(204).end();
};

export const appeal = async (r, res) =>
  res.status(201).json({ data: await groups.appealRemoval(r.user, r.params.id, r.body.text) });

export const listAppeals = async (r, res) =>
  res.json({ data: await groups.listChatAppeals(r.user) });

export const restoreMember = async (r, res) => {
  res.json({ data: await groups.restoreMember(r.user, r.params.memberId) });
};

export const uploadFile = async (r, res) =>
  res
    .status(201)
    .json({ data: await files.uploadFile(r.user, r.params.id, r.body, r.headers['content-type']) });

export const fileLink = async (r, res) =>
  res.json({ data: await files.createFileLink(r.user, r.params.id) });

export const downloadFile = async (r, res) => files.downloadFile(r.user, r.params.id, r.query, res);

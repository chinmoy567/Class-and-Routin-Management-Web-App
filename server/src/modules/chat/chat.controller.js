// Spec 20: HTTP to service. No logic here (see api-module).
import * as people from './chat.people.service.js';
import * as direct from './chat.direct.service.js';
import * as messages from './chat.messages.service.js';
import * as groups from './chat.group.service.js';
import * as files from './chat.files.service.js';
import * as safety from './chat.safety.service.js';
import * as suspension from './chat.suspension.service.js';

// Spec 22, SAF-01: blocks.
export const block = async (r, res) =>
  res.status(201).json({ data: await safety.block(r.user, r.body.user_id) });
export const unblock = async (r, res) => {
  await safety.unblock(r.user, r.params.userId);
  res.status(204).end();
};
export const listBlocks = async (r, res) => res.json({ data: await safety.listBlocked(r.user) });

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

// Spec 22, SAF-10: suspensions (admin routes).
export const suspend = async (r, res) =>
  res.status(201).json({ data: await suspension.suspend(r.user, r.body) });
export const listSuspensions = async (r, res) =>
  res.json({ data: await suspension.listActive(r.user, r.query.user_id) });
export const lift = async (r, res) =>
  res.json({ data: await suspension.lift(r.user, r.params.id) });

// Spec 22, SAF-04 to SAF-08: reports.
import * as reports from './chat.report.service.js';
export const createReport = async (r, res) =>
  res.status(201).json({ data: await reports.createReport(r.user, r.body) });
export const myReports = async (r, res) => res.json({ data: await reports.myReports(r.user) });
export const listReports = async (r, res) =>
  res.json({ data: await reports.listReports(r.user, r.query.status) });
export const viewReport = async (r, res) =>
  res.json({ data: await reports.viewReport(r.user, r.params.id) });
export const closeReport = async (r, res) =>
  res.json({ data: await reports.closeReport(r.user, r.params.id, r.body) });

// Spec 22, SAF-04 to SAF-09: reports of a message or a person. A report is routed to the reported
// person's department when it is made. Admins see the reported message and 5 messages either side,
// and nothing else of the conversation. Each view and close is audited.
import { SOCKET_EVENTS } from '@crm/shared';
import { AppError, notFound, rateLimited } from '../../lib/errors.js';
import { clock, instantFrom, toInstitutionDate } from '../../lib/time.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { decrypt } from '../../lib/crypto.js';
import { assertCan, can } from '../../policy/index.js';
import { peopleById } from '../auth/index.js';
import { record } from '../audit/index.js';
import { Conversation, ConversationMember, Message, Report } from './chat.model.js';
import { assertChatState, readable } from './chat.context.js';
import { departmentOfPerson, isAdminAccount } from './chat.safety.service.js';

const DAILY_LIMIT = 10; // SAF-04
const WINDOW = 5; // SAF-06: messages before and after the reported one
const HOLD_MS = 90 * 24 * 60 * 60 * 1000; // SAF-09: after the report is closed
const DAY_MS = 24 * 60 * 60 * 1000;

/** SAF-06: the reported message and up to 5 messages either side, in the same conversation. */
async function windowAround(message) {
  const base = { conversation_id: message.conversation_id };
  const before = await Message.find({
    ...base,
    $or: [
      { created_at: { $lt: message.created_at } },
      { created_at: message.created_at, _id: { $lt: message._id } },
    ],
  })
    .sort({ created_at: -1, _id: -1 })
    .limit(WINDOW)
    .select('_id')
    .lean();
  const after = await Message.find({
    ...base,
    $or: [
      { created_at: { $gt: message.created_at } },
      { created_at: message.created_at, _id: { $gt: message._id } },
    ],
  })
    .sort({ created_at: 1, _id: 1 })
    .limit(WINDOW)
    .select('_id')
    .lean();
  return [...before.map((m) => m._id), message._id, ...after.map((m) => m._id)];
}

/** SAF-04, SAF-05: make a report. A message must be from the named person, in a conversation the
 *  caller is in (else 404). */
export async function createReport(me, body) {
  assertChatState(me);
  assertCan(me, 'chat.report', {});
  if (String(body.target_user_id) === String(me._id)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'You cannot report yourself.');
  }
  const now = clock.now();

  let message = null;
  if (body.message_id) {
    message = await Message.findById(body.message_id).lean();
    if (!message) throw notFound();
    await readable(me, message.conversation_id);
    if (String(message.sender_id) !== String(body.target_user_id)) throw notFound();
  }
  const target = (await peopleById([body.target_user_id])).get(String(body.target_user_id));
  if (!target) throw notFound();

  const isAdmin = Boolean(await isAdminAccount(body.target_user_id));
  const departmentId = isAdmin
    ? null
    : await departmentOfPerson({ ...target, id: String(body.target_user_id) });
  const window = message ? await windowAround(message) : [];

  // SAF-04: insert, count today's reports, and undo this insert when it is over the limit. Of
  // parallel requests at most DAILY_LIMIT can keep their insert: the last of them to count sees
  // all the kept ones.
  const row = await Report.create({
    reporter_id: me._id,
    target_user_id: body.target_user_id,
    message_id: message?._id,
    conversation_id: message?.conversation_id,
    category: body.category,
    note: body.note,
    department_id: departmentId ?? undefined,
    to_super_admins: isAdmin || !departmentId,
    window_ids: window,
    status: 'open',
    created_at: now,
  });
  const dayStart = instantFrom(toInstitutionDate(now), 0);
  const today = await Report.countDocuments({
    reporter_id: me._id,
    created_at: { $gte: dayStart },
  });
  if (today > DAILY_LIMIT) {
    await Report.deleteOne({ _id: row._id });
    const tomorrow = instantFrom(toInstitutionDate(new Date(now.getTime() + DAY_MS)), 0);
    throw rateLimited(Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
  }

  // SAF-09: hold the window while the report is open.
  if (window.length) {
    await Message.updateMany({ _id: { $in: window } }, { $set: { hold_open: true } });
  }
  return { id: String(row._id) };
}

/** SAF-04: the reporter's own reports. Status only: "open" or "reviewed", never the outcome. */
export async function myReports(me) {
  assertChatState(me);
  const rows = await Report.find({ reporter_id: me._id })
    .sort({ created_at: -1 })
    .limit(100)
    .lean();
  return rows.map((r) => ({
    id: String(r._id),
    category: r.category,
    about_message: Boolean(r.message_id),
    created_at: r.created_at,
    status: r.status === 'closed' ? 'reviewed' : 'open',
  }));
}

/** SAF-05, SAF-06: the admin's list. Only the reports the caller is routed to. No message text. */
export async function listReports(me, status = 'open') {
  assertChatState(me);
  const rows = await Report.find({ status }).sort({ created_at: -1 }).limit(200).lean();
  const visible = rows.filter((r) => can(me, 'chat.review_report', { report: r }));
  const people = await peopleById(visible.map((r) => r.target_user_id));
  return visible.map((r) => ({
    id: String(r._id),
    category: r.category,
    status: r.status,
    about_message: Boolean(r.message_id),
    target_name: people.get(String(r.target_user_id))?.full_name ?? '',
    department_id: r.department_id ? String(r.department_id) : null,
    created_at: r.created_at,
  }));
}

/** SAF-06, SAF-07: a routed admin opens a report. Every opening is audited. Others get 404. */
export async function viewReport(me, reportId) {
  const report = await Report.findById(reportId).lean();
  if (!report) throw notFound();
  assertCan(me, 'chat.review_report', { report });

  await record({
    actor: me,
    action: 'chat.report_view',
    scope_department_id: report.department_id,
    target: { type: 'report', id: report._id },
    new_value: { report_id: String(report._id) },
  });

  const target = (await peopleById([report.target_user_id])).get(String(report.target_user_id));
  const summary = {
    id: String(report._id),
    category: report.category,
    note: report.note ?? null,
    status: report.status,
    outcome: report.outcome ?? null,
    outcome_note: report.outcome_note ?? null,
    created_at: report.created_at,
    closed_at: report.closed_at ?? null,
    target: { user_id: String(report.target_user_id), full_name: target?.full_name ?? '' },
  };
  if (!report.message_id) return { ...summary, messages: [] };

  // SAF-06: exactly the window fixed at report time. The reported message shows its text even when
  // the sender deleted it (that is why it is held). Other deleted messages show no text.
  const rows = await Message.find({ _id: { $in: report.window_ids } })
    .sort({ created_at: 1, _id: 1 })
    .lean();
  const senders = await peopleById(rows.map((m) => m.sender_id));
  const messages = rows.map((m) => {
    const isReported = String(m._id) === String(report.message_id);
    const showText = !m.deleted_at || isReported;
    return {
      id: String(m._id),
      sender_name: senders.get(String(m.sender_id))?.full_name ?? '',
      created_at: m.created_at,
      deleted: Boolean(m.deleted_at),
      reported: isReported,
      body: showText && m.body_enc ? decrypt(m.body_enc) : null,
    };
  });
  return { ...summary, messages };
}

/** SAF-08: close with an outcome. The first close wins; a second one is ALREADY_DECIDED. */
export async function closeReport(me, reportId, { outcome, note }) {
  const report = await Report.findById(reportId).lean();
  if (!report) throw notFound();
  assertCan(me, 'chat.review_report', { report });

  const now = clock.now();
  const holdUntil = new Date(now.getTime() + HOLD_MS);
  let removed = null;
  const result = await withTransaction(async (session) => {
    const row = await Report.findOneAndUpdate(
      { _id: report._id, status: 'open' },
      {
        $set: {
          status: 'closed',
          outcome,
          outcome_note: note ?? null,
          closed_by: me._id,
          closed_at: now,
          hold_until: holdUntil,
        },
      },
      { returnDocument: 'after', session },
    ).lean();
    if (!row) throw new AppError(409, 'ALREADY_DECIDED', 'This report has already been closed.');

    // SAF-09: the window is kept for 90 days after the close. The open hold is released unless
    // another open report still holds the message.
    if (row.window_ids?.length) {
      const stillHeld = new Set(
        (await Report.distinct('window_ids', { status: 'open' }).session(session)).map(String),
      );
      const release = row.window_ids.filter((id) => !stillHeld.has(String(id)));
      await Message.updateMany(
        { _id: { $in: row.window_ids } },
        { $max: { hold_until: holdUntil } },
        { session },
      );
      if (release.length) {
        await Message.updateMany(
          { _id: { $in: release } },
          { $set: { hold_open: false } },
          { session },
        );
      }
    }

    // SAF-08: "message removed" deletes the reported message for everyone.
    if (outcome === 'message_removed' && row.message_id) {
      const message = await Message.findOneAndUpdate(
        { _id: row.message_id, deleted_at: null },
        { $set: { deleted_at: now, deleted_by: me._id } },
        { returnDocument: 'after', session },
      ).lean();
      if (message) {
        removed = message;
        await record({
          actor: me,
          action: 'chat.message_removed_by_report',
          scope_department_id: row.department_id,
          target: { type: 'message', id: message._id },
          new_value: { report_id: String(row._id) },
          session,
        });
      }
    }

    await record({
      actor: me,
      action: 'chat.report_closed',
      scope_department_id: row.department_id,
      target: { type: 'report', id: row._id },
      new_value: { outcome },
      session,
    });
    return { id: String(row._id), status: 'closed', outcome };
  });

  if (removed) afterCommit(() => pushRemoved(removed));
  return result;
}

/** CHT-14 style push: ids and the status only, to the members of the conversation. */
async function pushRemoved(message) {
  const conversation = await Conversation.findById(message.conversation_id).lean();
  if (!conversation) return;
  const payload = {
    conversation_id: String(message.conversation_id),
    message_id: String(message._id),
    status: 'removed',
  };
  if (conversation.type === 'direct') {
    const members = await ConversationMember.find({
      conversation_id: conversation._id,
      removed_at: null,
    }).lean();
    for (const m of members)
      emitAfterCommit(`user:${m.user_id}`, SOCKET_EVENTS.MESSAGE_STATUS, payload);
  } else {
    emitAfterCommit(`conversation:${conversation._id}`, SOCKET_EVENTS.MESSAGE_STATUS, payload);
  }
}

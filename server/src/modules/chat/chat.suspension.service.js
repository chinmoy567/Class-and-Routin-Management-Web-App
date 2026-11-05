// Spec 22, SAF-10, SAF-11: a department admin suspends a person from SENDING chat messages for a set
// time. Reading and everything else keep working. Each suspend and lift is audited (PRD auditability).
import { AppError, notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { withTransaction } from '../../lib/db.js';
import { assertCan } from '../../policy/index.js';
import { peopleById, User } from '../auth/index.js';
import { record } from '../audit/index.js';
import { ChatSuspension } from './chat.model.js';
import { assertChatState } from './chat.context.js';
import { departmentOfPerson } from './chat.safety.service.js';

const HOUR_MS = 60 * 60 * 1000;

/** SAF-10: the user can't send until `chat_suspended_until`. Read fresh from the account each time. */
export async function assertNotSuspended(me) {
  const row = await User.findById(me._id).select('chat_suspended_until').lean();
  const until = row?.chat_suspended_until ? new Date(row.chat_suspended_until) : null;
  if (until && until.getTime() > clock.now().getTime()) {
    throw new AppError(
      403,
      'CHAT_SUSPENDED',
      'You cannot send messages until the suspension ends.',
      {
        until: until.toISOString(),
      },
    );
  }
}

/** SAF-10: suspend a person from sending for 1 hour to 90 days. Audited in the same transaction. */
export async function suspend(me, { user_id: userId, hours, reason }) {
  assertChatState(me);
  const people = await peopleById([userId]);
  const target = people.get(String(userId));
  if (!target) throw notFound();
  const targetDepartment = await departmentOfPerson({ ...target, id: String(userId) });
  assertCan(me, 'chat.suspend', {
    target_department_id: targetDepartment,
    target_is_self: String(userId) === String(me._id),
  });

  const now = clock.now();
  const until = new Date(now.getTime() + hours * HOUR_MS);
  return withTransaction(async (session) => {
    const [row] = await ChatSuspension.create(
      [{ user_id: userId, until, reason, by: me._id, created_at: now }],
      { session },
    );
    await User.updateOne({ _id: userId }, { $max: { chat_suspended_until: until } }, { session });
    await record({
      actor: me,
      action: 'chat.suspended',
      scope_department_id: targetDepartment,
      target: { type: 'user', id: userId },
      new_value: { suspension_id: String(row._id), until: until.toISOString(), hours },
      session,
    });
    return { id: String(row._id), user_id: String(userId), until: until.toISOString() };
  });
}

/** SAF-10: lift early. The first lift wins; a second is ALREADY_DECIDED. */
export async function lift(me, suspensionId) {
  const suspension = await ChatSuspension.findById(suspensionId).lean();
  if (!suspension) throw notFound();
  const person = (await peopleById([suspension.user_id])).get(String(suspension.user_id));
  if (!person) throw notFound();
  const targetDepartment = await departmentOfPerson({ ...person, id: String(suspension.user_id) });
  assertCan(me, 'chat.suspend', {
    target_department_id: targetDepartment,
    target_is_self: String(suspension.user_id) === String(me._id),
  });

  const now = clock.now();
  return withTransaction(async (session) => {
    const row = await ChatSuspension.findOneAndUpdate(
      { _id: suspension._id, lifted_at: null },
      { $set: { lifted_at: now, lifted_by: me._id } },
      { returnDocument: 'after', session },
    ).lean();
    if (!row)
      throw new AppError(409, 'ALREADY_DECIDED', 'This suspension has already been lifted.');
    // The account mirrors the latest suspension still running (or none).
    const remaining = await ChatSuspension.find({
      user_id: suspension.user_id,
      lifted_at: null,
      until: { $gt: now },
    })
      .sort({ until: -1 })
      .limit(1)
      .session(session)
      .lean();
    await User.updateOne(
      { _id: suspension.user_id },
      { $set: { chat_suspended_until: remaining[0]?.until ?? null } },
      { session },
    );
    await record({
      actor: me,
      action: 'chat.suspension_lifted',
      scope_department_id: targetDepartment,
      target: { type: 'user', id: suspension.user_id },
      new_value: { suspension_id: String(suspension._id) },
      session,
    });
    return { id: String(row._id), lifted: true };
  });
}

/** SAF-10: the suspensions still running for a person, for the admin who may lift them. */
export async function listActive(me, userId) {
  const person = (await peopleById([userId])).get(String(userId));
  if (!person) throw notFound();
  const targetDepartment = await departmentOfPerson({ ...person, id: String(userId) });
  assertCan(me, 'chat.suspend', {
    target_department_id: targetDepartment,
    target_is_self: String(userId) === String(me._id),
  });
  const now = clock.now();
  const rows = await ChatSuspension.find({ user_id: userId, lifted_at: null, until: { $gt: now } })
    .sort({ until: -1 })
    .lean();
  return rows.map((r) => ({
    id: String(r._id),
    user_id: String(r.user_id),
    until: r.until.toISOString(),
    reason: r.reason,
  }));
}

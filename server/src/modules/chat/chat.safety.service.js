// Spec 22, SAF-01 to SAF-03: blocking. A block stops the blocked person sending one-to-one messages
// to the blocker. It doesn't touch section groups. Blocked people are hidden from search both ways.
import { AppError, notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { assertCan } from '../../policy/index.js';
import { peopleById, UserRole } from '../auth/index.js';
import { departmentOfStudent } from '../enrolments/index.js';
import { Block } from './chat.model.js';
import { assertChatState } from './chat.context.js';

const ADMIN_ROLES = ['super_admin', 'dept_admin'];

/** True when the user holds an admin role (SAF-02). */
export const isAdminAccount = async (userId) =>
  Boolean(await UserRole.exists({ user_id: userId, role: { $in: ADMIN_ROLES }, ended_at: null }));

/** SAF-01: has `blockerId` blocked `blockedId`? One direction only. */
export const hasBlocked = (blockerId, blockedId) =>
  Block.exists({ blocker_id: blockerId, blocked_id: blockedId });

/** SAF-03: ids the user must not see in search, in either direction. */
export async function blockedEitherWay(userId) {
  const rows = await Block.find({
    $or: [{ blocker_id: userId }, { blocked_id: userId }],
  }).lean();
  const ids = new Set();
  for (const r of rows) {
    ids.add(String(r.blocker_id));
    ids.add(String(r.blocked_id));
  }
  ids.delete(String(userId));
  return ids;
}

/** SAF-01, SAF-02: block a person. Admins can't be blocked; a duplicate is a CONFLICT. */
export async function block(me, targetId) {
  assertChatState(me);
  assertCan(me, 'chat.block', {});
  if (String(targetId) === String(me._id)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'You cannot block yourself.');
  }
  const target = (await peopleById([targetId])).get(String(targetId));
  if (!target) throw notFound();
  if (await isAdminAccount(targetId)) {
    throw new AppError(403, 'CANNOT_BLOCK_ADMIN', 'Admins cannot be blocked.');
  }
  try {
    await Block.create({ blocker_id: me._id, blocked_id: targetId, created_at: clock.now() });
  } catch (err) {
    if (err?.code === 11000)
      throw new AppError(409, 'CONFLICT', 'You have already blocked this person.');
    throw err;
  }
  return { blocked: true };
}

/** SAF-01: unblocking is possible at any time. Nothing to undo is not an error. */
export async function unblock(me, targetId) {
  assertChatState(me);
  assertCan(me, 'chat.block', {});
  await Block.deleteOne({ blocker_id: me._id, blocked_id: targetId });
}

/** SAF-01: the people the caller has blocked, names and photos only. */
export async function listBlocked(me) {
  assertChatState(me);
  const rows = await Block.find({ blocker_id: me._id }).sort({ created_at: -1 }).lean();
  const people = await peopleById(rows.map((r) => r.blocked_id));
  return rows.map((r) => {
    const person = people.get(String(r.blocked_id));
    return {
      user_id: String(r.blocked_id),
      full_name: person?.full_name ?? '',
      photo_url: person?.photo_url ?? null,
    };
  });
}

/**
 * SAF-01: a one-to-one send is refused when the other person has blocked the sender. The message is
 * neutral and never says that a block exists.
 */
export async function assertNotBlockedBy(me, otherUserId) {
  if (otherUserId && (await hasBlocked(otherUserId, me._id))) {
    throw new AppError(403, 'BLOCKED', 'You cannot send this message.');
  }
}

/** The department a person belongs to for admin scope: a student's enrolment, else the account's. */
export async function departmentOfPerson(person) {
  if (person.kind === 'student')
    return (await departmentOfStudent(person.id)) ?? person.department_id ?? null;
  return person.department_id ? String(person.department_id) : null;
}

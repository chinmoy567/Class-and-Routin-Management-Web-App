import { assertCan } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { record } from '../audit/index.js';
import { User, UserRole, endAllSessions } from '../auth/index.js';
import { Teacher } from './teachers.model.js';

const ACTIONS = {
  suspend: { from: ['active'], to: 'suspended', audit: 'teacher.suspend' },
  remove: { from: ['active', 'suspended'], to: 'deactivated', audit: 'teacher.remove' },
  reactivate: { from: ['suspended', 'deactivated'], to: 'active', audit: 'teacher.reactivate' },
};

/**
 * TCH-12, TCH-13: the account has one state for all its departments, so the actor must administer
 * every department where the account holds the teacher role. Otherwise a suspension would also
 * cut off a department the actor does not run. A super admin passes every check.
 */
export async function changeTeacherState(actor, userId, action, reason) {
  const spec = ACTIONS[action];
  assertCan(actor, 'teacher.admin_list');
  const user = /^[a-f0-9]{24}$/i.test(String(userId))
    ? await User.findById(userId).select('kind state').lean()
    : null;
  if (!user || user.kind !== 'teacher') throw notFound('Teacher not found.');
  const roles = await UserRole.find({ user_id: user._id, role: 'teacher', ended_at: null }).lean();
  if (!roles.length) throw notFound('Teacher not found.');
  const departmentIds = [...new Set(roles.map((r) => String(r.department_id)))];
  for (const departmentId of departmentIds) {
    assertCan(actor, 'teacher.manage', { department_id: departmentId });
  }
  if (String(actor._id) === String(user._id)) {
    throw new AppError(409, 'CONFLICT', 'You cannot do this to your own account.');
  }

  await withTransaction(async (session) => {
    const changed = await User.findOneAndUpdate(
      { _id: user._id, state: { $in: spec.from } },
      { $set: { state: spec.to } },
      { session },
    );
    if (!changed) {
      throw new AppError(409, 'CONFLICT', 'The account is not in a state that allows this.');
    }
    // One audit entry per department, so each department's history shows the change.
    for (const departmentId of departmentIds) {
      await record({
        actor,
        action: spec.audit,
        scope_department_id: departmentId,
        target: { type: 'user', id: user._id },
        old_value: { state: changed.state },
        new_value: { state: spec.to, ...(reason && { reason }) },
        session,
      });
    }
  });
  // AUTH-23: the teacher can no longer sign in, so every open session ends.
  if (action !== 'reactivate') await endAllSessions(user._id);
  return { id: String(user._id), state: spec.to };
}

/** The teacher accounts of one department (name and state only, no email), for the Teachers page. */
export async function listTeacherAccounts(actor, departmentId) {
  assertCan(actor, 'teacher.manage', { department_id: departmentId });
  const roles = await UserRole.find({
    role: 'teacher',
    department_id: departmentId,
    ended_at: null,
  }).lean();
  const users = await User.find({ _id: { $in: roles.map((r) => r.user_id) } })
    .select('full_name state')
    .sort({ full_name: 1 })
    .lean();
  const linked = new Set(
    (
      await Teacher.find({ department_id: departmentId, user_id: { $type: 'objectId' } })
        .select('user_id')
        .lean()
    ).map((t) => String(t.user_id)),
  );
  return users.map((u) => ({
    id: String(u._id),
    full_name: u.full_name,
    state: u.state,
    linked: linked.has(String(u._id)),
  }));
}

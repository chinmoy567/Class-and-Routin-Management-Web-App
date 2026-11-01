import mongoose from 'mongoose';
import { User, UserRole, UserRoleGuard } from './auth.model.js';
import { cancelTokens, createToken } from './tokens.service.js';
import { endAllSessions } from './sessions.js';
import { assertCan } from '../../policy/index.js';
import { getConfig } from '../../config.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';
import {
  claimAdminAlert,
  clearAdminAlert,
  departmentNames,
  isActiveDepartment,
  listDepartmentsForCoverage,
} from '../organisation/index.js';
import { enqueue } from '../notifications/index.js';

const GUARD_ID = 'admin_roles';
const RESET_TTL_MS = 60 * 60 * 1000;
const ACTIVE = { ended_at: null };
const idOk = (id) => /^[a-f0-9]{24}$/i.test(String(id));
const same = (a, b) => String(a) === String(b);
const notFound = (what = 'Not found.') => new AppError(404, 'NOT_FOUND', what);
const selfForbidden = () =>
  new AppError(403, 'FORBIDDEN', 'You cannot change your own admin roles.');

// ---------------------------------------------------------------------------------------------
// The guard document: grants and removals write it first, so they run one after the other.
// ---------------------------------------------------------------------------------------------

async function ensureGuard() {
  try {
    await UserRoleGuard.updateOne(
      { _id: GUARD_ID },
      { $setOnInsert: { version: 0 } },
      { upsert: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err; // another request created it first
  }
}
const touchGuard = (session) =>
  UserRoleGuard.updateOne({ _id: GUARD_ID }, { $inc: { version: 1 } }, { session });

/** Active super-admin roles that sit on an active account. */
async function activeSuperAdminUserIds(session) {
  const roles = await UserRole.find({ role: 'super_admin', ...ACTIVE })
    .select('user_id')
    .session(session ?? null)
    .lean();
  if (!roles.length) return [];
  const users = await User.find({ _id: { $in: roles.map((r) => r.user_id) }, state: 'active' })
    .select('_id')
    .session(session ?? null)
    .lean();
  return users.map((u) => String(u._id));
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** DEP-07: the admin accounts with their active roles, and whether the "two super admins" rule is met. */
export async function listAdmins(actor) {
  assertCan(actor, 'admin_role.manage');
  const roles = await UserRole.find({ role: { $in: ['super_admin', 'dept_admin'] }, ...ACTIVE })
    .sort({ granted_at: 1 })
    .lean();
  const users = await User.find({ _id: { $in: roles.map((r) => r.user_id) } })
    .select('full_name kind state')
    .lean();
  const names = await departmentNames(roles.map((r) => r.department_id).filter(Boolean));
  const byUser = new Map(users.map((u) => [String(u._id), u]));
  const admins = new Map();
  for (const r of roles) {
    const user = byUser.get(String(r.user_id));
    if (!user) continue;
    const entry = admins.get(String(user._id)) ?? {
      user_id: String(user._id),
      full_name: user.full_name,
      kind: user.kind,
      state: user.state,
      roles: [],
    };
    entry.roles.push({
      id: String(r._id),
      role: r.role,
      department: r.department_id
        ? { id: String(r.department_id), ...(names.get(String(r.department_id)) ?? {}) }
        : null,
      granted_at: r.granted_at ?? null,
    });
    admins.set(String(user._id), entry);
  }
  const superAdmins = (await activeSuperAdminUserIds()).length;
  return {
    admins: [...admins.values()],
    super_admin_count: superAdmins,
    fewer_than_two_super_admins: superAdmins < 2,
  };
}

/** The picker for a new admin: verified, active accounts by name. No email, no phone. */
export async function searchEligibleUsers(actor, q) {
  assertCan(actor, 'admin_role.manage');
  const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const users = await User.find({
    state: 'active',
    email_verified_at: { $exists: true },
    full_name: { $regex: pattern, $options: 'i' },
  })
    .sort({ full_name: 1 })
    .limit(20)
    .select('full_name kind department_id')
    .lean();
  const names = await departmentNames(users.map((u) => u.department_id).filter(Boolean));
  return users.map((u) => ({
    id: String(u._id),
    full_name: u.full_name,
    kind: u.kind,
    department: u.department_id
      ? { id: String(u.department_id), ...(names.get(String(u.department_id)) ?? {}) }
      : null,
  }));
}

// ---------------------------------------------------------------------------------------------
// Grant and remove
// ---------------------------------------------------------------------------------------------

/** After the commit: the target's sessions end (DEP-09), they are told, coverage is checked (DEP-12). */
async function afterRoleChange(userId, change) {
  await endAllSessions(userId);
  await enqueue({ to_user_id: userId, template: 'admin_role_changed', data: change });
  await runCoverageCheck();
}

/** DEP-05, DEP-06, DEP-08, DEP-09, DEP-10 */
export async function grantAdminRole(actor, { user_id, role, department_id }) {
  assertCan(actor, 'admin_role.manage');
  if (same(user_id, actor._id)) throw selfForbidden();
  if (role === 'dept_admin' && !(await isActiveDepartment(department_id))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      department_id: 'Choose a department from the list.',
    });
  }
  await ensureGuard();
  let granted;
  try {
    granted = await withTransaction(async (session) => {
      await touchGuard(session);
      const target = await User.findById(user_id)
        .select('full_name state email_verified_at')
        .session(session)
        .lean();
      if (!target) throw notFound('User not found.');
      if (target.state !== 'active' || !target.email_verified_at) {
        throw new AppError(
          422,
          'USER_NOT_ELIGIBLE',
          'Only an active account with a verified email can become an admin.',
        );
      }
      const scope = role === 'dept_admin' ? { department_id } : {};
      if (await UserRole.exists({ user_id, role, ...scope, ...ACTIVE }).session(session)) {
        throw new AppError(409, 'CONFLICT', 'This account already holds that role.');
      }
      const [doc] = await UserRole.create(
        [{ user_id, role, ...scope, granted_by: actor._id, granted_at: clock.now() }],
        { session },
      );
      await record({
        actor,
        action: 'admin_role.grant',
        scope_department_id: department_id,
        target: { type: 'user', id: new mongoose.Types.ObjectId(user_id) },
        new_value: { role, department_id: department_id ?? null, role_id: doc._id },
        session,
      });
      return { id: String(doc._id), role, department_id: department_id ?? null, user_id };
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new AppError(409, 'CONFLICT', 'This account already holds that role.');
    }
    throw err;
  }
  await afterRoleChange(user_id, { change: 'granted', role });
  return granted;
}

/** DEP-07, DEP-08, DEP-09, DEP-10 */
export async function removeAdminRole(actor, roleId) {
  assertCan(actor, 'admin_role.manage');
  if (!idOk(roleId)) throw notFound();
  const found = await UserRole.findOne({
    _id: roleId,
    role: { $in: ['super_admin', 'dept_admin'] },
    ...ACTIVE,
  }).lean();
  if (!found) throw notFound('That role was not found or was already removed.');
  if (same(found.user_id, actor._id)) throw selfForbidden();
  await ensureGuard();
  await withTransaction(async (session) => {
    await touchGuard(session);
    if (found.role === 'super_admin') {
      const remaining = (await activeSuperAdminUserIds(session)).filter(
        (id) => !same(id, found.user_id),
      );
      if (!remaining.length) {
        throw new AppError(409, 'LAST_SUPER_ADMIN', 'The last super admin cannot be removed.');
      }
    }
    // First action wins: only a role that is still in effect can be ended.
    const ended = await UserRole.findOneAndUpdate(
      { _id: found._id, ...ACTIVE },
      { $set: { ended_at: clock.now(), ended_by: actor._id } },
      { session },
    );
    if (!ended) throw notFound('That role was not found or was already removed.');
    await record({
      actor,
      action: 'admin_role.remove',
      scope_department_id: found.department_id,
      target: { type: 'user', id: found.user_id },
      old_value: {
        role: found.role,
        department_id: found.department_id ?? null,
        role_id: found._id,
      },
      session,
    });
  });
  await afterRoleChange(found.user_id, { change: 'removed', role: found.role });
}

// ---------------------------------------------------------------------------------------------
// Recovery (DEP-11)
// ---------------------------------------------------------------------------------------------

async function adminTarget(actor, userId) {
  assertCan(actor, 'admin_role.manage');
  if (!idOk(userId)) throw notFound();
  if (same(userId, actor._id)) throw selfForbidden();
  const [user, role] = await Promise.all([
    User.findById(userId).select('full_name state').lean(),
    UserRole.exists({ user_id: userId, role: { $in: ['super_admin', 'dept_admin'] }, ...ACTIVE }),
  ]);
  if (!user || !role) throw notFound('Admin account not found.');
  return user;
}

/** Sends a one-hour reset link to the admin's own email. The address is never returned. */
export async function resetAdminPassword(actor, userId) {
  const target = await adminTarget(actor, userId);
  await withTransaction(async (session) => {
    await cancelTokens(target._id, 'reset_password', { session });
    const token = await createToken({
      userId: target._id,
      purpose: 'reset_password',
      ttlMs: RESET_TTL_MS,
      session,
    });
    await record({
      actor,
      action: 'admin.password_reset',
      target: { type: 'user', id: target._id },
      session,
    });
    afterCommit(() =>
      enqueue({
        to_user_id: target._id,
        template: 'admin_password_reset',
        data: {
          name: target.full_name,
          link: `${getConfig().APP_URL}/reset-password?token=${token}`,
        },
      }),
    );
  });
  await endAllSessions(target._id);
}

/** Clears the authenticator: the admin must set it up again at the next sign-in. */
export async function resetAdminSecondStep(actor, userId) {
  const target = await adminTarget(actor, userId);
  await withTransaction(async (session) => {
    await User.updateOne(
      { _id: target._id },
      { $unset: { totp_secret_enc: 1, totp_enabled_at: 1 } },
      { session },
    );
    await record({
      actor,
      action: 'admin.second_step_reset',
      target: { type: 'user', id: target._id },
      session,
    });
    afterCommit(() =>
      enqueue({
        to_user_id: target._id,
        template: 'admin_second_step_reset',
        data: { name: target.full_name },
      }),
    );
  });
  await endAllSessions(target._id);
}

// ---------------------------------------------------------------------------------------------
// Coverage (DEP-12)
// ---------------------------------------------------------------------------------------------

/** Departments (not retired) with no `dept_admin` role on an active account. */
export async function findDepartmentsWithoutActiveAdmin() {
  const departments = await listDepartmentsForCoverage();
  const roles = await UserRole.find({ role: 'dept_admin', ...ACTIVE })
    .select('user_id department_id')
    .lean();
  const activeUsers = new Set(
    (
      await User.find({ _id: { $in: roles.map((r) => r.user_id) }, state: 'active' })
        .select('_id')
        .lean()
    ).map((u) => String(u._id)),
  );
  const covered = new Set(
    roles.filter((r) => activeUsers.has(String(r.user_id))).map((r) => String(r.department_id)),
  );
  return departments.filter((d) => !covered.has(String(d._id)));
}

/**
 * Emails every super admin once per uncovered department, and forgets the alert when an admin
 * is back. Safe to run twice at once: `claimAdminAlert` lets only one run send.
 */
export async function runCoverageCheck() {
  const uncovered = await findDepartmentsWithoutActiveAdmin();
  const uncoveredIds = new Set(uncovered.map((d) => String(d._id)));
  for (const d of await listDepartmentsForCoverage()) {
    if (!uncoveredIds.has(String(d._id)) && d.admin_alert_sent_at) await clearAdminAlert(d._id);
  }
  let sent = 0;
  const superAdmins = uncovered.length ? await activeSuperAdminUserIds() : [];
  for (const d of uncovered) {
    if (d.admin_alert_sent_at || !(await claimAdminAlert(d._id))) continue;
    for (const userId of superAdmins) {
      await enqueue({
        to_user_id: userId,
        template: 'no_active_admin',
        data: {
          department: `${d.code} ${d.name}`,
          link: `${getConfig().APP_URL}/admin/admins`,
        },
      });
    }
    sent += 1;
  }
  return { alerted: sent };
}

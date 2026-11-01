import { TeacherRegistration, Teacher } from './teachers.model.js';
import { adminDepartmentIds, idOk } from './scope.js';
import { assertCan } from '../../policy/index.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';
import { User, UserRole, getEmailAddress } from '../auth/index.js';
import { departmentNames, isActiveDepartment } from '../organisation/index.js';
import { enqueue } from '../notifications/index.js';
import { getConfig } from '../../config.js';
import { notifyLinkChanged } from './directory.service.js';

const alreadyDecided = () =>
  new AppError(409, 'ALREADY_DECIDED', 'This registration was already decided.');
const invalid = (fields) =>
  new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', fields);
const waiting = () => new AppError(409, 'CONFLICT', 'You already have a registration waiting.');

/** TCH-01: called inside the email-verification transaction of a teacher. */
export async function createPendingRegistration(user, session) {
  if (!user.department_id || !user.requested_short_code) return;
  await TeacherRegistration.create(
    [
      {
        user_id: user._id,
        department_id: user.department_id,
        requested_short_code: user.requested_short_code,
      },
    ],
    { session },
  );
}

const latestOf = (userId) =>
  TeacherRegistration.findOne({ user_id: userId }).sort({ created_at: -1, _id: -1 }).lean();

/** AUTH-29: a pending teacher whose latest registration was rejected sees the rejected screen. */
export async function pendingScreen(user) {
  if (user.kind !== 'teacher') return 'waiting-approval';
  const latest = await latestOf(user._id);
  return latest?.status === 'rejected' ? 'teacher-rejected' : 'waiting-approval';
}

const regView = (r) => ({
  id: String(r._id),
  department_id: String(r.department_id),
  requested_short_code: r.requested_short_code,
  status: r.status,
  reason: r.reason ?? null,
  created_at: r.created_at,
  decided_at: r.decided_at ?? null,
});

/** The teacher's own latest registration (for the waiting and rejected screens). */
export async function myRegistration(actor) {
  assertCan(actor, 'teacher.apply');
  const latest = await latestOf(actor._id);
  if (!latest) return null;
  const names = await departmentNames([latest.department_id]);
  return { ...regView(latest), department: names.get(String(latest.department_id)) ?? null };
}

/** TCH-02: includes the email (a privacy exception) and the earlier rejections. */
export async function listRegistrations(actor, { status = 'pending', department_id } = {}) {
  assertCan(actor, 'teacher.admin_list');
  const scope = adminDepartmentIds(actor);
  const filter = { status };
  if (department_id) {
    assertCan(actor, 'teacher.manage', { department_id });
    filter.department_id = department_id;
  } else if (scope) {
    filter.department_id = { $in: scope };
  }
  const rows = await TeacherRegistration.find(filter).sort({ created_at: 1 }).lean();
  const userIds = rows.map((r) => r.user_id);
  const [users, rejected, names] = await Promise.all([
    User.find({ _id: { $in: userIds } })
      .select('full_name')
      .lean(),
    TeacherRegistration.find({ user_id: { $in: userIds }, status: 'rejected' })
      .sort({ created_at: 1 })
      .lean(),
    departmentNames(rows.map((r) => r.department_id)),
  ]);
  const nameOf = new Map(users.map((u) => [String(u._id), u.full_name]));
  return Promise.all(
    rows.map(async (r) => ({
      ...regView(r),
      user_id: String(r.user_id),
      full_name: nameOf.get(String(r.user_id)) ?? '',
      email: await getEmailAddress(r.user_id),
      department: names.get(String(r.department_id)) ?? null,
      earlier_rejections: rejected
        .filter((e) => String(e.user_id) === String(r.user_id) && String(e._id) !== String(r._id))
        .map((e) => ({
          reason: e.reason,
          department_id: String(e.department_id),
          requested_short_code: e.requested_short_code,
          decided_at: e.decided_at,
        })),
    })),
  );
}

/** TCH-03, TCH-04, TCH-06: first action wins. */
export async function decide(actor, id, body) {
  const reg = idOk(id) ? await TeacherRegistration.findById(id).lean() : null;
  if (!reg) throw notFound('Registration not found.');
  assertCan(actor, 'teacher.manage', { department_id: reg.department_id });

  const approve = body.decision === 'approve';
  const decidedAt = clock.now();
  const linkedUser = await withTransaction(async (session) => {
    const won = await TeacherRegistration.findOneAndUpdate(
      { _id: reg._id, status: 'pending' },
      {
        $set: {
          status: approve ? 'approved' : 'rejected',
          decided_by: actor._id,
          decided_at: decidedAt,
          ...(!approve && { reason: body.reason }),
        },
      },
      { session },
    );
    if (!won) throw alreadyDecided();

    const user = await User.findById(reg.user_id).select('full_name').session(session).lean();
    let linked = null;
    if (approve) {
      const activated = await User.findOneAndUpdate(
        { _id: reg.user_id, kind: 'teacher', state: 'pending' },
        {
          $set: {
            state: 'active',
            department_id: reg.department_id,
            requested_short_code: reg.requested_short_code,
          },
        },
        { session },
      );
      if (!activated) throw alreadyDecided();
      await UserRole.create(
        [
          {
            user_id: reg.user_id,
            role: 'teacher',
            department_id: reg.department_id,
            granted_by: actor._id,
            granted_at: decidedAt,
          },
        ],
        { session },
      );
      // Link in the same step: the admin's chosen record, or the one matching the requested code.
      const unlinked = { user_id: { $not: { $type: 'objectId' } } };
      const filter = body.teacher_id
        ? { _id: body.teacher_id, department_id: reg.department_id, ...unlinked }
        : { department_id: reg.department_id, short_code: reg.requested_short_code, ...unlinked };
      linked = await Teacher.findOneAndUpdate(
        filter,
        { $set: { user_id: reg.user_id } },
        { session, returnDocument: 'after' },
      );
      if (body.teacher_id && !linked) {
        throw new AppError(409, 'CONFLICT', 'That teacher record is missing or already linked.');
      }
    }

    await record({
      actor,
      action: approve ? 'teacher.registration.approve' : 'teacher.registration.reject',
      scope_department_id: reg.department_id,
      target: { type: 'teacher_registration', id: reg._id },
      old_value: { status: 'pending' },
      new_value: {
        status: approve ? 'approved' : 'rejected',
        user_id: String(reg.user_id),
        ...(linked && { teacher_id: String(linked._id) }),
        ...(!approve && { reason: body.reason }),
      },
      session,
    });
    afterCommit(() =>
      enqueue({
        to_user_id: reg.user_id,
        template: approve ? 'teacher_approved' : 'teacher_rejected',
        data: {
          name: user?.full_name ?? '',
          link: `${getConfig().APP_URL}/login`,
          reason: body.reason ?? '',
        },
      }),
    );
    return linked ? reg.user_id : null;
  });
  if (linkedUser) await notifyLinkChanged(linkedUser);
  return { id: String(reg._id), status: approve ? 'approved' : 'rejected' };
}

/** TCH-05: a rejected teacher corrects the department and code and applies again. */
export async function applyAgain(actor, { department_id, short_code }) {
  assertCan(actor, 'teacher.apply');
  if (!(await isActiveDepartment(department_id))) {
    throw invalid({ department_id: 'Choose a department from the list.' });
  }
  try {
    const created = await withTransaction(async (session) => {
      if (
        await TeacherRegistration.exists({ user_id: actor._id, status: 'pending' }).session(session)
      ) {
        throw waiting();
      }
      const [reg] = await TeacherRegistration.create(
        [{ user_id: actor._id, department_id, requested_short_code: short_code }],
        { session },
      );
      await User.updateOne(
        { _id: actor._id },
        { $set: { department_id, requested_short_code: short_code } },
        { session },
      );
      return reg;
    });
    return regView(created.toObject());
  } catch (err) {
    // Two requests at once: the partial unique index lets only one pending registration in.
    if (err?.code === 11000) throw waiting();
    throw err;
  }
}

import { Teacher } from './teachers.model.js';
import { adminDepartmentIds, idOk } from './scope.js';
import { assertCan } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { record } from '../audit/index.js';
import { User, UserRole } from '../auth/index.js';
import { isActiveDepartment } from '../organisation/index.js';

export const RESERVED_CODE = 'TBA'; // TCH-15: "Teacher to be announced", never a record

const isDuplicate = (err) => err?.code === 11000;
const unlinkedFilter = { user_id: { $not: { $type: 'objectId' } } };

// TCH-10: spec 12 registers a listener to drop the teacher's routine cache.
const listeners = [];
export function registerLinkChangeListener(fn) {
  listeners.push(fn);
}
export async function notifyLinkChanged(userId) {
  for (const fn of listeners) await fn(userId);
}

// TCH-16: spec 07 registers `(teacherIds) => sections[]` over the published slots.
const sectionProviders = [];
export function registerSectionsProvider(fn) {
  sectionProviders.push(fn);
}
/** For tests: forget every registered listener and provider. */
export function resetTeacherProviders() {
  listeners.length = 0;
  sectionProviders.length = 0;
}

const view = (t, linkedUser) => ({
  id: String(t._id),
  department_id: String(t.department_id),
  short_code: t.short_code,
  full_name: t.full_name,
  created_from: t.created_from,
  linked: Boolean(t.user_id),
  linked_user: t.user_id
    ? { id: String(t.user_id), full_name: linkedUser?.full_name ?? '', state: linkedUser?.state }
    : null,
});

async function loadRecord(id) {
  const rec = idOk(id) ? await Teacher.findById(id).lean() : null;
  if (!rec) throw notFound('Teacher record not found.');
  return rec;
}

/** TCH-07 (admin list) with link status. */
export async function listTeachers(actor, departmentId) {
  assertCan(actor, 'teacher.admin_list');
  const filter = {};
  if (departmentId) {
    assertCan(actor, 'teacher.manage', { department_id: departmentId });
    filter.department_id = departmentId;
  } else {
    const scope = adminDepartmentIds(actor);
    if (scope) filter.department_id = { $in: scope };
  }
  const rows = await Teacher.find(filter).sort({ department_id: 1, short_code: 1 }).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.user_id).filter(Boolean) } })
    .select('full_name state')
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((r) => view(r, byId.get(String(r.user_id))));
}

/** TCH-07: added by hand. */
export async function createTeacher(actor, { department_id, short_code, full_name }) {
  assertCan(actor, 'teacher.manage', { department_id });
  if (short_code === RESERVED_CODE) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      short_code: 'TBA is reserved.',
    });
  }
  if (!(await isActiveDepartment(department_id))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      department_id: 'Choose an active department.',
    });
  }
  try {
    return await withTransaction(async (session) => {
      const [rec] = await Teacher.create(
        [{ department_id, short_code, full_name, created_from: 'manual' }],
        { session },
      );
      await record({
        actor,
        action: 'teacher.record.create',
        scope_department_id: department_id,
        target: { type: 'teacher', id: rec._id },
        new_value: { short_code, full_name },
        session,
      });
      return view(rec.toObject());
    });
  } catch (err) {
    if (isDuplicate(err)) throw new AppError(409, 'CONFLICT', 'That short code is already used.');
    throw err;
  }
}

export async function updateTeacher(actor, id, { full_name }) {
  const rec = await loadRecord(id);
  assertCan(actor, 'teacher.manage', { department_id: rec.department_id });
  return withTransaction(async (session) => {
    const updated = await Teacher.findByIdAndUpdate(
      rec._id,
      { $set: { full_name } },
      { session, returnDocument: 'after' },
    ).lean();
    await record({
      actor,
      action: 'teacher.record.update',
      scope_department_id: rec.department_id,
      target: { type: 'teacher', id: rec._id },
      old_value: { full_name: rec.full_name },
      new_value: { full_name },
      session,
    });
    return view(updated);
  });
}

/** TCH-08, TCH-10 */
export async function linkTeacher(actor, id, userId) {
  const rec = await loadRecord(id);
  assertCan(actor, 'teacher.manage', { department_id: rec.department_id });
  const user = await User.findById(userId).select('kind state full_name').lean();
  const holdsRole = user
    ? await UserRole.exists({
        user_id: user._id,
        role: 'teacher',
        department_id: rec.department_id,
        ended_at: null,
      })
    : null;
  if (!user || user.kind !== 'teacher' || user.state !== 'active' || !holdsRole) {
    throw new AppError(422, 'USER_NOT_ELIGIBLE', 'This account cannot be linked to that record.');
  }
  try {
    const result = await withTransaction(async (session) => {
      const updated = await Teacher.findOneAndUpdate(
        { _id: rec._id, ...unlinkedFilter },
        { $set: { user_id: user._id } },
        { session, returnDocument: 'after' },
      ).lean();
      if (!updated) throw new AppError(409, 'CONFLICT', 'That record is already linked.');
      await record({
        actor,
        action: 'teacher.link',
        scope_department_id: rec.department_id,
        target: { type: 'teacher', id: rec._id },
        new_value: { user_id: String(user._id), short_code: rec.short_code },
        session,
      });
      return view(updated, user);
    });
    await notifyLinkChanged(user._id);
    return result;
  } catch (err) {
    if (isDuplicate(err)) {
      throw new AppError(409, 'CONFLICT', 'That account is already linked in this department.');
    }
    throw err;
  }
}

export async function unlinkTeacher(actor, id) {
  const rec = await loadRecord(id);
  assertCan(actor, 'teacher.manage', { department_id: rec.department_id });
  const result = await withTransaction(async (session) => {
    const updated = await Teacher.findOneAndUpdate(
      { _id: rec._id, user_id: { $type: 'objectId' } },
      { $unset: { user_id: 1 } },
      { session, returnDocument: 'after' },
    ).lean();
    if (!updated) throw new AppError(409, 'CONFLICT', 'That record is not linked.');
    await record({
      actor,
      action: 'teacher.unlink',
      scope_department_id: rec.department_id,
      target: { type: 'teacher', id: rec._id },
      old_value: { user_id: String(rec.user_id), short_code: rec.short_code },
      session,
    });
    return view(updated);
  });
  await notifyLinkChanged(rec.user_id);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Exports for the routine modules
// ---------------------------------------------------------------------------------------------

/** TCH-15: `TBA` is never a record. */
export async function findByCode(departmentId, shortCode) {
  const code = String(shortCode ?? '')
    .trim()
    .toUpperCase();
  if (!code || code === RESERVED_CODE) return null;
  return Teacher.findOne({ department_id: departmentId, short_code: code }).lean();
}

/** TCH-15, TCH-14: a Map of id to full name; removed teachers keep their names. */
export async function fullNames(ids) {
  const rows = await Teacher.find({ _id: { $in: ids } })
    .select('full_name')
    .lean();
  return new Map(rows.map((r) => [String(r._id), r.full_name]));
}

/** The records linked to an account (one per department at most). */
export const recordsOf = (userId) => Teacher.find({ user_id: userId }).lean();

/** TCH-16: always worked out on the server from the routine, never from the request. */
export async function sectionsTaughtBy(userId) {
  const records = await recordsOf(userId);
  if (!records.length) return [];
  const ids = records.map((r) => r._id);
  const lists = await Promise.all(sectionProviders.map((fn) => fn(ids)));
  return lists.flat();
}

export const departmentHasTeachers = async (departmentId) =>
  Boolean(await Teacher.exists({ department_id: departmentId }));

/** TCH-11: the teacher block of the profile. */
export async function profileBlock(user) {
  const rec = (await recordsOf(user._id))[0];
  return {
    department_id: user.department_id ?? null,
    short_code: rec?.short_code ?? null,
    linked: Boolean(rec),
  };
}

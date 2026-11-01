import { Department } from './organisation.model.js';
import { assertCan } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';

const view = (d) => ({
  id: String(d._id),
  code: d.code,
  name: d.name,
  retired: Boolean(d.retired),
});

// DEP-02, DEP-03: sections, rooms, teachers and routines arrive in later specs. Each registers
// what it knows here. Until then nothing uses a department.
const providers = { codeLocked: [], inUseBySemester: [] };
export function registerDepartmentUsage({ codeLocked, inUseBySemester } = {}) {
  if (codeLocked) providers.codeLocked.push(codeLocked);
  if (inUseBySemester) providers.inUseBySemester.push(inUseBySemester);
}
/** For tests: forget every registered provider. */
export function resetDepartmentUsage() {
  providers.codeLocked = [];
  providers.inUseBySemester = [];
}
async function anyTrue(list, id) {
  for (const fn of list) if (await fn(id)) return true;
  return false;
}

const isDuplicate = (err) => err?.code === 11000;
const idOk = (id) => /^[a-f0-9]{24}$/i.test(String(id));
const taken = () => new AppError(409, 'CONFLICT', 'That department code is taken.');

/** DEP-04: what sign-up and the join form show. */
export async function listActiveDepartments() {
  const rows = await Department.find({ retired: false }).sort({ code: 1 }).lean();
  return rows.map(view);
}

/** Admin list: retired ones too. */
export async function listAllDepartments(actor) {
  assertCan(actor, 'department.manage');
  const rows = await Department.find().sort({ code: 1 }).lean();
  return rows.map(view);
}

export async function getDepartment(id) {
  if (!idOk(id)) return null;
  const d = await Department.findById(id).lean();
  return d ? view(d) : null;
}

/** Sign-up (spec 01) and the admin grant: an existing department that is not retired. */
export async function isActiveDepartment(id) {
  if (!idOk(id)) return false;
  return Boolean(await Department.exists({ _id: id, retired: false }));
}

export async function createDepartment(actor, { code, name }) {
  assertCan(actor, 'department.manage');
  try {
    return await withTransaction(async (session) => {
      const [d] = await Department.create([{ code, name }], { session });
      await record({
        actor,
        action: 'department.create',
        scope_department_id: d._id,
        target: { type: 'department', id: d._id },
        new_value: { code, name },
        session,
      });
      return view(d);
    });
  } catch (err) {
    if (isDuplicate(err)) throw taken();
    throw err;
  }
}

export async function updateDepartment(actor, id, { code, name }) {
  assertCan(actor, 'department.manage');
  const current = idOk(id) ? await Department.findById(id).lean() : null;
  if (!current) throw new AppError(404, 'NOT_FOUND', 'Department not found.');
  const set = {};
  if (name !== undefined && name !== current.name) set.name = name;
  if (code !== undefined && code !== current.code) {
    if (await anyTrue(providers.codeLocked, current._id)) {
      throw new AppError(
        409,
        'CODE_LOCKED',
        'The code can no longer change because the department is in use.',
      );
    }
    set.code = code;
  }
  if (!Object.keys(set).length) return view(current);
  try {
    return await withTransaction(async (session) => {
      const updated = await Department.findOneAndUpdate(
        { _id: current._id },
        { $set: set },
        { returnDocument: 'after', session },
      ).lean();
      await record({
        actor,
        action: 'department.rename',
        scope_department_id: current._id,
        target: { type: 'department', id: current._id },
        old_value: { code: current.code, name: current.name },
        new_value: { code: updated.code, name: updated.name },
        session,
      });
      return view(updated);
    });
  } catch (err) {
    if (isDuplicate(err)) throw taken();
    throw err;
  }
}

export async function retireDepartment(actor, id) {
  assertCan(actor, 'department.manage');
  const current = idOk(id) ? await Department.findById(id).lean() : null;
  if (!current) throw new AppError(404, 'NOT_FOUND', 'Department not found.');
  if (await anyTrue(providers.inUseBySemester, current._id)) {
    throw new AppError(
      409,
      'DEPARTMENT_IN_USE',
      'A section of the current or draft semester still uses this department.',
    );
  }
  return withTransaction(async (session) => {
    const updated = await Department.findOneAndUpdate(
      { _id: current._id },
      { $set: { retired: true, retired_at: clock.now() } },
      { returnDocument: 'after', session },
    ).lean();
    if (!current.retired) {
      await record({
        actor,
        action: 'department.retire',
        scope_department_id: current._id,
        target: { type: 'department', id: current._id },
        old_value: { retired: false },
        new_value: { retired: true },
        session,
      });
    }
    return view(updated);
  });
}

// Coverage support (DEP-12): the auth module decides who the active admins are; the department
// only remembers whether the alert was already sent.
export const listDepartmentsForCoverage = () =>
  Department.find({ retired: false }).select('code name admin_alert_sent_at').lean();

/** First caller wins: true only for the call that marked the alert as sent. */
export async function claimAdminAlert(id) {
  const res = await Department.updateOne(
    { _id: id, admin_alert_sent_at: { $exists: false } },
    { $set: { admin_alert_sent_at: clock.now() } },
  );
  return res.modifiedCount === 1;
}
export const clearAdminAlert = (id) =>
  Department.updateOne({ _id: id }, { $unset: { admin_alert_sent_at: 1 } });

export async function departmentNames(ids) {
  const rows = await Department.find({ _id: { $in: ids } })
    .select('code name')
    .lean();
  return new Map(rows.map((d) => [String(d._id), { code: d.code, name: d.name }]));
}

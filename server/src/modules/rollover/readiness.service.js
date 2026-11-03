// ROL-01, ROL-02: the readiness checklist of each department for the draft semester.
import { assertCan, can, hasRole } from '../../policy/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { getSemester, listActiveDepartments } from '../organisation/index.js';
import { hasPublishedCleanImport, listSectionsBrief } from '../routine/index.js';
import { sectionIdsWithCr } from '../representatives/index.js';
import { countActiveRoomsOf } from '../rooms/index.js';

/** The four checks for one department. `reasons` lists what is missing, by code. */
async function checkDepartment(semesterId, department) {
  const sections = await listSectionsBrief(semesterId, department.id);
  const withCr = await sectionIdsWithCr(sections.map((s) => s.id));
  const withoutCr = sections.filter((s) => !withCr.has(s.id)).length;
  const hasImport = await hasPublishedCleanImport(semesterId, department.id);
  const rooms = await countActiveRoomsOf(department.id);
  const reasons = [];
  if (sections.length === 0) reasons.push('no_sections');
  if (!hasImport) reasons.push('no_import');
  if (withoutCr > 0) reasons.push('sections_without_cr');
  if (rooms === 0) reasons.push('no_rooms');
  return {
    id: department.id,
    code: department.code,
    name: department.name,
    ready: reasons.length === 0,
    items: {
      sections: { ok: sections.length > 0, count: sections.length },
      import: { ok: hasImport },
      cr: { ok: withoutCr === 0, total: sections.length, without_cr: withoutCr },
      rooms: { ok: rooms > 0, count: rooms },
    },
    reasons,
  };
}

/** All active departments, checked. No scope applied here. */
export async function computeReadiness(semesterId) {
  const departments = await listActiveDepartments();
  const out = [];
  for (const d of departments) out.push(await checkDepartment(semesterId, d));
  return out;
}

/** ROL-02: the checklists the actor may see. A super admin gets all, a dept admin their own. */
export async function readinessFor(actor, semesterId) {
  assertCan(actor, 'rollover.view');
  const semester = await getSemester(semesterId);
  if (!semester || semester.status !== 'draft') throw notFound('Semester not found.');
  const all = await computeReadiness(semester.id);
  const visible = all.filter((d) => can(actor, 'rollover.readiness', { department_id: d.id }));
  return {
    semester: { id: semester.id, name: semester.name, status: semester.status },
    can_make_current: hasRole(actor, 'super_admin') && actor.state === 'active',
    departments: visible,
  };
}

export const notReadyError = (departments) => {
  const err = new AppError(409, 'NOT_READY_UNCONFIRMED', 'Some departments are not ready.');
  err.extra = { departments: departments.map((d) => ({ code: d.code, reasons: d.reasons })) };
  return err;
};

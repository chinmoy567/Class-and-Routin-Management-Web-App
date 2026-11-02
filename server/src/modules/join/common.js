import { assertCan, can, hasRole } from '../../policy/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { getSectionBrief } from '../routine/index.js';
import { departmentNames, getSemester } from '../organisation/index.js';
import { getConfig } from '../../config.js';

export const idOk = (id) => /^[a-f0-9]{24}$/i.test(String(id));
export const sectionLetters = (s) => `${s.level}-${s.term}-${s.letter}`;
export const link = () => `${getConfig().APP_URL}/login`;

export const alreadyDecided = () =>
  new AppError(409, 'ALREADY_DECIDED', 'Someone already decided this request.');
export const conflict = (message) => new AppError(409, 'CONFLICT', message);
export const uvIdTaken = () =>
  new AppError(409, 'UV_ID_TAKEN', 'This UV ID is already approved for another account.');

/** "CSE 2-II-A" */
export async function sectionLabel(section) {
  const names = await departmentNames([section.department_id]);
  return `${names.get(section.department_id)?.code ?? ''} ${sectionLetters(section)}`.trim();
}

export async function loadSectionOr404(id) {
  const section = idOk(id) ? await getSectionBrief(id) : null;
  if (!section) throw notFound('Section not found.');
  return section;
}

export async function assertNotArchived(semesterId) {
  const semester = await getSemester(semesterId);
  if (!semester || semester.status === 'archived') {
    throw new AppError(409, 'SEMESTER_ARCHIVED', 'An archived semester cannot be changed.');
  }
  return semester;
}

/**
 * Check a policy for a section. A CR or DCR of another section gets 404 (they must not learn the
 * request exists); everyone else who fails the check gets 403.
 */
export function authorise(actor, action, section, extra = {}) {
  const resource = { department_id: section.department_id, section_id: section.id, ...extra };
  if (can(actor, action, resource)) return;
  const isAdmin = hasRole(actor, ['super_admin', 'dept_admin']);
  const isRep = hasRole(actor, ['cr', 'dcr']);
  if (isRep && !isAdmin && !hasRole(actor, ['cr', 'dcr'], { section_id: section.id })) {
    throw notFound();
  }
  assertCan(actor, action, resource);
}

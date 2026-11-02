import { assertCan } from '../../policy/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { getSectionBrief } from '../routine/index.js';
import { departmentNames, getSemester } from '../organisation/index.js';

export const label = (s) => `${s.level}-${s.term}-${s.letter}`;

/** The section and its semester, or 404. */
export async function loadSection(id) {
  const section = await getSectionBrief(id);
  if (!section) throw notFound('Section not found.');
  const semester = await getSemester(section.semester_id);
  return { section, semester };
}

/** "CSE 2-II-A" */
export async function sectionName(section) {
  const names = await departmentNames([section.department_id]);
  return `${names.get(section.department_id)?.code ?? ''} ${label(section)}`.trim();
}

export function assertWritable(semester) {
  if (!semester || semester.status === 'archived') {
    throw new AppError(409, 'SEMESTER_ARCHIVED', 'An archived semester cannot be changed.');
  }
}

export const assertManage = (actor, section) =>
  assertCan(actor, 'representative.manage', { department_id: section.department_id });
export const assertView = (actor, section) =>
  assertCan(actor, 'representative.view', { department_id: section.department_id });

// DSH-13, DSH-16: the teacher's account link and the sections they teach this semester.
import { recordsOf, sectionsTaughtBy } from '../teachers/index.js';
import { countAcceptedBySection } from '../enrolments/index.js';
import { getSectionBrief } from '../routine/index.js';
import { departmentNames } from '../organisation/index.js';
import { sectionLabel } from './student.card.js';

/** DSH-16: the linked short code and name, or `linked: false` for the "not linked yet" notice. */
export async function teacherAccount(actor) {
  const records = await recordsOf(actor._id);
  return {
    linked: records.length > 0,
    records: records.map((r) => ({ short_code: r.short_code, full_name: r.full_name })),
  };
}

/** DSH-13: the sections the teacher teaches (worked out on the server), with student counts. */
export async function teacherSections(actor, semester) {
  const taught = await sectionsTaughtBy(actor._id);
  const ids = [
    ...new Set(taught.filter((t) => t.semester_id === semester.id).map((t) => t.section_id)),
  ];
  if (!ids.length) return [];
  const sections = (await Promise.all(ids.map((id) => getSectionBrief(id)))).filter(Boolean);
  const [dept, counts] = await Promise.all([
    departmentNames([...new Set(sections.map((s) => s.department_id))]),
    countAcceptedBySection(ids, semester.id),
  ]);
  return sections
    .map((s) => ({
      section_id: s.id,
      name: sectionLabel(s, dept.get(s.department_id)?.code),
      student_count: counts.get(s.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

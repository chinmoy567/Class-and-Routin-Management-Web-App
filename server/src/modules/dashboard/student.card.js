// DSH-09, DSH-10: the student's section, its CR/DCRs, the courses of the student's group, and the
// facts the reminders need. Everything is read through the owning modules' index.js.
import { acceptedEnrolmentOf } from '../enrolments/index.js';
import { getGroupBrief, getSectionBrief, sectionCoursesFor } from '../routine/index.js';
import { crDcrOf } from '../representatives/index.js';
import { studentSummaries } from '../auth/index.js';
import { departmentNames } from '../organisation/index.js';

export const sectionLabel = (s, deptCode) =>
  `${deptCode ?? ''} ${s.level}-${s.term}${s.letter ? `-${s.letter}` : ''}`.trim();

const NOT_ENROLLED = {
  enrolled: false,
  group_missing: false,
  section: null,
  representatives: [],
  courses: [],
};

/** DSH-09, DSH-10: the student's accepted enrolment this semester, with its section and courses. */
export async function studentView(actor, semester) {
  const enrolment = await acceptedEnrolmentOf(actor._id, semester.id);
  if (!enrolment) return NOT_ENROLLED;
  const section = await getSectionBrief(String(enrolment.section_id));
  if (!section) return NOT_ENROLLED;

  const groupId = enrolment.group_id ? String(enrolment.group_id) : null;
  const [dept, group, roles, courses] = await Promise.all([
    departmentNames([section.department_id]),
    groupId ? getGroupBrief(groupId) : null,
    crDcrOf(section.id),
    sectionCoursesFor({ semesterId: semester.id, sectionId: section.id, groupId }),
  ]);
  const people = await studentSummaries(roles.map((r) => r.user_id));
  const representatives = roles
    .map((r) => {
      const p = people.get(r.user_id);
      return {
        user_id: r.user_id,
        role: r.role,
        name: p?.full_name ?? '',
        photo: p?.photo_url ?? null,
      };
    })
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'cr' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const myRole = (actor.roles ?? []).find(
    (r) => (r.role === 'cr' || r.role === 'dcr') && String(r.section_id) === section.id,
  );

  return {
    enrolled: true,
    group_missing: !groupId,
    section: {
      id: section.id,
      name: sectionLabel(section, dept.get(section.department_id)?.code),
      level: section.level,
      term: section.term,
      letter: section.letter,
      group: group?.label ?? null,
      my_role: myRole?.role ?? null,
    },
    representatives,
    courses,
  };
}

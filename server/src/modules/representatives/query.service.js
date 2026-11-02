// CRD-06, CRD-07, CRD-11: reading representatives, openness, the summary and the student search.
import { UserRole } from '../auth/auth.model.js';
import { findEligibleStudents, studentSummaries } from '../auth/index.js';
import { findSectionByBatch, getSectionBrief, listSectionsBrief } from '../routine/index.js';
import {
  currentSemester,
  departmentNames,
  getSemester,
  latestArchivedSemester,
} from '../organisation/index.js';
import { assertCan } from '../../policy/index.js';
import { notFound } from '../../lib/errors.js';
import { previousTerm } from './previous-section.js';
import { assertView, label, loadSection, sectionName } from './common.js';

const REP_ROLES = ['cr', 'dcr'];

/** CRD-11: the CR and DCRs in effect (current semester, not ended) for a section. */
export async function crDcrOf(sectionId) {
  const section = await getSectionBrief(sectionId);
  if (!section) return [];
  const semester = await currentSemester();
  if (!semester || semester.id !== section.semester_id) return [];
  const rows = await UserRole.find({
    section_id: section.id,
    role: { $in: REP_ROLES },
    ended_at: null,
  }).lean();
  return rows.map((r) => ({ role_id: String(r._id), user_id: String(r.user_id), role: r.role }));
}

/** CRD-06: open for join requests only in the current semester, not closed, with a CR in effect. */
export async function isOpen(sectionId) {
  const section = await getSectionBrief(sectionId);
  if (!section || section.closed_at) return false;
  return (await crDcrOf(section.id)).some((r) => r.role === 'cr');
}

async function withPeople(rows) {
  const people = await studentSummaries(rows.map((r) => r.user_id));
  return rows
    .map((r) => ({
      role_id: String(r._id),
      user_id: String(r.user_id),
      role: r.role,
      full_name: people.get(String(r.user_id))?.full_name ?? '',
      photo_url: people.get(String(r.user_id))?.photo_url ?? null,
      state: people.get(String(r.user_id))?.state ?? null,
    }))
    .sort((a, b) =>
      a.role === b.role ? a.full_name.localeCompare(b.full_name) : a.role === 'cr' ? -1 : 1,
    );
}

/** CRD-07: last semester's matching section and who held CR/DCR there (removed ones excluded). */
export async function lastSemesterMatch(section, semester) {
  const last =
    semester.status === 'draft' ? await currentSemester() : await latestArchivedSemester();
  const prev = previousTerm(section.level, section.term);
  if (!last || !prev) return null;
  const match = await findSectionByBatch(
    last.id,
    section.department_id,
    prev.level,
    prev.term,
    section.letter,
  );
  if (!match) return null;
  const rows = await UserRole.find({
    section_id: match.id,
    role: { $in: REP_ROLES },
    is_representative: true,
    ended_reason: { $ne: 'removed' },
  }).lean();
  return { section: match, semester: last, rows };
}

export async function representativesOfSection(actor, sectionId) {
  const { section, semester } = await loadSection(sectionId);
  assertView(actor, section);
  const rows = await UserRole.find({
    section_id: section.id,
    semester_id: semester.id,
    role: { $in: REP_ROLES },
    ended_at: null,
  }).lean();
  const last = await lastSemesterMatch(section, semester);
  return {
    section: {
      id: section.id,
      name: await sectionName(section),
      department_id: section.department_id,
    },
    semester_status: semester.status,
    representatives: await withPeople(rows),
    last_semester: last
      ? {
          section: {
            id: last.section.id,
            name: `${(await sectionName(last.section)).trim()}`,
            label: label(last.section),
          },
          semester: last.semester.name,
          representatives: await withPeople(last.rows),
        }
      : null,
  };
}

/** The readiness hint: every section of a department with its CR status. */
export async function summary(actor, semesterId, departmentId) {
  assertCan(actor, 'representative.view', { department_id: departmentId });
  const semester = await getSemester(semesterId);
  if (!semester) throw notFound('Semester not found.');
  const sections = await listSectionsBrief(semester.id, departmentId);
  const names = await departmentNames([departmentId]);
  const rows = await UserRole.find({
    section_id: { $in: sections.map((s) => s.id) },
    semester_id: semester.id,
    role: { $in: REP_ROLES },
    ended_at: null,
  }).lean();
  return sections
    .map((s) => {
      const mine = rows.filter((r) => String(r.section_id) === s.id);
      return {
        section_id: s.id,
        name: `${names.get(departmentId)?.code ?? ''} ${label(s)}`.trim(),
        has_cr: mine.some((r) => r.role === 'cr'),
        dcr_count: mine.filter((r) => r.role === 'dcr').length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** CRD-01: eligible students by name. No email or phone. A given department must be the admin's. */
export async function searchStudents(actor, { q, department_id }) {
  assertCan(actor, 'representative.search');
  if (department_id) assertCan(actor, 'representative.view', { department_id });
  return findEligibleStudents(q, department_id);
}

/** CRD-09: the owner's CR/DCR role in effect, for their own profile. Roles of other semesters never reach `actor.roles`. */
export async function ownRepresentativeRole(actor) {
  const role = (actor.roles ?? []).find((r) => REP_ROLES.includes(r.role) && r.section_id);
  if (!role) return null;
  const section = await getSectionBrief(role.section_id);
  const semester = section ? await getSemester(section.semester_id) : null;
  if (!section || !semester) return null;
  return {
    role: role.role,
    section_id: section.id,
    section_name: await sectionName(section),
    semester_name: semester.name,
  };
}

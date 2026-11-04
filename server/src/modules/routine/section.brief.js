// Spec 09: small reads other modules may use, so none of them touches `section` directly.
import { RoutineImport, Section, SectionGroup } from './routine.model.js';
import { idOk } from './scope.js';

const brief = (s) => ({
  id: String(s._id),
  semester_id: String(s.semester_id),
  department_id: String(s.department_id),
  level: s.level,
  term: s.term,
  letter: s.letter,
  closed_at: s.closed_at ?? null,
});

export async function getSectionBrief(id) {
  const s = idOk(id) ? await Section.findById(id).lean() : null;
  return s ? brief(s) : null;
}

export async function findSectionByBatch(semesterId, departmentId, level, term, letter) {
  const s = await Section.findOne({
    semester_id: semesterId,
    department_id: departmentId,
    level,
    term,
    letter,
  }).lean();
  return s ? brief(s) : null;
}

export async function listSectionsBrief(semesterId, departmentId) {
  const rows = await Section.find({ semester_id: semesterId, department_id: departmentId }).lean();
  return rows.map(brief);
}

/** CRD-02: a write to the section document, so two assignments at once conflict and run in turn. */
export async function bumpSectionRoleSeq(sectionId, session) {
  await Section.updateOne({ _id: sectionId }, { $inc: { role_seq: 1 } }, { session });
}

const groupBrief = (g) => ({ id: String(g._id), section_id: String(g.section_id), label: g.label });

/** Spec 10: the groups of one or more sections. */
export async function listGroupsOfSections(sectionIds) {
  const rows = await SectionGroup.find({ section_id: { $in: sectionIds } })
    .sort({ label: 1 })
    .lean();
  return rows.map(groupBrief);
}

export async function getGroupBrief(id) {
  const g = idOk(id) ? await SectionGroup.findById(id).lean() : null;
  return g ? groupBrief(g) : null;
}

/** ROL-01(b): the department has a published routine import for the semester with zero errors. */
export async function hasPublishedCleanImport(semesterId, departmentId) {
  return Boolean(
    await RoutineImport.exists({
      semester_id: semesterId,
      department_id: departmentId,
      status: 'published',
      'counts.errors': 0,
    }),
  );
}

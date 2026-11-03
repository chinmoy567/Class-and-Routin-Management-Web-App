// CRD-DSH-05, CRD-DSH-06: the section's routine, and each group's, for live status on the dashboard.
import { listGroupsOfSections, sectionRoutineFor } from '../../routine/index.js';
import { loadRepSection } from './cr.access.js';

/** The section's routine and one routine per group, built with the student's own rules. */
export async function getCrRoutine(actor, sectionId) {
  const { section, semester } = await loadRepSection(actor, sectionId);
  const groups = await listGroupsOfSections([section.id]);
  const data = await sectionRoutineFor({
    semester,
    sectionId: section.id,
    departmentId: section.department_id,
    groups: groups.map((g) => ({ id: g.id, label: g.label })),
  });
  return { section: data.section, groups: data.groups };
}

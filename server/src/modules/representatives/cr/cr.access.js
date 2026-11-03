// CRD-DSH-01, CRD-DSH-02: one section, of the current semester, seen by its CR/DCRs (and admins of
// its department). Every request runs this, so a role that has ended loses access at once.
import { assertCan } from '../../../policy/index.js';
import { notFound } from '../../../lib/errors.js';
import { currentSemester } from '../../organisation/index.js';
import { getSectionBrief } from '../../routine/index.js';
import { crDcrOf } from '../query.service.js';

/**
 * The section, its semester, the actor's own role in it (or null) and the action's check.
 * Throws 404 for a missing section, a section of another semester, or anyone without access.
 */
export async function loadRepSection(actor, sectionId, action = 'cr.dashboard.view') {
  const [section, semester] = await Promise.all([getSectionBrief(sectionId), currentSemester()]);
  if (!section || !semester || section.semester_id !== semester.id) {
    throw notFound('Section not found.');
  }
  const reps = await crDcrOf(section.id);
  const mine = reps.find((r) => r.user_id === String(actor._id)) ?? null;
  assertCan(actor, action, {
    department_id: section.department_id,
    section_id: section.id,
    is_rep: Boolean(mine),
  });
  return { section, semester, reps, myRole: mine?.role ?? null };
}

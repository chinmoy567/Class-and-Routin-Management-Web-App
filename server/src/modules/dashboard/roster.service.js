// DSH-13: the roster of one section. Phone and email never appear here.
import { assertCan, stateIn } from '../../policy/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { currentSemester } from '../organisation/index.js';
import { getSectionBrief, listGroupsOfSections } from '../routine/index.js';
import { listAcceptedOfSection } from '../enrolments/index.js';
import { sectionsTaughtBy } from '../teachers/index.js';
import { studentSummaries, uvIdsOf } from '../auth/index.js';

export async function getSectionRoster(actor, sectionId) {
  if (!stateIn(actor, 'active')) {
    throw new AppError(403, 'STATE_NOT_ALLOWED', 'This account cannot view rosters yet.', {
      state: actor.state,
    });
  }
  const [section, semester] = await Promise.all([getSectionBrief(sectionId), currentSemester()]);
  if (!section || !semester || section.semester_id !== semester.id) {
    throw notFound('Section not found.');
  }
  // `taught` is worked out on the server from the routine, never from the request.
  const taught = (await sectionsTaughtBy(actor._id)).some((s) => s.section_id === section.id);
  // A teacher who does not teach it, or anyone else, gets 404 from the policy (hideExistence).
  assertCan(actor, 'section.roster.read', { department_id: section.department_id, taught });

  const enrolments = await listAcceptedOfSection(section.id, semester.id);
  const ids = enrolments.map((e) => String(e.user_id));
  const [people, uvIds, groups] = await Promise.all([
    studentSummaries(ids),
    uvIdsOf(ids), // DSH-13: the roster is one of the places the UV ID may be shown
    listGroupsOfSections([section.id]),
  ]);
  const groupLabel = new Map(groups.map((g) => [g.id, g.label]));

  const rows = [];
  for (const e of enrolments) {
    const person = people.get(String(e.user_id));
    if (!person || person.state !== 'active') continue;
    rows.push({
      user_id: person.id,
      name: person.full_name,
      photo: person.photo_url,
      uv_id: uvIds.get(person.id) ?? null,
      group: e.group_id ? (groupLabel.get(String(e.group_id)) ?? null) : null,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

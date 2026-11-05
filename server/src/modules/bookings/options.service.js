import { notFound } from '../../lib/errors.js';
import { assertCan } from '../../policy/index.js';
import { currentSemester } from '../organisation/index.js';
import { getSectionBrief, listGroupsOfSections, teacherIdsOfSection } from '../routine/index.js';
import { teachersByIds } from '../teachers/index.js';
import { resolveRequester } from './send.service.js';

/**
 * BKG-02: the groups and teachers a requester may pick for one section. Only a CR or DCR of that
 * section, or a teacher who teaches it, may ask (the same rule as sending). The teachers come from
 * the routine on the server, never from the request.
 */
export async function requestOptions(actor, sectionId) {
  const semester = await currentSemester();
  if (!semester) throw notFound('No current semester.');
  assertCan(actor, 'room_request.send', { section_id: sectionId });
  await resolveRequester(actor, { target_section_id: sectionId }, semester);

  const section = await getSectionBrief(sectionId);
  if (!section || String(section.semester_id) !== String(semester.id)) {
    throw notFound('Section not found.');
  }
  const groups = await listGroupsOfSections([sectionId]);
  const teacherIds = await teacherIdsOfSection({ semesterId: semester.id, sectionId });
  const teachers = teacherIds.length ? await teachersByIds(teacherIds) : [];
  return {
    groups: groups.map((g) => ({ id: g.id, label: g.label })),
    teachers: teachers.map((t) => ({ id: String(t._id), label: t.full_name || t.short_code })),
  };
}

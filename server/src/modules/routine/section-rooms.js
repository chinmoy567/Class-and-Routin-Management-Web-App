import { currentSemester } from '../organisation/index.js';
import { acceptedSectionIdsOf } from '../enrolments/index.js';
import { representedSectionIdsOf } from '../auth/index.js';

/**
 * BKG-20: the `section:<id>` push rooms a signed-in user may join on connect. A student joins the
 * sections they are accepted into; a CR or DCR joins the section they represent. Ids only.
 */
export async function sectionRoomsFor(userId) {
  const semester = await currentSemester();
  if (!semester) return [];
  const ids = new Set([
    ...(await acceptedSectionIdsOf(userId)),
    ...(await representedSectionIdsOf(userId, semester.id)),
  ]);
  return [...ids].map((id) => `section:${id}`);
}

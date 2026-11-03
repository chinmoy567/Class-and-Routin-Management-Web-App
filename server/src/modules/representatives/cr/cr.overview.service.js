// CRD-DSH-01 to CRD-DSH-09, CRD-DSH-13: the CR/DCR dashboard for one section, in one call. The lists
// come from the owning modules' services; the join lists are spec 10's, read-only for the rep.
import { isReleased } from '@crm/shared';
import { listGroupsOfSections } from '../../routine/index.js';
import { listSectionClosed, listSectionRequests } from '../../join/index.js';
import { loadRepSection } from './cr.access.js';
import { flagsOf, rosterOf, unconfirmedOf } from './cr.lists.js';
import { sectionName } from '../common.js';

/** The dashboard data for the signed-in CR/DCR (or a department admin). */
export async function getCrOverview(actor, sectionId) {
  const { section, semester, myRole } = await loadRepSection(actor, sectionId);
  const [name, groups, roster, unconfirmed, pending, readOnly, flags] = await Promise.all([
    sectionName(section),
    listGroupsOfSections([section.id]),
    rosterOf(section, semester),
    unconfirmedOf(section, semester),
    listSectionRequests(actor, section.id),
    listSectionClosed(actor, section.id),
    flagsOf(section, semester, actor._id),
  ]);
  return {
    section: {
      id: section.id,
      name,
      level: section.level,
      term: section.term,
      letter: section.letter,
      department_id: section.department_id,
    },
    semester: { id: semester.id, name: semester.name, status: semester.status },
    my_role: myRole,
    groups: groups.map((g) => ({ id: g.id, label: g.label })),
    roster,
    unconfirmed,
    join_requests: { pending, read_only: readOnly },
    flags,
    counts: {
      roster: roster.length,
      unconfirmed: unconfirmed.length,
      pending_requests: pending.length,
      open_flags: flags.filter((f) => f.status === 'open').length,
    },
    released: { room_requests: isReleased('cr.room_requests') },
  };
}

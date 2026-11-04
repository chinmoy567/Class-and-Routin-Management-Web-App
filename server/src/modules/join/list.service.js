// JR-09: lists of join requests for the people who decide them. Each row carries the student's
// optional profile UV ID (spec 24): only the section's CR/DCR and the department's admins reach
// these lists, which is what the PRD's Privacy of the UV ID rule allows.
import { Enrolment } from '../enrolments/index.js';
import { getEmailAddress, studentSummaries, uvIdsOf } from '../auth/index.js';
import { getGroupBrief, getSectionBrief } from '../routine/index.js';
import { departmentNames } from '../organisation/index.js';
import { assertCan, hasRole, isAdminOf } from '../../policy/index.js';
import { authorise, loadSectionOr404, sectionLetters } from './common.js';

const LIMIT = 200;

/** Turn enrolments into list rows. `withEmail` is the CR/DCR privacy exception. */
async function rows(enrolments, { withEmail }) {
  const userIds = enrolments.map((e) => e.user_id);
  const [people, uvIds] = await Promise.all([studentSummaries(userIds), uvIdsOf(userIds)]);
  const deptIds = [...new Set(enrolments.map((e) => String(e.department_id)))];
  const depts = await departmentNames(deptIds);
  const sections = new Map();
  for (const e of enrolments) {
    const key = String(e.section_id);
    if (!sections.has(key)) sections.set(key, await getSectionBrief(key));
  }
  const out = [];
  for (const e of enrolments) {
    const section = sections.get(String(e.section_id));
    const group = e.group_id ? await getGroupBrief(String(e.group_id)) : null;
    const person = people.get(String(e.user_id));
    out.push({
      id: String(e._id),
      user_id: String(e.user_id),
      full_name: person?.full_name ?? '',
      photo_url: person?.photo_url ?? null,
      ...(withEmail && { email: await getEmailAddress(e.user_id) }),
      uv_id: uvIds.get(String(e.user_id)) ?? null,
      department: depts.get(String(e.department_id))?.code ?? '',
      section: section
        ? {
            id: section.id,
            level: section.level,
            term: section.term,
            letter: section.letter,
            label: sectionLetters(section),
          }
        : null,
      group: group ? { id: group.id, label: group.label } : null,
      status: e.status,
      escalated: Boolean(e.escalated_at),
      reason: e.reason ?? null,
      appeal: e.appeal ? { status: e.appeal.status, at: e.appeal.at } : null,
      created_at: e.created_at,
    });
  }
  return out;
}

/** JR-09: pending requests of one section. The CR/DCR see email; escalated ones are the admin's. */
export async function listSectionRequests(actor, sectionId) {
  const section = await loadSectionOr404(sectionId);
  authorise(actor, 'join.view', section);
  const byAdmin = isAdminOf(actor, section.department_id);
  const found = await Enrolment.find({
    section_id: section.id,
    status: 'pending',
    ...(byAdmin ? {} : { escalated_at: { $exists: false } }),
  })
    .sort({ created_at: 1 })
    .limit(LIMIT)
    .lean();
  return rows(found, { withEmail: !byAdmin });
}

/** The departments an admin may look at, or an error if they ask for another one. */
function scopeDepartments(actor, departmentId) {
  if (departmentId) {
    assertCan(actor, 'join.admin', { department_id: departmentId });
    return [departmentId];
  }
  if (hasRole(actor, 'super_admin')) return null; // all
  return [
    ...new Set(
      (actor.roles ?? [])
        .filter((r) => r.role === 'dept_admin')
        .map((r) => String(r.department_id)),
    ),
  ];
}

/** Admin cards: escalated requests (including a CR/DCR's own), rejected requests, open appeals. No email. */
export async function listForAdmin(
  actor,
  { department_id, view },
  { limit = LIMIT, newestFirst = false } = {},
) {
  const dir = newestFirst ? -1 : 1;
  assertCan(actor, 'join.admin_any');
  const depts = scopeDepartments(actor, department_id);
  const deptFilter = depts ? { department_id: { $in: depts } } : {};
  const filters = {
    escalated: { status: 'pending', escalated_at: { $exists: true } },
    rejected: { status: 'rejected' },
    appeals: { status: 'rejected', 'appeal.status': 'open' },
  };
  const found = await Enrolment.find({ ...filters[view], ...deptFilter })
    .sort({ created_at: dir })
    .limit(limit)
    .lean();
  return rows(found, { withEmail: false });
}

/** CRD-DSH-09: rejected and escalated requests of one section, read-only, without email. */
export async function listSectionClosed(actor, sectionId) {
  const section = await loadSectionOr404(sectionId);
  authorise(actor, 'join.view', section);
  const found = await Enrolment.find({
    section_id: section.id,
    $or: [{ status: 'rejected' }, { status: 'pending', escalated_at: { $exists: true } }],
  })
    .sort({ created_at: -1 })
    .limit(LIMIT)
    .lean();
  return rows(found, { withEmail: false });
}

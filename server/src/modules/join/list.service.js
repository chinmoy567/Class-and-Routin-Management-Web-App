// JR-07, JR-09: lists of join requests for the people who decide them.
import { Enrolment, UvClaim } from '../enrolments/index.js';
import { getEmailAddress, studentSummaries } from '../auth/index.js';
import { getGroupBrief, getSectionBrief } from '../routine/index.js';
import { departmentNames } from '../organisation/index.js';
import { assertCan, hasRole, isAdminOf } from '../../policy/index.js';
import { authorise, loadSectionOr404, sectionLetters } from './common.js';

const LIMIT = 200;

/** Pending claims per cleaned ID, so two claims for the same ID can both show the badge. */
async function duplicateCounts(claims) {
  const norms = [...new Set(claims.map((c) => c.uv_id_norm))];
  if (!norms.length) return new Map();
  const rows = await UvClaim.aggregate([
    { $match: { uv_id_norm: { $in: norms }, status: 'pending' } },
    { $group: { _id: '$uv_id_norm', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

/** Turn enrolments into list rows. `withEmail` is the CR/DCR privacy exception. */
async function rows(enrolments, { withEmail }) {
  const people = await studentSummaries(enrolments.map((e) => e.user_id));
  const claimIds = enrolments.map((e) => e.uv_claim_id).filter(Boolean);
  const claims = await UvClaim.find({ _id: { $in: claimIds } }).lean();
  const claimById = new Map(claims.map((c) => [String(c._id), c]));
  const dups = await duplicateCounts(claims);
  const deptIds = [...new Set(enrolments.map((e) => String(e.department_id)))];
  const depts = await departmentNames(deptIds);
  const sections = new Map();
  for (const e of enrolments) {
    const key = String(e.section_id);
    if (!sections.has(key)) sections.set(key, await getSectionBrief(key));
  }
  const out = [];
  for (const e of enrolments) {
    const claim = e.uv_claim_id ? claimById.get(String(e.uv_claim_id)) : null;
    const section = sections.get(String(e.section_id));
    const group = e.group_id ? await getGroupBrief(String(e.group_id)) : null;
    const person = people.get(String(e.user_id));
    out.push({
      id: String(e._id),
      user_id: String(e.user_id),
      full_name: person?.full_name ?? '',
      photo_url: person?.photo_url ?? null,
      ...(withEmail && { email: await getEmailAddress(e.user_id) }),
      uv_id: claim?.uv_id_text ?? null,
      duplicate_pending_claim: claim ? (dups.get(claim.uv_id_norm) ?? 0) > 1 : false,
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

/** Admin cards: escalated requests, rejected requests, open appeals, CR/DCR claims. No email. */
export async function listForAdmin(actor, { department_id, view }) {
  assertCan(actor, 'join.admin_any');
  const depts = scopeDepartments(actor, department_id);
  const deptFilter = depts ? { department_id: { $in: depts } } : {};
  if (view === 'claims') {
    const withRequest = await Enrolment.distinct('uv_claim_id', { uv_claim_id: { $exists: true } });
    const claims = await UvClaim.find({
      status: 'pending',
      _id: { $nin: withRequest },
      ...deptFilter,
    })
      .sort({ created_at: 1 })
      .limit(LIMIT)
      .lean();
    const people = await studentSummaries(claims.map((c) => c.user_id));
    const dups = await duplicateCounts(claims);
    return claims.map((c) => ({
      id: String(c._id),
      user_id: String(c.user_id),
      full_name: people.get(String(c.user_id))?.full_name ?? '',
      uv_id: c.uv_id_text,
      duplicate_pending_claim: (dups.get(c.uv_id_norm) ?? 0) > 1,
      created_at: c.created_at,
    }));
  }
  const filters = {
    escalated: { status: 'pending', escalated_at: { $exists: true } },
    rejected: { status: 'rejected' },
    appeals: { status: 'rejected', 'appeal.status': 'open' },
  };
  const found = await Enrolment.find({ ...filters[view], ...deptFilter })
    .sort({ created_at: 1 })
    .limit(LIMIT)
    .lean();
  return rows(found, { withEmail: false });
}

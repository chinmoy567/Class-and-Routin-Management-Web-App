// CRD-DSH-03, CRD-DSH-04, CRD-DSH-08: the roster, the unconfirmed students and the flags of one
// section. Nothing here carries a phone or an email.
import { studentCandidates, studentSummaries } from '../../auth/index.js';
import {
  acceptedUserIdsOf,
  approvedUvIds,
  enrolmentsOfSection,
  listAcceptedOfSection,
} from '../../enrolments/index.js';
import { listGroupsOfSections } from '../../routine/index.js';
import { lastSemesterMatch } from '../query.service.js';
import { Flag } from './flag.model.js';

const NEVER_REMINDED_STATES = ['graduated', 'deactivated'];

/** CRD-DSH-03: every accepted student of the section, with UV ID, group and confirmation. */
export async function rosterOf(section, semester) {
  const enrolments = await listAcceptedOfSection(section.id, semester.id);
  const ids = enrolments.map((e) => String(e.user_id));
  const [people, uvIds, groups] = await Promise.all([
    studentSummaries(ids),
    approvedUvIds(ids),
    listGroupsOfSections([section.id]),
  ]);
  const groupLabel = new Map(groups.map((g) => [g.id, g.label]));
  return enrolments
    .map((e) => {
      const p = people.get(String(e.user_id));
      return {
        enrolment_id: String(e._id),
        user_id: String(e.user_id),
        name: p?.full_name ?? '',
        photo_url: p?.photo_url ?? null,
        uv_id: uvIds.get(String(e.user_id)) ?? null,
        group_id: e.group_id ? String(e.group_id) : null,
        group: e.group_id ? (groupLabel.get(String(e.group_id)) ?? null) : null,
        confirmed: p?.state === 'active',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * CRD-DSH-04: students of last semester's matching section (CRD-07) and students with a pending
 * request for this section, who are not yet accepted this semester and not "not enrolled".
 * `can_remind` is true only in state `unconfirmed` (the semester update reminder applies).
 */
export async function unconfirmedOf(section, semester) {
  const last = await lastSemesterMatch(section, semester);
  const lastIds = last
    ? (await enrolmentsOfSection(last.section.id, last.semester.id, 'accepted')).map((e) =>
        String(e.user_id),
      )
    : [];
  const applicantIds = (await enrolmentsOfSection(section.id, semester.id, 'pending')).map((e) =>
    String(e.user_id),
  );
  const all = [...new Set([...lastIds, ...applicantIds])];
  if (!all.length) return [];
  const [people, acceptedNow] = await Promise.all([
    studentCandidates(all, semester.id),
    acceptedUserIdsOf(all, semester.id),
  ]);
  const applicants = new Set(applicantIds);
  return all
    .map((id) => people.get(id))
    .filter(
      (p) =>
        p && !acceptedNow.has(p.id) && !p.not_enrolled && !NEVER_REMINDED_STATES.includes(p.state),
    )
    .map((p) => ({
      id: p.id,
      name: p.full_name,
      photo_url: p.photo_url,
      state: p.state,
      applied: applicants.has(p.id),
      can_remind: p.state === 'unconfirmed',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** CRD-DSH-08, CRD-DSH-13: every flag of this section this semester, newest first. */
export async function flagsOf(section, semester, actorId) {
  const rows = await Flag.find({ section_id: section.id, semester_id: semester.id })
    .sort({ created_at: -1 })
    .limit(200)
    .lean();
  const people = await studentSummaries(rows.filter((r) => r.student_id).map((r) => r.student_id));
  return rows.map((r) => ({
    id: String(r._id),
    category: r.category,
    student: r.student_id
      ? { id: String(r.student_id), name: people.get(String(r.student_id))?.full_name ?? '' }
      : null,
    description: r.description,
    status: r.status,
    reply: r.reply ?? null,
    resolved_at: r.resolved_at ?? null,
    created_at: r.created_at,
    raised_by_me: String(r.raised_by) === String(actorId),
  }));
}

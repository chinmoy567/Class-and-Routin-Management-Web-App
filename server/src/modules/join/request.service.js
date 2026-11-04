// JR-01 to JR-04, JR-18, JR-21: sending, withdrawing and looking at a join request.
// Spec 24: there is no UV ID claim; the UV ID is an optional profile field (spec 02 PRF-10).
import { Enrolment } from '../enrolments/index.js';
import { clearNotEnrolled, setStudentName, studentSummaries } from '../auth/index.js';
import { getGroupBrief, listGroupsOfSections, listSectionsBrief } from '../routine/index.js';
import { crDcrOf, isOpen } from '../representatives/index.js';
import { currentSemester, listActiveDepartments, getSemester } from '../organisation/index.js';
import { record } from '../audit/index.js';
import { can, hasRole } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { alreadyDecided, idOk, loadSectionOr404, sectionLabel, sectionLetters } from './common.js';

const invalid = (fields) =>
  new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', fields);

/** JR-04: the server decides, not the screen. */
function assertWaitingStudent(actor) {
  if (actor.kind !== 'student') throw new AppError(403, 'FORBIDDEN', 'Only students can do this.');
  if (!can(actor, 'join.request')) {
    throw new AppError(403, 'STATE_NOT_ALLOWED', 'This account cannot send a join request.', {
      state: actor.state,
    });
  }
}

/** JR-03: open sections of the current semester by department, and departments still setting up. */
export async function joinOptions(actor) {
  assertWaitingStudent(actor);
  const semester = await currentSemester();
  const departments = await listActiveDepartments();
  if (!semester)
    return {
      semester: null,
      departments: departments.map((d) => ({ ...d, setting_up: true, sections: [] })),
    };
  const out = [];
  for (const d of departments) {
    const sections = await listSectionsBrief(semester.id, d.id);
    const open = [];
    for (const s of sections) if (await isOpen(s.id)) open.push(s);
    const groups = await listGroupsOfSections(open.map((s) => s.id));
    out.push({
      id: d.id,
      code: d.code,
      name: d.name,
      setting_up: open.length === 0,
      sections: open
        .map((s) => ({
          id: s.id,
          label: sectionLetters(s),
          level: s.level,
          term: s.term,
          letter: s.letter,
          groups: groups
            .filter((g) => g.section_id === s.id)
            .map((g) => ({ id: g.id, label: g.label })),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    });
  }
  return { semester: { id: semester.id, name: semester.name }, departments: out };
}

/** JR-01, JR-02 */
export async function createRequest(actor, body) {
  assertWaitingStudent(actor);
  const semester = await currentSemester();
  const section = await loadSectionOr404(body.section_id);
  if (!semester || section.semester_id !== semester.id || !(await isOpen(section.id))) {
    throw new AppError(409, 'SECTION_CLOSED', 'This section is not open for join requests.');
  }
  if (body.group_id) {
    const group = await getGroupBrief(body.group_id);
    if (!group || group.section_id !== section.id) {
      throw invalid({ group_id: 'Choose a group of this section' });
    }
  }
  if (await Enrolment.exists({ user_id: actor._id, status: 'pending' })) {
    throw new AppError(409, 'REQUEST_ALREADY_OPEN', 'You already have a request waiting.');
  }
  // JR-18: a CR or DCR never decides their own request; it goes straight to the admin.
  const ownRequest = hasRole(actor, ['cr', 'dcr']);

  try {
    const enrolment = await withTransaction(async (session) => {
      // ROL-10: sending a request ends a "not enrolled this semester" choice.
      await clearNotEnrolled(actor._id, session);
      // JR-01: the name is given on the first request only.
      const first = !(await Enrolment.exists({ user_id: actor._id }).session(session));
      if (first && body.full_name) await setStudentName(actor._id, body.full_name, session);
      const [row] = await Enrolment.create(
        [
          {
            user_id: actor._id,
            semester_id: semester.id,
            section_id: section.id,
            department_id: section.department_id,
            ...(body.group_id && { group_id: body.group_id }),
            ...(ownRequest && { escalated_at: clock.now() }),
            status: 'pending',
          },
        ],
        { session },
      );
      await record({
        actor,
        action: 'join.request',
        scope_department_id: section.department_id,
        target: { type: 'enrolment', id: row._id },
        new_value: {
          section_id: section.id,
          group_id: body.group_id ?? null,
          escalated: ownRequest,
        },
        session,
      });
      return row;
    });
    return { id: String(enrolment._id), status: 'pending', section_id: section.id };
  } catch (err) {
    // Two requests at once: the partial unique index on pending requests stops the second.
    if (err?.code === 11000) {
      throw new AppError(409, 'REQUEST_ALREADY_OPEN', 'You already have a request waiting.');
    }
    throw err;
  }
}

/** JR-02: withdraw. Only the owner, only while pending. */
export async function withdrawRequest(actor, id) {
  assertWaitingStudent(actor);
  if (!idOk(id)) throw notFound();
  const row = await withTransaction(async (session) => {
    const e = await Enrolment.findOneAndUpdate(
      { _id: id, user_id: actor._id, status: 'pending' },
      { $set: { status: 'withdrawn', decided_at: clock.now() } },
      { new: true, session },
    ).lean();
    if (!e) return null;
    await record({
      actor,
      action: 'join.withdraw',
      scope_department_id: e.department_id,
      target: { type: 'enrolment', id: e._id },
      session,
    });
    return e;
  });
  if (!row) {
    if (await Enrolment.exists({ _id: id, user_id: actor._id })) throw alreadyDecided();
    throw notFound();
  }
  return { id: String(row._id), status: 'withdrawn' };
}

/** JR-21: the student's latest request and the section's CR/DCR card. */
export async function myRequest(actor) {
  if (!can(actor, 'join.view_own')) {
    throw new AppError(403, 'STATE_NOT_ALLOWED', 'This account has no join request screen.', {
      state: actor.state,
    });
  }
  const e = await Enrolment.findOne({ user_id: actor._id }).sort({ created_at: -1 }).lean();
  if (!e) return null;
  const section = await loadSectionOr404(e.section_id);
  const semester = await getSemester(e.semester_id);
  const group = e.group_id ? await getGroupBrief(e.group_id) : null;
  const reps = await crDcrOf(section.id);
  const people = await studentSummaries(reps.map((r) => r.user_id));
  return {
    id: String(e._id),
    status: e.status,
    escalated: Boolean(e.escalated_at),
    reason: e.status === 'rejected' ? (e.reason ?? null) : null,
    appeal: e.appeal ? { status: e.appeal.status, at: e.appeal.at } : null,
    section: { id: section.id, name: await sectionLabel(section) },
    semester: semester ? { id: semester.id, name: semester.name } : null,
    group: group ? { id: group.id, label: group.label } : null,
    created_at: e.created_at,
    representatives: reps.map((r) => ({
      user_id: r.user_id,
      role: r.role,
      full_name: people.get(r.user_id)?.full_name ?? '',
      photo_url: people.get(r.user_id)?.photo_url ?? null,
    })),
  };
}

/** The check `nextScreen` uses: only a pending request holds the student on the waiting screen. */
export async function hasOpenRequest(userId) {
  const e = await Enrolment.findOne({ user_id: userId })
    .sort({ created_at: -1 })
    .select('status')
    .lean();
  return e?.status === 'pending';
}

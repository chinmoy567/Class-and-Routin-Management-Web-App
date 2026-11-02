// JR-01 to JR-06, JR-08, JR-18, JR-21: sending, withdrawing and looking at a join request.
import { normaliseUvId } from '@crm/shared';
import { Enrolment, UvClaim } from '../enrolments/index.js';
import {
  claimBlockedUntil,
  departmentAdminIds,
  setStudentName,
  studentSummaries,
} from '../auth/index.js';
import { getGroupBrief, listGroupsOfSections, listSectionsBrief } from '../routine/index.js';
import { crDcrOf, isOpen } from '../representatives/index.js';
import { currentSemester, listActiveDepartments, getSemester } from '../organisation/index.js';
import { record } from '../audit/index.js';
import { enqueue } from '../notifications/index.js';
import { can } from '../../policy/index.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import {
  alreadyDecided,
  idOk,
  link,
  loadSectionOr404,
  sectionLabel,
  sectionLetters,
  uvIdTaken,
} from './common.js';

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

const claimBlocked = (until) => {
  const err = new AppError(
    429,
    'CLAIM_BLOCKED',
    'Too many rejected UV ID claims. Try again later.',
    { blocked_until: until.toISOString() },
  );
  err.extra = { blocked_until: until.toISOString() };
  err.retryAfter = Math.max(1, Math.ceil((until.getTime() - clock.now().getTime()) / 1000));
  return err;
};

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

/** JR-06: tell the admin of the chosen department that someone claimed an approved ID. */
async function notifyIdTaken(section, uv) {
  const label = await sectionLabel(section);
  for (const adminId of await departmentAdminIds(section.department_id)) {
    await enqueue({
      to_user_id: adminId,
      template: 'uv_id_conflict',
      data: {
        uv_id: uv.text,
        section: label,
        detail: 'it is already approved for another account.',
        link: link(),
      },
    });
  }
}

/** JR-05, JR-06, JR-08: the checks a new claim must pass. Returns the cleaned ID. */
async function checkNewClaim(actor, rawUvId, section) {
  if (!rawUvId) throw invalid({ uv_id: 'Enter your UV ID' });
  const uv = normaliseUvId(rawUvId);
  if (!uv) throw invalid({ uv_id: 'Enter 1 to 20 digits' });
  const until = await claimBlockedUntil(actor._id);
  if (until) throw claimBlocked(until);
  const taken = await UvClaim.exists({
    uv_id_norm: uv.norm,
    status: 'approved',
    user_id: { $ne: actor._id },
  });
  if (taken) {
    await notifyIdTaken(section, uv);
    throw uvIdTaken();
  }
  return uv;
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
  const approved = await UvClaim.exists({ user_id: actor._id, status: 'approved' });
  const uv = approved ? null : await checkNewClaim(actor, body.uv_id, section);

  try {
    const enrolment = await withTransaction(async (session) => {
      let claim = null;
      if (uv) {
        [claim] = await UvClaim.create(
          [
            {
              user_id: actor._id,
              department_id: section.department_id,
              uv_id_text: uv.text,
              uv_id_norm: uv.norm,
              status: 'pending',
            },
          ],
          { session },
        );
      }
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
            ...(claim && { uv_claim_id: claim._id }),
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
          uv_claim: Boolean(claim),
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
    // A claim nobody decided never reserved the ID, so it can go.
    if (e.uv_claim_id)
      await UvClaim.deleteOne({ _id: e.uv_claim_id, status: 'pending' }, { session });
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
  const claim = e.uv_claim_id ? await UvClaim.findById(e.uv_claim_id).lean() : null;
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
    uv_id: claim ? { text: claim.uv_id_text, status: claim.status } : null,
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

/** JR-18: a CR or DCR's own claim goes straight to the department admin. */
export async function submitOwnClaim(actor, { uv_id }) {
  if (!can(actor, 'join.claim_own')) {
    throw new AppError(403, 'FORBIDDEN', 'Only a CR or DCR can claim their UV ID here.');
  }
  const role = (actor.roles ?? []).find((r) => ['cr', 'dcr'].includes(r.role));
  const section = await loadSectionOr404(role.section_id);
  if (await UvClaim.exists({ user_id: actor._id, status: { $in: ['approved', 'pending'] } })) {
    throw new AppError(409, 'CONFLICT', 'You already have a UV ID claim.');
  }
  const uv = await checkNewClaim(actor, uv_id, section);
  const claim = await withTransaction(async (session) => {
    const [row] = await UvClaim.create(
      [
        {
          user_id: actor._id,
          department_id: section.department_id,
          uv_id_text: uv.text,
          uv_id_norm: uv.norm,
          status: 'pending',
        },
      ],
      { session },
    );
    await record({
      actor,
      action: 'join.request',
      scope_department_id: section.department_id,
      target: { type: 'uv_claim', id: row._id },
      new_value: { own_claim: true },
      session,
    });
    afterCommit(() => notifyAdminsOfClaim(section, uv));
    return row;
  });
  return { id: String(claim._id), status: 'pending' };
}

async function notifyAdminsOfClaim(section, uv) {
  const label = await sectionLabel(section);
  for (const adminId of await departmentAdminIds(section.department_id)) {
    await enqueue({
      to_user_id: adminId,
      template: 'uv_id_conflict',
      data: {
        uv_id: uv.text,
        section: label,
        detail: 'a CR or DCR asked you to approve it.',
        link: link(),
      },
    });
  }
}

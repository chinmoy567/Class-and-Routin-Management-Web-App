// JR-10 to JR-20: deciding requests, groups, revocation and appeals.
import { SOCKET_EVENTS } from '@crm/shared';
import { Enrolment, UvClaim } from '../enrolments/index.js';
import {
  activateStudentForSemester,
  countClaimRejection,
  departmentAdminIds,
  sendStudentBackToWaiting,
  studentForJoin,
} from '../auth/index.js';
import { getGroupBrief } from '../routine/index.js';
import { currentSemester } from '../organisation/index.js';
import { record } from '../audit/index.js';
import { enqueue } from '../notifications/index.js';
import { assertCan, isAdminOf } from '../../policy/index.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import {
  alreadyDecided,
  assertNotArchived,
  authorise,
  conflict,
  idOk,
  link,
  loadSectionOr404,
  sectionLabel,
  uvIdTaken,
} from './common.js';
import { runJoinAcceptedHooks } from './hooks.js';

const AUTO_REASON = 'ID approved for another account';

const invalid = (fields) =>
  new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', fields);

async function loadEnrolment(id) {
  const e = idOk(id) ? await Enrolment.findById(id).lean() : null;
  if (!e) throw notFound('Request not found.');
  return e;
}

async function checkGroup(groupId, sectionId) {
  const group = await getGroupBrief(groupId);
  if (!group || group.section_id !== sectionId) {
    throw invalid({ group_id: 'Choose a group of this section' });
  }
  return group;
}

/**
 * JR-11: approve a pending claim and reject every other pending claim for the same ID (and the
 * requests that carry them). Runs inside the caller's transaction. Returns who was rejected.
 */
export async function approveClaim(claimId, actor, session, { fromStatuses = ['pending'] } = {}) {
  const now = clock.now();
  let claim;
  try {
    claim = await UvClaim.findOneAndUpdate(
      { _id: claimId, status: { $in: fromStatuses } },
      {
        $set: { status: 'approved', decided_by: actor._id, decided_at: now },
        $unset: { reason: '' },
      },
      { new: true, session },
    ).lean();
  } catch (err) {
    // The unique index on approved IDs: another account holds it.
    if (err?.code === 11000) throw uvIdTaken();
    throw err;
  }
  if (!claim) throw alreadyDecided();
  const others = await UvClaim.find({
    uv_id_norm: claim.uv_id_norm,
    status: 'pending',
    _id: { $ne: claim._id },
  })
    .session(session)
    .lean();
  const rejected = [];
  if (others.length) {
    const ids = others.map((c) => c._id);
    await UvClaim.updateMany(
      { _id: { $in: ids }, status: 'pending' },
      { $set: { status: 'rejected', reason: AUTO_REASON, decided_by: actor._id, decided_at: now } },
      { session },
    );
    const requests = await Enrolment.find({ uv_claim_id: { $in: ids }, status: 'pending' })
      .session(session)
      .lean();
    await Enrolment.updateMany(
      { _id: { $in: requests.map((r) => r._id) }, status: 'pending' },
      { $set: { status: 'rejected', reason: AUTO_REASON, decided_by: actor._id, decided_at: now } },
      { session },
    );
    for (const c of others) rejected.push({ user_id: String(c.user_id), claim_id: String(c._id) });
    for (const r of requests) {
      const hit = rejected.find((x) => x.claim_id === String(r.uv_claim_id));
      if (hit) hit.enrolment_id = String(r._id);
    }
  }
  return { claim, rejected };
}

/** The mail and hooks that follow a committed acceptance. */
async function afterAccept({ e, section, semester, student, rejected, claim }) {
  const label = await sectionLabel(section);
  await enqueue({
    to_user_id: String(e.user_id),
    template: 'join_accepted',
    data: { name: student.full_name, section: label, semester: semester.name, link: link() },
  });
  for (const r of rejected) {
    const s = await studentForJoin(r.user_id);
    await enqueue({
      to_user_id: r.user_id,
      template: 'join_rejected',
      data: {
        name: s?.full_name ?? '',
        section: label,
        semester: semester.name,
        reason: AUTO_REASON,
        link: link(),
      },
    });
  }
  if (rejected.length) {
    for (const adminId of await departmentAdminIds(String(section.department_id))) {
      await enqueue({
        to_user_id: adminId,
        template: 'uv_id_conflict',
        data: {
          uv_id: claim.uv_id_text,
          section: label,
          detail: `${rejected.length} other pending claim(s) for the same ID were rejected.`,
          link: link(),
        },
      });
    }
  }
  await runJoinAcceptedHooks({
    user_id: String(e.user_id),
    section_id: section.id,
    semester_id: semester.id,
    group_id: e.group_id ? String(e.group_id) : null,
  });
}

/**
 * JR-11: the acceptance transaction. `filter` says which state the request must be in; a miss
 * means someone decided first (JR-10).
 */
async function acceptCore(actor, e, section, { groupId, filter, extraSet = {}, action }) {
  const semester = await assertNotArchived(e.semester_id);
  if (groupId) await checkGroup(groupId, section.id);
  const student = await studentForJoin(e.user_id);
  const byAdmin = isAdminOf(actor, section.department_id);
  const result = await withTransaction(async (session) => {
    const set = {
      status: 'accepted',
      decided_by: actor._id,
      decided_at: clock.now(),
      ...extraSet,
      ...(groupId && { group_id: groupId, group_set_by: byAdmin ? 'admin' : 'cr' }),
    };
    let row;
    try {
      row = await Enrolment.findOneAndUpdate(
        { _id: e._id, ...filter },
        { $set: set, $unset: { reason: '' } },
        { new: true, session },
      ).lean();
    } catch (err) {
      // One accepted enrolment per student per semester.
      if (err?.code === 11000)
        throw conflict('This student is already in a section this semester.');
      throw err;
    }
    if (!row) throw alreadyDecided();
    let approval = { claim: null, rejected: [] };
    if (row.uv_claim_id) {
      approval = await approveClaim(row.uv_claim_id, actor, session, {
        fromStatuses: ['pending', 'rejected'],
      });
    }
    await activateStudentForSemester(row.user_id, row.semester_id, session, section.department_id);
    await record({
      actor,
      action,
      scope_department_id: section.department_id,
      target: { type: 'enrolment', id: row._id },
      new_value: {
        section_id: section.id,
        group_id: row.group_id ? String(row.group_id) : null,
        uv_claim_id: row.uv_claim_id ? String(row.uv_claim_id) : null,
        auto_rejected: approval.rejected.map((r) => r.user_id),
      },
      session,
    });
    if (approval.claim) {
      await record({
        actor,
        action: 'uv_claim.approve',
        scope_department_id: section.department_id,
        target: { type: 'uv_claim', id: approval.claim._id },
        new_value: { user_id: String(row.user_id) },
        session,
      });
    }
    await afterCommit(() =>
      afterAccept({
        e: row,
        section,
        semester,
        student,
        rejected: approval.rejected,
        claim: approval.claim,
      }),
    );
    emitAfterCommit(`user:${row.user_id}`, SOCKET_EVENTS.ROUTINE_CHANGED, {});
    return row;
  });
  return {
    id: String(result._id),
    status: 'accepted',
    group_id: result.group_id ? String(result.group_id) : null,
  };
}

async function rejectCore(actor, e, section, { reason, filter, extraSet = {} }) {
  const semester = await assertNotArchived(e.semester_id);
  const student = await studentForJoin(e.user_id);
  await withTransaction(async (session) => {
    const row = await Enrolment.findOneAndUpdate(
      { _id: e._id, ...filter },
      {
        $set: {
          status: 'rejected',
          reason,
          decided_by: actor._id,
          decided_at: clock.now(),
          ...extraSet,
        },
      },
      { new: true, session },
    ).lean();
    if (!row) throw alreadyDecided();
    if (row.uv_claim_id) {
      await UvClaim.updateOne(
        { _id: row.uv_claim_id, status: 'pending' },
        { $set: { status: 'rejected', reason, decided_by: actor._id, decided_at: clock.now() } },
        { session },
      );
      // JR-08: only a decider's rejection counts toward the block.
      await countClaimRejection(row.user_id, session);
    }
    await record({
      actor,
      action: 'join.reject',
      scope_department_id: section.department_id,
      target: { type: 'enrolment', id: row._id },
      new_value: { reason },
      session,
    });
    await afterCommit(async () =>
      enqueue({
        to_user_id: String(row.user_id),
        template: 'join_rejected',
        data: {
          name: student.full_name,
          section: await sectionLabel(section),
          semester: semester.name,
          reason,
          link: link(),
        },
      }),
    );
  });
  return { id: String(e._id), status: 'rejected' };
}

/** JR-10: accept or reject. A CR/DCR acts only while the request has not been escalated. */
export async function decide(actor, id, body) {
  const e = await loadEnrolment(id);
  const section = await loadSectionOr404(String(e.section_id));
  authorise(actor, 'join.decide', section, { escalated: Boolean(e.escalated_at) });
  const byAdmin = isAdminOf(actor, section.department_id);
  // A CR/DCR decision also loses to a request escalated a moment ago.
  const filter = { status: 'pending', ...(byAdmin ? {} : { escalated_at: { $exists: false } }) };
  if (body.decision === 'accept') {
    return acceptCore(actor, e, section, { groupId: body.group_id, filter, action: 'join.accept' });
  }
  return rejectCore(actor, e, section, { reason: body.reason, filter });
}

/** JR-16, JR-17: change or clear the group of an accepted student. */
export async function changeGroup(actor, id, { group_id }) {
  const e = await loadEnrolment(id);
  if (e.status !== 'accepted') throw notFound('Request not found.');
  const section = await loadSectionOr404(String(e.section_id));
  authorise(actor, 'join.group', section);
  await assertNotArchived(e.semester_id);
  const group = group_id ? await checkGroup(group_id, section.id) : null;
  const byAdmin = isAdminOf(actor, section.department_id);
  const student = await studentForJoin(e.user_id);
  await withTransaction(async (session) => {
    const update = group
      ? { $set: { group_id: group.id, group_set_by: byAdmin ? 'admin' : 'cr' } }
      : { $unset: { group_id: '', group_set_by: '' } };
    const row = await Enrolment.findOneAndUpdate({ _id: e._id, status: 'accepted' }, update, {
      new: false,
      session,
    }).lean();
    if (!row) throw notFound('Request not found.');
    await record({
      actor,
      action: 'join.group_change',
      scope_department_id: section.department_id,
      target: { type: 'enrolment', id: e._id },
      old_value: { group_id: row.group_id ? String(row.group_id) : null },
      new_value: { group_id: group?.id ?? null, set_by: byAdmin ? 'admin' : 'cr' },
      session,
    });
    emitAfterCommit(`user:${e.user_id}`, SOCKET_EVENTS.ROUTINE_CHANGED, {});
    await afterCommit(async () =>
      enqueue({
        to_user_id: String(e.user_id),
        template: 'group_changed',
        data: {
          name: student.full_name,
          section: await sectionLabel(section),
          group: group?.label ?? 'none',
          link: link(),
        },
      }),
    );
  });
  return {
    id: String(e._id),
    group_id: group?.id ?? null,
    group_set_by: group ? (byAdmin ? 'admin' : 'cr') : null,
  };
}

/** JR-20: one appeal per rejection. */
export async function appeal(actor, id) {
  if (actor.kind !== 'student') throw new AppError(403, 'FORBIDDEN', 'Only students can appeal.');
  if (!idOk(id)) throw notFound();
  const row = await withTransaction(async (session) => {
    const e = await Enrolment.findOneAndUpdate(
      { _id: id, user_id: actor._id, status: 'rejected', appeal: { $exists: false } },
      { $set: { appeal: { at: clock.now(), status: 'open' } } },
      { new: true, session },
    ).lean();
    if (!e) return null;
    await record({
      actor,
      action: 'join.appeal',
      scope_department_id: e.department_id,
      target: { type: 'enrolment', id: e._id },
      session,
    });
    return e;
  });
  if (!row) {
    if (await Enrolment.exists({ _id: id, user_id: actor._id, status: 'rejected' })) {
      throw conflict('You already appealed this decision.');
    }
    throw notFound();
  }
  return { id: String(row._id), appeal: { status: 'open' } };
}

/** JR-20: the admin upholds the rejection or reverses it (JR-11 runs as the admin). */
export async function decideAppeal(actor, id, body) {
  const e = await loadEnrolment(id);
  const section = await loadSectionOr404(String(e.section_id));
  assertCan(actor, 'join.admin', { department_id: section.department_id });
  const filter = { status: 'rejected', 'appeal.status': 'open' };
  if (body.decision === 'uphold') {
    await withTransaction(async (session) => {
      const row = await Enrolment.findOneAndUpdate(
        { _id: e._id, ...filter },
        { $set: { 'appeal.status': 'upheld' } },
        { new: true, session },
      ).lean();
      if (!row) throw alreadyDecided();
      await record({
        actor,
        action: 'join.appeal_decision',
        scope_department_id: section.department_id,
        target: { type: 'enrolment', id: e._id },
        new_value: { decision: 'uphold' },
        session,
      });
    });
    return { id: String(e._id), appeal: { status: 'upheld' } };
  }
  return acceptCore(actor, e, section, {
    groupId: body.group_id,
    filter,
    extraSet: { 'appeal.status': 'reversed' },
    action: 'join.appeal_decision',
  });
}

/** JR-19: take back an approved claim. The account goes back to waiting. */
export async function revokeClaim(actor, id, { reason }) {
  const claim = idOk(id) ? await UvClaim.findById(id).lean() : null;
  if (!claim) throw notFound('Claim not found.');
  assertCan(actor, 'join.admin', { department_id: String(claim.department_id) });
  const semester = await currentSemester();
  await withTransaction(async (session) => {
    const row = await UvClaim.findOneAndUpdate(
      { _id: claim._id, status: 'approved' },
      { $set: { status: 'revoked', reason, decided_by: actor._id, decided_at: clock.now() } },
      { new: true, session },
    ).lean();
    if (!row) throw conflict('This claim is not approved.');
    if (semester) {
      await Enrolment.updateMany(
        { user_id: claim.user_id, semester_id: semester.id, status: 'accepted' },
        { $set: { status: 'revoked', reason, decided_by: actor._id, decided_at: clock.now() } },
        { session },
      );
    }
    await sendStudentBackToWaiting(claim.user_id, session);
    await record({
      actor,
      action: 'uv_claim.revoke',
      scope_department_id: claim.department_id,
      target: { type: 'uv_claim', id: claim._id },
      new_value: { user_id: String(claim.user_id), reason },
      session,
    });
    emitAfterCommit(`user:${claim.user_id}`, SOCKET_EVENTS.ROUTINE_CHANGED, {});
  });
  return { id: String(claim._id), status: 'revoked' };
}

/** JR-18: the admin decides a CR/DCR's own claim (one with no join request). */
export async function decideOwnClaim(actor, id, body) {
  const claim = idOk(id) ? await UvClaim.findById(id).lean() : null;
  if (!claim) throw notFound('Claim not found.');
  assertCan(actor, 'join.admin', { department_id: String(claim.department_id) });
  if (await Enrolment.exists({ uv_claim_id: claim._id })) {
    throw conflict('This claim belongs to a join request. Decide the request instead.');
  }
  const scopeDepartment = String(claim.department_id);
  await withTransaction(async (session) => {
    if (body.decision === 'approve') {
      const { rejected } = await approveClaim(claim._id, actor, session);
      await record({
        actor,
        action: 'uv_claim.approve',
        scope_department_id: claim.department_id,
        target: { type: 'uv_claim', id: claim._id },
        new_value: {
          user_id: String(claim.user_id),
          auto_rejected: rejected.map((r) => r.user_id),
        },
        session,
      });
      await afterCommit(async () => {
        const semester = await currentSemester();
        for (const r of rejected) {
          const s = await studentForJoin(r.user_id);
          await enqueue({
            to_user_id: r.user_id,
            template: 'join_rejected',
            data: {
              name: s?.full_name ?? '',
              section: '',
              semester: semester?.name ?? '',
              reason: AUTO_REASON,
              link: link(),
            },
          });
        }
      });
      return;
    }
    const row = await UvClaim.findOneAndUpdate(
      { _id: claim._id, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          reason: body.reason,
          decided_by: actor._id,
          decided_at: clock.now(),
        },
      },
      { new: true, session },
    ).lean();
    if (!row) throw alreadyDecided();
    await countClaimRejection(claim.user_id, session);
    await record({
      actor,
      action: 'uv_claim.reject',
      scope_department_id: scopeDepartment,
      target: { type: 'uv_claim', id: claim._id },
      new_value: { reason: body.reason },
      session,
    });
  });
  return { id: String(claim._id), status: body.decision === 'approve' ? 'approved' : 'rejected' };
}

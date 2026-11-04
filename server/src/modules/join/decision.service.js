// JR-10 to JR-20: deciding requests, groups, removal from a section and appeals.
// Spec 24: no UV ID claim, so accepting and rejecting touch only the enrolment and the account.
import { SOCKET_EVENTS } from '@crm/shared';
import { Enrolment } from '../enrolments/index.js';
import {
  activateStudentForSemester,
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
} from './common.js';
import { runJoinAcceptedHooks, runMembershipRemovedHooks } from './hooks.js';

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

/** The mail and hooks that follow a committed acceptance. */
async function afterAccept({ e, section, semester, student }) {
  await enqueue({
    to_user_id: String(e.user_id),
    template: 'join_accepted',
    data: {
      name: student.full_name,
      section: await sectionLabel(section),
      semester: semester.name,
      link: link(),
    },
  });
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
    await activateStudentForSemester(row.user_id, row.semester_id, session, section.department_id);
    await record({
      actor,
      action,
      scope_department_id: section.department_id,
      target: { type: 'enrolment', id: row._id },
      new_value: {
        section_id: section.id,
        group_id: row.group_id ? String(row.group_id) : null,
      },
      session,
    });
    await afterCommit(() => afterAccept({ e: row, section, semester, student }));
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

/**
 * JR-19 (spec 24 OS-11): the department admin removes a student from a section. The current
 * semester's accepted enrolment becomes `revoked` and the account goes back to `claim_pending`, in
 * one transaction with the audit entry. A second admin acting at the same moment gets CONFLICT.
 */
export async function removeFromSection(actor, id, { reason }) {
  const e = await loadEnrolment(id);
  const section = await loadSectionOr404(String(e.section_id));
  assertCan(actor, 'join.remove', { department_id: section.department_id });
  const semester = await currentSemester();
  if (e.status !== 'accepted' || !semester || String(e.semester_id) !== String(semester.id)) {
    throw conflict('This student is not a member of this section this semester.');
  }
  await withTransaction(async (session) => {
    const row = await Enrolment.findOneAndUpdate(
      { _id: e._id, status: 'accepted' },
      { $set: { status: 'revoked', reason, decided_by: actor._id, decided_at: clock.now() } },
      { new: true, session },
    ).lean();
    if (!row) throw conflict('This student is not a member of this section this semester.');
    await sendStudentBackToWaiting(row.user_id, session);
    await record({
      actor,
      action: 'join.remove',
      scope_department_id: section.department_id,
      target: { type: 'enrolment', id: row._id },
      old_value: { status: 'accepted' },
      new_value: { status: 'revoked', user_id: String(row.user_id), reason },
      session,
    });
    emitAfterCommit(`user:${row.user_id}`, SOCKET_EVENTS.ROUTINE_CHANGED, {});
    await afterCommit(() =>
      runMembershipRemovedHooks({
        user_id: String(row.user_id),
        section_id: section.id,
        semester_id: String(row.semester_id),
      }),
    );
  });
  return { id: String(e._id), status: 'revoked' };
}

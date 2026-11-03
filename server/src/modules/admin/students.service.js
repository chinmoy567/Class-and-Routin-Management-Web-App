// Spec 18, ADM-12 to ADM-17: the student management screens. Every action checks the student's department,
// changes the state only while it still has the expected value (first action wins), and writes its audit
// entry in the same transaction. Sessions end after the commit. Nothing here returns an email or a phone.
import { assertCan } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';
import {
  endAllSessions,
  issueTemporaryPassword,
  setStateBeforeDeactivation,
  studentAdminRows,
  studentForAdmin,
  studentIdsByName,
  studentIdsOfDepartments,
  transitionStudentState,
} from '../auth/index.js';
import {
  acceptedEnrolmentOf,
  approvedClaimsOf,
  currentEnrolmentsOf,
  departmentOfStudent,
  enrolledUserIdsOfDepartments,
  userIdsByUvId,
} from '../enrolments/index.js';
import { getGroupBrief, getSectionBrief } from '../routine/index.js';
import { currentSemester } from '../organisation/index.js';
import { scopeOf } from './scope.js';

const RESULT_LIMIT = 50;
// ADM-14, ADM-13: states a deactivation may start from (a deactivated account is already there).
const DEACTIVATABLE = ['email_unverified', 'claim_pending', 'active', 'unconfirmed', 'graduated'];
// ADM-15: a student who can change a password can be given a temporary one.
const TEMP_PASSWORD_STATES = ['claim_pending', 'unconfirmed', 'active', 'graduated'];
// ADM-13: states that come back unchanged on reactivation (an active account comes back unconfirmed).
const RESTORE_AS_IS = ['email_unverified', 'claim_pending', 'unconfirmed', 'graduated'];

const conflict = (message) => new AppError(409, 'CONFLICT', message);
const sectionLabel = (s) => `${s.level}-${s.term}-${s.letter}`;

/** ADM-13 to ADM-15: the student, once the actor is shown to be an admin of their department (else 404). */
async function manageable(actor, userId) {
  const student = await studentForAdmin(userId);
  if (!student) throw notFound('Student not found.');
  const department_id = student.department_id ?? (await departmentOfStudent(userId));
  assertCan(actor, 'admin.student.manage', { department_id });
  return { ...student, department_id };
}

/** ADM-13: the state a reactivated account returns to. */
export function restoredState(previous) {
  if (previous === 'active') return 'unconfirmed';
  if (RESTORE_AS_IS.includes(previous)) return previous;
  return 'claim_pending';
}

/** ADM-12: students of the actor's departments whose name or UV ID matches, with their current section. */
export async function searchStudents(actor, { q, department_id }) {
  assertCan(actor, 'admin.student.search');
  const scope = await scopeOf(actor, department_id);
  const matches = new Set([...(await studentIdsByName(q)), ...(await userIdsByUvId(q))]);
  if (!scope.all) {
    const allowed = new Set([
      ...(await studentIdsOfDepartments(scope.ids)),
      ...(await enrolledUserIdsOfDepartments(scope.ids)),
    ]);
    for (const id of [...matches]) if (!allowed.has(id)) matches.delete(id);
  }
  const ids = [...matches].slice(0, RESULT_LIMIT);
  if (!ids.length) return [];

  const rows = await studentAdminRows(ids);
  const semester = await currentSemester();
  const enrolments = semester ? await currentEnrolmentsOf(ids, semester.id) : new Map();
  const claims = await approvedClaimsOf(ids);
  const sections = new Map();
  const groups = new Map();
  for (const e of enrolments.values()) {
    if (!sections.has(String(e.section_id))) {
      sections.set(String(e.section_id), await getSectionBrief(String(e.section_id)));
    }
    if (e.group_id && !groups.has(String(e.group_id))) {
      groups.set(String(e.group_id), await getGroupBrief(String(e.group_id)));
    }
  }

  return rows.map((row) => {
    const e = enrolments.get(row.id);
    const section = e ? sections.get(String(e.section_id)) : null;
    const group = e?.group_id ? groups.get(String(e.group_id)) : null;
    const claim = claims.get(row.id);
    return {
      ...row,
      uv_id: claim?.uv_id ?? null,
      uv_claim_id: claim?.id ?? null,
      enrolment: e ? { id: String(e._id ?? ''), status: e.status } : null,
      section: section ? { id: section.id, label: sectionLabel(section) } : null,
      group: group ? { id: group.id, label: group.label } : null,
    };
  });
}

/** ADM-13: deactivate. History is kept, the previous state is remembered, and every session ends. */
export async function deactivateStudent(actor, userId, { reason }) {
  const student = await manageable(actor, userId);
  const out = await withTransaction(async (session) => {
    const before = await transitionStudentState(
      userId,
      { from: DEACTIVATABLE, to: 'deactivated' },
      session,
    );
    if (!before) throw conflict('This account cannot be deactivated in its current state.');
    await setStateBeforeDeactivation(userId, before.state, session);
    await record({
      actor,
      action: 'student.deactivate',
      scope_department_id: student.department_id,
      target: { type: 'user', id: userId },
      old_value: { state: before.state },
      new_value: { state: 'deactivated', reason },
      session,
    });
    return { id: String(userId), state: 'deactivated' };
  });
  await endAllSessions(userId);
  return out;
}

/** ADM-13: reactivate. Active if the student has an accepted enrolment this semester, otherwise as before. */
export async function reactivateStudent(actor, userId) {
  const student = await manageable(actor, userId);
  const semester = await currentSemester();
  const accepted = semester ? await acceptedEnrolmentOf(userId, semester.id) : null;
  const restored = accepted ? 'active' : restoredState(student.state_before_deactivation);
  return withTransaction(async (session) => {
    const before = await transitionStudentState(
      userId,
      { from: ['deactivated'], to: restored, unset: { state_before_deactivation: '' } },
      session,
    );
    if (!before) throw conflict('This account is not deactivated.');
    await record({
      actor,
      action: 'student.reactivate',
      scope_department_id: student.department_id,
      target: { type: 'user', id: userId },
      old_value: { state: 'deactivated' },
      new_value: { state: restored },
      session,
    });
    return { id: String(userId), state: restored };
  });
}

/** ADM-14: mark a student as having finished the degree. */
export async function graduateStudent(actor, userId) {
  const student = await manageable(actor, userId);
  return withTransaction(async (session) => {
    const before = await transitionStudentState(
      userId,
      { from: ['active', 'unconfirmed'], to: 'graduated', set: { graduated_at: clock.now() } },
      session,
    );
    if (!before) throw conflict('Only an active or unconfirmed student can be marked graduated.');
    await record({
      actor,
      action: 'student.graduate',
      scope_department_id: student.department_id,
      target: { type: 'user', id: userId },
      old_value: { state: before.state },
      new_value: { state: 'graduated' },
      session,
    });
    return { id: String(userId), state: 'graduated' };
  });
}

/** ADM-14: reverse a graduation. The student is unconfirmed until they join a section again. */
export async function ungraduateStudent(actor, userId) {
  const student = await manageable(actor, userId);
  return withTransaction(async (session) => {
    const before = await transitionStudentState(
      userId,
      { from: ['graduated'], to: 'unconfirmed', unset: { graduated_at: '' } },
      session,
    );
    if (!before) throw conflict('This student is not marked graduated.');
    await record({
      actor,
      action: 'student.ungraduate',
      scope_department_id: student.department_id,
      target: { type: 'user', id: userId },
      old_value: { state: 'graduated' },
      new_value: { state: 'unconfirmed' },
      session,
    });
    return { id: String(userId), state: 'unconfirmed' };
  });
}

/**
 * ADM-15: a temporary password, returned once. Only its hash is stored, and the audit entry has no secret.
 * Every session of the student ends, so they must sign in again with the temporary password.
 */
export async function issueTempPassword(actor, userId) {
  const student = await manageable(actor, userId);
  if (!TEMP_PASSWORD_STATES.includes(student.state)) {
    throw conflict('A temporary password cannot be issued in the current state.');
  }
  const password = await withTransaction(async (session) => {
    const issued = await issueTemporaryPassword(userId, session);
    if (!issued) throw conflict('A temporary password cannot be issued in the current state.');
    await record({
      actor,
      action: 'student.temp_password',
      scope_department_id: student.department_id,
      target: { type: 'user', id: userId },
      old_value: { must_change_password: student.must_change_password },
      new_value: { must_change_password: true },
      session,
    });
    return issued;
  });
  await endAllSessions(userId);
  return { temp_password: password };
}

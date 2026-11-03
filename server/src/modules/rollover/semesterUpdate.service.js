// ROL-08 to ROL-10: the semester update screen for an unconfirmed student.
import { nextTerm } from '@crm/shared';
import { can } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { record } from '../audit/index.js';
import { currentSemester } from '../organisation/index.js';
import { getSectionBrief } from '../routine/index.js';
import { acceptedEnrolmentOf } from '../enrolments/index.js';
import { graduateStudent, markNotEnrolled, studentForUpdate } from '../auth/index.js';

const notAllowed = (actor) =>
  new AppError(403, 'STATE_NOT_ALLOWED', 'This account has no semester update screen.', {
    state: actor.state,
  });

function assertUnconfirmed(actor) {
  if (!can(actor, 'semester_update.use')) throw notAllowed(actor);
}

/** The section the student was last confirmed in, or null. */
async function lastSectionOf(userId, confirmedSemesterId) {
  if (!confirmedSemesterId) return null;
  const e = await acceptedEnrolmentOf(userId, confirmedSemesterId);
  return e ? getSectionBrief(String(e.section_id)) : null;
}

/** ROL-08 to ROL-10: the pre-filled form and the choices this student may make. */
export async function semesterUpdate(actor) {
  assertUnconfirmed(actor);
  const me = await studentForUpdate(actor._id);
  const semester = await currentSemester();
  const last = await lastSectionOf(actor._id, me?.confirmed_semester_id);
  // 4-II has no next term: the form keeps it, and the student may graduate instead.
  const suggested = last ? (nextTerm(last.level, last.term) ?? { level: 4, term: 'II' }) : null;
  return {
    semester: semester ? { id: semester.id, name: semester.name } : null,
    last_section: last ? { level: last.level, term: last.term, letter: last.letter } : null,
    prefill: last
      ? {
          department_id: last.department_id,
          letter: last.letter,
          level: suggested.level,
          term: suggested.term,
        }
      : null,
    can_graduate: Boolean(last && last.level === 4 && last.term === 'II'),
    not_enrolled: Boolean(semester) && me?.not_enrolled_semester_id === semester.id,
  };
}

/** ROL-09: the degree is complete. Only after 4-II, with no join request. */
export async function graduate(actor) {
  assertUnconfirmed(actor);
  const me = await studentForUpdate(actor._id);
  const last = await lastSectionOf(actor._id, me?.confirmed_semester_id);
  if (!last || last.level !== 4 || last.term !== 'II') {
    throw new AppError(409, 'NOT_FINAL_TERM', 'Only students who finished 4-II can choose this.');
  }
  await withTransaction(async (session) => {
    const row = await graduateStudent(actor._id, session);
    if (!row) throw notAllowed(actor);
    await record({
      actor,
      action: 'student.graduate',
      target: { type: 'user', id: actor._id },
      old_value: { state: 'unconfirmed' },
      new_value: { state: 'graduated' },
      session,
    });
  });
  return { state: 'graduated' };
}

/** ROL-10: "not enrolled this semester". The student stays unconfirmed. */
export async function notEnrolled(actor) {
  assertUnconfirmed(actor);
  const semester = await currentSemester();
  if (!semester) throw new AppError(409, 'CONFLICT', 'No semester is current.');
  await withTransaction(async (session) => {
    const matched = await markNotEnrolled(actor._id, semester.id, session);
    if (!matched) throw notAllowed(actor);
    await record({
      actor,
      action: 'student.not_enrolled',
      target: { type: 'user', id: actor._id },
      new_value: { semester_id: semester.id },
      session,
    });
  });
  return { not_enrolled_semester_id: semester.id };
}

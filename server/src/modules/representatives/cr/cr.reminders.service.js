// CRD-DSH-04, CRD-DSH-12: a semester update reminder to one unconfirmed student, at most one a day
// across all the section's CR/DCRs. Each reminder is audited, and emailed after the commit.
import { clock, toInstitutionDate } from '../../../lib/time.js';
import { withTransaction, afterCommit } from '../../../lib/db.js';
import { AppError, notFound } from '../../../lib/errors.js';
import { getConfig } from '../../../config.js';
import { record } from '../../audit/index.js';
import { enqueue } from '../../notifications/index.js';
import { loadRepSection } from './cr.access.js';
import { unconfirmedOf } from './cr.lists.js';
import { ReminderLog } from './reminder.model.js';

/** CRD-DSH-04: one reminder for this student today. Returns the student and the date. */
export async function sendReminder(actor, sectionId, { student_id: studentId }) {
  const { section, semester } = await loadRepSection(actor, sectionId, 'cr.dashboard.remind');
  const student = (await unconfirmedOf(section, semester)).find((u) => u.id === studentId);
  if (!student) throw notFound('Student not found in this section.');
  if (!student.can_remind) {
    throw new AppError(
      409,
      'CONFLICT',
      'Only a student who has not done the semester update can get a reminder.',
    );
  }
  const date = toInstitutionDate(clock.now());
  const link = `${getConfig().APP_URL}/login`;
  await withTransaction(async (session) => {
    try {
      await ReminderLog.create(
        [{ section_id: section.id, student_id: studentId, date, sent_by: actor._id }],
        { session },
      );
    } catch (err) {
      if (err?.code === 11000) {
        throw new AppError(429, 'RATE_LIMITED', 'This student already got a reminder today.');
      }
      throw err;
    }
    await record({
      actor,
      action: 'cr.reminder',
      scope_department_id: section.department_id,
      target: { type: 'user', id: studentId },
      new_value: { section_id: section.id, date },
      session,
    });
    afterCommit(() =>
      enqueue({
        to_user_id: studentId,
        template: 'semester_update_reminder',
        data: { name: student.name, semester: semester.name, link },
        dedupe_key: `cr_reminder:${studentId}:${date}`,
      }),
    );
  });
  return { student_id: studentId, date };
}

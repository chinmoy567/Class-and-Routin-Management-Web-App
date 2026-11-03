// ROL-13: semester update reminders to unconfirmed students, on day 0, 7 and 14.
import { enqueue } from '../notifications/index.js';
import { studentSummaries, unconfirmedStudentIds } from '../auth/index.js';
import { currentSemester } from '../organisation/index.js';
import { getConfig } from '../../config.js';
import { clock, toInstitutionDate } from '../../lib/time.js';

export const MILESTONES = [7, 14];

/** Whole calendar days (institution time) from the day the semester became current to `now`. */
export function daysSince(madeCurrentAt, now) {
  const from = Date.parse(`${toInstitutionDate(madeCurrentAt)}T00:00:00Z`);
  const to = Date.parse(`${toInstitutionDate(now)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Queue one reminder per unconfirmed student for this milestone. The dedupe key makes a second
 * run for the same milestone a no-op, so a retried job never sends twice.
 */
export async function sendMilestoneReminders(semesterId, milestone) {
  const ids = await unconfirmedStudentIds(semesterId);
  if (!ids.length) return 0;
  const semester = await currentSemester();
  const people = await studentSummaries(ids);
  for (const id of ids) {
    await enqueue({
      to_user_id: id,
      template: 'semester_update_reminder',
      data: {
        name: people.get(id)?.full_name ?? '',
        semester: semester?.name ?? '',
        link: `${getConfig().APP_URL}/login`,
      },
      dedupe_key: `semester_update:${semesterId}:${id}:${milestone}`,
    });
  }
  return ids.length;
}

/** The daily job (09:00 Dhaka): sends the day 7 and day 14 reminders when they fall due today. */
export async function sendDueReminders(now = clock.now()) {
  const semester = await currentSemester();
  if (!semester?.made_current_at) return 0;
  const days = daysSince(semester.made_current_at, now);
  if (!MILESTONES.includes(days)) return 0;
  return sendMilestoneReminders(semester.id, days);
}

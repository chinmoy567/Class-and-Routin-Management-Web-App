// ROL-12: students still unconfirmed 14 days after the semester became current, excluding those
// who chose "not enrolled". Read by spec 18's "Unconfirmed students" list. Nobody is locked out.
import { unconfirmedStudentIds } from '../auth/index.js';
import { currentSemester } from '../organisation/index.js';
import { clock } from '../../lib/time.js';
import { daysSince } from './reminders.service.js';

export const OVERDUE_AFTER_DAYS = 14;

/** The user ids on the overdue list, or none before day 14. */
export async function listOverdueUnconfirmed(now = clock.now()) {
  const semester = await currentSemester();
  if (!semester?.made_current_at) return [];
  if (daysSince(semester.made_current_at, now) < OVERDUE_AFTER_DAYS) return [];
  return unconfirmedStudentIds(semester.id);
}

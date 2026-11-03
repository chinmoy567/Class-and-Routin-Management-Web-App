import { sendDueReminders } from './reminders.service.js';

export const REMINDER_JOB = 'semester.reminders';

/** Spec 14 jobs. The server schedules REMINDER_JOB daily at 09:00, Asia/Dhaka. */
export function defineJobs(define) {
  define(REMINDER_JOB, () => sendDueReminders());
}

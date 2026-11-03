import { z } from 'zod';
import { dateString, objectIdString } from './primitives.js';

export const FLAG_RESOLUTIONS = Object.freeze(['fixed', 'rejected']);
export const AUDIT_PAGE_MAX = 100;

/** ADM-11: the dashboard for one department, or every department when omitted (super admin). */
export const dashboardQuery = z.strictObject({ department_id: objectIdString.optional() });

/** ADM-12: student search by name or UV ID. */
export const studentsQuery = z.strictObject({
  q: z
    .string({ error: 'Enter a name or UV ID' })
    .trim()
    .min(2, 'Enter at least 2 characters')
    .max(100),
  department_id: objectIdString.optional(),
});

export const studentIdParam = z.object({ id: objectIdString });

/** ADM-13: deactivation needs a reason. */
export const deactivateBody = z.strictObject({
  reason: z
    .string({ error: 'Enter a reason' })
    .trim()
    .min(5, 'Give a reason of at least 5 characters')
    .max(500, 'Keep the reason to 500 characters'),
});

/** ADM-18 */
export const flagsQuery = z.strictObject({
  status: z.enum(['open', 'fixed', 'rejected']).optional(),
  department_id: objectIdString.optional(),
});
export const flagIdParam = z.object({ id: objectIdString });

/** ADM-18: the admin marks a flag fixed or rejected, with a reply of 1–1,000 characters. */
export const resolveFlagBody = z.strictObject({
  status: z.enum(FLAG_RESOLUTIONS, { error: 'Choose fixed or rejected' }),
  reply: z
    .string({ error: 'Write a reply' })
    .trim()
    .min(1, 'Write a reply')
    .max(1000, 'Keep the reply to 1,000 characters'),
});

// A date that exists in the calendar (2027-02-30 matches the pattern but is not a day).
const calendarDate = dateString.refine((value) => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, 'Use a real calendar date');

// The cursor is base64url text, as the audit service writes it.
const auditCursor = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use the cursor the page gave you');

/** ADM-19: the audit log filters and paging. */
export const auditQuery = z.strictObject({
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  action: z.string().trim().min(1).max(100).optional(),
  actor_id: objectIdString.optional(),
  target_id: objectIdString.optional(),
  cursor: auditCursor.optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(50),
});

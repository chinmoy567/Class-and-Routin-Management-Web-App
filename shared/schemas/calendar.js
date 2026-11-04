import { z } from 'zod';
import { objectIdString, dateString } from './primitives.js';

export const EVENT_KINDS = ['holiday', 'prep_leave', 'exam', 'early_closing', 'dept_event'];

// CAL-01: cutoff is minutes since midnight, e.g. 720 = 12:00.
const cutoffMin = z.number().int().min(0).max(1439);

// CAL-01: label 1–80 chars.
const label = z
  .string()
  .min(1)
  .max(80)
  .transform((s) => s.trim());

const eventFields = z.object({
  scope: z.union([z.literal('university'), objectIdString]),
  from_date: dateString,
  to_date: dateString,
  kind: z.enum(EVENT_KINDS),
  cutoff_min: cutoffMin.nullable().optional(),
  label,
});

/**
 * CAL-01, CAL-03: the rules that relate fields to each other, for a whole event.
 * Used by the request schemas (whatever fields are present) and by the calendar service on the
 * merged event after a partial update, so a PATCH cannot leave an invalid event behind.
 * Returns [path, message] pairs; an empty list means valid. Scope is 'university' or a department id.
 */
export function eventProblems(v) {
  const problems = [];
  if (v.from_date && v.to_date && v.from_date > v.to_date) {
    problems.push(['to_date', 'to_date must be on or after from_date']);
  }
  if (v.kind === 'early_closing' && !v.cutoff_min && v.cutoff_min !== 0) {
    problems.push(['cutoff_min', 'Required for early_closing']);
  }
  if (['holiday', 'prep_leave', 'exam'].includes(v.kind) && v.cutoff_min != null) {
    problems.push(['cutoff_min', 'Not allowed for this kind']);
  }
  if (v.kind === 'dept_event' && v.scope === 'university') {
    problems.push(['scope', 'dept_event must have a department scope']);
  }
  return problems;
}

function validateEventFields(v, ctx) {
  for (const [path, message] of eventProblems(v)) {
    ctx.addIssue({ code: 'custom', path: [path], message });
  }
}

export const eventCreateBody = eventFields
  .extend({ confirm: z.boolean().optional() })
  .superRefine(validateEventFields);

export const eventUpdateBody = eventFields
  .partial()
  .extend({ confirm: z.boolean().optional() })
  .superRefine((v, ctx) => {
    if (!Object.keys(v).some((k) => k !== 'confirm')) {
      ctx.addIssue({ code: 'custom', message: 'At least one field must be provided' });
    }
    validateEventFields(v, ctx);
  });

export const eventIdParam = z.object({ id: objectIdString });

export const calendarEventsQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  department_id: objectIdString.optional(),
});

export const cancellationBody = z.object({
  date: dateString,
  reason: z.string().min(1).max(500),
});

export const cancellationParams = z.object({
  id: objectIdString, // slot id
  date: dateString,
});

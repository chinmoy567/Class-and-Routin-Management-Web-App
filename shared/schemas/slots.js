import { z } from 'zod';
const objectIdString = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

// Spec 08. The body shape is checked loosely here: a wrong or missing slot field is reported by
// the server as `SLOT_INVALID` with a list (EDT-04), so a form can show every problem at once.
const slotFields = {
  department_id: objectIdString.optional(),
  group: z.string().max(10).nullish(),
  day_of_week: z.number().int().nullish(),
  start: z.string().max(10).nullish(),
  end: z.string().max(10).nullish(),
  course_code: z.string().max(40).nullish(),
  course_name: z.string().max(200).nullish(),
  teachers: z.union([z.literal('TBA'), z.array(z.string().max(40)).max(10)]).nullish(),
  room: z.string().max(60).nullish(),
  confirm_warnings: z.boolean().optional(),
  booking_action: z.enum(['keep_booking', 'cancel_booking']).optional(),
  combine_with_slot_id: objectIdString.optional(),
};

export const slotCreateBody = z.strictObject({
  semester_id: objectIdString,
  section_id: objectIdString,
  ...slotFields,
});
export const slotUpdateBody = z.strictObject({
  section_id: objectIdString.optional(),
  version: z.number().int().min(1),
  ...slotFields,
});
export const slotDeleteBody = z.strictObject({
  version: z.number().int().min(1),
  booking_action: z.enum(['keep_booking', 'cancel_booking']).optional(),
});
export const slotIdParam = z.object({ id: objectIdString });
export const sectionsQuery = z.object({ department_id: objectIdString.optional() });

export const sectionCreateBody = z.strictObject({
  semester_id: objectIdString,
  department_id: objectIdString.optional(),
  level: z.number().int().min(1).max(4),
  term: z.enum(['I', 'II']),
  letter: z.string().regex(/^[A-Za-z]$/, 'One letter A-Z'),
});
export const groupBody = z.strictObject({
  label: z.string().regex(/^G\d{1,2}$/i, 'Use a label like G1'),
});

/** The slot form, checked in the browser before sending (the server checks again). */
export const slotFormSchema = z
  .object({
    group: z.string(),
    day_of_week: z.coerce.number().int().min(0).max(4),
    start: z.string().regex(/^\d{1,2}:\d{2}$/),
    end: z.string().regex(/^\d{1,2}:\d{2}$/),
    course_code: z.string().trim().min(1).max(40),
    course_name: z.string().max(200),
    teachers: z.string().trim().min(1).max(200),
    room: z.string().trim().min(1).max(60),
  })
  .strict();

import { z } from 'zod';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

// CRD-DSH-11: what a CR or DCR can flag to the admin.
export const FLAG_CATEGORIES = Object.freeze([
  'wrong_section',
  'wrong_group',
  'missing_student',
  'routine_mistake',
  'other',
]);

// CRD-DSH-08: the admin's decision on a flag.
export const FLAG_STATUSES = Object.freeze(['open', 'fixed', 'rejected']);

/** CRD-DSH-11 */
export const flagBody = z.strictObject({
  category: z.enum(FLAG_CATEGORIES, { error: 'Choose a category' }),
  student_id: objectId.optional(),
  description: z
    .string({ error: 'is required' })
    .trim()
    .min(10, 'Describe the problem in at least 10 characters')
    .max(1000, 'Keep the description to 1,000 characters'),
});

/** CRD-DSH-04 */
export const reminderBody = z.strictObject({ student_id: objectId });

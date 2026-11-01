import { z } from 'zod';
import { shortCodeSchema } from './auth.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** TCH-04, TCH-12: 5 to 500 characters. */
export const reasonSchema = z
  .string({ error: 'is required' })
  .trim()
  .min(5, 'Enter at least 5 characters')
  .max(500, 'Use 500 characters or fewer');

export const registrationsQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  department_id: objectId.optional(),
});

export const registrationIdParam = z.object({ id: objectId });

export const decisionBody = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('approve'), teacher_id: objectId.optional() }),
  z.strictObject({ decision: z.literal('reject'), reason: reasonSchema }),
]);

export const applyAgainBody = z.strictObject({
  department_id: objectId,
  short_code: shortCodeSchema,
});

export const teachersQuery = z.object({ department_id: objectId.optional() });

export const createTeacherBody = z.strictObject({
  department_id: objectId,
  short_code: shortCodeSchema,
  full_name: z.string({ error: 'is required' }).trim().min(2, 'Enter a name').max(100),
});

export const updateTeacherBody = z.strictObject({
  full_name: z.string({ error: 'is required' }).trim().min(2, 'Enter a name').max(100),
});

export const teacherIdParam = z.object({ id: objectId });
export const linkTeacherBody = z.strictObject({ user_id: objectId });
export const teacherAccountParam = z.object({ userId: objectId });
export const reasonBody = z.strictObject({ reason: reasonSchema });

export const teacherAccountsQuery = z.object({ department_id: objectId });

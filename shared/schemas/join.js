import { z } from 'zod';
import { reasonSchema } from './teachers.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const enrolmentIdParam = z.object({ id: objectId });

/** JR-01: no UV ID on the join form (spec 24). Unknown keys, `uv_id` included, are refused. */
export const createEnrolmentBody = z.strictObject({
  full_name: z.string().trim().min(2, 'Enter your name').max(100).optional(),
  section_id: objectId,
  group_id: objectId.optional(),
});

/** JR-10 */
export const joinDecisionBody = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('accept'), group_id: objectId.optional() }),
  z.strictObject({ decision: z.literal('reject'), reason: reasonSchema }),
]);

/** JR-16, JR-17: null clears the group. */
export const enrolmentGroupBody = z.strictObject({ group_id: objectId.nullable() });

export const joinRequestsQuery = z.object({
  status: z.enum(['pending']).default('pending'),
});

/** JR-20 */
export const appealDecisionBody = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('reverse'), group_id: objectId.optional() }),
  z.strictObject({ decision: z.literal('uphold') }),
]);

/** JR-19: the admin removes a student from a section. */
export const removeFromSectionBody = z.strictObject({ reason: reasonSchema });

export const adminJoinQuery = z.object({
  department_id: objectId.optional(),
  view: z.enum(['escalated', 'rejected', 'appeals']).default('escalated'),
});

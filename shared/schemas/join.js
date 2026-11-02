import { z } from 'zod';
import { reasonSchema } from './teachers.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/**
 * JR-05: remove spaces and dashes, keep leading zeros (`text`). `norm` also drops the zeros and
 * is used for duplicate checks only. Returns null when the result is not 1 to 20 digits.
 */
export function normaliseUvId(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/[\s-]/g, '');
  if (!/^\d{1,20}$/.test(text)) return null;
  const norm = text.replace(/^0+/, '') || '0';
  return { text, norm };
}

export const uvIdSchema = z
  .string({ error: 'is required' })
  .trim()
  .refine((v) => normaliseUvId(v) !== null, 'Enter 1 to 20 digits');

export const enrolmentIdParam = z.object({ id: objectId });

/** JR-01 */
export const createEnrolmentBody = z.strictObject({
  full_name: z.string().trim().min(2, 'Enter your name').max(100).optional(),
  uv_id: uvIdSchema.optional(),
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

/** JR-19 */
export const revokeBody = z.strictObject({ reason: reasonSchema });

/** JR-18 */
export const ownClaimBody = z.strictObject({ uv_id: uvIdSchema });

export const claimDecisionBody = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('approve') }),
  z.strictObject({ decision: z.literal('reject'), reason: reasonSchema }),
]);

export const adminJoinQuery = z.object({
  department_id: objectId.optional(),
  view: z.enum(['escalated', 'rejected', 'appeals', 'claims']).default('escalated'),
});

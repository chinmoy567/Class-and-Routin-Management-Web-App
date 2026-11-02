import { z } from 'zod';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

// CRD-02: the two roles a representative can hold.
export const REPRESENTATIVE_ROLES = Object.freeze(['cr', 'dcr']);

export const sectionIdParam = z.object({ id: objectId });
export const representativeRoleParam = z.object({ roleId: objectId });
export const assignBody = z.strictObject({
  user_id: objectId,
  role: z.enum(REPRESENTATIVE_ROLES, { error: 'Choose CR or DCR' }),
});
export const searchQuery = z.object({
  q: z.string({ error: 'is required' }).trim().min(2, 'Enter at least 2 characters').max(100),
  department_id: objectId.optional(),
});
export const summaryQuery = z.object({ department_id: objectId });

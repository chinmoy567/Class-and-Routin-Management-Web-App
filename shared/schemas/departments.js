import { z } from 'zod';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** DEP-01: 2 to 10 upper-case letters. */
export const departmentCode = z
  .string({ error: 'is required' })
  .trim()
  .regex(/^[A-Z]{2,10}$/, 'Use 2 to 10 upper-case letters');

const departmentName = z.string({ error: 'is required' }).trim().min(2, 'Enter a name').max(100);

export const createDepartmentBody = z.strictObject({ code: departmentCode, name: departmentName });

export const updateDepartmentBody = z
  .strictObject({ code: departmentCode.optional(), name: departmentName.optional() })
  .refine((v) => v.code !== undefined || v.name !== undefined, 'Nothing to change');

export const departmentIdParam = z.object({ id: objectId });

/** DEP-05, DEP-06: a department is needed for dept_admin and not allowed for super_admin. */
export const grantAdminBody = z
  .strictObject({
    user_id: objectId,
    role: z.enum(['dept_admin', 'super_admin']),
    department_id: objectId.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'dept_admin' && !v.department_id) {
      ctx.addIssue({ code: 'custom', path: ['department_id'], message: 'is required' });
    }
    if (v.role === 'super_admin' && v.department_id) {
      ctx.addIssue({ code: 'custom', path: ['department_id'], message: 'is not allowed' });
    }
  });

export const roleIdParam = z.object({ roleId: objectId });
export const adminUserIdParam = z.object({ userId: objectId });

export const userSearchQuery = z.object({
  q: z.string({ error: 'is required' }).trim().min(2, 'Type at least 2 letters').max(100),
});

import { z } from 'zod';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/**
 * PRF-03: Bangladeshi mobile numbers only. `01XXXXXXXXX` or `+8801XXXXXXXXX` (spaces and hyphens
 * are ignored) become `+8801XXXXXXXXX`.
 */
export const phoneSchema = z
  .string({ error: 'is required' })
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^(\+880|0)1[3-9]\d{8}$/.test(v), 'Enter a Bangladeshi mobile number')
  .transform((v) => `+880${v.replace(/^(\+880|0)/, '')}`);

/** PRF-03: the phone may be cleared with null. Anything else (a name, for example) is refused. */
export const updateProfileBody = z.strictObject({ phone: phoneSchema.nullable() });

const emailField = z
  .string({ error: 'is required' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address');

export const changeEmailBody = z.object({ new_email: emailField });
export const confirmEmailBody = z.object({ token: z.string().min(10).max(200) });

/** PRF-02 */
export const renameBody = z.object({
  full_name: z.string({ error: 'is required' }).trim().min(2, 'Enter a full name').max(100),
});

export const userIdParam = z.object({ id: objectId });

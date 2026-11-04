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

/**
 * PRF-10 (spec 24): trim, remove spaces and dashes, keep leading zeros. Returns the cleaned text,
 * '' for an empty value, or null when it is not 1 to 20 digits. Not unique, never checked.
 */
export function normaliseUvId(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/[\s-]/g, '');
  if (text === '') return '';
  return /^\d{1,20}$/.test(text) ? text : null;
}

/** PRF-10: '' or null clears the UV ID (both become null). */
export const uvIdSchema = z
  .string({ error: 'Enter 1 to 20 digits' })
  .refine((v) => normaliseUvId(v) !== null, 'Enter 1 to 20 digits')
  .transform((v) => normaliseUvId(v) || null)
  .nullable();

/**
 * PRF-03, PRF-10: the phone and (students) the UV ID may be changed or cleared with null.
 * Anything else (a name, for example) is refused, and at least one field must be sent.
 */
export const updateProfileBody = z
  .strictObject({ phone: phoneSchema.nullable().optional(), uv_id: uvIdSchema.optional() })
  .refine((v) => 'phone' in v || 'uv_id' in v, 'Send phone or uv_id');

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

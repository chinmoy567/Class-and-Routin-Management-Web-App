import { z } from 'zod';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** AUTH-06: 8 to 128 characters, at least one letter and one number. */
export const passwordSchema = z
  .string({ error: 'is required' })
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v), 'Include at least one letter')
  .refine((v) => /\d/.test(v), 'Include at least one number');

export const emailSchema = z
  .string({ error: 'is required' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address');

const fullName = z.string({ error: 'is required' }).trim().min(2, 'Enter your full name').max(100);

/** AUTH-04: a teacher also gives a department and a short code of 1 to 10 letters. */
export const shortCodeSchema = z
  .string({ error: 'is required' })
  .trim()
  .regex(/^[A-Za-z]{1,10}$/, 'Use 1 to 10 letters')
  .transform((v) => v.toUpperCase());

export const signupBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('student'),
    full_name: fullName,
    email: emailSchema,
    password: passwordSchema,
  }),
  z.object({
    kind: z.literal('teacher'),
    full_name: fullName,
    email: emailSchema,
    password: passwordSchema,
    department_id: objectId,
    short_code: shortCodeSchema,
  }),
]);

export const captchaAnswer = z.object({
  id: objectId,
  solution: z.string().min(1).max(64),
});

export const loginBody = z.object({
  email: emailSchema,
  password: z.string({ error: 'is required' }).min(1, 'is required').max(128),
  captcha: captchaAnswer.optional(),
});

export const verifyBody = z.object({ token: z.string().min(10).max(200) });
export const resendBody = z.object({ email: emailSchema });

/** A 6 digit code from the authenticator app or from the email. */
export const secondStepBody = z.object({
  code: z
    .string({ error: 'is required' })
    .trim()
    .regex(/^\d{6}$/, 'Enter 6 digits'),
});

export const resetRequestBody = z.object({ email: emailSchema });
export const resetConfirmBody = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});

export const changePasswordBody = z.object({
  current_password: z.string({ error: 'is required' }).min(1, 'is required').max(128),
  new_password: passwordSchema,
});

export const domainBody = z.object({
  domain: z
    .string({ error: 'is required' })
    .trim()
    .toLowerCase()
    .regex(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, 'Enter a domain such as baiust.ac.bd'),
});

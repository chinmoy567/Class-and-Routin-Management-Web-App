import { z } from 'zod';

// Spec 20 request shapes. The client imports these where it can.
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Choose a valid id.');

export const peopleQuery = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters.').max(60, 'Search is too long.'),
});

export const idParam = z.object({ id: objectId });
export const messageIdParam = z.object({ id: objectId });
export const memberParams = z.object({ id: objectId, userId: objectId });
export const restoreParams = z.object({ memberId: objectId });
export const userParams = z.object({ userId: objectId });

export const directBody = z.object({ user_id: objectId });
export const blockBody = z.object({ user_id: objectId });

// SAF-10: 1 hour to 90 days (2,160 hours), with a reason.
export const suspendBody = z.object({
  user_id: objectId,
  hours: z.number().int('Choose whole hours.').min(1).max(2160),
  reason: z
    .string()
    .trim()
    .min(1, 'Give a reason.')
    .max(500, 'The reason can have up to 500 characters.'),
});
export const suspensionParams = z.object({ id: objectId });
export const suspensionsQuery = z.object({ user_id: objectId });

// SAF-04: a report of a message (message_id) or of a person, with a reason and an optional note.
export const REPORT_CATEGORIES = ['harassment', 'spam', 'inappropriate', 'impersonation', 'other'];
export const reportBody = z.object({
  target_user_id: objectId,
  message_id: objectId.optional(),
  category: z.enum(REPORT_CATEGORIES, { error: 'Choose a reason.' }),
  note: z.string().trim().max(500, 'The note can have up to 500 characters.').optional(),
});
export const reportsQuery = z.object({
  status: z.enum(['open', 'closed']).default('open'),
});
export const reportParams = z.object({ id: objectId });
// SAF-08: the admin's outcome, with an optional note.
export const closeReportBody = z.object({
  outcome: z.enum(['no_action', 'warned', 'suspended', 'message_removed'], {
    error: 'Choose an outcome.',
  }),
  note: z.string().trim().max(500, 'The note can have up to 500 characters.').optional(),
});

// CHT-06: plain text, 1 to 4,000 characters.
export const messageBody = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a message.')
    .max(4000, 'A message can have up to 4,000 characters.'),
});

export const messagesQuery = z.object({ before: objectId.optional() });

// CHT-10a: an appeal is up to 500 characters.
export const appealBody = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Write your appeal.')
    .max(500, 'An appeal can have up to 500 characters.'),
});

// Spec 21, FIL-08: the download link's query, as the link endpoint wrote it.
export const fileDownloadQuery = z.object({
  u: objectId,
  exp: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[a-f\d]{64}$/i, 'Invalid link.'),
});

// Spec 21: an optional caption on a file, same limit as a text message.
export const fileCaption = z
  .string()
  .trim()
  .max(4000, 'A message can have up to 4,000 characters.');

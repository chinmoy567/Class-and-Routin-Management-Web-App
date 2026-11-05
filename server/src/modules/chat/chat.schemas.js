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

export const directBody = z.object({ user_id: objectId });

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

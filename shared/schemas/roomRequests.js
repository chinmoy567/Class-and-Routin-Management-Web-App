import { z } from 'zod';
import { minuteOfDay, isoDate } from './rooms.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const ROOM_REQUEST_STATUSES = Object.freeze([
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'expired',
]);

const note = (min, max) =>
  z
    .string({ error: 'Write a note' })
    .trim()
    .min(min, `Write at least ${min} characters`)
    .max(max, `Use ${max} characters or fewer`);

export const roomRequestIdParam = z.object({ id: objectId });

/** BKG-02: one room, one date, one range; 30 min to 3 h, 08:00 to 18:00, 5-minute steps. */
export const sendRoomRequestBody = z
  .strictObject({
    room_id: objectId,
    date: isoDate,
    start: minuteOfDay,
    end: minuteOfDay,
    note: note(5, 300),
    target_section_id: objectId,
    target_group_id: objectId.optional(),
    named_teacher_id: objectId.optional(),
  })
  .refine((v) => v.end > v.start, {
    message: 'The end time must be after the start time',
    path: ['end'],
  })
  .refine((v) => v.end - v.start >= 30 && v.end - v.start <= 180, {
    message: 'A request lasts from 30 minutes to 3 hours',
    path: ['end'],
  });

/** BKG-14, BKG-15: approve or reject. A note is optional on either. */
export const roomRequestDecisionBody = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('approve') }),
  z.strictObject({ decision: z.literal('reject'), note: note(1, 300).optional() }),
]);

/** BKG-21, BKG-22: a decider must give a reason, a requester may not. */
export const roomRequestCancelBody = z.strictObject({
  reason: note(1, 300).optional(),
});

/** BKG-23 */
export const roomRequestNoShowBody = z.strictObject({ note: note(1, 300) });

export const roomRequestQueueQuery = z.object({
  status: z.enum(['pending']).default('pending'),
  department_id: objectId.optional(),
});

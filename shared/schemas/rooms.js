import { z } from 'zod';
const objectIdString = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const ROOM_TYPES = Object.freeze(['classroom', 'lab']);

/** Trim and collapse inner whitespace, then check the length (ROOM-01, ROOM-02). */
const spaced = (min, max, empty, long) =>
  z
    .string({ error: 'is required' })
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(min, empty).max(max, long));

/** ROOM-01: 1 to 20 characters, for example `311` or `LR-407B`. */
export const roomCode = spaced(1, 20, 'Enter a room code', 'Use 20 characters or fewer');
/** ROOM-02: a sheet spelling such as `RN: 311`. */
export const roomAlias = spaced(1, 40, 'Enter an alias', 'Use 40 characters or fewer');

const roomType = z.enum(ROOM_TYPES, { error: 'Choose classroom or lab' });

export const createRoomBody = z.strictObject({
  code: roomCode,
  type: roomType,
  department_id: objectIdString,
});

export const updateRoomBody = z
  .strictObject({ code: roomCode.optional(), type: roomType.optional() })
  .refine((v) => v.code !== undefined || v.type !== undefined, 'Nothing to change');

export const createAliasBody = z.strictObject({ alias: roomAlias });

/** ROOM-04: the full list of sharing departments (replaces the old list). */
export const setSharesBody = z.strictObject({
  department_ids: z
    .array(objectIdString)
    .max(50)
    .refine((ids) => new Set(ids.map((i) => i.toLowerCase())).size === ids.length, 'Duplicate'),
});

export const roomIdParam = z.object({ id: objectIdString });
export const roomAliasParams = z.object({ id: objectIdString, aliasId: objectIdString });
export const adminRoomsQuery = z.object({ department_id: objectIdString.optional() });

// FRV-01: a time of day as minutes since midnight, on 5-minute steps, between 08:00 and 18:00.
const minuteOfDay = z.coerce
  .number({ error: 'Choose a time' })
  .int('Use whole minutes')
  .min(480, 'Choose a time from 08:00')
  .max(1080, 'Choose a time up to 18:00')
  .refine((m) => m % 5 === 0, 'Use 5-minute steps');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// FRV-01, FRV-06: the free-room query.
export const availabilityQuery = z
  .object({
    date: isoDate,
    from: minuteOfDay,
    to: minuteOfDay,
    type: roomType.optional(),
    department_id: objectIdString.optional(),
  })
  .refine((v) => v.from < v.to, {
    message: 'The end time must be after the start time',
    path: ['to'],
  });

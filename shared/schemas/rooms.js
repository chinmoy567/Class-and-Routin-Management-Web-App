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

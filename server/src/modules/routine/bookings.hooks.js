// EDT-05: spec 19 (room bookings) plugs in here. Until then nothing is registered, so no
// booking is ever reported and the booking choice is a no-op.
const clashProviders = [];
const actionHandlers = [];

/** `async ({ semester_id, room_id, day_of_week, start_min, end_min }) => [booking]`. A booking is
 * `{ id, date, requester_name, ... }`: future approved bookings only. */
export const registerBookingClashProvider = (fn) => clashProviders.push(fn);
/** `async ({ action: 'keep_booking' | 'cancel_booking', bookings, actor, session }) => void`. */
export const registerBookingActionHandler = (fn) => actionHandlers.push(fn);
/** For tests: forget every provider and handler. */
export function resetBookingHooks() {
  clashProviders.length = 0;
  actionHandlers.length = 0;
}

/** Approved future bookings for these room and time places, without duplicates. */
export async function findBookingClashes(places) {
  const seen = new Map();
  for (const place of places) {
    for (const fn of clashProviders) {
      for (const b of await fn(place)) seen.set(String(b.id), b);
    }
  }
  return [...seen.values()];
}

export async function applyBookingAction({ action, bookings, actor, session }) {
  if (!action || !bookings.length) return;
  for (const fn of actionHandlers) await fn({ action, bookings, actor, session });
}

// BKG-18: approved bookings for a viewer's section, group or teacher, in one date range. The
// bookings module registers this; routine only merges what it returns (never the booking rules).
const bookingsProviders = [];
export const registerBookingsForRoutineProvider = (fn) => bookingsProviders.push(fn);

/** `[{ id, date, start_min, end_min, room_code, course_name }]` for the viewer's routine. */
export async function bookingsForRoutine(args) {
  const out = [];
  for (const fn of bookingsProviders) out.push(...(await fn(args)));
  return out;
}

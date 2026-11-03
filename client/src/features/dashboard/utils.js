import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'Asia/Dhaka';
const DAY_MS = 86_400_000;

/** The institution date (YYYY-MM-DD, Asia/Dhaka) `offsetDays` from now. Never the device zone. */
export const dhakaDate = (offsetDays = 0, now = new Date()) =>
  formatInTimeZone(new Date(now.getTime() + offsetDays * DAY_MS), TZ, 'yyyy-MM-dd');

/** Add days to a YYYY-MM-DD string (Dhaka has no daylight saving, so plain UTC arithmetic holds). */
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The day entry of a routine response for one date, or undefined. */
export const dayOf = (routine, date) => routine?.days?.find((d) => d.date === date);

/** The earliest class of a day that is not cancelled, or null. */
export function firstClassOf(day) {
  const slots = (day?.slots ?? []).filter((s) => s.status !== 'cancelled');
  if (!slots.length) return null;
  return slots.reduce((a, b) => (b.start_min < a.start_min ? b : a));
}

/** DSH-12: the first class of the next day that has any (inside the fetched range), or null. */
export function nextTeachingDay(routine, after) {
  const days = (routine?.days ?? [])
    .filter((d) => d.date > after)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const day of days) {
    const slot = firstClassOf(day);
    if (slot) return { date: day.date, slot };
  }
  return null;
}

/**
 * What the Today card shows: today's classes in time order, the tomorrow preview (students) or the
 * next teaching day once none is left today (teachers). Plain data, so the component stays simple.
 */
export function todayView({ routine, status, isTeacher }) {
  const today = routine?.today;
  if (!today) return { slots: [], tomorrow: null, next: null };
  const slots = (dayOf(routine, today)?.slots ?? [])
    .slice()
    .sort((a, b) => a.start_min - b.start_min);
  const tomorrow = isTeacher ? null : firstClassOf(dayOf(routine, addDays(today, 1)));
  const next =
    isTeacher && noClassesLeftToday(status, today) ? nextTeachingDay(routine, today) : null;
  return { slots, tomorrow, next };
}

/**
 * DSH-12: true when no class is left today, from the live status (computed from server time).
 * `free` with no next class today means the rest of today is empty.
 */
export function noClassesLeftToday(status, today) {
  if (!status) return false;
  const { kind, next } = status;
  if (['no_classes_today', 'classes_over', 'event', 'no_semester'].includes(kind)) return true;
  if (kind === 'free') return !next || next.date !== today;
  return false;
}

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { INSTITUTION_TIMEZONE as TZ } from '@crm/shared/enums';

// The only place allowed to read the system clock (FND-13).
let override = null;
export const clock = {
  now() {
    return override ? new Date(override.getTime()) : new Date();
  },
  /** Tests: fix the clock at an instant (Date or ISO string). */
  set(instant) {
    override = new Date(instant);
  },
  reset() {
    override = null;
  },
};

const pad = (n) => String(n).padStart(2, '0');

export const institutionNow = () => clock.now();

export function toInstitutionDate(instant) {
  return formatInTimeZone(instant, TZ, 'yyyy-MM-dd');
}

export function minutesOfDay(instant) {
  const [h, m] = formatInTimeZone(instant, TZ, 'HH:mm').split(':').map(Number);
  return h * 60 + m;
}

/** UTC instant of an institution date plus minutes since midnight. */
export function instantFrom(date, minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return fromZonedTime(`${date}T${pad(h)}:${pad(m)}:00`, TZ);
}

const asUtcDate = (date) => new Date(`${date}T00:00:00Z`);

/** 0 = Sunday ... 6 = Saturday. A week runs Sunday to Saturday. */
export const weekdayOf = (date) => asUtcDate(date).getUTCDay();

export function addDays(date, days) {
  const d = asUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const weekStart = (date) => addDays(date, -weekdayOf(date));

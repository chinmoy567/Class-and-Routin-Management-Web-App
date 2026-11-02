// Pure helpers for the free-room view. Institution time (Asia/Dhaka) is computed by the server;
// these only shape what the pickers offer. The server enforces the real window (FRV-01).

const pad = (n) => String(n).padStart(2, '0');

/** Minutes since midnight as HH:MM. */
export const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export const FIRST_MINUTE = 480; // 08:00
export const LAST_MINUTE = 1080; // 18:00
export const STEP_MINUTES = 5;

/** The 5-minute steps for a start time (08:00 to 17:55) or an end time (08:05 to 18:00). */
export function timeOptions(kind) {
  const first = kind === 'end' ? FIRST_MINUTE + STEP_MINUTES : FIRST_MINUTE;
  const last = kind === 'end' ? LAST_MINUTE : LAST_MINUTE - STEP_MINUTES;
  const out = [];
  for (let m = first; m <= last; m += STEP_MINUTES) out.push(m);
  return out;
}

const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** FRV-01: this week and next week, Sunday to Saturday, counted from the institution date. */
export function weekBounds(institutionDate) {
  const dow = new Date(`${institutionDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const thisSunday = addDays(institutionDate, -dow);
  return { min: thisSunday, max: addDays(thisSunday, 13) };
}

import { minutesToTime } from './hooks.js';

export function slotForPeriod(slots, periodStart) {
  for (const s of slots) {
    if (s.start_min <= periodStart && s.end_min > periodStart) return s;
  }
  return null;
}

export function fmtMin(min) {
  if (min == null) return '';
  return minutesToTime(min);
}

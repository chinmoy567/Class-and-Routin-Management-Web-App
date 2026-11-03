import { minutesToTime } from './hooks.js';

export function slotForPeriod(slots, periodStart) {
  for (const s of slots) {
    if (s.start_min <= periodStart && s.end_min > periodStart) return s;
  }
  return null;
}

/** The day shown in the phone list: the chosen date, or the first day of the range. */
export function activeDayOf(days, date) {
  return days.find((d) => d.date === date) ?? days[0];
}

/** The rule label (closed day, early closing, exam…) for a day, or null for an ordinary day. */
export function dayRuleLabelOf(day) {
  const kind = day.dayRule?.kind;
  return kind && kind !== 'normal' ? (day.dayRule.label ?? kind) : null;
}

export function fmtMin(min) {
  if (min == null) return '';
  return minutesToTime(min);
}

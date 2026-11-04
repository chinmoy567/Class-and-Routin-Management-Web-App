import { minutesToTime } from './hooks.js';

/**
 * RTN-17: where one day's slots go on the grid. A slot starts in the period that contains its
 * start and spans every period it overlaps, so a multi-period lab is one block. Returns the slot
 * and span for each row where a block starts, and the rows that a block covers from above.
 */
export function placeSlots(daySlots, periods) {
  const starts = new Map();
  const covered = new Set();
  for (const slot of [...daySlots].sort((a, b) => a.start_min - b.start_min)) {
    const rows = [];
    periods.forEach((p, i) => {
      if (p.start_min < slot.end_min && p.end_min > slot.start_min) rows.push(i);
    });
    if (!rows.length || starts.has(rows[0])) continue; // the first slot that starts here wins
    starts.set(rows[0], { slot, span: rows.length });
    for (const row of rows.slice(1)) covered.add(row);
  }
  return { starts, covered };
}

/** The day of the routine with this date, or undefined. */
export function dayOn(days, date) {
  return (days ?? []).find((d) => d.date === date);
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

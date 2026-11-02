/**
 * RTN-08 to RTN-13: pure live-status resolver.
 * No I/O — all data comes from GET /api/me/routine so the client and the server use the same rules.
 *
 * @param {object} routineData  the `data` field of a GET /api/me/routine response
 * @param {number} serverNow    milliseconds since epoch (Date.now() + offset from RTN-11)
 * @returns {{ kind: string, slot?: object, ends_at?: number, next?: object, label?: string }}
 */

const INSTITUTION_TZ = 'Asia/Dhaka';

/** Convert a ms timestamp to YYYY-MM-DD in Asia/Dhaka without date-fns-tz (browser-safe). */
function toInstitutionDate(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: INSTITUTION_TZ });
}

/** Minutes since midnight in Asia/Dhaka for a given ms timestamp. */
function minutesOfDay(ms) {
  const parts = new Date(ms).toLocaleTimeString('en-GB', {
    timeZone: INSTITUTION_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const [h, m] = parts.split(':').map(Number);
  return h * 60 + m;
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD string. */
const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Add N calendar days to a YYYY-MM-DD string. */
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * RTN-08, RTN-10: walk forward from `date` (inclusive) up to `maxDays` days
 * and return the first slot with status 'runs', or null.
 */
function nextRunningSlot(days, fromDate, minutesSoFar, semester, maxDays = 14) {
  for (let i = 0; i <= maxDays; i++) {
    const date = addDays(fromDate, i);

    // Stop past the semester.
    if (date > semester.end_date) break;

    const entry = days.find((d) => d.date === date);
    if (!entry) break; // not in the payload — can't go further

    const { dayRule, slots } = entry;
    if (
      dayRule.kind === 'no_semester' ||
      dayRule.kind === 'non_teaching_day' ||
      dayRule.kind === 'closed'
    ) {
      continue;
    }

    const running = slots
      .filter((s) => s.status === 'runs')
      .sort((a, b) => a.start_min - b.start_min);

    for (const slot of running) {
      // On the starting date, only consider slots that haven't ended yet.
      if (i === 0 && slot.effective_end_min <= minutesSoFar) continue;
      return { slot, date };
    }
  }
  return null;
}

/**
 * RTN-08: given the routine payload and `serverNow` (ms, already offset-adjusted),
 * return the live status for the caller.
 *
 * Returns:
 *   { kind: 'in_class' | 'teaching', slot, ends_at }   — a slot contains now
 *   { kind: 'free', next? }                              — free; next = { slot, date } or null
 *   { kind: 'event', label }                             — full-day closed event
 *   { kind: 'classes_over', label }                      — after early-closing cutoff
 *   { kind: 'no_classes_today' }                         — Fri/Sat
 *   { kind: 'no_semester' }                              — outside semester dates
 */
export function liveStatus(routineData, serverNow) {
  const { semester, days, week: _week, bookings: _b } = routineData;
  const isTeacher = routineData.is_teacher ?? false;

  const today = toInstitutionDate(serverNow);
  const nowMin = minutesOfDay(serverNow);

  const todayEntry = days.find((d) => d.date === today);

  // If today is not in the payload at all, derive the rule from semester boundaries.
  if (!todayEntry) {
    const d = today;
    if (d < semester.start_date || d > semester.end_date) return { kind: 'no_semester' };
    const wd = weekdayOf(today);
    if (wd === 5 || wd === 6) return { kind: 'no_classes_today' };
    // payload doesn't cover today — treat as no data
    return { kind: 'no_semester' };
  }

  const { dayRule, slots } = todayEntry;

  // RTN-08 step 1: semester check
  if (dayRule.kind === 'no_semester') return { kind: 'no_semester' };

  // RTN-08 step 2: non-teaching day
  if (dayRule.kind === 'non_teaching_day') return { kind: 'no_classes_today' };

  // RTN-08 step 3: closed full-day event
  if (dayRule.kind === 'closed') return { kind: 'event', label: dayRule.label };

  // RTN-08 step 5+6: find running slot that contains now
  const runningSlots = slots.filter((s) => s.status === 'runs');

  const currentSlot = runningSlots.find(
    (s) => s.start_min <= nowMin && nowMin < s.effective_end_min,
  );

  if (currentSlot) {
    return {
      kind: isTeacher ? 'teaching' : 'in_class',
      slot: currentSlot,
      ends_at: currentSlot.effective_end_min,
    };
  }

  // RTN-08 step 7: classes_over after cutoff
  if (dayRule.kind === 'cutoff' && nowMin >= dayRule.cutoff_min) {
    return { kind: 'classes_over', label: dayRule.label };
  }

  // RTN-08 step 8: free — find next running slot
  const next = nextRunningSlot(days, today, nowMin, semester);
  return { kind: 'free', next: next ?? null };
}

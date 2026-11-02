/**
 * CAL-06 to CAL-09: pure calendar resolver.
 * No I/O — all data is passed in so the client can use the exact same logic.
 *
 * @typedef {{ start_date: string, end_date: string }} Semester
 * @typedef {{ scope_department_id?: string|null, from_date: string, to_date: string,
 *   kind: string, cutoff_min?: number|null, label: string, created_at: Date|string }} CalEvent
 * @typedef {{ slot_id: string, date: string, reason?: string }} Cancellation
 */

/** "0000-00-00" string → UTC day number for simple comparison */
const asDay = (date) => new Date(`${date}T00:00:00Z`).getTime();

/** 0 = Sunday … 6 = Saturday */
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * CAL-06, CAL-07: day rule for a department's slots on a date.
 *
 * @param {string} date YYYY-MM-DD (institution time)
 * @param {string|null} departmentId the section's department (null = university-wide student)
 * @param {{ events: CalEvent[], semester: Semester }} 
 * @returns {{ kind: string, label?: string, cutoff_min?: number }}
 */
export function dayRule(date, departmentId, { events, semester }) {
  const deptStr = departmentId ? String(departmentId) : null;

  if (asDay(date) < asDay(semester.start_date) || asDay(date) > asDay(semester.end_date)) {
    return { kind: 'no_semester' };
  }

  const wd = weekday(date);
  if (wd === 5 || wd === 6) {
    return { kind: 'non_teaching_day' };
  }

  // Filter events that cover this date and apply to this department.
  // CAL-06: universe events always apply; dept events apply only to their department.
  const applicable = events.filter((e) => {
    const deptMatch = !e.scope_department_id || String(e.scope_department_id) === deptStr;
    return deptMatch && asDay(date) >= asDay(e.from_date) && asDay(date) <= asDay(e.to_date);
  });

  if (!applicable.length) return { kind: 'normal' };

  // CAL-07: closed beats cutoff.
  const closedEvents = applicable.filter(
    (e) =>
      e.kind === 'holiday' ||
      e.kind === 'prep_leave' ||
      e.kind === 'exam' ||
      (e.kind === 'dept_event' && !e.cutoff_min && e.cutoff_min !== 0),
  );

  if (closedEvents.length) {
    // CAL-07: dept-scope label wins over university; among same scope, earliest-created.
    const sorted = [...closedEvents].sort((a, b) => {
      const aDept = Boolean(a.scope_department_id);
      const bDept = Boolean(b.scope_department_id);
      if (aDept !== bDept) return aDept ? -1 : 1;
      return new Date(a.created_at) - new Date(b.created_at);
    });
    return { kind: 'closed', label: sorted[0].label };
  }

  // Cutoff events: early_closing or dept_event with cutoff.
  const cutoffEvents = applicable.filter(
    (e) =>
      e.kind === 'early_closing' ||
      (e.kind === 'dept_event' && (e.cutoff_min || e.cutoff_min === 0)),
  );

  if (cutoffEvents.length) {
    // CAL-07: earliest cutoff wins.
    const sorted = [...cutoffEvents].sort((a, b) => a.cutoff_min - b.cutoff_min);
    return { kind: 'cutoff', cutoff_min: sorted[0].cutoff_min, label: sorted[0].label };
  }

  return { kind: 'normal' };
}

/**
 * CAL-08: does this routine slot run on a given date?
 *
 * @param {{ day_of_week: number, start_min: number, end_min: number,
 *   department_id: string }} slot  section's department_id is resolved by the caller
 * @param {string} date YYYY-MM-DD
 * @param {{ events: CalEvent[], cancellations: Cancellation[], semester: Semester }} ctx
 * @returns {{ status: 'runs'|'stopped'|'cancelled', end_min?: number, label?: string, reason?: string }}
 */
export function slotRuns(slot, date, { events, cancellations, semester }) {
  // CAL-10: single-class cancellation.
  const cancelled = (cancellations || []).find(
    (c) => String(c.slot_id) === String(slot.slot_id ?? slot._id ?? slot.id) && c.date === date,
  );
  if (cancelled) {
    return { status: 'cancelled', reason: cancelled.reason };
  }

  // Uses the slot's section's department (CAL-08 decision).
  const rule = dayRule(date, slot.department_id, { events, semester });

  if (rule.kind === 'closed' || rule.kind === 'no_semester' || rule.kind === 'non_teaching_day') {
    return { status: 'stopped', label: rule.label };
  }

  if (rule.kind === 'cutoff') {
    // A class that starts at or after the cutoff doesn't run.
    if (slot.start_min >= rule.cutoff_min) {
      return { status: 'stopped', label: rule.label };
    }
    // A class running at the cutoff ends at the cutoff.
    return {
      status: 'runs',
      end_min: Math.min(slot.end_min, rule.cutoff_min),
    };
  }

  return { status: 'runs', end_min: slot.end_min };
}

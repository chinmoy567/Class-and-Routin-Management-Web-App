import { slotRuns, dayRule } from '@crm/shared';
import { RoutineSlot } from './routine.model.js';
import { getEventsForDepartment, getCancellationsForSlots } from '../calendar/index.js';
import { weekdayOf } from '../../lib/time.js';

// FRV-02, FRV-03, FRV-04: the routine's answers to the free-room view, registered with rooms.
// Calendar rules come only from the calendar module's exported functions (CAL-08 via slotRuns).

const UNIVERSITY = 'university';

/** FRV-02: departments that have at least one published slot in this semester. */
export async function publishedDepartments({ semester }) {
  return RoutineSlot.distinct('owner_department_id', {
    semester_id: semester.id,
    published: true,
  });
}

/**
 * FRV-03: the published slots that run on `date` and overlap `[from, to)`, with their effective
 * end (a class running at a cutoff ends at the cutoff). Cancelled and stopped slots are left out.
 */
export async function runningSlots({ semester, date, from, to }) {
  const day = weekdayOf(date);
  if (day === 5 || day === 6) return []; // Friday and Saturday never run (CAL-06)
  const slots = await RoutineSlot.find({
    semester_id: semester.id,
    published: true,
    room_id: { $ne: null },
    day_of_week: day,
    start_min: { $lt: to },
    end_min: { $gt: from },
  })
    .select('_id room_id owner_department_id start_min end_min')
    .lean();
  if (!slots.length) return [];

  const deptIds = [...new Set(slots.map((s) => String(s.owner_department_id)))];
  const eventsByDept = new Map();
  for (const id of deptIds) {
    eventsByDept.set(id, await getEventsForDepartment(id, date, date));
  }
  const cancellations = await getCancellationsForSlots(
    slots.map((s) => s._id),
    { from: date, to: date },
  );

  const runs = [];
  for (const slot of slots) {
    const deptId = String(slot.owner_department_id);
    const result = slotRuns(
      {
        slot_id: String(slot._id),
        department_id: deptId,
        day_of_week: day,
        start_min: slot.start_min,
        end_min: slot.end_min,
      },
      date,
      { events: eventsByDept.get(deptId), cancellations, semester },
    );
    if (result.status === 'runs') {
      runs.push({
        room_id: String(slot.room_id),
        start_min: slot.start_min,
        end_min: result.end_min ?? slot.end_min,
      });
    }
  }
  return runs;
}

/**
 * FRV-04: the day rule for the university and for each owner department, for one date. Rooms
 * use the rule of their owner department; the top-level answer uses the university rule.
 */
export async function dayRules({ semester, date, departmentIds }) {
  const rules = new Map();
  rules.set(
    UNIVERSITY,
    dayRule(date, null, { events: await getEventsForDepartment(null, date, date), semester }),
  );
  for (const id of departmentIds) {
    const events = await getEventsForDepartment(id, date, date);
    rules.set(String(id), dayRule(date, id, { events, semester }));
  }
  return rules;
}

import { rangesOverlap, slotRuns } from '@crm/shared';
import { RoutineSlot, RoutineSlotTeacher } from './routine.model.js';
import { getEventsForDepartment, getCancellationsForSlots } from '../calendar/index.js';
import { weekdayOf } from '../../lib/time.js';

/**
 * BKG-06, BKG-07: the published classes that run on `date` and overlap `[from, to)` for any of the
 * given sections or teachers. A class counts only if it runs that day (calendar rules applied, the
 * same as spec 11). A whole-section class has `group_id: null` and so blocks every group.
 *
 * Returns `[{ slot_id, section_id, group_id, teacher_ids, start_min, end_min }]`.
 * Teachers come from the routine, never from the request (CLAUDE.md, booking rules).
 */
export async function runningClasses({
  semester,
  date,
  from,
  to,
  sectionIds = [],
  teacherIds = [],
}) {
  const day = weekdayOf(date);
  if (day === 5 || day === 6) return []; // Friday and Saturday never run (CAL-06)
  if (!sectionIds.length && !teacherIds.length) return [];

  const scope = [];
  if (sectionIds.length) scope.push({ section_id: { $in: sectionIds } });
  if (teacherIds.length) {
    const links = await RoutineSlotTeacher.find({ teacher_id: { $in: teacherIds } })
      .select('slot_id')
      .lean();
    scope.push({ _id: { $in: links.map((l) => l.slot_id) } });
  }

  const slots = await RoutineSlot.find({
    semester_id: semester.id,
    published: true,
    day_of_week: day,
    start_min: { $lt: to },
    end_min: { $gt: from },
    $or: scope,
  })
    .select('_id section_id group_id owner_department_id start_min end_min')
    .lean();
  if (!slots.length) return [];

  const slotIds = slots.map((s) => s._id);
  const teacherLinks = await RoutineSlotTeacher.find({ slot_id: { $in: slotIds } })
    .select('slot_id teacher_id')
    .lean();
  const teachersOf = new Map();
  for (const l of teacherLinks) {
    const key = String(l.slot_id);
    if (!teachersOf.has(key)) teachersOf.set(key, []);
    teachersOf.get(key).push(String(l.teacher_id));
  }

  const deptIds = [...new Set(slots.map((s) => String(s.owner_department_id)))];
  const eventsByDept = new Map();
  for (const id of deptIds) {
    eventsByDept.set(id, await getEventsForDepartment(id, date, date));
  }
  const cancellations = await getCancellationsForSlots(slotIds, { from: date, to: date });

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
    if (result.status !== 'runs') continue;
    const end = result.end_min ?? slot.end_min; // a class cut short by a calendar cutoff
    if (!rangesOverlap(slot.start_min, end, from, to)) continue;
    runs.push({
      slot_id: String(slot._id),
      section_id: String(slot.section_id),
      group_id: slot.group_id ? String(slot.group_id) : null,
      teacher_ids: teachersOf.get(String(slot._id)) ?? [],
      start_min: slot.start_min,
      end_min: end,
    });
  }
  return runs;
}

/**
 * BKG-02: the teacher records that teach a section in a semester, from its published routine.
 * Used to check the requesting teacher or the teacher a CR/DCR names. Never taken from the request.
 */
export async function teacherIdsOfSection({ semesterId, sectionId }) {
  const slots = await RoutineSlot.find({
    semester_id: semesterId,
    section_id: sectionId,
    published: true,
  })
    .select('_id')
    .lean();
  if (!slots.length) return [];
  const links = await RoutineSlotTeacher.find({ slot_id: { $in: slots.map((s) => s._id) } })
    .select('teacher_id')
    .lean();
  return [...new Set(links.map((l) => String(l.teacher_id)))];
}

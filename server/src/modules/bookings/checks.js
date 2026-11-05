import { dayRule } from '@crm/shared';
import { AppError } from '../../lib/errors.js';
import { t } from '../../i18n/index.js';
import { addDays, instantFrom, toInstitutionDate, weekStart, weekdayOf } from '../../lib/time.js';
import { getEventsForDepartment } from '../calendar/index.js';
import { roomStatusFor } from '../rooms/index.js';
import { runningClasses } from '../routine/index.js';
import { RoomRequest } from './bookings.model.js';

// BKG-04 to BKG-10: the checks run when a request is sent, and again when an admin approves it.
// Approval skips only the 12-hour rule (BKG-09), because the decision can come later than the send.

const LEAD_MS = 12 * 60 * 60 * 1000; // BKG-09
const DAY_RULE_BLOCKS = new Set(['closed', 'non_teaching_day', 'no_semester']);

const fail = (code, key, vars) => new AppError(409, code, t(`bookings.errors.${key}`, vars));

/** BKG-10: this week or next week (Sunday to Saturday, institution time). */
export function inBookingWindow(date, today) {
  const thisWeek = weekStart(today);
  return date >= thisWeek && date <= addDays(thisWeek, 13);
}

/** BKG-08: a teaching day, inside the semester; on an early-closing day the range ends by the cutoff. */
export function teachingDayProblem({ semester, date, end, rules }) {
  if (!semester || date < semester.start_date || date > semester.end_date) return 'NOT_TEACHING';
  for (const rule of rules) {
    if (DAY_RULE_BLOCKS.has(rule.kind)) return 'NOT_TEACHING';
    if (rule.kind === 'cutoff' && end > rule.cutoff_min) return 'PAST_CUTOFF';
  }
  // Friday and Saturday are never teaching days; dayRule covers them, this keeps the check explicit.
  if (weekdayOf(date) === 5 || weekdayOf(date) === 6) return 'NOT_TEACHING';
  return null;
}

/** Two requests or bookings clash for a target when their sections and groups can overlap. */
export const groupsClash = (groupA, groupB) => !groupA || !groupB || groupA === groupB;

/**
 * Runs BKG-04 to BKG-10 and throws the first failure. Every failure has its own code (BKG-04 to
 * BKG-10 list them). Pending requests never block; only published classes and approved bookings do.
 *
 * `target` is `{ section_id, group_id? }`. `requester` is `{ section_id }` or `{ teacher_id }`.
 */
export async function assertRequestAllowed({
  semester,
  room,
  date,
  start,
  end,
  target,
  requester,
  namedTeacherId = null,
  now,
  checkLeadTime = true,
}) {
  // BKG-10: window
  if (!inBookingWindow(date, toInstitutionDate(now))) {
    throw fail('OUTSIDE_WINDOW', 'outsideWindow');
  }

  // BKG-08: teaching day, semester and the early-closing cutoff (owner's rule and the university rule)
  const universityEvents = await getEventsForDepartment(null, date, date);
  const ownerEvents = await getEventsForDepartment(room.owner_department_id, date, date);
  const rules = [
    dayRule(date, null, { events: universityEvents, semester }),
    dayRule(date, room.owner_department_id, { events: ownerEvents, semester }),
  ];
  const dayProblem = teachingDayProblem({ semester, date, end, rules });
  if (dayProblem === 'NOT_TEACHING') throw fail('NOT_TEACHING_DAY', 'notTeachingDay');
  if (dayProblem === 'PAST_CUTOFF') throw fail('NOT_TEACHING_DAY', 'pastCutoff');

  // BKG-09: 12 hours ahead (sending only)
  if (checkLeadTime) {
    const startsAt = instantFrom(date, start);
    if (startsAt.getTime() - now.getTime() < LEAD_MS) {
      throw new AppError(409, 'TOO_LATE', t('bookings.errors.tooLate'));
    }
  }

  // BKG-04, BKG-05: the room. Availability must be known; booked or busy rooms are not free.
  const row = await roomStatusFor({ roomId: room.id, date, from: start, to: end });
  if (!row || row.status === 'unknown') throw fail('AVAILABILITY_UNKNOWN', 'availabilityUnknown');
  if (row.status === 'busy' || row.status === 'booked') {
    throw fail('ROOM_NOT_FREE', 'roomNotFree');
  }

  // BKG-06: the target section or group
  const sectionClasses = await runningClasses({
    semester,
    date,
    from: start,
    to: end,
    sectionIds: [target.section_id],
  });
  // A whole-section target clashes with every group; a group target clashes with the whole section
  // and with its own group only.
  const classClash = sectionClasses.some((c) => groupsClash(c.group_id, target.group_id));
  const bookingGroupFilter = target.group_id
    ? { $or: [{ target_group_id: null }, { target_group_id: target.group_id }] }
    : {};
  const bookingClash = await RoomRequest.exists({
    status: 'approved',
    date,
    target_section_id: target.section_id,
    start_min: { $lt: end },
    end_min: { $gt: start },
    ...bookingGroupFilter,
  });
  if (classClash || bookingClash) throw fail('TARGET_BUSY', 'targetBusy');

  // BKG-07: the requesting teacher, or the teacher named on a CR/DCR request
  const teacherIds = [requester.teacher_id, namedTeacherId].filter(Boolean).map(String);
  if (teacherIds.length) {
    const teacherClasses = await runningClasses({
      semester,
      date,
      from: start,
      to: end,
      teacherIds,
    });
    const teacherBooked = await RoomRequest.exists({
      status: 'approved',
      date,
      start_min: { $lt: end },
      end_min: { $gt: start },
      $or: [
        { requester_teacher_id: { $in: teacherIds } },
        { named_teacher_id: { $in: teacherIds } },
      ],
    });
    if (teacherClasses.length || teacherBooked) throw fail('TEACHER_BUSY', 'teacherBusy');
  }

  return true;
}

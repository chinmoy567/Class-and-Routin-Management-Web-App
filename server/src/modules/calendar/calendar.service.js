import mongoose from 'mongoose';
import { SOCKET_EVENTS } from '@crm/shared/enums';
import { eventProblems, slotRuns } from '@crm/shared';
import { CalendarEvent, ClassCancellation } from './calendar.model.js';
import { assertCan } from '../../policy/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock, toInstitutionDate, instantFrom, weekdayOf } from '../../lib/time.js';
import { emitAfterCommit } from '../../lib/events.js';
import { afterCommit } from '../../lib/db.js';
import { record } from '../audit/index.js';
import { enqueue } from '../notifications/index.js';
import { currentSemester } from '../organisation/index.js';
import { RoutineSlot, RoutineSlotTeacher, Section } from '../routine/index.js';
import { linkedUserIds } from '../teachers/index.js';
import { getAudienceForSections } from './hooks.js';

// CAL-13: spec 19 registers a function that returns affected bookings.
const bookingAffectedProviders = [];
export const registerBookingAffectedProvider = (fn) => bookingAffectedProviders.push(fn);
export const resetBookingAffectedProviders = () => (bookingAffectedProviders.length = 0);

async function affectedBookings(fromDate, toDate, departmentId) {
  const results = [];
  for (const fn of bookingAffectedProviders) {
    for (const b of await fn({ fromDate, toDate, departmentId })) results.push(b);
  }
  return results;
}

function toPlain(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = String(obj._id);
  if (obj.scope_department_id) obj.scope_department_id = String(obj.scope_department_id);
  return obj;
}

/** CAL-05: emit calendar.changed to the right rooms after commit. */
function notifyCalendarChange(scopeDepartmentId) {
  if (scopeDepartmentId) {
    // Only users in that department need to refresh.
    emitAfterCommit(`dept:${scopeDepartmentId}`, SOCKET_EVENTS.CALENDAR_CHANGED, {});
  } else {
    // University-wide: emit to the broadcast room.
    emitAfterCommit('all', SOCKET_EVENTS.CALENDAR_CHANGED, {});
  }
}

// ── Event CRUD ──────────────────────────────────────────────────────────────

/** Build the scope_department_id from the body's `scope` field. */
function scopeDeptId(scope) {
  return scope === 'university' ? null : scope;
}

/** CAL-14: list events visible to the caller, optionally filtered. */
export async function listCalendarEvents(actor, { from, to, department_id } = {}) {
  assertCan(actor, 'calendar.event.read');

  const filter = {};
  if (from) filter.to_date = { $gte: from };
  if (to) filter.from_date = { $lte: to };

  if (!actor.roles?.some((r) => ['super_admin', 'dept_admin'].includes(r.role))) {
    // Regular users see university events + their own department's events.
    const deptId = actor.department_id ? String(actor.department_id) : null;
    filter.$or = [
      { scope_department_id: null },
      ...(deptId ? [{ scope_department_id: deptId }] : []),
    ];
  } else if (department_id) {
    filter.$or = [{ scope_department_id: null }, { scope_department_id: department_id }];
  }

  const events = await CalendarEvent.find(filter).sort({ from_date: 1, created_at: 1 }).lean();
  return events.map(toPlain);
}

/** GET /api/calendar/upcoming — next 14 days for the caller. */
export async function upcomingEvents(actor) {
  assertCan(actor, 'calendar.event.read');

  const now = toInstitutionDate(clock.now());
  const end = addCalendarDays(now, 14);

  const deptId = actor.department_id ? String(actor.department_id) : null;
  const filter = {
    from_date: { $lte: end },
    to_date: { $gte: now },
    $or: [{ scope_department_id: null }, ...(deptId ? [{ scope_department_id: deptId }] : [])],
  };

  const events = await CalendarEvent.find(filter).sort({ from_date: 1 }).lean();
  return events.map(toPlain);
}

function addCalendarDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** POST /api/calendar-events */
export async function createCalendarEvent(actor, body) {
  const deptId = scopeDeptId(body.scope);
  assertCan(actor, 'calendar.event.manage', { scope_department_id: deptId });

  // CAL-13: check affected bookings before saving.
  if (!body.confirm) {
    const affected = await affectedBookings(body.from_date, body.to_date, deptId);
    if (affected.length) {
      return { saved: false, affected_bookings: affected };
    }
  }

  const event = await CalendarEvent.create({
    scope_department_id: deptId ?? undefined,
    from_date: body.from_date,
    to_date: body.to_date,
    kind: body.kind,
    cutoff_min: body.cutoff_min ?? undefined,
    label: body.label,
    created_by: actor._id,
  });

  await record({
    actor,
    action: 'calendar.event.create',
    scope_department_id: deptId,
    target: { type: 'calendar_event', id: event._id },
    new_value: toPlain(event),
  });

  notifyCalendarChange(deptId);
  return { saved: true, event: toPlain(event) };
}

/** PATCH /api/calendar-events/:id */
export async function updateCalendarEvent(actor, id, body) {
  const event = idOk(id) ? await CalendarEvent.findById(id).lean() : null;
  if (!event) throw notFound('Calendar event not found.');
  const deptId = event.scope_department_id ? String(event.scope_department_id) : null;
  assertCan(actor, 'calendar.event.manage', { scope_department_id: deptId });

  // If the dates/scope change, recheck bookings.
  const newFrom = body.from_date ?? event.from_date;
  const newTo = body.to_date ?? event.to_date;
  const newDeptId = body.scope !== undefined ? scopeDeptId(body.scope) : deptId;

  // CAL-02: a scope change must also be allowed for the scope it moves to.
  if (body.scope !== undefined) {
    assertCan(actor, 'calendar.event.manage', { scope_department_id: newDeptId });
  }

  // CAL-01, CAL-03: the merged event must still be valid (a partial body alone can't tell).
  const merged = {
    scope: newDeptId ?? 'university',
    from_date: newFrom,
    to_date: newTo,
    kind: body.kind ?? event.kind,
    cutoff_min: body.cutoff_min !== undefined ? body.cutoff_min : event.cutoff_min,
  };
  const problems = eventProblems(merged);
  if (problems.length) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      Object.fromEntries(problems),
    );
  }

  if (!body.confirm) {
    const affected = await affectedBookings(newFrom, newTo, newDeptId);
    if (affected.length) {
      return { saved: false, affected_bookings: affected };
    }
  }

  const set = {};
  if (body.from_date !== undefined) set.from_date = body.from_date;
  if (body.to_date !== undefined) set.to_date = body.to_date;
  if (body.kind !== undefined) set.kind = body.kind;
  if (body.cutoff_min !== undefined) set.cutoff_min = body.cutoff_min;
  if (body.label !== undefined) set.label = body.label;
  if (body.scope !== undefined) set.scope_department_id = newDeptId ?? null;

  const updated = await CalendarEvent.findByIdAndUpdate(
    id,
    { $set: set },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw notFound('Calendar event not found.');

  await record({
    actor,
    action: 'calendar.event.update',
    scope_department_id: deptId,
    target: { type: 'calendar_event', id: updated._id },
    old_value: toPlain(event),
    new_value: toPlain(updated),
  });

  notifyCalendarChange(newDeptId);
  return { saved: true, event: toPlain(updated) };
}

/** DELETE /api/calendar-events/:id */
export async function deleteCalendarEvent(actor, id) {
  const event = idOk(id) ? await CalendarEvent.findById(id).lean() : null;
  if (!event) throw notFound('Calendar event not found.');
  const deptId = event.scope_department_id ? String(event.scope_department_id) : null;
  assertCan(actor, 'calendar.event.manage', { scope_department_id: deptId });

  await CalendarEvent.deleteOne({ _id: id });

  await record({
    actor,
    action: 'calendar.event.delete',
    scope_department_id: deptId,
    target: { type: 'calendar_event', id: event._id },
    old_value: toPlain(event),
  });

  notifyCalendarChange(deptId);
}

// ── Single-class cancellation ────────────────────────────────────────────────

async function loadPublishedSlot(slotId) {
  const slot = idOk(slotId)
    ? await RoutineSlot.findOne({ _id: slotId, published: true }).lean()
    : null;
  if (!slot) throw notFound('Slot not found.');
  return slot;
}

/** POST /api/slots/:id/cancellations */
export async function cancelClass(actor, slotId, { date, reason }) {
  const slot = await loadPublishedSlot(slotId);
  assertCan(actor, 'calendar.cancellation.manage', {
    owner_department_id: slot.owner_department_id,
  });

  const semester = await currentSemester();
  if (!semester) throw new AppError(409, 'CONFLICT', 'No current semester.');

  // CAL-10: date must match the slot's weekday.
  if (weekdayOf(date) !== slot.day_of_week) {
    throw new AppError(409, 'SLOT_NOT_ON_DATE', 'That date is not a day this slot runs.');
  }

  // CAL-10: date must be within the current semester.
  if (date < semester.start_date || date > semester.end_date) {
    throw new AppError(409, 'SLOT_NOT_ON_DATE', 'That date is outside the current semester.');
  }

  // CAL-10: the date must not already be stopped by a calendar event (holiday, exam, a cutoff the
  // class starts after). The section's department decides, as in CAL-08.
  const section = await Section.findById(slot.section_id).select('department_id').lean();
  const departmentId = section?.department_id ?? slot.owner_department_id;
  const events = await getEventsForDepartment(departmentId, date, date);
  const run = slotRuns(
    {
      slot_id: slot._id,
      start_min: slot.start_min,
      end_min: slot.end_min,
      department_id: departmentId,
    },
    date,
    {
      events,
      cancellations: [],
      semester: { start_date: semester.start_date, end_date: semester.end_date },
    },
  );
  if (run.status !== 'runs') {
    throw new AppError(409, 'SLOT_NOT_ON_DATE', 'A calendar event stops this slot on that date.');
  }

  let cancellation;
  try {
    cancellation = await ClassCancellation.create({
      slot_id: slot._id,
      date,
      reason,
      created_by: actor._id,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError(409, 'CONFLICT', 'This class is already cancelled on that date.');
    }
    throw err;
  }

  await record({
    actor,
    action: 'class.cancel',
    scope_department_id: slot.owner_department_id,
    target: { type: 'routine_slot', id: slot._id },
    new_value: { date, reason },
  });

  await notifyCancellationChange(slot, date, 'cancelled', cancellation._id);
  return cancellation.toObject();
}

/** DELETE /api/slots/:id/cancellations/:date */
export async function undoCancelClass(actor, slotId, date) {
  const slot = await loadPublishedSlot(slotId);
  assertCan(actor, 'calendar.cancellation.manage', {
    owner_department_id: slot.owner_department_id,
  });

  const cancellation = await ClassCancellation.findOne({ slot_id: slot._id, date }).lean();
  if (!cancellation) throw notFound('Cancellation not found.');

  // CAL-12: cannot undo after the class has started.
  const semester = await currentSemester();
  if (semester) {
    const slotStart = instantFrom(date, slot.start_min);
    if (clock.now() >= slotStart) {
      throw new AppError(409, 'TOO_LATE', 'The class has already started; undo is not allowed.');
    }
  }

  await ClassCancellation.deleteOne({ _id: cancellation._id });

  await record({
    actor,
    action: 'class.cancel.undo',
    scope_department_id: slot.owner_department_id,
    target: { type: 'routine_slot', id: slot._id },
    old_value: { date, reason: cancellation.reason },
  });

  await notifyCancellationChange(slot, date, 'restored', cancellation._id);
}

/** CAL-11, CAL-12: emit routine.changed and email affected users. */
async function notifyCancellationChange(slot, date, verb, cancellationId) {
  const sectionId = String(slot.section_id);
  emitAfterCommit(`section:${sectionId}`, SOCKET_EVENTS.ROUTINE_CHANGED, {
    section_id: sectionId,
  });

  // Teachers on the slot
  const links = await RoutineSlotTeacher.find({ slot_id: slot._id }).lean();
  const teacherUserIds = await linkedUserIds(links.map((l) => l.teacher_id));
  for (const uid of teacherUserIds) {
    emitAfterCommit(`user:${uid}`, SOCKET_EVENTS.ROUTINE_CHANGED, { section_id: sectionId });
  }

  await afterCommit(async () => {
    // Students of the section (via registered audience providers)
    const studentUserIds = await getAudienceForSections([sectionId]);

    const allUsers = [...new Set([...teacherUserIds, ...studentUserIds])];
    for (const uid of allUsers) {
      await enqueue({
        to_user_id: uid,
        template: verb === 'cancelled' ? 'class_cancelled' : 'class_restored',
        data: { date, course_code: slot.course_code },
        // EML-04: keyed on this cancellation, so cancelling again after an undo is still emailed.
        dedupe_key: `class_cancel:${cancellationId}:${verb}:${uid}`,
      });
    }
  });
}

// ── Helpers for downstream specs ─────────────────────────────────────────────

/** spec 12/13: query cancellations for a set of slot ids within a date range. */
export async function getCancellationsForSlots(slotIds, { from, to } = {}) {
  const filter = { slot_id: { $in: slotIds.map((id) => new mongoose.Types.ObjectId(id)) } };
  if (from) filter.date = { ...filter.date, $gte: from };
  if (to) filter.date = { ...filter.date, $lte: to };
  return ClassCancellation.find(filter).lean();
}

/** spec 12/13: query events for a department and date range. */
export async function getEventsForDepartment(departmentId, from, to) {
  return CalendarEvent.find({
    from_date: { $lte: to },
    to_date: { $gte: from },
    $or: [{ scope_department_id: null }, { scope_department_id: departmentId }],
  })
    .sort({ from_date: 1, created_at: 1 })
    .lean();
}

function idOk(id) {
  return Boolean(id) && mongoose.Types.ObjectId.isValid(id);
}

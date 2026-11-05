// Spec 19 hooks into the other modules. Each one is registered once, at import time, through the
// module's exported registration function. Bookings never reads another module's collections.
import { SOCKET_EVENTS, dayRule } from '@crm/shared';
import { RoomRequest, RoomSlotLock } from './bookings.model.js';
import { teachingDayProblem } from './checks.js';
import { requesterLabels } from './queries.service.js';
import { emailBookingAudience, pushBookingAudience } from './audience.js';
import { enqueue, registerDigestProvider } from '../notifications/index.js';
import { record } from '../audit/index.js';
import { currentSemester } from '../organisation/index.js';
import { roomCodes, roomForBooking, roomIdsForDepartments } from '../rooms/index.js';
import {
  registerBookingActionHandler,
  registerBookingClashProvider,
  registerBookingsForRoutineProvider,
} from '../routine/index.js';
import { recordsOf } from '../teachers/index.js';
import {
  getEventsForDepartment,
  registerBookingAffectedProvider,
  registerBookingEffectHandler,
} from '../calendar/index.js';
import { withTransaction, afterCommit } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { clock, toInstitutionDate, weekdayOf } from '../../lib/time.js';

const roomScope = async (departmentId) =>
  departmentId ? { room_id: { $in: await roomIdsForDepartments([departmentId]) } } : {};

/**
 * Cancels approved bookings: removes their locks, marks them cancelled, and emails the requesters
 * once the transaction commits. Runs inside `session` when given (routine edit already has one
 * open); otherwise it opens its own transaction.
 */
export async function cancelApprovedBookings(bookings, { reason, actor, session }) {
  const ids = bookings.map((b) => b._id ?? b.id);
  if (!ids.length) return [];
  const run = async (s) => {
    const docs = await RoomRequest.find({ _id: { $in: ids }, status: 'approved' })
      .session(s)
      .lean();
    if (!docs.length) return [];
    const keep = docs.map((d) => d._id);
    await RoomSlotLock.deleteMany({ room_request_id: { $in: keep } }, { session: s });
    await RoomRequest.updateMany(
      { _id: { $in: keep }, status: 'approved' },
      { $set: { status: 'cancelled', reason, cancelled_at: clock.now() } },
      { session: s },
    );
    for (const d of docs) {
      await record({
        actor: { _id: actor?._id ?? null, roles: actor?.roles ?? [] },
        action: 'room_request.auto_cancel',
        scope_department_id: null,
        target: { type: 'room_request', id: d._id },
        old_value: { status: 'approved' },
        new_value: { status: 'cancelled', reason },
        session: s,
      });
    }
    return docs;
  };
  const cancelled = session ? await run(session) : await withTransaction(run);
  afterCommit(async () => {
    for (const d of cancelled) {
      await enqueue({
        to_user_id: d.sent_by_user_id,
        template: 'booking_cancelled',
        data: { room: '', date: d.date },
      });
      await emailBookingAudience(d, {
        template: 'booking_cancelled',
        data: { room: '', date: d.date },
        kind: 'cancelled',
      });
      await pushBookingAudience(d);
    }
    emitAfterCommit('everyone', SOCKET_EVENTS.BOOKING_CHANGED, {});
  });
  return cancelled;
}

// ── EDT-05, IMP-19: a routine change that clashes with an approved booking ─────

registerBookingClashProvider(async ({ semester_id, room_id, day_of_week, start_min, end_min }) => {
  const today = toInstitutionDate(clock.now());
  const rows = await RoomRequest.find({
    status: 'approved',
    semester_id,
    room_id,
    date: { $gte: today },
    start_min: { $lt: end_min },
    end_min: { $gt: start_min },
  }).lean();
  // A booking is dated, so it clashes only on its own weekday (the weekly routine never changes).
  const sameDay = rows.filter((r) => weekdayOf(r.date) === day_of_week);
  const labelOf = await requesterLabels(sameDay);
  return sameDay.map((r) => ({
    id: String(r._id),
    date: r.date,
    start_min: r.start_min,
    end_min: r.end_min,
    requester_name: labelOf(r),
  }));
});

registerBookingActionHandler(async ({ action, bookings, actor, session }) => {
  if (action !== 'cancel_booking') return; // keep_booking: the admin keeps both
  await cancelApprovedBookings(bookings, { reason: 'routine_changed', actor, session });
});

// ── BKG-18: approved bookings in the routine, My routine and live status ──────

registerBookingsForRoutineProvider(
  async ({ semesterId, fromDate, toDate, sectionId, groupId, userId, isTeacher }) => {
    const or = [];
    if (sectionId) {
      // The target section's routine: a whole-section booking, or the viewer's own group's.
      or.push({
        target_section_id: sectionId,
        $or: [{ target_group_id: null }, ...(groupId ? [{ target_group_id: groupId }] : [])],
      });
    }
    if (isTeacher && userId) {
      // The routine of the teacher who booked it, or the teacher a CR/DCR named.
      const ids = (await recordsOf(userId)).map((t) => t._id);
      if (ids.length)
        or.push({ requester_teacher_id: { $in: ids } }, { named_teacher_id: { $in: ids } });
    }
    if (!or.length) return [];
    const rows = await RoomRequest.find({
      status: 'approved',
      semester_id: semesterId,
      date: { $gte: fromDate, $lte: toDate },
      $or: or,
    })
      .sort({ date: 1, start_min: 1 })
      .lean();
    const codes = await roomCodes([...new Set(rows.map((r) => String(r.room_id)))]);
    return rows.map((r) => ({
      id: String(r._id),
      date: r.date,
      start_min: r.start_min,
      end_min: r.end_min,
      room_code: codes.get(String(r.room_id)) ?? '',
      course_name: 'Room booking',
    }));
  },
);

// ── CAL-13: a calendar event that closes a day or cuts it short ──────────────

registerBookingAffectedProvider(async ({ fromDate, toDate, departmentId }) => {
  const rows = await RoomRequest.find({
    status: 'approved',
    date: { $gte: fromDate, $lte: toDate },
    ...(await roomScope(departmentId)),
  }).lean();
  const labelOf = await requesterLabels(rows);
  const codes = await roomCodes([...new Set(rows.map((r) => String(r.room_id)))]);
  return rows.map((r) => ({
    id: String(r._id),
    date: r.date,
    room_code: codes.get(String(r.room_id)) ?? '',
    requester_name: labelOf(r),
  }));
});

/** Does the calendar, as it now stands, stop this request's range on its day? (BKG-08) */
async function stoppedByCalendar(req, semester, universityEvents) {
  const room = await roomForBooking(req.room_id);
  if (!room) return false;
  const ownerEvents = await getEventsForDepartment(room.owner_department_id, req.date, req.date);
  const rules = [
    dayRule(req.date, null, { events: universityEvents, semester }),
    dayRule(req.date, room.owner_department_id, { events: ownerEvents, semester }),
  ];
  return Boolean(teachingDayProblem({ semester, date: req.date, end: req.end_min, rules }));
}

registerBookingEffectHandler(async ({ fromDate, toDate, departmentId, actor }) => {
  const semester = await currentSemester();
  if (!semester) return;
  const window = { date: { $gte: fromDate, $lte: toDate }, ...(await roomScope(departmentId)) };
  const universityEvents = await getEventsForDepartment(null, fromDate, toDate);

  const approved = await RoomRequest.find({ status: 'approved', ...window }).lean();
  const toCancel = [];
  for (const r of approved) {
    if (await stoppedByCalendar(r, semester, universityEvents)) toCancel.push(r);
  }
  if (toCancel.length) {
    await cancelApprovedBookings(toCancel, { reason: 'calendar_event', actor });
  }

  // CAL-13: pending requests on the affected days expire
  const pending = await RoomRequest.find({ status: 'pending', ...window }).lean();
  const toExpire = [];
  for (const r of pending) {
    if (await stoppedByCalendar(r, semester, universityEvents)) toExpire.push(r);
  }
  if (toExpire.length) {
    await RoomRequest.updateMany(
      { _id: { $in: toExpire.map((r) => r._id) }, status: 'pending' },
      { $set: { status: 'expired', reason: 'calendar_event' } },
    );
    for (const r of toExpire) {
      await enqueue({
        to_user_id: r.sent_by_user_id,
        template: 'request_expired',
        data: { room: '', date: r.date },
        dedupe_key: `booking.expired:${r._id}`,
      });
    }
  }
  if (toCancel.length || toExpire.length) {
    emitAfterCommit('everyone', SOCKET_EVENTS.BOOKING_CHANGED, {});
  }
});

// EML-08: the admin digest counts the requests waiting for a decision (spec 15).
registerDigestProvider({
  key: 'room_requests',
  labelKey: 'digest.room_requests',
  count: async ({ departmentIds }) => {
    const filter = { status: 'pending' };
    if (departmentIds) filter.room_id = { $in: await roomIdsForDepartments(departmentIds) };
    return RoomRequest.countDocuments(filter);
  },
});

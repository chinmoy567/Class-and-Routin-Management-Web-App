import { SOCKET_EVENTS } from '@crm/shared';
import { RoomRequest, RoomSlotLock } from './bookings.model.js';
import { assertRequestAllowed } from './checks.js';
import { assertCan } from '../../policy/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock, instantFrom } from '../../lib/time.js';
import { withTransaction } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { t } from '../../i18n/index.js';
import { record } from '../audit/index.js';
import { enqueue } from '../notifications/index.js';
import { currentSemester } from '../organisation/index.js';
import { roomForBooking } from '../rooms/index.js';
import { serialise } from './send.service.js';
import { emailBookingAudience, pushBookingAudience } from './audience.js';

const CUTOFF_MS = 2 * 60 * 60 * 1000; // BKG-15
const alreadyDecided = () =>
  new AppError(409, 'ALREADY_DECIDED', t('bookings.errors.alreadyDecided'));

/** BKG-13: one lock per 5-minute block, so touching ranges do not clash and overlapping ones do. */
export function lockBlocks(roomId, date, requestId, start, end) {
  const locks = [];
  for (let b = start; b < end; b += 5) {
    locks.push({ room_id: roomId, date, block_start: b, room_request_id: requestId });
  }
  return locks;
}

/** The people who hear about a request: the one who sent it (BKG-16). */
const mailTo = (req) => req.sent_by_user_id;

async function loadRequestOr404(id) {
  const req = await RoomRequest.findById(id).lean();
  if (!req) throw notFound('Room request not found.');
  return req;
}

/** Re-runs the checks for approval (BKG-13): every rule except the 12-hour rule (decision). */
async function recheckForApproval(req, room) {
  const semester = await currentSemester();
  const target = { section_id: req.target_section_id, group_id: req.target_group_id ?? null };
  const requester = req.requester_teacher_id
    ? { teacher_id: String(req.requester_teacher_id) }
    : {};
  await assertRequestAllowed({
    semester,
    room,
    date: req.date,
    start: req.start_min,
    end: req.end_min,
    target,
    requester,
    namedTeacherId: req.named_teacher_id ? String(req.named_teacher_id) : null,
    now: clock.now(),
    checkLeadTime: false,
  });
}

/**
 * BKG-12 to BKG-16: an admin of a department that owns or shares the room approves or rejects a
 * request. The first decision is final. Approval runs as one transaction: the conditional update
 * (first action wins), the checks again, the lock inserts (the database refuses a double-booking),
 * and the cancellations and rejections of overlapping requests.
 */
export async function decideRequest(actor, id, body) {
  const req = await loadRequestOr404(id);
  const room = await roomForBooking(req.room_id);
  if (!room) throw notFound('Room not found.');
  assertCan(actor, 'room_request.decide', { department_ids: room.department_ids });

  if (req.status !== 'pending') throw alreadyDecided();
  const startsAt = instantFrom(req.date, req.start_min);
  if (clock.now().getTime() >= startsAt.getTime() - CUTOFF_MS) {
    throw new AppError(409, 'DECISION_CUTOFF_PASSED', t('bookings.errors.cutoffPassed'));
  }

  if (body.decision === 'reject') {
    const updated = await RoomRequest.findOneAndUpdate(
      { _id: id, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          reason: body.note ?? null,
          decided_by: actor._id,
          decided_at: clock.now(),
        },
      },
      { new: true },
    ).lean();
    if (!updated) throw alreadyDecided();
    await record({
      actor,
      action: 'room_request.reject',
      scope_department_id: room.owner_department_id,
      target: { type: 'room_request', id },
      new_value: { status: 'rejected' },
    });
    await notifyResult(req, room, 'rejected', body.note ?? '');
    emitAfterCommit('everyone', SOCKET_EVENTS.BOOKING_CHANGED, {});
    return serialise(updated);
  }

  const result = await withTransaction(async (session) => {
    // First action wins: only a pending request can become approved.
    const approved = await RoomRequest.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: { status: 'approved', decided_by: actor._id, decided_at: clock.now() } },
      { new: true, session },
    );
    if (!approved) throw alreadyDecided();

    await recheckForApproval(req, room);

    try {
      await RoomSlotLock.insertMany(
        lockBlocks(req.room_id, req.date, id, req.start_min, req.end_min),
        { session, ordered: true },
      );
    } catch (err) {
      // BKG-13: a lock already held for this room and block means another booking won the room
      if (err?.code === 11000 || err?.writeErrors?.some((e) => e.code === 11000)) {
        throw alreadyDecided();
      }
      throw err;
    }

    // BKG-13: the same requester's other pending requests that overlap this time are cancelled
    const requesterFilter = req.requester_section_id
      ? { requester_section_id: req.requester_section_id }
      : { requester_teacher_id: req.requester_teacher_id };
    const sameRequester = {
      ...requesterFilter,
      _id: { $ne: req._id },
      status: 'pending',
      date: req.date,
      start_min: { $lt: req.end_min },
      end_min: { $gt: req.start_min },
    };
    const cancelledOwn = await RoomRequest.find(sameRequester).session(session).lean();
    await RoomRequest.updateMany(
      { _id: { $in: cancelledOwn.map((r) => r._id) }, status: 'pending' },
      { $set: { status: 'cancelled', reason: 'another_request_approved' } },
      { session },
    );

    // BKG-13: other requesters' pending requests for the same room that overlap are rejected
    const others = {
      room_id: req.room_id,
      _id: { $ne: req._id },
      status: 'pending',
      date: req.date,
      start_min: { $lt: req.end_min },
      end_min: { $gt: req.start_min },
    };
    const rejected = await RoomRequest.find(others).session(session).lean();
    await RoomRequest.updateMany(
      { _id: { $in: rejected.map((r) => r._id) }, status: 'pending' },
      { $set: { status: 'rejected', reason: 'room_given_to_another' } },
      { session },
    );

    await record({
      actor,
      action: 'room_request.approve',
      scope_department_id: room.owner_department_id,
      target: { type: 'room_request', id },
      new_value: { status: 'approved', room_id: req.room_id, date: req.date },
      session,
    });

    return { approved, cancelledOwn, rejected };
  });

  // Emails go out only after commit (BKG-16)
  await notifyResult(req, room, 'approved', '');
  await emailBookingAudience(req, {
    template: 'booking_approved',
    data: { room: room.code, date: req.date },
    kind: 'approved',
  });
  await pushBookingAudience(req);
  for (const r of result.cancelledOwn)
    await notifyResult(r, room, 'cancelled', 'another_request_approved');
  for (const r of result.rejected) await notifyResult(r, room, 'rejected', 'room_given_to_another');
  emitAfterCommit('everyone', SOCKET_EVENTS.BOOKING_CHANGED, {});
  return serialise(result.approved);
}

/** Emails the requester the result of a request (BKG-16). `outcome` and `reason` fill the template. */
async function notifyResult(req, room, outcome, reason) {
  await enqueue({
    to_user_id: mailTo(req),
    template: 'room_request_result',
    data: {
      room: room.code,
      date: req.date,
      outcome: outcomeText(outcome),
      reason: reasonText(reason),
    },
  });
}

const OUTCOME = {
  approved: 'approved',
  rejected: 'not approved',
  cancelled: 'cancelled',
  expired: 'expired',
};
const outcomeText = (o) => OUTCOME[o] ?? o;
const REASON = {
  room_given_to_another: ' The room went to another section.',
  another_request_approved: ' You were given another room at that time.',
};
const reasonText = (r) => REASON[r] ?? '';

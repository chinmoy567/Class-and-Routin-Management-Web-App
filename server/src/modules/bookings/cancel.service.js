import { SOCKET_EVENTS } from '@crm/shared';
import { RoomRequest, RoomSlotLock } from './bookings.model.js';
import { assertCan, can } from '../../policy/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock, instantFrom } from '../../lib/time.js';
import { withTransaction } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { t } from '../../i18n/index.js';
import { record } from '../audit/index.js';
import { enqueue } from '../notifications/index.js';
import { roomForBooking } from '../rooms/index.js';
import { serialise } from './send.service.js';
import { emailBookingAudience } from './audience.js';

const HOUR = 60 * 60 * 1000;
const LATE_CANCEL_MS = 6 * HOUR; // BKG-21
const endsAt = (req) => instantFrom(req.date, req.end_min);

async function loadRequestOr404(id) {
  const req = await RoomRequest.findById(id).lean();
  if (!req) throw notFound('Room request not found.');
  return req;
}

/**
 * BKG-21, BKG-22: cancel a pending or approved request. The requester (or a CR/DCR of the section)
 * cancels on their own; a decider cancels an approved booking and must give a reason. An approved
 * cancellation removes its locks in the same transaction, so the room is free at once.
 */
export async function cancelRequest(actor, id, body) {
  const req = await loadRequestOr404(id);
  const room = await roomForBooking(req.room_id);
  if (!room) throw notFound('Room not found.');
  const resource = {
    section_id: req.requester_section_id ? String(req.requester_section_id) : null,
    sent_by_user_id: req.sent_by_user_id,
    requester_teacher_user_id: req.requester_teacher_id ? req.sent_by_user_id : null,
    department_ids: room.department_ids,
  };
  const decider = can(actor, 'room_request.admin_cancel', resource);
  if (decider) {
    if (!body.reason) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Give a reason for cancelling this booking.', {
        reason: 'is required',
      });
    }
  } else {
    assertCan(actor, 'room_request.cancel', resource);
  }

  if (req.status !== 'pending' && req.status !== 'approved') {
    throw new AppError(409, 'ALREADY_DECIDED', t('bookings.errors.alreadyDecided'));
  }
  if (clock.now().getTime() >= endsAt(req).getTime()) {
    throw new AppError(409, 'TOO_LATE', t('bookings.errors.tooLate'));
  }

  const wasApproved = req.status === 'approved';
  const now = clock.now();
  const lateCancel =
    wasApproved && instantFrom(req.date, req.start_min).getTime() - now.getTime() < LATE_CANCEL_MS;

  const updated = await withTransaction(async (session) => {
    const doc = await RoomRequest.findOneAndUpdate(
      { _id: id, status: req.status },
      {
        $set: {
          status: 'cancelled',
          cancelled_by: actor._id,
          cancelled_at: now,
          late_cancel: lateCancel,
          reason: body.reason ?? null,
        },
      },
      { new: true, session },
    );
    if (!doc) throw new AppError(409, 'ALREADY_DECIDED', t('bookings.errors.alreadyDecided'));
    if (wasApproved) await RoomSlotLock.deleteMany({ room_request_id: id }, { session });
    await record({
      actor,
      action: decider ? 'room_request.admin_cancel' : 'room_request.cancel',
      scope_department_id: room.owner_department_id,
      target: { type: 'room_request', id },
      old_value: { status: req.status },
      new_value: { status: 'cancelled', late_cancel: lateCancel },
      session,
    });
    return doc;
  });

  if (wasApproved) {
    await enqueue({
      to_user_id: req.sent_by_user_id,
      template: 'booking_cancelled',
      data: { room: room.code, date: req.date },
    });
    await emailBookingAudience(req, {
      template: 'booking_cancelled',
      data: { room: room.code, date: req.date },
      kind: 'cancelled',
    });
  }
  emitAfterCommit('everyone', SOCKET_EVENTS.BOOKING_CHANGED, {});
  return serialise(updated);
}

/** BKG-23: after the slot, a decider adds a no-show note to an approved request. */
export async function addNoShowNote(actor, id, body) {
  const req = await loadRequestOr404(id);
  const room = await roomForBooking(req.room_id);
  if (!room) throw notFound('Room not found.');
  assertCan(actor, 'room_request.no_show', { department_ids: room.department_ids });
  if (req.status !== 'approved') {
    throw new AppError(409, 'ALREADY_DECIDED', t('bookings.errors.alreadyDecided'));
  }
  if (clock.now().getTime() < endsAt(req).getTime()) {
    throw new AppError(409, 'TOO_EARLY', t('bookings.errors.tooEarly'));
  }
  const updated = await RoomRequest.findOneAndUpdate(
    { _id: id, status: 'approved' },
    { $set: { no_show_note: body.note } },
    { new: true },
  ).lean();
  if (!updated) throw new AppError(409, 'ALREADY_DECIDED', t('bookings.errors.alreadyDecided'));
  await record({
    actor,
    action: 'room_request.no_show_note',
    scope_department_id: room.owner_department_id,
    target: { type: 'room_request', id },
    new_value: { no_show_note: body.note },
  });
  return serialise(updated);
}

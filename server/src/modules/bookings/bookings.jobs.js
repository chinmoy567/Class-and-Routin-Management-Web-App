// BKG-17: a pending request with no decision by 2 hours before its start expires, and the
// requester is emailed. Idempotent: a conditional update moves each request once.
import { RoomRequest } from './bookings.model.js';
import { enqueue } from '../notifications/index.js';
import { roomForBooking } from '../rooms/index.js';
import { logger } from '../../lib/logger.js';
import { clock } from '../../lib/time.js';

export const EXPIRE_JOB = 'booking.expire';
const CUTOFF_MS = 2 * 60 * 60 * 1000;

export async function expireDueRequests() {
  const cutoff = new Date(clock.now().getTime() + CUTOFF_MS);
  const due = await RoomRequest.find({ status: 'pending', starts_at: { $lte: cutoff } })
    .select('_id sent_by_user_id room_id date')
    .lean();
  let moved = 0;
  for (const req of due) {
    const res = await RoomRequest.updateOne(
      { _id: req._id, status: 'pending' },
      { $set: { status: 'expired', reason: 'expired' } },
    );
    if (!res.modifiedCount) continue;
    moved += 1;
    const room = await roomForBooking(req.room_id);
    await enqueue({
      to_user_id: req.sent_by_user_id,
      template: 'request_expired',
      data: { room: room?.code ?? '', date: req.date },
      dedupe_key: `booking.expired:${req._id}`,
    });
  }
  if (moved) logger.info({ count: moved }, 'room requests expired');
  return moved;
}

export function defineJobs(define) {
  define(EXPIRE_JOB, () => expireDueRequests());
}

import { registerPolicies } from '../../policy/index.js';
import { registerAvailabilityProvider } from '../rooms/index.js';
import { bookingsPolicy } from './bookings.policy.js';
import { RoomRequest } from './bookings.model.js';
import './hooks.js'; // EDT-05, IMP-19, CAL-13 registrations

registerPolicies(bookingsPolicy);

// FRV-09 / BKG-19: approved bookings make a room `booked` in the free-room view. Approved only.
registerAvailabilityProvider({
  bookedRoomIds: async ({ date, from, to }) =>
    RoomRequest.distinct('room_id', {
      status: 'approved',
      date,
      start_min: { $lt: to },
      end_min: { $gt: from },
    }),
});

export { roomRequestRouter } from './bookings.routes.js';
export { defineJobs as defineBookingJobs, EXPIRE_JOB, expireDueRequests } from './bookings.jobs.js';
export { RoomRequest, RoomSlotLock } from './bookings.model.js';
export { sendRequest } from './send.service.js';
export { pendingRequestsSummary, adminQueue, myRequests } from './queries.service.js';
export { decideRequest } from './decision.service.js';
export { cancelRequest, addNoShowNote } from './cancel.service.js';

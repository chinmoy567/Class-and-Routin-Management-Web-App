import { api } from '@/lib/api';

// Spec 19. The server checks every rule again on each call; these are thin wrappers.

/** BKG-01 to BKG-11: send a request for one room, one date and one time range. */
export const sendRoomRequest = (body) => api('/room-requests', { method: 'POST', body });

/** BKG-02: the groups and teachers a requester may pick for one section. */
export const fetchRoomRequestOptions = (sectionId) =>
  api(`/room-requests/options?section_id=${encodeURIComponent(sectionId)}`);

/** BKG-26: the requester's own requests (and the section's, for a CR or DCR). */
export const fetchMyRoomRequests = () => api('/me/room-requests');

/** BKG-12: the decision queue for the admin's departments, grouped by room and slot. */
export const fetchAdminRoomRequests = (status = 'pending') =>
  api(`/admin/room-requests?status=${encodeURIComponent(status)}`);

/** BKG-13, BKG-14: approve or reject. */
export const decideRoomRequest = ({ id, ...body }) =>
  api(`/room-requests/${id}/decision`, { method: 'POST', body });

/** BKG-21, BKG-22: cancel. A decider must give a reason. */
export const cancelRoomRequest = ({ id, ...body }) =>
  api(`/room-requests/${id}/cancel`, { method: 'POST', body });

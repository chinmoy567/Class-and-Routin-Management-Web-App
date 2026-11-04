import { api, apiBody } from '@/lib/api';

// Query strings drop empty values, so an unset filter is simply not sent.
const qs = (params) => {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return q ? `?${q}` : '';
};

/**
 * A create or update answers `{ data: event }`, or, when the change affects approved bookings
 * (CAL-13), `{ saved: false, affected_bookings }` at the top level. Both come back as
 * `{ saved: true, event }` or `{ saved: false, affected_bookings }`.
 */
async function saveEvent(path, opts) {
  const res = await apiBody(path, opts);
  if (res?.saved === false) return { saved: false, affected_bookings: res.affected_bookings ?? [] };
  return { saved: true, event: res?.data };
}

export const fetchCalendarEvents = (params = {}) => api(`/calendar-events${qs(params)}`);
export const createCalendarEvent = (body) =>
  saveEvent('/calendar-events', { method: 'POST', body });
export const updateCalendarEvent = ({ id, ...body }) =>
  saveEvent(`/calendar-events/${id}`, { method: 'PATCH', body });
export const deleteCalendarEvent = (id) => api(`/calendar-events/${id}`, { method: 'DELETE' });

/** CAL-10: cancel one class on one date. `id` is the slot. */
export const cancelClass = ({ id, date, reason }) =>
  api(`/slots/${id}/cancellations`, { method: 'POST', body: { date, reason } });
/** CAL-12: undo a cancellation before the class starts. */
export const undoCancelClass = ({ id, date }) =>
  api(`/slots/${id}/cancellations/${date}`, { method: 'DELETE' });

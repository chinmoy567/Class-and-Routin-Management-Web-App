import { api } from '@/lib/api';

export const fetchAdminRooms = (departmentId) =>
  api(`/admin/rooms${departmentId ? `?department_id=${departmentId}` : ''}`);
export const createRoom = (body) => api('/admin/rooms', { method: 'POST', body });
export const updateRoom = ({ id, ...body }) => api(`/admin/rooms/${id}`, { method: 'PATCH', body });
export const addRoomAlias = ({ id, alias }) =>
  api(`/admin/rooms/${id}/aliases`, { method: 'POST', body: { alias } });
export const removeRoomAlias = ({ id, aliasId }) =>
  api(`/admin/rooms/${id}/aliases/${aliasId}`, { method: 'DELETE' });
export const setRoomShares = ({ id, department_ids }) =>
  api(`/admin/rooms/${id}/shares`, { method: 'PUT', body: { department_ids } });
export const retireRoom = (id) => api(`/admin/rooms/${id}/retire`, { method: 'POST' });

/** FRV-01: the free-room view. `from` and `to` are minutes since midnight. */
export const fetchAvailability = ({ date, from, to, type, departmentId }) => {
  const params = new URLSearchParams({ date, from: String(from), to: String(to) });
  if (type) params.set('type', type);
  if (departmentId) params.set('department_id', departmentId);
  return api(`/rooms/availability?${params}`);
};
/** FRV-07: the rooms free in the next 55 minutes, for the dashboard card. */
export const fetchFreeNow = () => api('/rooms/free-now');

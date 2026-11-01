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

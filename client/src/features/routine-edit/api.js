import { api } from '@/lib/api';

export const fetchSections = (semesterId) => api(`/admin/semesters/${semesterId}/sections`);
export const fetchGrid = (sectionId) => api(`/admin/sections/${sectionId}/routine`);
export const createSlot = (body) => api('/slots', { method: 'POST', body });
export const updateSlot = ({ id, ...body }) => api(`/slots/${id}`, { method: 'PUT', body });
export const deleteSlot = ({ id, ...body }) => api(`/slots/${id}`, { method: 'DELETE', body });
export const createSection = (body) => api('/admin/sections', { method: 'POST', body });
export const addGroup = ({ sectionId, label }) =>
  api(`/admin/sections/${sectionId}/groups`, { method: 'POST', body: { label } });
export const renameGroup = ({ id, label }) =>
  api(`/admin/groups/${id}`, { method: 'PATCH', body: { label } });
export const removeGroup = (id) => api(`/admin/groups/${id}`, { method: 'DELETE' });

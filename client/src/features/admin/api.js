import { api } from '@/lib/api';

export const fetchAdminDepartments = () => api('/admin/departments');
export const createDepartment = (body) => api('/admin/departments', { method: 'POST', body });
export const updateDepartment = ({ id, ...body }) =>
  api(`/admin/departments/${id}`, { method: 'PATCH', body });
export const retireDepartment = (id) => api(`/admin/departments/${id}/retire`, { method: 'POST' });

export const fetchAdmins = () => api('/admin/admins');
export const searchUsers = (q) => api(`/admin/users/search?q=${encodeURIComponent(q)}`);
export const grantAdminRole = (body) => api('/admin/admins', { method: 'POST', body });
export const removeAdminRole = (roleId) => api(`/admin/admins/${roleId}`, { method: 'DELETE' });
export const resetAdminPassword = (userId) =>
  api(`/admin/admins/${userId}/reset-password`, { method: 'POST' });
export const resetAdminSecondStep = (userId) =>
  api(`/admin/admins/${userId}/reset-second-step`, { method: 'POST' });

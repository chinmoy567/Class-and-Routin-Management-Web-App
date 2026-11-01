import { api } from '@/lib/api';

export const fetchRegistrations = () => api('/admin/teacher-registrations?status=pending');
export const decideRegistration = ({ id, ...body }) =>
  api(`/admin/teacher-registrations/${id}/decision`, { method: 'POST', body });
export const fetchMyRegistration = () => api('/me/teacher-registration');
export const applyAgain = (body) => api('/me/teacher-registration', { method: 'POST', body });

export const fetchTeachers = (departmentId) => api(`/admin/teachers?department_id=${departmentId}`);
export const fetchTeacherAccounts = (departmentId) =>
  api(`/admin/teacher-accounts?department_id=${departmentId}`);
export const createTeacher = (body) => api('/admin/teachers', { method: 'POST', body });
export const linkTeacher = ({ id, user_id }) =>
  api(`/admin/teachers/${id}/link`, { method: 'POST', body: { user_id } });
export const unlinkTeacher = (id) => api(`/admin/teachers/${id}/unlink`, { method: 'POST' });
export const changeAccount = ({ userId, action, reason }) =>
  api(`/admin/teacher-accounts/${userId}/${action}`, {
    method: 'POST',
    ...(reason && { body: { reason } }),
  });

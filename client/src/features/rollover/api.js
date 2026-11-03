import { api } from '@/lib/api';

export const fetchReadiness = (semesterId) => api(`/admin/semesters/${semesterId}/readiness`);
export const makeCurrent = ({ id, confirm_not_ready = [] }) =>
  api(`/admin/semesters/${id}/make-current`, {
    method: 'POST',
    body: { confirm_not_ready },
  });

export const fetchSemesterUpdate = () => api('/me/semester-update');
export const graduate = () => api('/me/graduate', { method: 'POST' });
export const notEnrolled = () => api('/me/not-enrolled', { method: 'POST' });

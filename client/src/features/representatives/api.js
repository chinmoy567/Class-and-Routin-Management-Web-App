import { api } from '@/lib/api';

export const fetchSectionReps = (sectionId) => api(`/admin/sections/${sectionId}/representatives`);
export const fetchSummary = ({ semesterId, departmentId }) =>
  api(`/admin/semesters/${semesterId}/representatives/summary?department_id=${departmentId}`);
export const searchStudents = ({ q, departmentId }) =>
  api(
    `/admin/students/search?q=${encodeURIComponent(q)}${
      departmentId ? `&department_id=${departmentId}` : ''
    }`,
  );
export const assignRep = ({ sectionId, user_id, role }) =>
  api(`/admin/sections/${sectionId}/representatives`, { method: 'POST', body: { user_id, role } });
export const reappointReps = (sectionId) =>
  api(`/admin/sections/${sectionId}/representatives/reappoint`, { method: 'POST' });
export const removeRep = (roleId) => api(`/admin/representatives/${roleId}`, { method: 'DELETE' });

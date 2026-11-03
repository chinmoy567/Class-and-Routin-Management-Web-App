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

export const fetchCurrentSemester = () => api('/semesters/current');
export const fetchAdminSemesters = () => api('/admin/semesters');
export const createSemester = (body) => api('/admin/semesters', { method: 'POST', body });
export const updateSemester = ({ id, ...body }) =>
  api(`/admin/semesters/${id}`, { method: 'PATCH', body });
export const deleteSemester = (id) => api(`/admin/semesters/${id}`, { method: 'DELETE' });
export const bootstrapSemester = (id) =>
  api(`/admin/semesters/${id}/bootstrap-current`, { method: 'POST' });

// Spec 18. Query strings drop empty values, so an unset filter is simply not sent.
const qs = (params) => {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return q ? `?${q}` : '';
};

export const fetchAdminDashboard = (departmentId) =>
  api(`/admin/dashboard${qs({ department_id: departmentId })}`);

export const searchStudents = ({ q, department_id }) =>
  api(`/admin/students${qs({ q, department_id })}`);
export const deactivateStudent = ({ id, reason }) =>
  api(`/admin/students/${id}/deactivate`, { method: 'POST', body: { reason } });
export const reactivateStudent = (id) =>
  api(`/admin/students/${id}/reactivate`, { method: 'POST' });
export const graduateStudent = (id) => api(`/admin/students/${id}/graduate`, { method: 'POST' });
export const ungraduateStudent = (id) =>
  api(`/admin/students/${id}/ungraduate`, { method: 'POST' });
export const issueTempPassword = (id) =>
  api(`/admin/students/${id}/temp-password`, { method: 'POST' });

/** The groups of a section, from the CR/DCR overview (an admin may read it). */
export const fetchSectionGroups = (sectionId) => api(`/cr/sections/${sectionId}/overview`);
export const setStudentGroup = ({ enrolmentId, group_id }) =>
  api(`/enrolments/${enrolmentId}/group`, { method: 'PATCH', body: { group_id } });
export const revokeUvClaim = ({ claimId, reason }) =>
  api(`/admin/uv-claims/${claimId}/revoke`, { method: 'POST', body: { reason } });

export const fetchAdminFlags = ({ status, department_id }) =>
  api(`/admin/flags${qs({ status, department_id })}`);
export const resolveFlag = ({ id, status, reply }) =>
  api(`/admin/flags/${id}/resolve`, { method: 'POST', body: { status, reply } });

export const fetchJoinList = ({ view, department_id }) =>
  api(`/admin/join-requests${qs({ view, department_id })}`);
export const decideAppeal = ({ enrolmentId, decision, group_id }) =>
  api(`/admin/enrolments/${enrolmentId}/appeal-decision`, {
    method: 'POST',
    body: decision === 'reverse' && group_id ? { decision, group_id } : { decision },
  });

export const fetchAuditLog = (params) => api(`/admin/audit${qs(params)}`);

/** JR-14: an admin decides an escalated request. Accepting takes an optional group. */
export const decideEscalatedJoin = ({ enrolmentId, ...body }) =>
  api(`/enrolments/${enrolmentId}/decision`, { method: 'POST', body });
/** JR-18: an admin decides a CR or DCR's own UV ID claim. */
export const decideOwnClaim = ({ claimId, ...body }) =>
  api(`/admin/uv-claims/${claimId}/decision`, { method: 'POST', body });

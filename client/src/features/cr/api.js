import { api } from '@/lib/api';

// Spec 17: the CR/DCR dashboard. Join decisions and group changes reuse spec 10's endpoints.
export const fetchOverview = (sectionId) => api(`/cr/sections/${sectionId}/overview`);
export const fetchRoutine = (sectionId) => api(`/cr/sections/${sectionId}/routine`);
export const sendReminder = (sectionId, studentId) =>
  api(`/cr/sections/${sectionId}/reminders`, { method: 'POST', body: { student_id: studentId } });
export const raiseFlag = (sectionId, body) =>
  api(`/cr/sections/${sectionId}/flags`, { method: 'POST', body });
export const decideRequest = (enrolmentId, body) =>
  api(`/enrolments/${enrolmentId}/decision`, { method: 'POST', body });
export const changeGroup = (enrolmentId, groupId) =>
  api(`/enrolments/${enrolmentId}/group`, { method: 'PATCH', body: { group_id: groupId } });

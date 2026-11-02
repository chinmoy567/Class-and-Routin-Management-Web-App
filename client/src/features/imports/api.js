import { api } from '@/lib/api';

const dept = (departmentId) => (departmentId ? `?department_id=${departmentId}` : '');

export const fetchImports = (semesterId, departmentId) =>
  api(`/semesters/${semesterId}/imports${dept(departmentId)}`);
export const fetchPreview = (id) => api(`/imports/${id}/preview`);
export const uploadImport = ({ semesterId, departmentId, file }) =>
  api(`/semesters/${semesterId}/imports${dept(departmentId)}`, { method: 'POST', body: file });
export const confirmIssue = ({ id, issueId }) =>
  api(`/imports/${id}/issues/${issueId}/confirm`, { method: 'POST' });
export const saveKeepChoices = ({ id, choices }) =>
  api(`/imports/${id}/keep-choices`, { method: 'PUT', body: choices });
export const publishImport = ({ id, warningsReviewed }) =>
  api(`/imports/${id}/publish`, {
    method: 'POST',
    body: warningsReviewed ? { warnings_reviewed: true } : {},
  });

/** The template is a file, not JSON, so it is fetched here and handed to the browser to save. */
export async function downloadTemplate(departmentId) {
  const res = await fetch(`/api/admin/imports/template${dept(departmentId)}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('template');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = 'routine-template.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

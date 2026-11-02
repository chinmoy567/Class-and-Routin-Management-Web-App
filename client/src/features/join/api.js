import { api } from '@/lib/api';

export const fetchOptions = () => api('/join/options');
export const fetchMyRequest = () => api('/me/join-request');
export const sendRequest = (body) => api('/enrolments', { method: 'POST', body });
export const withdrawRequest = (id) => api(`/enrolments/${id}/withdraw`, { method: 'POST' });
export const appealRequest = (id) => api(`/enrolments/${id}/appeal`, { method: 'POST' });

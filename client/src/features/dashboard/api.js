import { api } from '@/lib/api';

/** DSH-01: the whole dashboard, one call. */
export const fetchDashboard = () => api('/me/dashboard');

/** DSH-13: one section's roster, loaded when a teacher opens it. */
export const fetchSectionRoster = (sectionId) => api(`/sections/${sectionId}/roster`);

import { api } from '@/lib/api';

export const fetchProfile = () => api('/me/profile');
export const updatePhone = (phone) => api('/me/profile', { method: 'PATCH', body: { phone } });
/** PRF-10 (spec 24): a student's optional UV ID; null clears it. */
export const updateUvId = (uv_id) => api('/me/profile', { method: 'PATCH', body: { uv_id } });
/** The photo goes up as the raw file (PRF-04), not as JSON. */
export const uploadPhoto = (file) => api('/me/photo', { method: 'PUT', body: file });
export const deletePhoto = () => api('/me/photo', { method: 'DELETE' });
export const requestEmailChange = (new_email) =>
  api('/me/email', { method: 'POST', body: { new_email } });
export const confirmEmailChange = (token) =>
  api('/me/email/confirm', { method: 'POST', body: { token } });
export const fetchPublicProfile = (id) => api(`/users/${id}`);

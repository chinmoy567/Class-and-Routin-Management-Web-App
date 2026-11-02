import { api } from '@/lib/api';

export const fetchMyRoutine = (from, to) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return api(`/me/routine${qs ? '?' + qs : ''}`);
};

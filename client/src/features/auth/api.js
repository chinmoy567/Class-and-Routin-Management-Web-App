import { api, ApiError, resetCsrfToken } from '@/lib/api';
import { solveChallenge } from './pow.js';

// Where each `next` value from the server sends the person (AUTH-29).
export const NEXT_PATHS = {
  'verify-email': '/verify-email',
  'second-step': '/second-step',
  'setup-totp': '/setup-totp',
  'join-form': '/join',
  'waiting-approval': '/waiting-approval',
  'semester-update': '/semester-update',
  dashboard: '/',
};
export const pathForNext = (next) => NEXT_PATHS[next] ?? '/';

export async function fetchMe() {
  try {
    return await api('/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const signUp = (body) => api('/auth/signup', { method: 'POST', body });
export const verifyEmail = (token) => api('/auth/verify', { method: 'POST', body: { token } });
export const resendVerification = (email) =>
  api('/auth/verify/resend', { method: 'POST', body: { email } });

/** Sign in. If the server asks for a CAPTCHA, solve it and try once more. */
export async function signIn({ email, password }) {
  const attempt = (captcha) =>
    api('/auth/login', { method: 'POST', body: { email, password, ...(captcha && { captcha }) } });
  try {
    return await attempt();
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'CAPTCHA_REQUIRED') throw err;
    const challenge = await api('/auth/captcha');
    const solution = await solveChallenge(challenge);
    return attempt({ id: challenge.id, solution });
  }
}

export async function signOut() {
  await api('/auth/logout', { method: 'POST' });
  resetCsrfToken();
}

export const submitSecondStep = (code) =>
  api('/auth/second-step', { method: 'POST', body: { code } });
export const emailSecondStepCode = () => api('/auth/second-step/email-code', { method: 'POST' });
export const startTotpSetup = () => api('/auth/totp/setup', { method: 'POST' });
export const confirmTotp = (code) => api('/auth/totp/confirm', { method: 'POST', body: { code } });

export const requestPasswordReset = (email) =>
  api('/auth/reset/request', { method: 'POST', body: { email } });
export const confirmPasswordReset = (body) => api('/auth/reset/confirm', { method: 'POST', body });
export const changePassword = (body) => api('/me/password', { method: 'POST', body });

// The department list belongs to spec 03; teacher sign-up reads it from here.
export const fetchDepartments = () => api('/departments');

import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { fail, mockApi, meResponse, renderApp } from '@/test/mockApi.jsx';

afterEach(() => vi.unstubAllGlobals());

describe('AuthGate', () => {
  it('AUTH-29 a signed-out visitor is sent to sign in', async () => {
    mockApi({ 'GET /api/auth/me': fail(401, 'UNAUTHENTICATED') });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  const screens = [
    ['verify-email', 'Confirm your email'],
    ['second-step', 'Second step'],
    ['join-form', 'Join your section'],
    ['waiting-approval', 'Waiting for approval'],
    ['semester-update', 'Update your semester details'],
  ];
  it.each(screens)(
    'AUTH-29 next=%s shows the %s screen from any address',
    async (next, heading) => {
      mockApi({ 'GET /api/auth/me': meResponse(next) });
      renderApp('/account/password');
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    },
  );

  it('AUTH-29 next=setup-totp shows the authenticator setup', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('setup-totp'),
      'POST /api/auth/totp/setup': {
        ...meResponse('x'),
        json: async () => ({ data: { otpauth_url: 'otpauth://totp/x?secret=ABC', secret: 'ABC' } }),
      },
    });
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: 'Set up your authenticator app' }),
    ).toBeInTheDocument();
  });

  it('AUTH-29 a person held on a step screen cannot wander to another one', async () => {
    mockApi({ 'GET /api/auth/me': meResponse('waiting-approval') });
    renderApp('/semester-update');
    expect(
      await screen.findByRole('heading', { name: 'Waiting for approval' }),
    ).toBeInTheDocument();
  });

  it('AUTH-29 a person with next=dashboard leaves a step screen for the app', async () => {
    mockApi({ 'GET /api/auth/me': meResponse('dashboard') });
    renderApp('/waiting-approval');
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });

  it('AUTH-29 public pages stay open to everyone', async () => {
    mockApi({ 'GET /api/auth/me': fail(401, 'UNAUTHENTICATED') });
    for (const [path, heading] of [
      ['/signup', 'Create your account'],
      ['/forgot-password', 'Forgot your password?'],
      ['/check-email', 'Check your email'],
    ]) {
      const { unmount } = renderApp(path);
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
      unmount();
    }
  });
});

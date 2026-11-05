import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { fail, mockApi, meResponse, renderApp } from '@/test/mockApi.jsx';

afterEach(() => vi.unstubAllGlobals());

const LANDING_TITLE = 'Your class routine, live, in one place.';

describe('Visitor landing dashboard (F7e)', () => {
  it('F7e a signed-out visitor at / sees the landing page, not a redirect to sign-in', async () => {
    mockApi({ 'GET /api/auth/me': fail(401, 'UNAUTHENTICATED') });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: LANDING_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('F7e the landing page links to sign in and sign up', async () => {
    mockApi({ 'GET /api/auth/me': fail(401, 'UNAUTHENTICATED') });
    renderApp('/');
    await screen.findByRole('heading', { name: LANDING_TITLE });
    for (const link of screen.getAllByRole('link', { name: 'Sign in' })) {
      expect(link).toHaveAttribute('href', '/login');
    }
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  });

  it('F7e the landing page makes no authenticated API call besides the session check', async () => {
    const calls = mockApi({ 'GET /api/auth/me': fail(401, 'UNAUTHENTICATED') });
    renderApp('/');
    await screen.findByRole('heading', { name: LANDING_TITLE });
    const apiCalls = calls.map((c) => c.url).filter((u) => !u.startsWith('/api/auth/'));
    expect(apiCalls).toEqual([]);
  });

  it('F7e every example is labelled as an example', async () => {
    mockApi({ 'GET /api/auth/me': fail(401, 'UNAUTHENTICATED') });
    renderApp('/');
    await screen.findByRole('heading', { name: LANDING_TITLE });
    expect(screen.getAllByText('Example').length).toBeGreaterThanOrEqual(2);
  });

  it('F7e the landing page has a skip link to its main content', async () => {
    mockApi({ 'GET /api/auth/me': fail(401, 'UNAUTHENTICATED') });
    renderApp('/');
    await screen.findByRole('heading', { name: LANDING_TITLE });
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#landing-main',
    );
  });

  it('F7e a signed-in student at / gets their own dashboard, not the landing page', async () => {
    mockApi({ 'GET /api/auth/me': meResponse('dashboard') });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: LANDING_TITLE })).not.toBeInTheDocument();
  });

  it('F7e a signed-in person held on a step screen is sent to that screen from /', async () => {
    mockApi({ 'GET /api/auth/me': meResponse('verify-email', { email_verified: false }) });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
  });

  it('F7e with reduced motion on, the reveal items are shown at once', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })),
    );
    mockApi({ 'GET /api/auth/me': fail(401, 'UNAUTHENTICATED') });
    renderApp('/');
    await screen.findByRole('heading', { name: LANDING_TITLE });
    await waitFor(() => {
      const items = document.querySelectorAll('[data-reveal]');
      expect(items.length).toBeGreaterThan(0);
      items.forEach((el) => expect(el).toHaveClass('is-visible'));
    });
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { mockApi, meResponse, renderApp } from '@/test/mockApi.jsx';

afterEach(() => vi.unstubAllGlobals());

describe('AppShell', () => {
  it('FND-31 renders the navigation, a skip link and the home page', async () => {
    mockApi({ 'GET /api/auth/me': meResponse('dashboard') });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('FND-31 an unknown route shows the not-found page inside the shell', async () => {
    mockApi({ 'GET /api/auth/me': meResponse('dashboard') });
    renderApp('/nope');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});

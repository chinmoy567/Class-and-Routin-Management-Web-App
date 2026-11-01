import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { AppRoutes } from '@/App.jsx';
import { resetCsrfToken } from '@/lib/api.js';

const reply = (status, body, headers = {}) => ({
  ok: status < 400,
  status,
  statusText: String(status),
  headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
  json: () => Promise.resolve(body),
  clone() {
    return reply(status, body, headers);
  },
});

export const ok = (data) => reply(200, { data });
export const fail = (status, code, extra = {}, headers = {}) =>
  reply(status, { error: { code, message: code, ...extra } }, headers);

/**
 * Stub `fetch`. `routes` maps "METHOD /api/path" to a response (or a function of the parsed
 * request body returning one). Every call is recorded in the returned `calls` list.
 */
export function mockApi(routes) {
  resetCsrfToken();
  const calls = [];
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const method = init.method ?? 'GET';
    // a file body (the profile photo) is passed through as the Blob itself
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, body });
    if (url === '/api/auth/csrf') return ok({ token: 'csrf-token' });
    const route = routes[`${method} ${url}`];
    if (!route) return fail(404, 'NOT_FOUND');
    const handler = Array.isArray(route) ? route.shift() : route;
    return typeof handler === 'function' ? handler(body) : handler;
  });
  return calls;
}

export const meResponse = (next, over = {}) =>
  ok({
    user: {
      id: 'u1',
      full_name: 'Rafi Ahmed',
      kind: 'student',
      state: 'active',
      email_verified: true,
      email_bouncing: false,
      ...over,
    },
    roles: [],
    email_action_required: false,
    next,
    ...(over.email_action_required !== undefined && {
      email_action_required: over.email_action_required,
    }),
  });

/** Render the real route tree at `path`, with a fresh query cache. */
export function renderApp(path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, resetCsrfToken } from '../api.js';

const response = (status, body) => ({
  ok: status < 400,
  status,
  statusText: 'x',
  json: () => Promise.resolve(body),
  clone: () => response(status, body),
});
const json = (status, body) => Promise.resolve(response(status, body));

let calls;
beforeEach(() => {
  calls = [];
  resetCsrfToken();
});
afterEach(() => vi.unstubAllGlobals());

describe('api()', () => {
  it('FND-31 GET sends credentials and no CSRF header, and returns data', async () => {
    vi.stubGlobal('fetch', (url, init) => {
      calls.push([url, init]);
      return json(200, { data: { ok: true } });
    });
    expect(await api('/health')).toEqual({ ok: true });
    expect(calls[0][0]).toBe('/api/health');
    expect(calls[0][1].credentials).toBe('include');
    expect(calls[0][1].headers['X-CSRF-Token']).toBeUndefined();
  });

  it('FND-31 a POST fetches the CSRF token once and sends it in X-CSRF-Token', async () => {
    vi.stubGlobal('fetch', (url, init) => {
      calls.push([url, init]);
      if (url === '/api/auth/csrf') return json(200, { data: { token: 'tok123' } });
      return json(200, { data: { saved: true } });
    });
    await api('/things', { method: 'POST', body: { a: 1 } });
    await api('/things', { method: 'POST', body: { a: 2 } });
    const posts = calls.filter(([u]) => u === '/api/things');
    expect(posts[0][1].headers['X-CSRF-Token']).toBe('tok123');
    expect(posts[0][1].body).toBe('{"a":1}');
    expect(calls.filter(([u]) => u === '/api/auth/csrf')).toHaveLength(1);
  });

  it('FND-31 an error response becomes an ApiError with code, status and fields', async () => {
    vi.stubGlobal('fetch', () =>
      json(409, { error: { code: 'ALREADY_DECIDED', message: 'done', fields: { x: 'y' } } }),
    );
    const err = await api('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'ALREADY_DECIDED', fields: { x: 'y' } });
  });

  it('FND-31 a CSRF_FAILED is retried once with a fresh token', async () => {
    let tokenCalls = 0;
    let posts = 0;
    vi.stubGlobal('fetch', (url) => {
      if (url === '/api/auth/csrf') return json(200, { data: { token: `t${++tokenCalls}` } });
      posts += 1;
      return posts === 1
        ? json(403, { error: { code: 'CSRF_FAILED', message: 'bad' } })
        : json(200, { data: { ok: 1 } });
    });
    expect(await api('/w', { method: 'POST', body: {} })).toEqual({ ok: 1 });
    expect(tokenCalls).toBe(2);
  });
});

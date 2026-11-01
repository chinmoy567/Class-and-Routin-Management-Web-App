export class ApiError extends Error {
  constructor(status, code, message, fields, retryAfter) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

let csrfToken = null;
export const resetCsrfToken = () => {
  csrfToken = null;
};

async function getCsrfToken() {
  if (!csrfToken) {
    const res = await fetch('/api/auth/csrf', { credentials: 'include' });
    const body = await res.json();
    csrfToken = body.data.token;
  }
  return csrfToken;
}

async function parse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    // empty body
  }
  if (!res.ok) {
    const e = body?.error;
    const retryAfter = Number(res.headers?.get?.('Retry-After')) || undefined;
    throw new ApiError(
      res.status,
      e?.code ?? 'INTERNAL',
      e?.message ?? res.statusText,
      e?.fields,
      retryAfter,
    );
  }
  return body;
}

/**
 * The single fetch wrapper (FND-31). Sends the session cookie, adds the CSRF header to every
 * non-GET request, and turns `{ error }` into a thrown ApiError. Returns the response `data`.
 */
export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const init = { method, credentials: 'include', headers: { ...headers } };
  if (method !== 'GET') init.headers['X-CSRF-Token'] = await getCsrfToken();
  if (body instanceof Blob) {
    // a file (the profile photo) goes up as it is, with its own content type
    init.headers['Content-Type'] = body.type || 'application/octet-stream';
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res = await fetch(`/api${path}`, init);
  if (res.status === 403 && method !== 'GET') {
    // the session may have rotated: fetch a fresh token once and retry
    const clone = res.clone();
    const err = (await clone.json().catch(() => null))?.error;
    if (err?.code === 'CSRF_FAILED') {
      resetCsrfToken();
      init.headers['X-CSRF-Token'] = await getCsrfToken();
      res = await fetch(`/api${path}`, init);
    }
  }
  const parsed = await parse(res);
  return parsed?.data;
}

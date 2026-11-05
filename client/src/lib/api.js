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
    const error = new ApiError(
      res.status,
      e?.code ?? 'INTERNAL',
      e?.message ?? res.statusText,
      e?.fields,
      retryAfter,
    );
    error.issues = e?.issues; // SLOT_INVALID: the list of problems (spec 08)
    error.details = e; // the whole error body, for extra fields such as spec 14's departments
    throw error;
  }
  return body;
}

/**
 * The single fetch wrapper (FND-31). Sends the session cookie, adds the CSRF header to every
 * non-GET request, and turns `{ error }` into a thrown ApiError. Returns the response `data`.
 */
export async function api(path, opts) {
  return (await apiBody(path, opts))?.data;
}

/** As `api`, but returns the whole response body, for answers that are not wrapped in `data`. */
export async function apiBody(path, { method = 'GET', body, headers = {} } = {}) {
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
  return parse(res);
}

/**
 * Spec 21: a multipart upload that reports progress (`fetch` cannot). The CSRF header is sent as
 * for every write, and an error body becomes an ApiError. `onProgress` receives 0 to 1.
 */
export async function uploadForm(path, formData, { onProgress } = {}) {
  const token = await getCsrfToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-CSRF-Token', token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body?.data);
      const e = body?.error;
      const retryAfter = Number(xhr.getResponseHeader('Retry-After')) || undefined;
      reject(
        new ApiError(
          xhr.status,
          e?.code ?? 'INTERNAL',
          e?.message ?? xhr.statusText,
          e?.fields,
          retryAfter,
        ),
      );
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Network error'));
    xhr.send(formData);
  });
}

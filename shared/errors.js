export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  UNAUTHENTICATED: { code: 'UNAUTHENTICATED', status: 401 },
  SECOND_STEP_REQUIRED: { code: 'SECOND_STEP_REQUIRED', status: 401 },
  CSRF_FAILED: { code: 'CSRF_FAILED', status: 403 },
  FORBIDDEN: { code: 'FORBIDDEN', status: 403 },
  STATE_NOT_ALLOWED: { code: 'STATE_NOT_ALLOWED', status: 403 },
  NOT_FOUND: { code: 'NOT_FOUND', status: 404 },
  ALREADY_DECIDED: { code: 'ALREADY_DECIDED', status: 409 },
  CONFLICT: { code: 'CONFLICT', status: 409 },
  RATE_LIMITED: { code: 'RATE_LIMITED', status: 429 },
  INTERNAL: { code: 'INTERNAL', status: 500 },
});

export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';
export const SECOND_STEP_REQUIRED = 'SECOND_STEP_REQUIRED';
export const CSRF_FAILED = 'CSRF_FAILED';
export const FORBIDDEN = 'FORBIDDEN';
export const STATE_NOT_ALLOWED = 'STATE_NOT_ALLOWED';
export const NOT_FOUND = 'NOT_FOUND';
export const ALREADY_DECIDED = 'ALREADY_DECIDED';
export const CONFLICT = 'CONFLICT';
export const RATE_LIMITED = 'RATE_LIMITED';
export const INTERNAL = 'INTERNAL';

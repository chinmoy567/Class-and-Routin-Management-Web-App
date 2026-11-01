import { AppError } from '../lib/errors.js';

const registry = new Map();

/**
 * Register a module's policies, keyed `<resource>.<verb>`.
 * A policy is a synchronous function `(user, resource) => boolean`, or
 * `{ allow: fn, hideExistence: true }` when a refusal must look like a 404.
 */
export function registerPolicies(policies) {
  for (const [action, policy] of Object.entries(policies)) {
    if (registry.has(action)) throw new Error(`Policy already registered: ${action}`);
    registry.set(action, typeof policy === 'function' ? { allow: policy } : policy);
  }
}

export function clearPolicies() {
  registry.clear();
}

function lookup(action) {
  const entry = registry.get(action);
  if (entry) return entry;
  // FND-18: loud in development and test, deny in production
  if (process.env.NODE_ENV === 'production') return { allow: () => false };
  throw new Error(`Unregistered policy action: ${action}`);
}

export function can(user, action, resource) {
  if (!user) return false;
  return Boolean(lookup(action).allow(user, resource));
}

export function assertCan(user, action, resource) {
  if (can(user, action, resource)) return;
  const entry = lookup(action);
  if (entry.hideExistence) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do this.');
}

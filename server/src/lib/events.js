import { afterCommit } from './db.js';

let emitter = () => {};

/** Wired by socket.js (or by tests) to the real emitter. */
export function setEmitter(fn) {
  emitter = fn ?? (() => {});
}

/**
 * FND-26: send a push event only after the surrounding transaction has committed.
 * Payloads carry ids and the event name only, never personal data.
 */
export function emitAfterCommit(room, event, payload = {}) {
  afterCommit(() => emitter(room, event, payload));
}

import { clock } from './time.js';
/** pino level for `error` (levels 50 and up are errors). */
export const ERROR_LEVEL = 50;

/**
 * OPS-12: count error-level log lines in a sliding window and call `onAlert` once when the count
 * goes above `threshold`. After an alert the counter waits for the window to clear before it can
 * alert again, so one incident sends one alert, not one per log line.
 */
export function createErrorCounter({
  threshold = 20,
  windowMs = 5 * 60 * 1000,
  now = () => clock.now().getTime(),
  onAlert = () => {},
} = {}) {
  let times = [];
  let alertedAt = null;

  function record(level) {
    if (level < ERROR_LEVEL) return false;
    const t = now();
    times.push(t);
    times = times.filter((x) => t - x < windowMs);
    if (times.length > threshold && (alertedAt === null || t - alertedAt >= windowMs)) {
      alertedAt = t;
      onAlert({ count: times.length, windowMs });
      return true;
    }
    return false;
  }

  return { record, count: () => times.length };
}

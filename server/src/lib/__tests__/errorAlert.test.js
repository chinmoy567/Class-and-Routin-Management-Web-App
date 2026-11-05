import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, onErrorAlert } from '../logger.js';

const sink = () => new Writable({ write: (_c, _e, cb) => cb() });

describe('OPS-12 error lines reach the alert handler', () => {
  it('OPS-12 a burst of error lines from the counted logger fires one alert', () => {
    const alerts = [];
    onErrorAlert((a) => alerts.push(a));
    const log = createLogger({ level: 'error', count: true, destination: sink() });
    for (let i = 0; i < 25; i++) log.error({ n: i }, 'boom');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].count).toBeGreaterThan(20);
  });

  it('OPS-12 a logger that is not counted does not trigger alerts', () => {
    const alerts = [];
    onErrorAlert((a) => alerts.push(a));
    const log = createLogger({ level: 'error', destination: sink() });
    for (let i = 0; i < 30; i++) log.error('boom');
    expect(alerts).toHaveLength(0);
  });
});

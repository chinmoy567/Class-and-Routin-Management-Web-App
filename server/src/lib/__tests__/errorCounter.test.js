import { describe, it, expect } from 'vitest';
import { createErrorCounter } from '../errorCounter.js';

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe('OPS-12 error counter', () => {
  it('OPS-12 alerts when more than 20 errors occur in 5 minutes', () => {
    const clock = fakeClock();
    const alerts = [];
    const c = createErrorCounter({ now: clock.now, onAlert: (a) => alerts.push(a) });
    for (let i = 0; i < 20; i++) c.record(50);
    expect(alerts).toHaveLength(0);
    c.record(50);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].count).toBe(21);
  });

  it('OPS-12 ignores lines below error level', () => {
    const alerts = [];
    const c = createErrorCounter({ threshold: 2, onAlert: (a) => alerts.push(a) });
    for (let i = 0; i < 10; i++) c.record(40);
    expect(alerts).toHaveLength(0);
    expect(c.count()).toBe(0);
  });

  it('OPS-12 errors older than 5 minutes do not count', () => {
    const clock = fakeClock();
    const alerts = [];
    const c = createErrorCounter({ threshold: 3, now: clock.now, onAlert: (a) => alerts.push(a) });
    for (let i = 0; i < 3; i++) c.record(50);
    clock.advance(5 * 60 * 1000 + 1);
    for (let i = 0; i < 3; i++) c.record(50);
    expect(alerts).toHaveLength(0);
  });

  it('OPS-12 one incident sends one alert, not one per line', () => {
    const clock = fakeClock();
    const alerts = [];
    const c = createErrorCounter({ threshold: 2, now: clock.now, onAlert: (a) => alerts.push(a) });
    for (let i = 0; i < 10; i++) c.record(50);
    expect(alerts).toHaveLength(1);
  });
});

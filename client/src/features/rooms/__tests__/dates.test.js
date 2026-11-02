import { describe, it, expect } from 'vitest';
import { hhmm, timeOptions, weekBounds } from '../dates.js';

describe('free-room pickers (spec 13)', () => {
  it('FRV-01 the time pickers offer 5-minute steps from 08:00 to 18:00', () => {
    const starts = timeOptions('start');
    const ends = timeOptions('end');
    expect(starts[0]).toBe(480);
    expect(starts.at(-1)).toBe(1075); // 17:55 as a start
    expect(ends[0]).toBe(485); // 08:05 as an end
    expect(ends.at(-1)).toBe(1080); // 18:00 as an end
    expect(starts.every((m) => m % 5 === 0)).toBe(true);
  });

  it('FRV-01 hhmm shows minutes since midnight as HH:MM', () => {
    expect(hhmm(630)).toBe('10:30');
    expect(hhmm(1080)).toBe('18:00');
  });

  it('FRV-01 a Sunday shows this Sunday to the Saturday after next', () => {
    expect(weekBounds('2027-04-04')).toEqual({ min: '2027-04-04', max: '2027-04-17' });
  });

  it('FRV-01 a Wednesday shows the Sunday of its week to the Saturday of next week', () => {
    expect(weekBounds('2027-04-07')).toEqual({ min: '2027-04-04', max: '2027-04-17' });
  });

  it('FRV-01 a Saturday still belongs to the week that started on the Sunday before', () => {
    expect(weekBounds('2027-04-10')).toEqual({ min: '2027-04-04', max: '2027-04-17' });
  });
});

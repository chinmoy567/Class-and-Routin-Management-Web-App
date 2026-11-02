import { describe, it, expect } from 'vitest';
import { rangesOverlap, availabilityQuery, ERROR_CODES } from '../index.js';

describe('FRV-03 rangesOverlap', () => {
  it('FRV-03 a class 10:30-11:25 overlaps 11:00-12:00', () => {
    expect(rangesOverlap(630, 685, 660, 720)).toBe(true);
  });
  it('FRV-03 a class 10:30-11:25 does not overlap 11:35-12:30', () => {
    expect(rangesOverlap(630, 685, 695, 750)).toBe(false);
  });
  it('FRV-03 ranges that only touch do not overlap', () => {
    expect(rangesOverlap(630, 685, 685, 695)).toBe(false);
    expect(rangesOverlap(685, 695, 630, 685)).toBe(false);
  });
});

describe('FRV-01 availability query', () => {
  const ok = { date: '2027-04-04', from: '600', to: '660' };
  it('accepts 5-minute steps inside 08:00 to 18:00', () => {
    expect(availabilityQuery.safeParse(ok).success).toBe(true);
  });
  it('rejects a time that is not on a 5-minute step', () => {
    expect(availabilityQuery.safeParse({ ...ok, from: '601' }).success).toBe(false);
  });
  it('rejects a time before 08:00 or after 18:00', () => {
    expect(availabilityQuery.safeParse({ ...ok, from: '479' }).success).toBe(false);
    expect(availabilityQuery.safeParse({ ...ok, to: '1085' }).success).toBe(false);
  });
  it('rejects from >= to', () => {
    expect(availabilityQuery.safeParse({ ...ok, from: '660', to: '660' }).success).toBe(false);
  });
  it('rejects a malformed date', () => {
    expect(availabilityQuery.safeParse({ ...ok, date: '04/04/2027' }).success).toBe(false);
  });
  it('DATE_OUT_OF_RANGE is a 400 error code', () => {
    expect(ERROR_CODES.DATE_OUT_OF_RANGE).toEqual({ code: 'DATE_OUT_OF_RANGE', status: 400 });
  });
});

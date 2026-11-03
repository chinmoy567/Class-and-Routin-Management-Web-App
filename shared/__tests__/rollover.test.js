import { describe, it, expect } from 'vitest';
import { makeCurrentBody, nextTerm } from '../index.js';

describe('ROL-08 suggested next term', () => {
  it('ROL-08 a student last confirmed in 2-II gets 3-I suggested', () => {
    expect(nextTerm(2, 'II')).toEqual({ level: 3, term: 'I' });
  });
  it('ROL-08 2-I becomes 2-II and 1-I becomes 1-II', () => {
    expect(nextTerm(2, 'I')).toEqual({ level: 2, term: 'II' });
    expect(nextTerm(1, 'I')).toEqual({ level: 1, term: 'II' });
  });
  it('ROL-09 4-II has no next term', () => {
    expect(nextTerm(4, 'II')).toBeNull();
  });
});

describe('ROL-03 make-current body', () => {
  it('ROL-03 accepts an empty body and a list of department codes', () => {
    expect(makeCurrentBody.safeParse({}).success).toBe(true);
    expect(makeCurrentBody.safeParse({ confirm_not_ready: ['EEE'] }).success).toBe(true);
  });
  it('ROL-03 rejects unknown fields', () => {
    expect(makeCurrentBody.safeParse({ force: true }).success).toBe(false);
  });
});

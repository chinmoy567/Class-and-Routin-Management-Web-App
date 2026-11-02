import { describe, it, expect } from 'vitest';
import { previousTerm } from '../previous-section.js';

describe('previousTerm (CRD-07)', () => {
  it('CRD-07 2-II is preceded by 2-I', () => {
    expect(previousTerm(2, 'II')).toEqual({ level: 2, term: 'I' });
  });
  it('CRD-07 2-I is preceded by 1-II', () => {
    expect(previousTerm(2, 'I')).toEqual({ level: 1, term: 'II' });
  });
  it('CRD-07 1-I has no earlier term', () => {
    expect(previousTerm(1, 'I')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { normaliseUvId, createEnrolmentBody, joinDecisionBody } from '../schemas/index.js';

describe('UV ID normaliser (JR-05)', () => {
  it('JR-05 removes spaces and dashes and keeps leading zeros in the text', () => {
    expect(normaliseUvId('0822-3102 05101077')).toEqual({
      text: '0822310205101077',
      norm: '822310205101077',
    });
  });
  it('JR-05 the leading-zero and plain forms have the same norm', () => {
    expect(normaliseUvId('0822310205101077').norm).toBe(normaliseUvId('822310205101077').norm);
  });
  it('JR-05 needs 1 to 20 digits', () => {
    expect(normaliseUvId('')).toBeNull();
    expect(normaliseUvId('12a')).toBeNull();
    expect(normaliseUvId('1'.repeat(21))).toBeNull();
    expect(normaliseUvId('1'.repeat(20))).not.toBeNull();
    expect(normaliseUvId('000')).toEqual({ text: '000', norm: '0' });
  });
});

describe('join schemas', () => {
  it('JR-10 a rejection needs a reason of 5 to 500 characters', () => {
    expect(joinDecisionBody.safeParse({ decision: 'reject', reason: 'no' }).success).toBe(false);
    expect(
      joinDecisionBody.safeParse({ decision: 'reject', reason: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(
      joinDecisionBody.safeParse({ decision: 'reject', reason: 'Not in this batch' }).success,
    ).toBe(true);
    expect(joinDecisionBody.safeParse({ decision: 'accept' }).success).toBe(true);
  });
  it('JR-01 rejects unknown fields (no mass assignment)', () => {
    const id = 'a'.repeat(24);
    expect(createEnrolmentBody.safeParse({ section_id: id, status: 'accepted' }).success).toBe(
      false,
    );
    expect(createEnrolmentBody.safeParse({ section_id: id, uv_id: '0822 31' }).success).toBe(true);
  });
});

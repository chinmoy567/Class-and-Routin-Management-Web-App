import { describe, it, expect } from 'vitest';
import {
  normaliseUvId,
  uvIdSchema,
  updateProfileBody,
  createEnrolmentBody,
  joinDecisionBody,
  removeFromSectionBody,
  adminJoinQuery,
} from '../schemas/index.js';

describe('profile UV ID (spec 24 OS-05, spec 02 PRF-10)', () => {
  it('OS-05 removes spaces and dashes and keeps leading zeros', () => {
    expect(normaliseUvId(' 08 22-3102 ')).toBe('08223102');
    expect(uvIdSchema.parse('08 22-3102')).toBe('08223102');
    expect(uvIdSchema.parse('000')).toBe('000');
  });
  it('OS-05 needs 1 to 20 digits', () => {
    expect(uvIdSchema.safeParse('1'.repeat(21)).success).toBe(false);
    expect(uvIdSchema.safeParse('12a').success).toBe(false);
    expect(uvIdSchema.parse('1'.repeat(20))).toBe('1'.repeat(20));
  });
  it('OS-05 an empty value or null clears it', () => {
    expect(uvIdSchema.parse('')).toBeNull();
    expect(uvIdSchema.parse('  ')).toBeNull();
    expect(uvIdSchema.parse(null)).toBeNull();
  });
  it('PRF-10 the profile body takes uv_id, phone, or both, and nothing else', () => {
    expect(updateProfileBody.parse({ uv_id: '0822' })).toEqual({ uv_id: '0822' });
    expect(updateProfileBody.safeParse({}).success).toBe(false);
    expect(updateProfileBody.safeParse({ uv_id: '1', full_name: 'X Y' }).success).toBe(false);
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
  });
  it('OS-06 a join request with uv_id is refused', () => {
    const id = 'a'.repeat(24);
    expect(createEnrolmentBody.safeParse({ section_id: id, uv_id: '0822 31' }).success).toBe(
      false,
    );
    expect(createEnrolmentBody.safeParse({ section_id: id }).success).toBe(true);
  });
  it('JR-19 removing a student from a section needs a reason of 5 to 500 characters', () => {
    expect(removeFromSectionBody.safeParse({}).success).toBe(false);
    expect(removeFromSectionBody.safeParse({ reason: 'abc' }).success).toBe(false);
    expect(removeFromSectionBody.safeParse({ reason: 'Wrong section' }).success).toBe(true);
  });
  it('OS-08 the admin list has no claims view', () => {
    expect(adminJoinQuery.safeParse({ view: 'claims' }).success).toBe(false);
  });
});

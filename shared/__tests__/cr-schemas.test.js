import { describe, it, expect } from 'vitest';
import { flagBody, reminderBody, FLAG_CATEGORIES, FLAG_STATUSES } from '../schemas/cr.js';
import { ERROR_CODES, FLAG_LIMIT, isReleased } from '../index.js';

const id = '64b7f0c2a1b2c3d4e5f60718';

describe('CRD-DSH-11 flag body', () => {
  it('CRD-DSH-11 accepts a category, a description of 10 to 1,000 characters and an optional student', () => {
    expect(flagBody.safeParse({ category: 'other', description: '1234567890' }).success).toBe(true);
    expect(
      flagBody.safeParse({ category: 'wrong_group', student_id: id, description: 'x'.repeat(1000) })
        .success,
    ).toBe(true);
  });

  it('CRD-DSH-11 rejects a 9-character description, a 1,001-character one and an unknown category', () => {
    expect(flagBody.safeParse({ category: 'other', description: '123456789' }).success).toBe(false);
    expect(flagBody.safeParse({ category: 'other', description: 'x'.repeat(1001) }).success).toBe(
      false,
    );
    expect(flagBody.safeParse({ category: 'nope', description: '1234567890' }).success).toBe(false);
  });

  it('CRD-DSH-11 trims the description before counting it', () => {
    expect(flagBody.safeParse({ category: 'other', description: '   123456789   ' }).success).toBe(
      false,
    );
  });

  it('CRD-DSH-11 lists the five categories and the three statuses', () => {
    expect(FLAG_CATEGORIES).toEqual([
      'wrong_section',
      'wrong_group',
      'missing_student',
      'routine_mistake',
      'other',
    ]);
    expect(FLAG_STATUSES).toEqual(['open', 'fixed', 'rejected']);
  });
});

describe('CRD-DSH-04 reminder body', () => {
  it('CRD-DSH-04 needs a valid student id and nothing else', () => {
    expect(reminderBody.safeParse({ student_id: id }).success).toBe(true);
    expect(reminderBody.safeParse({ student_id: 'nope' }).success).toBe(false);
    expect(reminderBody.safeParse({ student_id: id, email: 'x@y.z' }).success).toBe(false);
  });
});

describe('CRD-DSH-11 shared error code', () => {
  it('CRD-DSH-11 FLAG_LIMIT is a 429 in the shared error table', () => {
    expect(FLAG_LIMIT).toBe('FLAG_LIMIT');
    expect(ERROR_CODES.FLAG_LIMIT).toEqual({ code: 'FLAG_LIMIT', status: 429 });
  });
});

describe('DSH-02 CR dashboard release', () => {
  it('CRD-DSH-07 the room-request part of the dashboard is R2, not released in R1', () => {
    expect(isReleased('cr.dashboard', 'R1')).toBe(true);
    expect(isReleased('cr.room_requests', 'R1')).toBe(false);
    expect(isReleased('cr.room_requests', 'R2')).toBe(true);
  });
});

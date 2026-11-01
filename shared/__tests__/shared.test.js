import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  ACCOUNT_STATES,
  ROLES,
  SOCKET_EVENTS,
  INSTITUTION_TIMEZONE,
  STATES_BY_KIND,
  passwordSchema,
  signupBody,
} from '../index.js';
import { objectIdString, dateString } from '../schemas/index.js';

describe('shared', () => {
  it('FND-11 every error code constant matches its table key and has an HTTP status', () => {
    for (const [key, v] of Object.entries(ERROR_CODES)) {
      expect(v.code).toBe(key);
      expect(v.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('FND-01 enums list the PRD states, roles and push events', () => {
    expect(ACCOUNT_STATES).toEqual(
      expect.arrayContaining([
        'email_unverified',
        'claim_pending',
        'active',
        'unconfirmed',
        'graduated',
        'deactivated',
        'pending',
        'suspended',
      ]),
    );
    expect(ROLES).toEqual(['super_admin', 'dept_admin', 'teacher', 'cr', 'dcr']);
    expect(Object.values(SOCKET_EVENTS).sort()).toEqual([
      'booking.changed',
      'calendar.changed',
      'message.new',
      'message.status',
      'routine.changed',
    ]);
    expect(INSTITUTION_TIMEZONE).toBe('Asia/Dhaka');
  });

  it('AUTH-06 password: 8 to 128 characters with a letter and a number', () => {
    expect(passwordSchema.safeParse('abc12345').success).toBe(true);
    expect(passwordSchema.safeParse('abc1234').success).toBe(false); // 7 characters
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(false); // no number
    expect(passwordSchema.safeParse('12345678').success).toBe(false); // no letter
    expect(passwordSchema.safeParse('a1'.repeat(64)).success).toBe(true); // 128
    expect(passwordSchema.safeParse('a1'.repeat(64) + 'x').success).toBe(false); // 129
  });

  it('AUTH-04 teacher sign-up needs a department and a 1 to 10 letter short code, upper-cased', () => {
    const base = { full_name: 'Ada Lovelace', email: 'Ada@Baiust.ac.bd', password: 'abc12345' };
    const department_id = '507f1f77bcf86cd799439011';
    expect(signupBody.safeParse({ kind: 'teacher', ...base }).success).toBe(false);
    const ok = signupBody.safeParse({ kind: 'teacher', ...base, department_id, short_code: 'abc' });
    expect(ok.success).toBe(true);
    expect(ok.data.short_code).toBe('ABC');
    expect(ok.data.email).toBe('ada@baiust.ac.bd');
    for (const short_code of ['', 'ABCDEFGHIJK', 'AB1']) {
      const r = signupBody.safeParse({ kind: 'teacher', ...base, department_id, short_code });
      expect(r.success).toBe(false);
    }
    expect(signupBody.safeParse({ kind: 'student', ...base }).success).toBe(true);
    expect(signupBody.safeParse({ kind: 'staff', ...base }).success).toBe(false);
  });

  it('AUTH-01 states are limited per kind', () => {
    expect(STATES_BY_KIND.student).toContain('claim_pending');
    expect(STATES_BY_KIND.teacher).toContain('suspended');
    expect(STATES_BY_KIND.staff).toEqual(['active', 'deactivated']);
  });

  it('FND-10 the shared schemas accept good ids and dates and reject bad ones', () => {
    expect(objectIdString.safeParse('507f1f77bcf86cd799439011').success).toBe(true);
    expect(objectIdString.safeParse('nope').success).toBe(false);
    expect(dateString.safeParse('2026-11-10').success).toBe(true);
    expect(dateString.safeParse('10/11/2026').success).toBe(false);
  });
});

import { phoneSchema, updateProfileBody } from '../index.js';

describe('profile schemas', () => {
  it('PRF-03 normalises Bangladeshi mobile numbers to +8801XXXXXXXXX', () => {
    expect(phoneSchema.parse('01712345678')).toBe('+8801712345678');
    expect(phoneSchema.parse('+8801712345678')).toBe('+8801712345678');
    expect(phoneSchema.parse('017 1234-5678')).toBe('+8801712345678');
  });
  it('PRF-03 rejects other numbers', () => {
    for (const bad of ['12345', '01212345678', '0171234567', '+9101712345678', 'abc', ''])
      expect(phoneSchema.safeParse(bad).success).toBe(false);
  });
  it('PRF-03 allows null; PRF-02 refuses any other field', () => {
    expect(updateProfileBody.parse({ phone: null })).toEqual({ phone: null });
    expect(updateProfileBody.safeParse({ phone: null, full_name: 'X Y' }).success).toBe(false);
  });
});

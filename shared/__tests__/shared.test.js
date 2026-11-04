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

import { dayRule, slotRuns } from '../calendar.js';

const semester = { start_date: '2027-06-01', end_date: '2027-11-30' };

const mkEvent = (overrides) => ({
  scope_department_id: null,
  from_date: '2027-06-07',
  to_date: '2027-06-07',
  kind: 'exam',
  cutoff_min: null,
  label: 'Mid-term exam',
  created_at: new Date('2027-01-01'),
  ...overrides,
});

describe('calendar resolver — dayRule (CAL-06, CAL-07)', () => {
  it('CAL-06-test1 date after semester end → no_semester', () => {
    expect(dayRule('2027-12-01', 'cse', { events: [], semester }).kind).toBe('no_semester');
  });

  it('CAL-06 date before semester start → no_semester', () => {
    expect(dayRule('2027-05-31', 'cse', { events: [], semester }).kind).toBe('no_semester');
  });

  it('CAL-06 Friday → non_teaching_day', () => {
    // 2027-06-04 is a Friday
    expect(dayRule('2027-06-04', 'cse', { events: [], semester }).kind).toBe('non_teaching_day');
  });

  it('CAL-06 Saturday → non_teaching_day', () => {
    // 2027-06-05 is a Saturday
    expect(dayRule('2027-06-05', 'cse', { events: [], semester }).kind).toBe('non_teaching_day');
  });

  it('CAL-06 no events → normal', () => {
    expect(dayRule('2027-06-07', 'cse', { events: [], semester }).kind).toBe('normal');
  });

  it('[PRD-AC1] university exam event → closed with label', () => {
    const result = dayRule('2027-06-07', 'cse', { events: [mkEvent()], semester });
    expect(result).toEqual({ kind: 'closed', label: 'Mid-term exam' });
  });

  it('[PRD-AC3] CSE dept_event does not affect EEE', () => {
    const ev = mkEvent({ kind: 'dept_event', scope_department_id: 'cse_id', label: 'CSE FEST' });
    expect(dayRule('2027-06-07', 'cse_id', { events: [ev], semester }).kind).toBe('closed');
    expect(dayRule('2027-06-07', 'eee_id', { events: [ev], semester }).kind).toBe('normal');
  });

  it('[PRD-AC2] early_closing at 12:00 → cutoff 720', () => {
    const ev = mkEvent({ kind: 'early_closing', cutoff_min: 720, label: 'Campus Day' });
    const result = dayRule('2027-06-07', 'cse', { events: [ev], semester });
    expect(result).toEqual({ kind: 'cutoff', cutoff_min: 720, label: 'Campus Day' });
  });

  it('[CAL-07-test1] holiday + early_closing on same day → closed', () => {
    const holiday = mkEvent({ kind: 'holiday', label: 'Public Holiday' });
    const ec = mkEvent({ kind: 'early_closing', cutoff_min: 720, label: 'Campus Day' });
    expect(dayRule('2027-06-07', 'cse', { events: [holiday, ec], semester }).kind).toBe('closed');
  });

  it('[CAL-07-test2] two early_closings at 12:00 and 13:00 → cutoff 720', () => {
    const ec1 = mkEvent({ kind: 'early_closing', cutoff_min: 720, label: 'Early' });
    const ec2 = mkEvent({ kind: 'early_closing', cutoff_min: 780, label: 'Later' });
    const result = dayRule('2027-06-07', 'cse', { events: [ec1, ec2], semester });
    expect(result).toEqual({ kind: 'cutoff', cutoff_min: 720, label: 'Early' });
  });

  it('CAL-07 dept scope label beats university scope label', () => {
    const univ = mkEvent({
      kind: 'holiday',
      label: 'University Holiday',
      created_at: new Date('2027-01-01'),
    });
    const dept = mkEvent({
      kind: 'exam',
      scope_department_id: 'cse_id',
      label: 'Dept Exam',
      created_at: new Date('2027-01-02'),
    });
    const result = dayRule('2027-06-07', 'cse_id', { events: [univ, dept], semester });
    expect(result.label).toBe('Dept Exam');
  });

  it('CAL-03 dept_event without cutoff → closed', () => {
    const ev = mkEvent({
      kind: 'dept_event',
      scope_department_id: 'cse_id',
      cutoff_min: null,
      label: 'Fest',
    });
    expect(dayRule('2027-06-07', 'cse_id', { events: [ev], semester }).kind).toBe('closed');
  });

  it('CAL-03 dept_event with cutoff → cutoff', () => {
    const ev = mkEvent({
      kind: 'dept_event',
      scope_department_id: 'cse_id',
      cutoff_min: 720,
      label: 'Fest',
    });
    const result = dayRule('2027-06-07', 'cse_id', { events: [ev], semester });
    expect(result).toEqual({ kind: 'cutoff', cutoff_min: 720, label: 'Fest' });
  });
});

describe('calendar resolver — slotRuns (CAL-08)', () => {
  const slot = {
    slot_id: 'slot1',
    day_of_week: 1,
    start_min: 695,
    end_min: 750,
    department_id: 'cse',
  };

  it('CAL-08 normal day → runs with original end_min', () => {
    const result = slotRuns(slot, '2027-06-07', { events: [], cancellations: [], semester });
    expect(result).toEqual({ status: 'runs', end_min: 750 });
  });

  it('[PRD-AC2] early_closing at 720 — class 695–750 runs until 720', () => {
    const ev = mkEvent({ kind: 'early_closing', cutoff_min: 720, label: 'Campus Day' });
    const result = slotRuns(slot, '2027-06-07', { events: [ev], cancellations: [], semester });
    expect(result).toEqual({ status: 'runs', end_min: 720 });
  });

  it('[CAL-08-test1] class starting at cutoff (720) with 720 cutoff → stopped', () => {
    const ev = mkEvent({ kind: 'early_closing', cutoff_min: 720, label: 'Campus Day' });
    const s = { ...slot, start_min: 720, end_min: 780 };
    const result = slotRuns(s, '2027-06-07', { events: [ev], cancellations: [], semester });
    expect(result.status).toBe('stopped');
  });

  it('CAL-10 cancelled slot → cancelled with reason', () => {
    const cancellation = { slot_id: 'slot1', date: '2027-06-07', reason: 'Teacher absent' };
    const result = slotRuns(slot, '2027-06-07', {
      events: [],
      cancellations: [cancellation],
      semester,
    });
    expect(result).toEqual({ status: 'cancelled', reason: 'Teacher absent' });
  });

  it('CAL-08 closed day → stopped', () => {
    const ev = mkEvent({ kind: 'holiday', label: 'Holiday' });
    const result = slotRuns(slot, '2027-06-07', { events: [ev], cancellations: [], semester });
    expect(result.status).toBe('stopped');
    expect(result.label).toBe('Holiday');
  });

  it('CAL-08 outside semester → stopped', () => {
    const result = slotRuns(slot, '2027-12-01', { events: [], cancellations: [], semester });
    expect(result.status).toBe('stopped');
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

import { createDepartmentBody, grantAdminBody, updateDepartmentBody } from '../schemas/index.js';

describe('departments and admin schemas (spec 03)', () => {
  const id = 'a'.repeat(24);
  it('DEP-01 the code is 2 to 10 upper-case letters', () => {
    expect(createDepartmentBody.safeParse({ code: 'CSE', name: 'Computer Science' }).success).toBe(
      true,
    );
    for (const code of ['C', 'cse', 'CS1', 'ABCDEFGHIJK']) {
      expect(createDepartmentBody.safeParse({ code, name: 'Computer Science' }).success).toBe(
        false,
      );
    }
  });
  it('DEP-02 an update needs at least one field', () => {
    expect(updateDepartmentBody.safeParse({}).success).toBe(false);
    expect(updateDepartmentBody.safeParse({ name: 'New name' }).success).toBe(true);
  });
  it('DEP-05 DEP-06 dept_admin needs a department, super_admin must not have one', () => {
    expect(grantAdminBody.safeParse({ user_id: id, role: 'dept_admin' }).success).toBe(false);
    expect(
      grantAdminBody.safeParse({ user_id: id, role: 'dept_admin', department_id: id }).success,
    ).toBe(true);
    expect(grantAdminBody.safeParse({ user_id: id, role: 'super_admin' }).success).toBe(true);
    expect(
      grantAdminBody.safeParse({ user_id: id, role: 'super_admin', department_id: id }).success,
    ).toBe(false);
    expect(grantAdminBody.safeParse({ user_id: id, role: 'cr' }).success).toBe(false);
  });
});

describe('semester schemas (spec 04)', () => {
  const ok = { name: 'Spring 2027', start_date: '2027-04-04', end_date: '2027-09-30' };
  it('SEM-01 accepts a name with a start and an end date', async () => {
    const { createSemesterBody } = await import('../index.js');
    expect(createSemesterBody.safeParse(ok).success).toBe(true);
  });
  it('SEM-03 rejects an end date that is not after the start date, or a fake date', async () => {
    const { createSemesterBody, updateSemesterBody } = await import('../index.js');
    expect(createSemesterBody.safeParse({ ...ok, end_date: '2027-04-04' }).success).toBe(false);
    expect(createSemesterBody.safeParse({ ...ok, end_date: '2027-02-30' }).success).toBe(false);
    expect(updateSemesterBody.safeParse({}).success).toBe(false);
    expect(
      updateSemesterBody.safeParse({ start_date: '2027-05-01', end_date: '2027-04-01' }).success,
    ).toBe(false);
    expect(updateSemesterBody.safeParse({ end_date: '2027-10-01' }).success).toBe(true);
  });
});

describe('room schemas (spec 05)', () => {
  const dept = 'a'.repeat(24);
  it('ROOM-01 trims the code, collapses spaces, and allows 1 to 20 characters', async () => {
    const { createRoomBody } = await import('../index.js');
    const parsed = createRoomBody.parse({ code: '  LR-407B  ', type: 'lab', department_id: dept });
    expect(parsed.code).toBe('LR-407B');
    expect(createRoomBody.safeParse({ code: '  ', type: 'lab', department_id: dept }).success).toBe(
      false,
    );
    expect(
      createRoomBody.safeParse({ code: 'x'.repeat(21), type: 'lab', department_id: dept }).success,
    ).toBe(false);
    expect(
      createRoomBody.safeParse({ code: '311', type: 'hall', department_id: dept }).success,
    ).toBe(false);
  });
  it('ROOM-02 an alias is trimmed with inner spaces collapsed', async () => {
    const { createAliasBody } = await import('../index.js');
    expect(createAliasBody.parse({ alias: ' RN:   311 ' }).alias).toBe('RN: 311');
  });
  it('ROOM-04 the sharing list refuses duplicates and bad ids', async () => {
    const { setSharesBody } = await import('../index.js');
    expect(setSharesBody.safeParse({ department_ids: [dept, 'b'.repeat(24)] }).success).toBe(true);
    expect(setSharesBody.safeParse({ department_ids: [dept, dept] }).success).toBe(false);
    expect(setSharesBody.safeParse({ department_ids: ['x'] }).success).toBe(false);
  });
});

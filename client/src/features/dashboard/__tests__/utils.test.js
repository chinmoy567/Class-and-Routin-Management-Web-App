import { describe, it, expect } from 'vitest';
import { addDays, dhakaDate, firstClassOf, nextTeachingDay, noClassesLeftToday } from '../utils.js';

const slot = (over = {}) => ({
  slot_id: 'x',
  course_code: 'CSE-301',
  start_min: 510,
  end_min: 565,
  status: 'runs',
  ...over,
});

describe('DSH-06 / DSH-12 dashboard date helpers', () => {
  it('DSH-06 the window is the institution date, not the device date', () => {
    // 2027-04-05 20:30 UTC is 2027-04-06 02:30 in Dhaka (UTC+6, no daylight saving).
    const instant = new Date('2027-04-05T20:30:00Z');
    expect(dhakaDate(0, instant)).toBe('2027-04-06');
    expect(dhakaDate(6, instant)).toBe('2027-04-12');
  });

  it('DSH-06 addDays crosses month and year boundaries', () => {
    expect(addDays('2027-04-30', 1)).toBe('2027-05-01');
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
  });

  it('DSH-06 the first class of a day ignores cancelled ones and picks the earliest', () => {
    const day = {
      slots: [
        slot({ slot_id: 'late', start_min: 600 }),
        slot({ slot_id: 'gone', start_min: 480, status: 'cancelled' }),
        slot({ slot_id: 'early', start_min: 510 }),
      ],
    };
    expect(firstClassOf(day).slot_id).toBe('early');
    expect(firstClassOf({ slots: [] })).toBeNull();
    expect(firstClassOf(undefined)).toBeNull();
  });
});

describe('DSH-12 next teaching day', () => {
  const routine = {
    days: [
      { date: '2027-04-06', slots: [] },
      { date: '2027-04-07', slots: [] },
      { date: '2027-04-08', slots: [slot({ slot_id: 'thu', course_code: 'CSE-400' })] },
    ],
  };

  it('DSH-12 finds the next day with a class after today', () => {
    const next = nextTeachingDay(routine, '2027-04-06');
    expect(next.date).toBe('2027-04-08');
    expect(next.slot.course_code).toBe('CSE-400');
  });

  it('DSH-12 returns null when no later day in the range has a class', () => {
    expect(nextTeachingDay(routine, '2027-04-08')).toBeNull();
  });
});

describe('DSH-12 when no class is left today', () => {
  it.each([
    ['no_classes_today', {}],
    ['classes_over', { label: 'Campus Day' }],
    ['event', { label: 'Exam' }],
    ['no_semester', {}],
  ])('DSH-12 %s means no class is left', (kind, extra) => {
    expect(noClassesLeftToday({ kind, ...extra }, '2027-04-06')).toBe(true);
  });

  it('DSH-12 a free status with its next class on another day means none is left today', () => {
    const status = { kind: 'free', next: { slot: slot(), date: '2027-04-08' } };
    expect(noClassesLeftToday(status, '2027-04-06')).toBe(true);
  });

  it('DSH-12 a free status with a later class today means classes are left', () => {
    const status = { kind: 'free', next: { slot: slot(), date: '2027-04-06' } };
    expect(noClassesLeftToday(status, '2027-04-06')).toBe(false);
  });

  it('DSH-12 a running class means classes are left', () => {
    expect(noClassesLeftToday({ kind: 'in_class' }, '2027-04-06')).toBe(false);
  });
});

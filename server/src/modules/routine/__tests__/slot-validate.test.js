import { describe, it, expect } from 'vitest';
import { validateRows } from '../validate.js';

const base = (over = {}) => ({
  row: 1,
  section_key: 'd:4:I:A',
  group: null,
  day: 0,
  start_min: 540,
  end_min: 600,
  course_code: 'C-1',
  course_name: null,
  room_text: '311',
  room_id: 'r1',
  teachers: [{ department_code: 'CSE', short_code: 'AB' }],
  tba: false,
  teacher_keys: ['CSE:AB'],
  ...over,
});
const saved = (over = {}) => ({
  id: 's1',
  section_key: 'd:4:I:A',
  group: null,
  day: 0,
  start_min: 540,
  end_min: 600,
  course_code: 'C-2',
  room_id: 'r2',
  teacher_keys: ['CSE:ZZ'],
  tba: false,
  department_code: 'CSE',
  combined_key: null,
  ...over,
});
const run = (row, others, single = { department_code: 'CSE' }) =>
  validateRows({
    rows: [row],
    teacherEntries: [],
    directory: new Map([['CSE:AB', 'Ab']]),
    others,
    single,
  }).map((i) => i.code);

describe('single-slot checks (EDT-04)', () => {
  it('a saved slot of the same section at the same time is a SECTION_OVERLAP', () => {
    expect(run(base(), [saved()])).toContain('SECTION_OVERLAP');
  });
  it('a different group of the same section does not clash', () => {
    expect(run(base({ group: 'G1' }), [saved({ group: 'G2' })])).not.toContain('SECTION_OVERLAP');
    expect(run(base({ group: 'G1' }), [saved({ group: null })])).toContain('SECTION_OVERLAP');
  });
  it('the same course on one day is DUPLICATE_COURSE_DAY even without a time overlap', () => {
    const codes = run(base(), [saved({ course_code: 'C-1', start_min: 700, end_min: 760 })]);
    expect(codes).toContain('DUPLICATE_COURSE_DAY');
    expect(codes).not.toContain('SECTION_OVERLAP');
  });
  it('the owner’s own saved slot is never a CROSS_DEPARTMENT_DUPLICATE', () => {
    const own = run(base(), [saved({ course_code: 'C-1' })]);
    expect(own).not.toContain('CROSS_DEPARTMENT_DUPLICATE');
    const other = run(base(), [saved({ course_code: 'C-1', department_code: 'LAW' })]);
    expect(other).toContain('CROSS_DEPARTMENT_DUPLICATE');
  });
  it('an identical overlap in another section offers combined', () => {
    const issues = validateRows({
      rows: [base()],
      teacherEntries: [],
      directory: new Map([['CSE:AB', 'Ab']]),
      others: [saved({ section_key: 'd:4:I:B', room_id: 'r1', teacher_keys: ['CSE:AB'] })],
      single: { department_code: 'CSE' },
    });
    const room = issues.find((i) => i.code === 'ROOM_OVERLAP');
    expect(room).toMatchObject({ offer_combined: true, other_slot_id: 's1' });
  });
  it('without `single` the import behaviour is unchanged (no section overlap against others)', () => {
    const codes = validateRows({
      rows: [base()],
      teacherEntries: [],
      directory: new Map([['CSE:AB', 'Ab']]),
      others: [saved({ department_code: 'LAW' })],
    }).map((i) => i.code);
    expect(codes).not.toContain('SECTION_OVERLAP');
  });
});

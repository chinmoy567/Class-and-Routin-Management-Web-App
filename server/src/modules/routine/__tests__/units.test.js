import { describe, it, expect } from 'vitest';
import { parseRoutineRows, parseTeachers, parseTime } from '../parse.js';
import { validateRows } from '../validate.js';
import { buildDiff } from '../diff.js';
import { sniffXlsx } from '../xlsx.js';

const active = new Map([
  ['CSE', { id: 'd1' }],
  ['LAW', { id: 'd2' }],
]);
const cells = (over = {}) => ({
  department: 'cse',
  level: '4',
  term: 'I',
  section: '',
  group: '',
  day: 'Sunday',
  start: '9:00',
  end: '10:00',
  course_code: 'cse-301',
  course_name: '',
  teachers: 'CSE:AB',
  room: '311',
  ...over,
});
const parse = (over, extra = []) =>
  parseRoutineRows([{ row: 2, cells: cells(over) }, ...extra], { activeDepartments: active });
const codes = (r) => r.issues.map((i) => i.code);

describe('parsing (IMP-04, IMP-05, IMP-11)', () => {
  it('IMP-04 term 2 becomes II, department is upper-cased, an empty section becomes A', () => {
    const { rows, issues } = parse({ term: '2' });
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({ term: 'II', department_code: 'CSE', letter: 'A', level: 4 });
  });

  it('IMP-04 level 5 is an error', () => {
    expect(codes(parse({ level: '5' }))).toContain('INVALID_LEVEL');
  });

  it('IMP-04 day Fri is an error (outside Sunday to Thursday), Sun and thursday are fine', () => {
    expect(codes(parse({ day: 'Fri' }))).toContain('DAY_OUTSIDE_WEEK');
    expect(codes(parse({ day: 'Funday' }))).toContain('INVALID_DAY');
    expect(parse({ day: 'thursday' }).rows[0].day).toBe(4);
    expect(parse({ day: 'SUN' }).rows[0].day).toBe(0);
  });

  it('IMP-04 times are H:MM or HH:MM, 24-hour', () => {
    expect(parseTime('8:30')).toBe(510);
    expect(parseTime('17:30')).toBe(1050);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('9.00')).toBeNull();
    expect(codes(parse({ start: '9am' }))).toContain('INVALID_TIME');
  });

  it('IMP-04 group is G<number> or empty', () => {
    expect(parse({ group: 'g2' }).rows[0].group).toBe('G2');
    expect(codes(parse({ group: 'X' }))).toContain('INVALID_GROUP');
  });

  it('IMP-04 an empty section is an error when the batch has other lettered sections', () => {
    const other = { row: 3, cells: cells({ section: 'B' }) };
    expect(codes(parse({}, [other]))).toContain('SECTION_REQUIRED');
  });

  it('IMP-05 teachers are DEPT:CODE joined with +, or TBA; a code with no department is an error', () => {
    expect(parseTeachers('CSE:AB + LAW:cd', 2).teachers).toEqual([
      { department_code: 'CSE', short_code: 'AB' },
      { department_code: 'LAW', short_code: 'CD' },
    ]);
    expect(parseTeachers('tba', 2)).toMatchObject({ tba: true, teachers: [] });
    expect(parseTeachers('AB', 2).issues[0].code).toBe('TEACHER_NO_DEPARTMENT');
  });

  it('IMP-11 missing fields, end before start and unknown or retired departments are errors', () => {
    expect(codes(parse({ room: '', course_code: '' }))).toContain('MISSING_FIELD');
    expect(codes(parse({ end: '8:00' }))).toContain('END_BEFORE_START');
    expect(codes(parse({ department: 'XYZ' }))).toContain('UNKNOWN_DEPARTMENT');
  });
});

const r = (over = {}) => ({
  row: 2,
  department_code: 'CSE',
  section_key: 'd1:4:I:A',
  group: null,
  day: 0,
  start_min: 540,
  end_min: 600,
  course_code: 'CSE-301',
  teachers: [{ department_code: 'CSE', short_code: 'AB' }],
  teacher_keys: ['CSE:AB'],
  tba: false,
  room_text: '311',
  room_id: 'room1',
  ...over,
});
const check = (rows, extra = {}) =>
  validateRows({
    rows,
    teacherEntries: [],
    directory: new Map([['CSE:AB', 'A B']]),
    others: [],
    ...extra,
  });
const has = (issues, code) => issues.filter((i) => i.code === code);

describe('validation (IMP-08 … IMP-22)', () => {
  it('IMP-08 an unknown teacher is an error', () => {
    const issues = check([r({ teachers: [{ department_code: 'CSE', short_code: 'AA' }] })]);
    expect(has(issues, 'UNKNOWN_TEACHER')[0]).toMatchObject({ severity: 'error', row: 2 });
  });

  it('IMP-09 the same teacher twice with different names is an error', () => {
    const e = (row, full_name) => ({ row, department_code: 'CSE', short_code: 'AB', full_name });
    const issues = check([], { teacherEntries: [e(2, 'A B'), e(3, 'Other Name')] });
    expect(has(issues, 'DUPLICATE_TEACHER')).toHaveLength(1);
  });

  it('IMP-10 an unresolved room is an error', () => {
    expect(has(check([r({ room_id: null })]), 'UNKNOWN_ROOM')).toHaveLength(1);
  });

  it('IMP-12/13/14 teacher, room and section overlaps are warnings', () => {
    const a = r({ row: 2 });
    const b = r({ row: 3, start_min: 570, end_min: 630 });
    const issues = check([a, b]);
    expect(has(issues, 'TEACHER_OVERLAP')[0].severity).toBe('warning');
    expect(has(issues, 'ROOM_OVERLAP')).toHaveLength(1);
    expect(has(issues, 'SECTION_OVERLAP')).toHaveLength(1);
  });

  it('IMP-14 a whole-section row overlaps a group row, but two different groups do not', () => {
    const whole = r({ row: 2, teacher_keys: [], teachers: [], room_id: 'r1', tba: true });
    const g1 = r({ row: 3, group: 'G1', teacher_keys: [], teachers: [], room_id: 'r2', tba: true });
    const g2 = r({ row: 4, group: 'G2', teacher_keys: [], teachers: [], room_id: 'r3', tba: true });
    const issues = check([whole, g1, g2]);
    expect(has(issues, 'SECTION_OVERLAP').map((i) => [i.row, i.related_rows[0]])).toEqual([
      [2, 3],
      [2, 4],
    ]);
  });

  it('IMP-15 a TBA teacher is a warning', () => {
    expect(
      has(check([r({ tba: true, teachers: [], teacher_keys: [] })]), 'TEACHER_TBA'),
    ).toHaveLength(1);
  });

  it('IMP-16 the same course and group twice in one day is a warning', () => {
    const issues = check([r({ row: 2 }), r({ row: 3, start_min: 700, end_min: 760 })]);
    expect(has(issues, 'DUPLICATE_COURSE_DAY')).toHaveLength(1);
  });

  it('IMP-17 before 08:30 or after 17:30 is a warning', () => {
    expect(has(check([r({ start_min: 480 })]), 'OUTSIDE_HOURS')).toHaveLength(1);
    expect(has(check([r({ end_min: 1080, start_min: 1000 })]), 'OUTSIDE_HOURS')).toHaveLength(1);
    expect(has(check([r()]), 'OUTSIDE_HOURS')).toHaveLength(0);
  });

  it('IMP-18/22 another department’s published slots are checked', () => {
    const other = {
      section_key: 'd1:4:I:A',
      day: 0,
      start_min: 540,
      end_min: 600,
      course_code: 'CSE-301',
      room_id: 'room1',
      teacher_keys: ['CSE:AB'],
      department_code: 'LAW',
    };
    const issues = check([r()], { others: [other] });
    expect(has(issues, 'CROSS_DEPARTMENT_DUPLICATE')).toHaveLength(1);
    expect(has(issues, 'ROOM_OVERLAP')).toHaveLength(1);
    expect(has(issues, 'TEACHER_OVERLAP')).toHaveLength(1);
  });

  it('IMP-20 a changed full name is a warning', () => {
    const e = { row: 2, department_code: 'CSE', short_code: 'AB', full_name: 'New Name' };
    expect(has(check([], { teacherEntries: [e] }), 'TEACHER_NAME_CHANGED')).toHaveLength(1);
  });

  it('IMP-21 identical teacher, room and time in two sections offers a combined class', () => {
    const a = r({ row: 2 });
    const b = r({ row: 3, section_key: 'd1:4:I:B' });
    const issues = check([a, b]);
    expect(has(issues, 'TEACHER_OVERLAP')[0].offer_combined).toBe(true);
    expect(has(issues, 'ROOM_OVERLAP')[0].offer_combined).toBe(true);
    // a different time in the same room is a plain overlap, not an offer
    const c = r({ row: 3, section_key: 'd1:4:I:B', end_min: 630 });
    expect(has(check([a, c]), 'ROOM_OVERLAP')[0].offer_combined).toBeUndefined();
  });
});

describe('diff (IMP-24)', () => {
  const slot = (over = {}) => ({
    id: 's1',
    section_key: 'k',
    group: null,
    day: 0,
    start_min: 540,
    end_min: 600,
    course_code: 'C',
    course_name: null,
    room_id: 'a',
    teacher_keys: ['CSE:AB'],
    tba: false,
    edited_by_hand: false,
    ...over,
  });

  it('IMP-24 added, removed and changed are matched on section, group, day, start and course', () => {
    const existing = [slot(), slot({ id: 's2', day: 1 }), slot({ id: 's3', day: 2 })];
    const rows = [
      slot({ room_id: 'b' }), // changed (room)
      slot({ day: 2 }), // same
      slot({ day: 3 }), // added
    ];
    const d = buildDiff(existing, rows);
    expect(d.changed.map((c) => c.slot.id)).toEqual(['s1']);
    expect(d.removed.map((s) => s.id)).toEqual(['s2']);
    expect(d.added).toHaveLength(1);
  });

  it('IMP-24 a change of start time is a removal plus an addition', () => {
    const d = buildDiff([slot()], [slot({ start_min: 600, end_min: 660 })]);
    expect(d.removed).toHaveLength(1);
    expect(d.added).toHaveLength(1);
    expect(d.changed).toHaveLength(0);
  });
});

describe('file type (IMP-02)', () => {
  it('IMP-02 a non-zip, an empty buffer and a macro workbook are refused', () => {
    expect(sniffXlsx(Buffer.from('hello'))).toBe(false);
    expect(sniffXlsx(Buffer.alloc(0))).toBe(false);
    const zip = (...names) =>
      Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from(names.join('\0'), 'latin1')]);
    expect(sniffXlsx(zip('xl/workbook.xml'))).toBe(true);
    expect(sniffXlsx(zip('xl/workbook.xml', 'xl/vbaProject.bin'))).toBe(false);
  });
});

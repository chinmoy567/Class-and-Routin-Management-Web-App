import ExcelJS from 'exceljs';
import { ROUTINE_COLUMNS, TEACHER_COLUMNS } from '@crm/shared';

/** Build a template workbook from rows of text. `routine` rows have the 12 columns in order. */
export async function workbook({ routine = [], teachers = [], routineHeader, extraSheets = [] }) {
  const wb = new ExcelJS.Workbook();
  const r = wb.addWorksheet('Routine');
  r.addRow(routineHeader ?? [...ROUTINE_COLUMNS]);
  for (const row of routine) r.addRow(row);
  const t = wb.addWorksheet('Teachers');
  t.addRow([...TEACHER_COLUMNS]);
  for (const row of teachers) t.addRow(row);
  for (const name of extraSheets) wb.addWorksheet(name);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A routine row: [dept, level, term, section, group, day, start, end, code, name, teachers, room]. */
export const row = (dept, over = {}) => {
  const v = {
    level: '4',
    term: 'I',
    section: 'A',
    group: '',
    day: 'Sunday',
    start: '9:00',
    end: '10:00',
    code: 'CSE-301',
    name: 'Algorithms',
    teachers: `${dept}:AB`,
    room: '311',
    ...over,
  };
  return [
    dept,
    v.level,
    v.term,
    v.section,
    v.group,
    v.day,
    v.start,
    v.end,
    v.code,
    v.name,
    v.teachers,
    v.room,
  ];
};

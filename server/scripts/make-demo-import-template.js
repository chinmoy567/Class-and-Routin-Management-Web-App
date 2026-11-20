import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ROUTINE_COLUMNS, TEACHER_COLUMNS } from '@crm/shared';

/**
 * Writes two routine import templates for the demo data (docs/demo-data.md), for the draft
 * semester run by the CSE admin. Rooms, teachers and departments are the ones `seed:demo` creates.
 *
 *   node server/scripts/make-demo-import-template.js
 *
 * - demo-routine-import-clean.xlsx: no errors, publishes straight away.
 * - demo-routine-import-with-mistakes.xlsx: the same rows plus one row for each check.
 */
const OUT = path.resolve(fileURLToPath(import.meta.url), '../../../docs/demo-import');

// Department, Level, Term, Section, Group, Day, Start, End, Course code, Course name, Teachers, Room
const clean = [
  [
    'CSE',
    '1',
    'I',
    'A',
    '',
    'Sunday',
    '8:30',
    '10:25',
    'CSE101',
    'Introduction to Programming',
    'CSE:RHN',
    'CSE-101',
  ],
  [
    'CSE',
    '1',
    'I',
    'A',
    '',
    'Monday',
    '8:30',
    '9:25',
    'CSE103',
    'Discrete Mathematics',
    'CSE:KRM',
    'CSE-101',
  ],
  [
    'CSE',
    '1',
    'I',
    'A',
    'G1',
    'Tuesday',
    '8:30',
    '11:25',
    'CSE102',
    'Programming Lab',
    'CSE:RHN',
    'Main Lab',
  ],
  [
    'CSE',
    '1',
    'I',
    'A',
    'G2',
    'Wednesday',
    '8:30',
    '11:25',
    'CSE102',
    'Programming Lab',
    'CSE:RHN',
    'CSE-LAB-1',
  ],
  [
    'CSE',
    '1',
    'I',
    'B',
    '',
    'Sunday',
    '11:35',
    '12:30',
    'CSE101',
    'Introduction to Programming',
    'CSE:RHN',
    'CSE-102',
  ],
  [
    'CSE',
    '1',
    'I',
    'B',
    '',
    'Monday',
    '10:30',
    '11:25',
    'CSE103',
    'Discrete Mathematics',
    'CSE:KRM',
    'CSE-102',
  ],
  [
    'CSE',
    '1',
    'I',
    'B',
    '',
    'Tuesday',
    '12:35',
    '15:30',
    'CSE102',
    'Programming Lab',
    'CSE:RHN',
    'CSE-LAB-2',
  ],
  [
    'CSE',
    '2',
    'I',
    'A',
    '',
    'Sunday',
    '8:30',
    '9:25',
    'CSE201',
    'Data Structures',
    'CSE:TNJ',
    'CSE-301',
  ],
  [
    'CSE',
    '2',
    'I',
    'A',
    '',
    'Monday',
    '9:30',
    '10:25',
    'CSE203',
    'Digital Logic Design',
    'CSE:MZR',
    'CSE-301',
  ],
  [
    'CSE',
    '2',
    'I',
    'A',
    '',
    'Tuesday',
    '8:30',
    '9:25',
    'CSE205',
    'Object Oriented Programming',
    'CSE:KRM',
    'CSE-301',
  ],
  [
    'CSE',
    '3',
    'I',
    'A',
    '',
    'Sunday',
    '9:30',
    '10:25',
    'CSE301',
    'Database Systems',
    'CSE:MZR',
    'CSE-302',
  ],
  [
    'CSE',
    '3',
    'I',
    'A',
    '',
    'Monday',
    '11:35',
    '12:30',
    'CSE305',
    'Computer Networks',
    'CSE:TNJ',
    'CSE-302',
  ],
  [
    'CSE',
    '3',
    'I',
    'A',
    '',
    'Wednesday',
    '8:30',
    '9:25',
    'CSE303',
    'Operating Systems',
    'CSE:KRM',
    'Seminar Room',
  ],
  // A class CSE teaches to a BBA batch: CSE owns the slot, the import creates BBA 3-II-A.
  [
    'BBA',
    '3',
    'II',
    'A',
    '',
    'Thursday',
    '8:30',
    '9:25',
    'CSE391',
    'Management Information Systems',
    'CSE:KRM',
    'CSE-201',
  ],
];

// One row per check the PRD lists. The comment says what the admin should see.
const mistakes = [
  // error: unknown teacher (AA is not on the Teachers sheet)
  [
    'CSE',
    '2',
    'I',
    'A',
    '',
    'Wednesday',
    '8:30',
    '9:25',
    'CSE207',
    'Algorithms',
    'CSE:AA',
    'CSE-301',
  ],
  // error: unknown room
  [
    'CSE',
    '2',
    'I',
    'A',
    '',
    'Wednesday',
    '9:30',
    '10:25',
    'CSE209',
    'Numerical Methods',
    'CSE:MZR',
    'BNK-999',
  ],
  // error: day outside Sunday to Thursday
  ['CSE', '1', 'I', 'A', '', 'Friday', '9:00', '10:00', 'CSE105', 'Seminar', 'CSE:KRM', 'CSE-101'],
  // error: end before start
  [
    'CSE',
    '3',
    'I',
    'A',
    '',
    'Thursday',
    '11:35',
    '10:30',
    'CSE307',
    'Compiler Design',
    'CSE:MZR',
    'CSE-302',
  ],
  // warning: teacher overlap (RHN is already in CSE-101 until 10:25 on Sunday)
  [
    'CSE',
    '2',
    'I',
    'A',
    '',
    'Sunday',
    '9:30',
    '10:25',
    'CSE211',
    'Software Engineering',
    'CSE:RHN',
    'CSE-301',
  ],
  // warning: room overlap (CSE-102 is in use on Sunday 11:35-12:30 by 1-I-B)
  [
    'CSE',
    '3',
    'I',
    'A',
    '',
    'Sunday',
    '11:35',
    '12:30',
    'CSE309',
    'Web Programming',
    'CSE:MZR',
    'CSE-102',
  ],
  // warning: teacher is TBA
  [
    'CSE',
    '2',
    'I',
    'A',
    '',
    'Thursday',
    '8:30',
    '9:25',
    'HUM201',
    'Technical Writing',
    'TBA',
    'CSE-301',
  ],
  // warning: starts before 8:30
  [
    'CSE',
    '1',
    'I',
    'B',
    '',
    'Thursday',
    '7:30',
    '8:25',
    'CSE105',
    'Computer Fundamentals',
    'CSE:KRM',
    'CSE-102',
  ],
  // warning: same course and group twice on one day (G1 lab on Tuesday already above)
  [
    'CSE',
    '1',
    'I',
    'A',
    'G1',
    'Tuesday',
    '14:35',
    '15:30',
    'CSE102',
    'Programming Lab',
    'CSE:KRM',
    'CSE-LAB-1',
  ],
  // warning: section overlap (1-I-A already has CSE101 on Sunday 8:30-10:25)
  [
    'CSE',
    '1',
    'I',
    'A',
    '',
    'Sunday',
    '9:30',
    '10:25',
    'MATH101',
    'Calculus I',
    'CSE:AHM',
    'CSE-202',
  ],
];

const teachers = [
  ['CSE', 'RHN', 'Md. Rahman'],
  ['CSE', 'KRM', 'Dr. Abdul Karim'],
  ['CSE', 'AHM', 'Farhana Ahmed'],
  ['CSE', 'TNJ', 'Tanjila Nowrin'],
  ['CSE', 'MZR', 'Mizanur Rahman'],
];

async function write(file, rows) {
  const wb = new ExcelJS.Workbook();
  const routine = wb.addWorksheet('Routine');
  const sheet = wb.addWorksheet('Teachers');
  routine.addRow([...ROUTINE_COLUMNS]);
  sheet.addRow([...TEACHER_COLUMNS]);
  // Text cells, so a label like `4-I` or a time never turns into a date.
  for (const r of rows) {
    const row = routine.addRow(r);
    row.eachCell({ includeEmpty: true }, (c) => (c.numFmt = '@'));
  }
  for (const t of teachers) sheet.addRow(t);
  routine.getRow(1).font = { bold: true };
  sheet.getRow(1).font = { bold: true };
  routine.columns.forEach((c) => (c.width = 16));
  sheet.columns.forEach((c) => (c.width = 20));
  await wb.xlsx.writeFile(path.join(OUT, file));
  console.log(`${file}: ${rows.length} routine rows`);
}

mkdirSync(OUT, { recursive: true });
await write('demo-routine-import-clean.xlsx', clean);
await write('demo-routine-import-with-mistakes.xlsx', [...clean, ...mistakes]);

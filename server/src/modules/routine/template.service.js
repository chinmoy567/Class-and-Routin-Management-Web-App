import ExcelJS from 'exceljs';
import { ROUTINE_COLUMNS, TEACHER_COLUMNS } from '@crm/shared';
import { assertCan } from '../../policy/index.js';
import { listActiveDepartments } from '../organisation/index.js';
import { listAdminRooms } from '../rooms/index.js';
import { resolveDepartmentScope } from './scope.js';

const DATA_ROWS = 500;

/**
 * IMP-01: the downloadable template. Text format on every data cell so `4-I` stays text,
 * drop-downs for Department, Level, Term, Day and Room, a Teachers sheet and instructions.
 */
export async function buildTemplate(actor, departmentId) {
  assertCan(actor, 'import.access');
  const deptId = departmentId ? resolveDepartmentScope(actor, departmentId) : null;
  if (deptId) assertCan(actor, 'import.manage', { department_id: deptId });

  const departments = await listActiveDepartments();
  const roomData = await listAdminRooms(actor, deptId ?? undefined);
  const roomNames = [
    ...new Set([
      ...roomData.owned.flatMap((r) => [r.code, ...r.aliases.map((a) => a.alias)]),
      ...roomData.shared_with_me.map((r) => r.code),
    ]),
  ];

  const wb = new ExcelJS.Workbook();
  const notes = wb.addWorksheet('Instructions');
  const routine = wb.addWorksheet('Routine');
  const teachers = wb.addWorksheet('Teachers');
  const lists = wb.addWorksheet('Lists');
  lists.state = 'hidden';

  [
    'Routine import template',
    'Fill the Routine sheet: one row per class. Do not change the header row.',
    'Department, Level (1-4), Term (I or II), Section (A-Z; leave empty for a one-section batch), Group (G1, G2 … or empty for the whole section).',
    'Day is Sunday to Thursday. Start and End are 24-hour times such as 8:30 or 14:00.',
    'Teachers are written DEPT:CODE, joined with + for shared classes (CSE:AB+CSE:CD), or TBA.',
    'Room is a room code or one of its aliases.',
    'List every teacher used in the Teachers sheet: department, short code and full name.',
  ].forEach((line, i) => {
    notes.getCell(i + 1, 1).value = line;
  });
  notes.getRow(1).font = { bold: true };
  notes.getColumn(1).width = 110;

  routine.addRow([...ROUTINE_COLUMNS]);
  routine.getRow(1).font = { bold: true };
  routine.views = [{ state: 'frozen', ySplit: 1 }];
  ROUTINE_COLUMNS.forEach((_, i) => {
    routine.getColumn(i + 1).width = i === 9 ? 28 : 14;
  });
  teachers.addRow([...TEACHER_COLUMNS]);
  teachers.getRow(1).font = { bold: true };
  [14, 14, 32].forEach((w, i) => {
    teachers.getColumn(i + 1).width = w;
  });

  lists.getCell(1, 1).value = 'Departments';
  departments.forEach((d, i) => {
    lists.getCell(i + 2, 1).value = d.code;
  });
  lists.getCell(1, 2).value = 'Rooms';
  roomNames.forEach((name, i) => {
    lists.getCell(i + 2, 2).value = name;
  });

  const list = (formulae) => ({
    type: 'list',
    allowBlank: true,
    showErrorMessage: false,
    formulae: [formulae],
  });
  const deptRange = `Lists!$A$2:$A$${Math.max(2, departments.length + 1)}`;
  const roomRange = `Lists!$B$2:$B$${Math.max(2, roomNames.length + 1)}`;
  for (let n = 2; n <= DATA_ROWS + 1; n++) {
    for (let c = 1; c <= ROUTINE_COLUMNS.length; c++) routine.getCell(n, c).numFmt = '@';
    for (let c = 1; c <= TEACHER_COLUMNS.length; c++) teachers.getCell(n, c).numFmt = '@';
    routine.getCell(n, 1).dataValidation = list(deptRange);
    routine.getCell(n, 2).dataValidation = list('"1,2,3,4"');
    routine.getCell(n, 3).dataValidation = list('"I,II"');
    routine.getCell(n, 6).dataValidation = list('"Sunday,Monday,Tuesday,Wednesday,Thursday"');
    routine.getCell(n, 12).dataValidation = list(roomRange);
    teachers.getCell(n, 1).dataValidation = list(deptRange);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

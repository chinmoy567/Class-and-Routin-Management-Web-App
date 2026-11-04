import ExcelJS from 'exceljs';
import { ROUTINE_COLUMNS, TEACHER_COLUMNS } from '@crm/shared';

const ROUTINE_KEYS = [
  'department',
  'level',
  'term',
  'section',
  'group',
  'day',
  'start',
  'end',
  'course_code',
  'course_name',
  'teachers',
  'room',
];
const TEACHER_KEYS = ['department', 'short_code', 'full_name'];
const MAX_ROWS = 5000;

/**
 * IMP-02: is this a plain `.xlsx`? Decided from the content, never from the file name or the
 * Content-Type header. A zip with a workbook part and no macro project (`.xlsm`) passes.
 */
export function sniffXlsx(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04)) {
    return false;
  }
  // Zip entry names are stored uncompressed, so they can be found in the raw bytes.
  const latin = buffer.toString('latin1');
  return latin.includes('xl/workbook.xml') && !latin.includes('vbaProject.bin');
}

const pad = (n) => String(n).padStart(2, '0');

function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // A time typed into Excel arrives as a Date; its clock part is in UTC.
    return `${v.getUTCHours()}:${pad(v.getUTCMinutes())}`;
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.richText))
      return v.richText
        .map((p) => p.text)
        .join('')
        .trim();
    if ('result' in v) return String(v.result ?? '').trim();
    if ('text' in v) return String(v.text ?? '').trim();
    return '';
  }
  return String(v).trim();
}

const sheetNamed = (wb, name) =>
  wb.worksheets.find((w) => w.name.trim().toLowerCase() === name.toLowerCase());

function readSheet(ws, columns, keys) {
  const header = ws.getRow(1);
  const bad = columns.some(
    (c, i) => cellText(header.getCell(i + 1)).toLowerCase() !== c.toLowerCase(),
  );
  if (bad) return null;
  const out = [];
  const last = Math.min(ws.rowCount, MAX_ROWS + 1);
  for (let n = 2; n <= last; n++) {
    const r = ws.getRow(n);
    const cells = {};
    let any = false;
    keys.forEach((key, i) => {
      cells[key] = cellText(r.getCell(i + 1));
      if (cells[key]) any = true;
    });
    if (any) out.push({ row: n, cells });
  }
  return out;
}

/**
 * Read the Routine and Teachers sheets as plain text. Returns `{ routine, teachers }`, or null
 * when the file cannot be read as a template.
 */
export async function readTemplate(buffer) {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const routineSheet = sheetNamed(wb, 'Routine');
    if (!routineSheet) return null;
    const routine = readSheet(routineSheet, ROUTINE_COLUMNS, ROUTINE_KEYS);
    if (!routine) return null;
    const teacherSheet = sheetNamed(wb, 'Teachers');
    const teachers = teacherSheet ? readSheet(teacherSheet, TEACHER_COLUMNS, TEACHER_KEYS) : [];
    if (!teachers) return null;
    return { routine, teachers };
  } catch {
    return null;
  }
}

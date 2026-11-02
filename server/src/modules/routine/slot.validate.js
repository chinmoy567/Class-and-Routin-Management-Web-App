// EDT-04: build one normalised row from a request body and run the import's checks on it.
import { parseTeachers, parseTime, makeIssue } from './parse.js';
import { teacherKey, validateRows } from './validate.js';
import { loadSlots, sectionKey } from './slots.loader.js';
import { SectionGroup } from './routine.model.js';
import { departmentNames, listActiveDepartments } from '../organisation/index.js';
import { resolve as resolveRoom } from '../rooms/index.js';
import { directoryFor } from '../teachers/index.js';

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const strip = ({ row: _row, related_rows: _related, ...issue }) => issue;

/**
 * `section`: `{ id, semester_id, department_id, level, term, letter }`. `ownerCode`: the code
 * of the department that will own the slot. `excludeSlotId`: the slot being edited, so it
 * never clashes with itself.
 * Returns `{ errors, warnings, row, others, roomId, groupId, teacherIds }`.
 */
export async function checkSlot({ body, section, ownerCode, excludeSlotId = null }) {
  const raw = [];
  const bad = (code, message, field) => raw.push(makeIssue('error', code, 1, message, { field }));

  for (const [field, value] of [
    ['day_of_week', body.day_of_week],
    ['start', body.start],
    ['end', body.end],
    ['course_code', body.course_code],
    ['room', body.room],
  ]) {
    if (blank(value)) bad('MISSING_FIELD', `${field} is required.`, field);
  }
  const teachersGiven =
    body.teachers === 'TBA' || (Array.isArray(body.teachers) && body.teachers.length);
  if (!teachersGiven) bad('MISSING_FIELD', 'teachers is required (or TBA).', 'teachers');

  let day = null;
  if (!blank(body.day_of_week)) {
    if (Number.isInteger(body.day_of_week) && body.day_of_week >= 0 && body.day_of_week <= 4) {
      day = body.day_of_week;
    } else bad('INVALID_DAY', 'The day must be Sunday to Thursday.', 'day_of_week');
  }
  let startMin = null;
  let endMin = null;
  if (!blank(body.start)) {
    startMin = parseTime(body.start);
    if (startMin === null) bad('INVALID_TIME', 'The start time must be HH:MM.', 'start');
  }
  if (!blank(body.end)) {
    endMin = parseTime(body.end);
    if (endMin === null) bad('INVALID_TIME', 'The end time must be HH:MM.', 'end');
  }
  if (startMin !== null && endMin !== null && endMin <= startMin) {
    bad('INVALID_TIME', 'The end time must be after the start time.', 'end');
  }

  let teachers = [];
  let tba = false;
  if (teachersGiven) {
    const text = body.teachers === 'TBA' ? 'TBA' : body.teachers.join('+');
    const parsed = parseTeachers(text, 1);
    teachers = parsed.teachers;
    tba = parsed.tba;
    for (const i of parsed.issues) raw.push({ ...i, field: 'teachers' });
  }

  let groupLabel = null;
  let groupId = null;
  if (!blank(body.group)) {
    const g = /^G(\d+)$/i.exec(String(body.group).trim());
    groupLabel = g ? `G${Number(g[1])}` : String(body.group).trim();
    const found = g
      ? await SectionGroup.findOne({ section_id: section.id, label: groupLabel }).lean()
      : null;
    if (found) groupId = String(found._id);
    else bad('UNKNOWN_GROUP', `The section has no group "${groupLabel}".`, 'group');
  }

  const room = blank(body.room) ? null : await resolveRoom(String(body.room));
  const row = {
    row: 1,
    section_key: sectionKey(section),
    group: groupLabel,
    day,
    start_min: startMin,
    end_min: endMin,
    course_code: blank(body.course_code) ? '' : String(body.course_code).trim(),
    course_name: blank(body.course_name) ? null : String(body.course_name).trim(),
    room_text: blank(body.room) ? '' : String(body.room).trim(),
    room_id: room?.id ?? null,
    teachers,
    tba,
    teacher_keys: teachers.map(teacherKey),
  };

  // IMP-08: the saved directory, keyed by `DEPT:CODE` for the checks and by id for the links.
  const departments = await listActiveDepartments();
  const deptByCode = new Map(departments.map((d) => [d.code.toUpperCase(), d.id]));
  const codeByDept = new Map(departments.map((d) => [d.id, d.code.toUpperCase()]));
  const pairs = teachers
    .filter((t) => deptByCode.has(t.department_code))
    .map((t) => ({ department_id: deptByCode.get(t.department_code), short_code: t.short_code }));
  const saved = await directoryFor(pairs);
  const directory = new Map();
  const idByKey = new Map();
  for (const [key, rec] of saved) {
    const [deptId, code] = key.split(':');
    directory.set(`${codeByDept.get(deptId)}:${code}`, rec.full_name);
    idByKey.set(`${codeByDept.get(deptId)}:${code}`, rec.id);
  }

  const filter = { semester_id: section.semester_id, published: true };
  if (excludeSlotId) filter._id = { $ne: excludeSlotId };
  if (day !== null) filter.day_of_week = day;
  const loaded = await loadSlots(filter);
  const owners = await departmentNames(loaded.map((s) => s.owner_department_id));
  const others = loaded.map((s) => ({
    ...s,
    department_code: owners.get(s.owner_department_id)?.code ?? '',
  }));

  const issues = validateRows({
    rows: [row],
    teacherEntries: [],
    directory,
    others,
    single: { department_code: ownerCode },
  });
  const all = [...raw, ...issues].map(strip);
  return {
    errors: all.filter((i) => i.severity === 'error'),
    warnings: all.filter((i) => i.severity === 'warning'),
    row,
    others,
    roomId: room?.id ?? null,
    groupId,
    teacherIds: row.teacher_keys.map((k) => idByKey.get(k)).filter(Boolean),
  };
}

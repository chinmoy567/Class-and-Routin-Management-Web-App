// IMP-04, IMP-05, IMP-11: turn the raw text of a Routine sheet into normalised rows and errors.
// Pure functions: no database, no clock.

const DAYS = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/** IMP-04: `H:MM` or `HH:MM`, 24-hour. Returns minutes since midnight or null. */
export function parseTime(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export const formatTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function makeIssue(severity, code, row, message, extra = {}) {
  return { severity, code, row, message, related_rows: [], ...extra };
}
const err = (code, row, message, extra) => makeIssue('error', code, row, message, extra);

/** IMP-05: `DEPT:CODE+DEPT:CODE` or `TBA`. */
export function parseTeachers(text, row) {
  const issues = [];
  const parts = String(text ?? '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 1 && parts[0].toUpperCase() === 'TBA') {
    return { teachers: [], tba: true, issues };
  }
  const teachers = [];
  for (const part of parts) {
    if (part.toUpperCase() === 'TBA') {
      issues.push(err('INVALID_TEACHERS', row, 'TBA cannot be mixed with other teachers.'));
      continue;
    }
    const m = /^([^:\s]+)\s*:\s*([^:\s]+)$/.exec(part);
    if (m) {
      teachers.push({ department_code: m[1].toUpperCase(), short_code: m[2].toUpperCase() });
    } else if (/^[^:\s]+$/.test(part)) {
      issues.push(
        err('TEACHER_NO_DEPARTMENT', row, `Teacher "${part}" needs a department (DEPT:CODE).`),
      );
    } else {
      issues.push(err('INVALID_TEACHERS', row, `Cannot read the teacher "${part}".`));
    }
  }
  return { teachers, tba: false, issues };
}

const REQUIRED = [
  ['department', 'Department'],
  ['level', 'Level'],
  ['term', 'Term'],
  ['day', 'Day'],
  ['start', 'Start'],
  ['end', 'End'],
  ['course_code', 'Course code'],
  ['teachers', 'Teachers'],
  ['room', 'Room'],
];

const batchKey = (r) => `${r.department_code}|${r.level}|${r.term}`;

/**
 * `raw` is `[{ row, cells }]` with every cell as trimmed text. `activeDepartments` is a Map of
 * upper-case code to `{ id }`. Returns `{ rows, issues }`.
 */
export function parseRoutineRows(raw, { activeDepartments }) {
  const issues = [];
  const staged = [];

  for (const { row, cells: c } of raw) {
    const missing = REQUIRED.filter(([key]) => !c[key]).map(([, label]) => label);
    if (missing.length) {
      issues.push(
        err('MISSING_FIELD', row, `Missing: ${missing.join(', ')}.`, { fields: missing }),
      );
    }

    const department_code = c.department.toUpperCase();
    if (c.department && !activeDepartments.has(department_code)) {
      issues.push(
        err('UNKNOWN_DEPARTMENT', row, `Unknown or retired department "${c.department}".`),
      );
    }

    let level = null;
    if (c.level) {
      if (/^[1-4]$/.test(c.level)) level = Number(c.level);
      else issues.push(err('INVALID_LEVEL', row, `Level "${c.level}" must be 1 to 4.`));
    }

    let term = null;
    if (c.term) {
      const t = c.term.toUpperCase();
      if (t === 'I' || t === '1') term = 'I';
      else if (t === 'II' || t === '2') term = 'II';
      else issues.push(err('INVALID_TERM', row, `Term "${c.term}" must be I or II.`));
    }

    let letter = null;
    if (c.section) {
      if (/^[A-Za-z]$/.test(c.section)) letter = c.section.toUpperCase();
      else
        issues.push(err('INVALID_SECTION', row, `Section "${c.section}" must be one letter A-Z.`));
    }

    let group = null;
    if (c.group) {
      const g = /^G(\d+)$/i.exec(c.group);
      if (g) group = `G${Number(g[1])}`;
      else issues.push(err('INVALID_GROUP', row, `Group "${c.group}" must look like G1.`));
    }

    let day = null;
    if (c.day) {
      day = DAYS[c.day.toLowerCase()] ?? null;
      if (day === null) issues.push(err('INVALID_DAY', row, `Cannot read the day "${c.day}".`));
      else if (day > 4) {
        issues.push(err('DAY_OUTSIDE_WEEK', row, `"${c.day}" is outside Sunday to Thursday.`));
        day = null;
      }
    }

    const start_min = c.start ? parseTime(c.start) : null;
    const end_min = c.end ? parseTime(c.end) : null;
    if (c.start && start_min === null) {
      issues.push(err('INVALID_TIME', row, `Cannot read the start time "${c.start}".`));
    }
    if (c.end && end_min === null) {
      issues.push(err('INVALID_TIME', row, `Cannot read the end time "${c.end}".`));
    }
    if (start_min !== null && end_min !== null && end_min <= start_min) {
      issues.push(err('END_BEFORE_START', row, 'The end time must be after the start time.'));
    }

    const t = c.teachers
      ? parseTeachers(c.teachers, row)
      : { teachers: [], tba: false, issues: [] };
    issues.push(...t.issues);

    staged.push({
      row,
      department_code,
      department_id: activeDepartments.get(department_code)?.id ?? null,
      level,
      term,
      letter,
      group,
      day,
      start_min,
      end_min,
      course_code: c.course_code.toUpperCase(),
      course_name: c.course_name || null,
      teachers: t.teachers,
      tba: t.tba,
      room_text: c.room,
    });
  }

  // IMP-04: an empty section letter is `A` when the batch has one section only.
  const letters = new Set();
  for (const r of staged) {
    if (r.letter && r.department_id && r.level && r.term) letters.add(batchKey(r));
  }
  for (const r of staged) {
    if (r.letter || !r.department_id || !r.level || !r.term) continue;
    if (letters.has(batchKey(r))) {
      issues.push(
        err(
          'SECTION_REQUIRED',
          r.row,
          'Write the section letter: this batch has several sections.',
        ),
      );
    } else {
      r.letter = 'A';
    }
  }

  for (const r of staged) {
    r.section_key =
      r.department_id && r.level && r.term && r.letter
        ? `${r.department_id}:${r.level}:${r.term}:${r.letter}`
        : null;
  }
  return { rows: staged, issues };
}

/** IMP-07: the Teachers sheet. `raw` is `[{ row, cells }]`. */
export function parseTeacherSheet(raw, { activeDepartments }) {
  const issues = [];
  const entries = [];
  for (const { row, cells: c } of raw) {
    if (!c.department || !c.short_code || !c.full_name) {
      issues.push(
        err(
          'MISSING_FIELD',
          row,
          'Teachers sheet: department, short code and full name are required.',
        ),
      );
      continue;
    }
    const department_code = c.department.toUpperCase();
    const dept = activeDepartments.get(department_code);
    if (!dept) {
      issues.push(
        err('UNKNOWN_DEPARTMENT', row, `Unknown or retired department "${c.department}".`),
      );
      continue;
    }
    const short_code = c.short_code.toUpperCase();
    if (short_code === 'TBA') {
      issues.push(err('INVALID_TEACHERS', row, 'TBA is reserved and cannot be a short code.'));
      continue;
    }
    entries.push({
      row,
      department_code,
      department_id: dept.id,
      short_code,
      full_name: c.full_name.replace(/\s+/g, ' '),
    });
  }
  return { entries, issues };
}

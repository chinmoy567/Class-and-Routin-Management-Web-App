// IMP-08 … IMP-22: errors and warnings over the parsed rows. Pure functions.
import { formatTime, makeIssue } from './parse.js';

export const EARLIEST_START = 8 * 60 + 30; // IMP-17
export const LATEST_END = 17 * 60 + 30;

export const teacherKey = (t) => `${t.department_code}:${t.short_code}`;
const overlaps = (a, b) => a.start_min < b.end_min && b.start_min < a.end_min;
const usable = (r) =>
  r.day !== null && r.start_min !== null && r.end_min !== null && r.end_min > r.start_min;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const slotLabel = (r) => `${formatTime(r.start_min)}-${formatTime(r.end_min)}`;

/** Does the group of `a` clash with the group of `b`? A whole-section row clashes with all. */
const groupsClash = (a, b) => a.group === null || b.group === null || a.group === b.group;

/**
 * `rows`: normalised rows with `room_id` (null when unknown). `teacherEntries`: the Teachers
 * sheet. `directory`: Map `DEPT:CODE` to the saved full name. `others`: other departments'
 * published slots of this semester, as `{ section_key, group, day, start_min, end_min,
 * course_code, room_id, teacher_keys, department_code }`.
 * Returns the issue list (without ids).
 */
export function validateRows({ rows, teacherEntries, directory, others }) {
  const issues = [];
  const add = (severity, code, row, message, extra) =>
    issues.push(makeIssue(severity, code, row, message, extra));

  // IMP-09, IMP-20: the Teachers sheet.
  const sheet = new Map();
  for (const e of teacherEntries) {
    const key = `${e.department_code}:${e.short_code}`;
    const seen = sheet.get(key);
    if (seen && seen.full_name !== e.full_name) {
      add(
        'error',
        'DUPLICATE_TEACHER',
        e.row,
        `${key} appears twice with different names ("${seen.full_name}" and "${e.full_name}").`,
        { related_rows: [seen.row] },
      );
      continue;
    }
    if (!seen) sheet.set(key, e);
  }
  for (const [key, e] of sheet) {
    const saved = directory.get(key);
    if (saved !== undefined && saved !== e.full_name) {
      add(
        'warning',
        'TEACHER_NAME_CHANGED',
        e.row,
        `${key}: the saved name "${saved}" will change to "${e.full_name}".`,
      );
    }
  }

  // IMP-08, IMP-10, IMP-15
  for (const r of rows) {
    for (const t of r.teachers) {
      const key = teacherKey(t);
      if (!sheet.has(key) && !directory.has(key)) {
        add('error', 'UNKNOWN_TEACHER', r.row, `Unknown teacher ${key}.`);
      }
    }
    if (r.room_text && !r.room_id) {
      add('error', 'UNKNOWN_ROOM', r.row, `Unknown room "${r.room_text}".`);
    }
    if (r.tba) add('warning', 'TEACHER_TBA', r.row, 'The teacher is TBA.');
  }

  const ok = rows.filter(usable);

  // IMP-17
  for (const r of ok) {
    if (r.start_min < EARLIEST_START || r.end_min > LATEST_END) {
      add('warning', 'OUTSIDE_HOURS', r.row, `Class ${slotLabel(r)} is outside 08:30-17:30.`);
    }
  }

  // IMP-16
  const seenCourse = new Map();
  for (const r of ok) {
    const key = `${r.section_key}|${r.group}|${r.day}|${r.course_code}`;
    const first = seenCourse.get(key);
    if (first) {
      add('warning', 'DUPLICATE_COURSE_DAY', r.row, `${r.course_code} appears twice on one day.`, {
        related_rows: [first.row],
      });
    } else seenCourse.set(key, r);
  }

  // IMP-12, IMP-13, IMP-14, IMP-21: overlaps inside the file.
  const byDay = new Map();
  for (const r of ok) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  for (const list of byDay.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!overlaps(a, b)) continue;
        const ta = a.teachers.map(teacherKey);
        const tb = b.teachers.map(teacherKey);
        const shared = ta.filter((k) => tb.includes(k));
        const sameRoom = a.room_id && a.room_id === b.room_id;
        const identical =
          sameRoom &&
          a.start_min === b.start_min &&
          a.end_min === b.end_min &&
          !a.tba &&
          !b.tba &&
          sameSet(ta, tb);
        const offer = identical && (a.section_key !== b.section_key || a.group !== b.group);
        const pair = { related_rows: [b.row], ...(offer ? { offer_combined: true } : {}) };
        if (shared.length) {
          add(
            'warning',
            'TEACHER_OVERLAP',
            a.row,
            `${shared.join(', ')} has two classes at the same time.`,
            pair,
          );
        }
        if (sameRoom) {
          add('warning', 'ROOM_OVERLAP', a.row, `Room ${a.room_text} is used twice at the same time.`, pair);
        }
        if (a.section_key === b.section_key && groupsClash(a, b)) {
          add('warning', 'SECTION_OVERLAP', a.row, 'The section has two classes at the same time.', {
            related_rows: [b.row],
          });
        }
      }
    }
  }

  // IMP-18, IMP-22: against other departments' published slots.
  for (const r of ok) {
    const rk = r.teachers.map(teacherKey);
    for (const o of others) {
      if (o.day !== r.day || !overlaps(r, o)) continue;
      if (r.section_key && o.section_key === r.section_key && o.course_code === r.course_code) {
        add(
          'warning',
          'CROSS_DEPARTMENT_DUPLICATE',
          r.row,
          `${o.department_code} already has ${r.course_code} for this section at this time.`,
          { other_department: o.department_code },
        );
      }
      if (r.room_id && o.room_id === r.room_id) {
        add(
          'warning',
          'ROOM_OVERLAP',
          r.row,
          `Room ${r.room_text} is used by ${o.department_code} at this time.`,
          { other_department: o.department_code },
        );
      }
      const shared = rk.filter((k) => o.teacher_keys.includes(k));
      if (shared.length) {
        add(
          'warning',
          'TEACHER_OVERLAP',
          r.row,
          `${shared.join(', ')} teaches for ${o.department_code} at this time.`,
          { other_department: o.department_code },
        );
      }
    }
  }

  return issues;
}

/** Order errors first, then number the issues; the number is the issue id used by the API. */
export function numberIssues(issues) {
  const rank = (i) => (i.severity === 'error' ? 0 : 1);
  return [...issues]
    .sort((a, b) => rank(a) - rank(b) || a.row - b.row)
    .map((issue, index) => ({ ...issue, id: String(index) }));
}

export const countIssues = (issues) => ({
  errors: issues.filter((i) => i.severity === 'error').length,
  warnings: issues.filter((i) => i.severity === 'warning' && !i.confirmed).length,
});

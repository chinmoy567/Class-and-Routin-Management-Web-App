// IMP-24: what a re-import would change in one department's own slots. Pure functions.

const keyOf = (s) => [s.section_key, s.group ?? '', s.day, s.start_min, s.course_code].join('|');
const teacherSig = (s) => [...s.teacher_keys].sort().join('+');
const sigOf = (s) =>
  [s.end_min, s.room_id, teacherSig(s), s.tba ? 1 : 0, s.course_name ?? ''].join('|');

/**
 * `existing`: the department's published slots as `{ id, section_key, group, day, start_min,
 * end_min, course_code, course_name, room_id, teacher_keys, tba, edited_by_hand }`.
 * `rows`: the new normalised rows with `teacher_keys`. Matching is on section, group, day, start
 * time and course code; a change of room, teacher, end time or name is "changed". When a key
 * appears more than once, the entries are matched in order.
 */
export function buildDiff(existing, rows) {
  const pool = new Map();
  for (const s of existing) {
    const k = keyOf(s);
    pool.set(k, [...(pool.get(k) ?? []), s]);
  }
  const added = [];
  const changed = [];
  for (const row of rows) {
    const list = pool.get(keyOf(row));
    const match = list?.shift();
    if (!match) added.push(row);
    else if (sigOf(match) !== sigOf(row)) changed.push({ slot: match, row });
  }
  const removed = [...pool.values()].flat();
  return { added, removed, changed };
}

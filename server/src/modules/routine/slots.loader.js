import { RoutineSlot, RoutineSlotTeacher, Section, SectionGroup } from './routine.model.js';
import { teachersByIds } from '../teachers/index.js';
import { departmentNames } from '../organisation/index.js';

export const sectionKey = (s) => `${s.department_id}:${s.level}:${s.term}:${s.letter}`;

/**
 * Slots in the shape the checks and the diff use:
 * `{ id, owner_department_id, section_id, section_key, group, day, start_min, end_min,
 *    course_code, course_name, room_id, teacher_ids, teacher_keys, tba, edited_by_hand }`.
 * `teacher_keys` are `DEPT:CODE`.
 */
export async function loadSlots(filter, { session } = {}) {
  const slots = await RoutineSlot.find(filter).session(session ?? null).lean();
  if (!slots.length) return [];
  const slotIds = slots.map((s) => s._id);
  const [links, sections, groups] = await Promise.all([
    RoutineSlotTeacher.find({ slot_id: { $in: slotIds } }).session(session ?? null).lean(),
    Section.find({ _id: { $in: [...new Set(slots.map((s) => String(s.section_id)))] } })
      .session(session ?? null)
      .lean(),
    SectionGroup.find({ _id: { $in: slots.map((s) => s.group_id).filter(Boolean) } })
      .session(session ?? null)
      .lean(),
  ]);
  const teachers = await teachersByIds([...new Set(links.map((l) => String(l.teacher_id)))]);
  const names = await departmentNames(teachers.map((t) => t.department_id));
  const keyOfTeacher = new Map(
    teachers.map((t) => [
      String(t._id),
      `${names.get(String(t.department_id))?.code ?? ''}:${t.short_code}`,
    ]),
  );
  const sectionById = new Map(sections.map((s) => [String(s._id), s]));
  const groupById = new Map(groups.map((g) => [String(g._id), g.label]));
  const teachersOf = new Map();
  for (const l of links) {
    const list = teachersOf.get(String(l.slot_id)) ?? [];
    list.push(String(l.teacher_id));
    teachersOf.set(String(l.slot_id), list);
  }
  return slots.map((s) => {
    const ids = teachersOf.get(String(s._id)) ?? [];
    return {
      id: String(s._id),
      owner_department_id: String(s.owner_department_id),
      section_id: String(s.section_id),
      section_key: sectionById.has(String(s.section_id))
        ? sectionKey(sectionById.get(String(s.section_id)))
        : null,
      group: s.group_id ? (groupById.get(String(s.group_id)) ?? null) : null,
      day: s.day_of_week,
      start_min: s.start_min,
      end_min: s.end_min,
      course_code: s.course_code,
      course_name: s.course_name ?? null,
      room_id: String(s.room_id),
      teacher_ids: ids,
      teacher_keys: ids.map((i) => keyOfTeacher.get(i)).filter(Boolean),
      tba: Boolean(s.tba),
      edited_by_hand: Boolean(s.edited_by_hand),
    };
  });
}

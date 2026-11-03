import { RoutineSlot, Section } from './routine.model.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']; // day_of_week 0..4 (Sunday to Thursday)

/**
 * EML-06: one short line per changed section for the routine-change email, for example
 * "3-II-A (Sun, Tue): CSE 301, CSE 305". A section with no classes left says so.
 */
export async function describeSections(sectionIds, semesterId) {
  if (sectionIds.length === 0) return [];
  const sections = await Section.find({ _id: { $in: sectionIds } }).lean();
  const slots = await RoutineSlot.find({ section_id: { $in: sectionIds }, semester_id: semesterId })
    .select('section_id day_of_week course_code')
    .lean();
  return sections.map((s) => {
    const label = `${s.level}-${s.term}-${s.letter}`;
    const mine = slots.filter((x) => String(x.section_id) === String(s._id));
    if (mine.length === 0) return `${label}: no classes this semester`;
    const days = [...new Set(mine.map((x) => x.day_of_week))].sort((a, b) => a - b);
    const courses = [...new Set(mine.map((x) => x.course_code))];
    return `${label} (${days.map((d) => DAYS[d]).join(', ')}): ${courses.join(', ')}`;
  });
}

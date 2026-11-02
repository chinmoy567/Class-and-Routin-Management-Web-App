// EDT-01, EDT-07: the section grid, and sections and groups added by hand.
import { RoutineSlot, Section, SectionGroup } from './routine.model.js';
import { loadSlots } from './slots.loader.js';
import { idOk, resolveDepartmentScope } from './scope.js';
import { openSemester } from './slot.service.js';
import { formatTime } from './parse.js';
import { assertCan, can } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { record } from '../audit/index.js';
import { departmentNames, getSemester } from '../organisation/index.js';
import { roomCodes } from '../rooms/index.js';
import { fullNames } from '../teachers/index.js';

// EDT-07: spec 10 (enrolments) registers `{ inUse(groupId) => boolean }`.
const groupUsage = [];
export const registerGroupUsage = ({ inUse } = {}) => {
  if (inUse) groupUsage.push(inUse);
};
/** For tests: forget every registered provider. */
export const resetGroupUsage = () => {
  groupUsage.length = 0;
};

const conflict = (message) => new AppError(409, 'CONFLICT', message);
const isDuplicate = (err) => err?.code === 11000;
const letters = (s) => `${s.level}-${s.term}-${s.letter}`;

async function loadSectionDoc(id) {
  const s = idOk(id) ? await Section.findById(id).lean() : null;
  if (!s) throw notFound('Section not found.');
  return s;
}

/** Any active admin may look at any section of the semester (read only). */
export async function listSections(actor, semesterId, departmentId) {
  assertCan(actor, 'slot.view');
  const semester = idOk(semesterId) ? await getSemester(semesterId) : null;
  if (!semester) throw notFound('Semester not found.');
  const filter = { semester_id: semesterId };
  if (departmentId) filter.department_id = departmentId;
  const sections = await Section.find(filter).lean();
  const groups = await SectionGroup.find({ section_id: { $in: sections.map((s) => s._id) } })
    .sort({ label: 1 })
    .lean();
  const names = await departmentNames(sections.map((s) => s.department_id));
  return sections
    .map((s) => ({
      id: String(s._id),
      department_id: String(s.department_id),
      department_code: names.get(String(s.department_id))?.code ?? '',
      level: s.level,
      term: s.term,
      letter: s.letter,
      name: `${names.get(String(s.department_id))?.code ?? ''} ${letters(s)}`,
      groups: groups
        .filter((g) => String(g.section_id) === String(s._id))
        .map((g) => ({ id: String(g._id), label: g.label })),
      can_manage: can(actor, 'section.manage', { department_id: String(s.department_id) }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** EDT-01: the published slots of a section, with who owns each and whether the actor may edit. */
export async function sectionRoutine(actor, sectionId) {
  assertCan(actor, 'slot.view');
  const section = await loadSectionDoc(sectionId);
  const semester = await getSemester(String(section.semester_id));
  const slots = await loadSlots({ section_id: section._id, published: true });
  const [owners, rooms, teachers, groups] = await Promise.all([
    departmentNames(slots.map((s) => s.owner_department_id)),
    roomCodes(slots.map((s) => s.room_id)),
    fullNames(slots.flatMap((s) => s.teacher_ids)),
    SectionGroup.find({ section_id: section._id }).sort({ label: 1 }).lean(),
  ]);
  return {
    section: {
      id: String(section._id),
      semester_id: String(section.semester_id),
      semester_status: semester?.status ?? null,
      department_id: String(section.department_id),
      level: section.level,
      term: section.term,
      letter: section.letter,
      groups: groups.map((g) => ({ id: String(g._id), label: g.label })),
      can_manage: can(actor, 'section.manage', { department_id: String(section.department_id) }),
    },
    slots: slots
      .sort((a, b) => a.day - b.day || a.start_min - b.start_min)
      .map((s) => ({
        id: s.id,
        group: s.group,
        day_of_week: s.day,
        start: formatTime(s.start_min),
        end: formatTime(s.end_min),
        course_code: s.course_code,
        course_name: s.course_name,
        room: rooms.get(s.room_id) ?? '',
        teachers: s.tba ? 'TBA' : s.teacher_ids.map((t) => teachers.get(t) ?? ''),
        owner_department: {
          id: s.owner_department_id,
          code: owners.get(s.owner_department_id)?.code ?? '',
        },
        editable:
          Boolean(semester) &&
          ['draft', 'current'].includes(semester.status) &&
          can(actor, 'slot.manage', { department_id: s.owner_department_id }),
        version: s.version,
        combined: Boolean(s.combined_key),
        edited_by_hand: s.edited_by_hand,
      })),
  };
}

const sectionView = (s) => ({
  id: String(s._id),
  semester_id: String(s.semester_id),
  department_id: String(s.department_id),
  level: s.level,
  term: s.term,
  letter: s.letter,
});

/** EDT-07: a section of the admin's own department's batch. */
export async function createSection(actor, body) {
  assertCan(actor, 'slot.view');
  const deptId = resolveDepartmentScope(actor, body.department_id);
  assertCan(actor, 'section.manage', { department_id: deptId });
  const semester = await openSemester(body.semester_id);
  if (!(await departmentNames([deptId])).has(deptId)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      department_id: 'Choose an active department',
    });
  }
  try {
    return await withTransaction(async (session) => {
      const [created] = await Section.create(
        [
          {
            semester_id: semester.id,
            department_id: deptId,
            level: body.level,
            term: body.term,
            letter: body.letter.toUpperCase(),
          },
        ],
        { session },
      );
      await record({
        actor,
        action: 'section.create',
        scope_department_id: deptId,
        target: { type: 'section', id: created._id },
        new_value: sectionView(created),
        session,
      });
      return { ...sectionView(created), groups: [] };
    });
  } catch (err) {
    if (isDuplicate(err)) throw conflict('That section already exists.');
    throw err;
  }
}

async function loadGroup(actor, id) {
  assertCan(actor, 'slot.view');
  const group = idOk(id) ? await SectionGroup.findById(id).lean() : null;
  if (!group) throw notFound('Group not found.');
  const section = await loadSectionDoc(String(group.section_id));
  assertCan(actor, 'section.manage', { department_id: String(section.department_id) });
  await openSemester(String(section.semester_id));
  return { group, section };
}

const groupView = (g) => ({ id: String(g._id), section_id: String(g.section_id), label: g.label });
const normaliseLabel = (label) => `G${Number(/^G(\d+)$/i.exec(label)[1])}`;

export async function addGroup(actor, sectionId, { label }) {
  assertCan(actor, 'slot.view');
  const section = await loadSectionDoc(sectionId);
  assertCan(actor, 'section.manage', { department_id: String(section.department_id) });
  await openSemester(String(section.semester_id));
  try {
    return await withTransaction(async (session) => {
      const [created] = await SectionGroup.create(
        [{ section_id: section._id, label: normaliseLabel(label) }],
        { session },
      );
      await record({
        actor,
        action: 'group.create',
        scope_department_id: section.department_id,
        target: { type: 'section_group', id: created._id },
        new_value: groupView(created),
        session,
      });
      return groupView(created);
    });
  } catch (err) {
    if (isDuplicate(err)) throw conflict('That group already exists.');
    throw err;
  }
}

export async function renameGroup(actor, id, { label }) {
  const { group, section } = await loadGroup(actor, id);
  try {
    return await withTransaction(async (session) => {
      const updated = await SectionGroup.findOneAndUpdate(
        { _id: group._id },
        { $set: { label: normaliseLabel(label) } },
        { returnDocument: 'after', session },
      ).lean();
      await record({
        actor,
        action: 'group.rename',
        scope_department_id: section.department_id,
        target: { type: 'section_group', id: group._id },
        old_value: groupView(group),
        new_value: groupView(updated),
        session,
      });
      return groupView(updated);
    });
  } catch (err) {
    if (isDuplicate(err)) throw conflict('That group already exists.');
    throw err;
  }
}

/** EDT-07: a group in use by a slot or an accepted enrolment cannot be removed. */
export async function removeGroup(actor, id) {
  const { group, section } = await loadGroup(actor, id);
  let used = Boolean(await RoutineSlot.exists({ group_id: group._id }));
  for (const fn of groupUsage) used ||= Boolean(await fn(String(group._id)));
  if (used) {
    throw new AppError(409, 'GROUP_IN_USE', 'A class or a student still uses this group.');
  }
  await withTransaction(async (session) => {
    await SectionGroup.deleteOne({ _id: group._id }, { session });
    await record({
      actor,
      action: 'group.delete',
      scope_department_id: section.department_id,
      target: { type: 'section_group', id: group._id },
      old_value: groupView(group),
      session,
    });
  });
}

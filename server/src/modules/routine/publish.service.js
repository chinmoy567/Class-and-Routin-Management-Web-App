import { SOCKET_EVENTS } from '@crm/shared';
import {
  RoutineImport,
  RoutineSlot,
  RoutineSlotTeacher,
  Section,
  SectionGroup,
} from './routine.model.js';
import { alreadyDecided, diffFor, loadImportFor } from './import.service.js';
import { withTransaction, afterCommit } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { AppError } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';
import { enqueue } from '../notifications/index.js';
import { getSemester } from '../organisation/index.js';
import { directoryFor, linkedUserIds, upsertFromImport } from '../teachers/index.js';

// IMP-28: later specs plug in here.
// - spec 10/12: the students of some sections, `(sectionIds) => userIds`
// - spec 12: drop the cached routines of those sections and users
const audienceProviders = [];
const changeListeners = [];
export const registerAudienceProvider = (fn) => audienceProviders.push(fn);
export const registerRoutineChangeListener = (fn) => changeListeners.push(fn);
/** For tests: forget every provider and listener. */
export function resetRoutineHooks() {
  audienceProviders.length = 0;
  changeListeners.length = 0;
}

/**
 * EDT-08, IMP-28: after a change to published slots. Call inside the transaction: the events
 * and the follow-up work run after the commit. `dedupeKey(userId)` makes the email batched.
 * A draft semester gets events but no email.
 */
export async function notifyRoutineChange({ semester, sectionIds, teacherIds, dedupeKey }) {
  const userIds = new Set(await linkedUserIds(teacherIds));
  for (const sid of sectionIds) {
    emitAfterCommit(`section:${sid}`, SOCKET_EVENTS.ROUTINE_CHANGED, { section_id: sid });
  }
  for (const uid of userIds) {
    emitAfterCommit(`user:${uid}`, SOCKET_EVENTS.ROUTINE_CHANGED, {});
  }
  afterCommit(async () => {
    for (const fn of changeListeners) await fn({ sectionIds, userIds: [...userIds] });
    if (semester.status !== 'current') return;
    const audience = new Set(userIds);
    for (const fn of audienceProviders)
      for (const u of await fn(sectionIds)) audience.add(String(u));
    for (const uid of audience) {
      await enqueue({
        to_user_id: uid,
        template: 'routine_changed',
        data: { semester: semester.name },
        dedupe_key: dedupeKey(uid),
      });
    }
  });
}

const archived = () =>
  new AppError(409, 'SEMESTER_ARCHIVED', 'Only a draft or current semester can be imported.');

async function assertSemesterOpen(semesterId) {
  const s = await getSemester(semesterId);
  if (!s || !['draft', 'current'].includes(s.status)) throw archived();
  return s;
}

const slotDoc = (row, { imp, sectionIds, groupIds, teacherIds }) => ({
  semester_id: imp.semester_id,
  owner_department_id: imp.department_id, // IMP-30
  section_id: sectionIds.get(row.section_key),
  group_id: row.group ? groupIds.get(`${row.section_key}|${row.group}`) : undefined,
  day_of_week: row.day,
  start_min: row.start_min,
  end_min: row.end_min,
  course_code: row.course_code,
  course_name: row.course_name ?? undefined,
  room_id: row.room_id,
  source: 'import',
  tba: row.tba,
  edited_by_hand: false,
  combined_key: row.combined_key ?? undefined,
  published: true,
  import_id: imp._id,
  _teachers: row.teacher_keys.map((k) => teacherIds.get(k)),
});

/** IMP-25, IMP-26, IMP-28, IMP-29 */
export async function publishImport(actor, id, { warnings_reviewed } = {}) {
  const imp0 = await loadImportFor(actor, id);
  if (imp0.status === 'published' || imp0.status === 'replaced') throw alreadyDecided();
  const semester = await assertSemesterOpen(imp0.semester_id);
  const errors = imp0.issues.filter((i) => i.severity === 'error').length;
  if (imp0.status === 'failed' || errors) {
    throw new AppError(409, 'IMPORT_HAS_ERRORS', 'Fix the errors in the file before publishing.');
  }
  const warnings = imp0.issues.filter((i) => i.severity === 'warning' && !i.confirmed).length;
  if (warnings && warnings_reviewed !== true) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      warnings_reviewed: `Confirm that you reviewed ${warnings} warnings`,
    });
  }

  // Ids of the teachers the rows name that are already saved (the sheet's teachers are upserted).
  const departmentIds = new Map();
  for (const r of imp0.rows)
    if (r.department_id) departmentIds.set(r.department_code, r.department_id);
  for (const e of imp0.teachers) departmentIds.set(e.department_code, e.department_id);
  const wanted = [];
  for (const r of imp0.rows) {
    for (const t of r.teachers) {
      const d = departmentIds.get(t.department_code);
      if (d) wanted.push({ department_id: d, short_code: t.short_code });
    }
  }
  const saved = await directoryFor(wanted);

  const result = await withTransaction(async (session) => {
    // First action wins: only one publish flips the status.
    const imp = await RoutineImport.findOneAndUpdate(
      { _id: imp0._id, status: 'checked' },
      { $set: { status: 'published', published_by: actor._id, published_at: clock.now() } },
      { returnDocument: 'after', session },
    ).lean();
    if (!imp) throw alreadyDecided();
    await assertSemesterOpen(imp.semester_id);

    // IMP-26: sections and groups for every department in the file.
    const sectionIds = new Map();
    const groupIds = new Map();
    for (const row of imp.rows) {
      if (sectionIds.has(row.section_key)) continue;
      const own = String(row.department_id) === String(imp.department_id);
      const section = await Section.findOneAndUpdate(
        {
          semester_id: imp.semester_id,
          department_id: row.department_id,
          level: row.level,
          term: row.term,
          letter: row.letter,
        },
        { $setOnInsert: own ? {} : { created_by_import_of: imp.department_id } },
        { upsert: true, returnDocument: 'after', session },
      ).lean();
      sectionIds.set(row.section_key, section._id);
    }
    for (const row of imp.rows) {
      if (!row.group) continue;
      const key = `${row.section_key}|${row.group}`;
      if (groupIds.has(key)) continue;
      const group = await SectionGroup.findOneAndUpdate(
        { section_id: sectionIds.get(row.section_key), label: row.group },
        { $setOnInsert: {} },
        { upsert: true, returnDocument: 'after', session },
      ).lean();
      groupIds.set(key, group._id);
    }

    // IMP-07
    const upserted = await upsertFromImport(
      imp.teachers.map((e) => ({
        department_id: e.department_id,
        short_code: e.short_code,
        full_name: e.full_name,
      })),
      { session },
    );
    const idByCode = new Map();
    const codeOfDept = new Map([...departmentIds].map(([code, d]) => [String(d), code]));
    for (const [key, rec] of saved) {
      const [d, code] = key.split(':');
      idByCode.set(`${codeOfDept.get(d)}:${code}`, rec.id);
    }
    for (const [key, tid] of upserted) {
      const [d, code] = key.split(':');
      idByCode.set(`${codeOfDept.get(d)}:${code}`, tid);
    }
    const ctx = { imp, sectionIds, groupIds, teacherIds: idByCode };

    // IMP-24, IMP-26: only this department's slots.
    const { diff } = await diffFor(imp, { session });
    const choice = (slot) =>
      slot.edited_by_hand ? (imp.keep_choices?.[slot.id] ?? 'keep') : 'replace';
    const withKeys = (row) => ({
      ...row,
      combined_key: row.combined_key ? `${imp._id}:${row.combined_key}` : null,
    });

    const removeIds = diff.removed.filter((s) => choice(s) === 'replace').map((s) => s.id);
    const changes = diff.changed.filter((c) => choice(c.slot) === 'replace');
    const deleteIds = [...removeIds];
    if (deleteIds.length) {
      await RoutineSlotTeacher.deleteMany({ slot_id: { $in: deleteIds } }, { session });
      await RoutineSlot.deleteMany({ _id: { $in: deleteIds } }, { session });
    }
    for (const { slot, row } of changes) {
      const doc = slotDoc(withKeys(row), ctx);
      const { _teachers, ...fields } = doc;
      await RoutineSlot.updateOne(
        { _id: slot.id },
        { $set: { ...fields, combined_key: fields.combined_key ?? null }, $inc: { version: 1 } },
        { session },
      );
      await RoutineSlotTeacher.deleteMany({ slot_id: slot.id }, { session });
      if (_teachers.length) {
        await RoutineSlotTeacher.insertMany(
          _teachers.map((teacher_id) => ({ slot_id: slot.id, teacher_id })),
          { session },
        );
      }
    }
    for (const row of diff.added) {
      const { _teachers, ...fields } = slotDoc(withKeys(row), ctx);
      const [slot] = await RoutineSlot.create([fields], { session });
      if (_teachers.length) {
        await RoutineSlotTeacher.insertMany(
          _teachers.map((teacher_id) => ({ slot_id: slot._id, teacher_id })),
          { session },
        );
      }
    }

    const counts = {
      added: diff.added.length,
      removed: removeIds.length,
      changed: changes.length,
    };
    await record({
      actor,
      action: 'routine.publish',
      scope_department_id: imp.department_id,
      target: { type: 'routine_import', id: imp._id },
      new_value: counts,
      session,
    });

    // The sections and teachers this publish touched.
    const touchedSections = new Set();
    const touchedTeachers = new Set();
    const mark = (sectionId, teacherIds) => {
      if (sectionId) touchedSections.add(String(sectionId));
      for (const t of teacherIds) if (t) touchedTeachers.add(String(t));
    };
    for (const row of diff.added) {
      mark(
        sectionIds.get(row.section_key),
        row.teacher_keys.map((k) => idByCode.get(k)),
      );
    }
    for (const s of diff.removed.filter((s) => removeIds.includes(s.id))) {
      mark(s.section_id, s.teacher_ids);
    }
    for (const { slot, row } of changes) {
      mark(slot.section_id, slot.teacher_ids);
      mark(
        sectionIds.get(row.section_key),
        row.teacher_keys.map((k) => idByCode.get(k)),
      );
    }
    const sectionList = [...touchedSections];
    await notifyRoutineChange({
      semester,
      sectionIds: sectionList,
      teacherIds: [...touchedTeachers],
      dedupeKey: (uid) => `routine:${imp._id}:${uid}`,
    });
    return { ...counts, sections: sectionList.length };
  });
  return result;
}

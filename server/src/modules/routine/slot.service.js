// EDT-02 … EDT-10: add, edit and delete one slot.
import mongoose from 'mongoose';
import { RoutineSlot, RoutineSlotTeacher, Section } from './routine.model.js';
import { checkSlot } from './slot.validate.js';
import { loadSlots } from './slots.loader.js';
import { idOk, resolveDepartmentScope } from './scope.js';
import { notifyRoutineChange } from './publish.service.js';
import { applyBookingAction, findBookingClashes } from './bookings.hooks.js';
import { formatTime } from './parse.js';
import { assertCan } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { record } from '../audit/index.js';
import { departmentNames, getSemester } from '../organisation/index.js';
import { roomCodes } from '../rooms/index.js';

const OPEN = ['draft', 'current'];

export const conflict = () =>
  new AppError(409, 'CONFLICT', 'This slot was changed by someone else. Reload and try again.');
export const archived = () =>
  new AppError(409, 'SEMESTER_ARCHIVED', 'Only a draft or current semester can be changed.');

/** EDT-09: slots saved before versions existed count as version 1. */
const versionIs = (v) =>
  v === 1 ? { $or: [{ version: 1 }, { version: { $exists: false } }] } : { version: v };

export async function openSemester(id) {
  const semester = await getSemester(id);
  if (!semester) throw notFound('Semester not found.');
  if (!OPEN.includes(semester.status)) throw archived();
  return semester;
}

async function loadSection(id, semesterId) {
  const s = idOk(id) ? await Section.findOne({ _id: id, semester_id: semesterId }).lean() : null;
  if (!s) throw notFound('Section not found.');
  return {
    ...s,
    id: String(s._id),
    department_id: String(s.department_id),
    semester_id: String(s.semester_id),
  };
}

// EDT-08: one routine email per person per hour (institution hours are whole hours from UTC).
/** A slot as stored, for the audit entry and the response. */
const viewOf = (s, roomCode) => ({
  id: s.id,
  section_id: s.section_id,
  group: s.group,
  day_of_week: s.day,
  start: formatTime(s.start_min),
  end: formatTime(s.end_min),
  course_code: s.course_code,
  course_name: s.course_name,
  room: roomCode,
  teachers: s.tba ? 'TBA' : s.teacher_keys,
  version: s.version,
});
const viewOfRow = (check, id, sectionId, version) =>
  viewOf(
    { ...check.row, id, section_id: sectionId, day: check.row.day, version },
    check.row.room_text,
  );

function slotInvalid(errors) {
  const err = new AppError(400, 'SLOT_INVALID', 'The slot has errors. Nothing was saved.');
  err.extra = { issues: errors };
  return err;
}

/** The answer when warnings or booking choices are not confirmed yet, or null. */
function needsAnswer(body, clashes, warnings) {
  const warn = warnings.length > 0 && body.confirm_warnings !== true;
  const book = clashes.length > 0 && !body.booking_action;
  if (!warn && !book) return null;
  return { saved: false, warnings, ...(clashes.length ? { booking_clashes: clashes } : {}) };
}

/** EDT-04: a confirmed "combined" choice must name an identical overlapping slot that was offered. */
function combineChoice(check, body) {
  if (!body.combine_with_slot_id) return { warnings: check.warnings, key: null };
  const offered = check.warnings.some(
    (w) => w.offer_combined && w.other_slot_id === body.combine_with_slot_id,
  );
  const other = check.others.find((o) => o.id === body.combine_with_slot_id);
  if (!offered || !other) {
    throw slotInvalid([
      {
        severity: 'error',
        code: 'COMBINE_NOT_ALLOWED',
        message: 'That class is not an identical overlapping class.',
        field: 'combine_with_slot_id',
      },
    ]);
  }
  return {
    warnings: check.warnings.filter((w) => w.other_slot_id !== body.combine_with_slot_id),
    // The other slot is never modified: a fresh key is minted when it has none.
    key: other.combined_key ?? new mongoose.Types.ObjectId().toString(),
  };
}

const place = (semester_id, room_id, day, start_min, end_min) => ({
  semester_id,
  room_id,
  day_of_week: day,
  start_min,
  end_min,
});

async function ownerCodeOf(deptId) {
  const names = await departmentNames([deptId]);
  const code = names.get(String(deptId))?.code;
  if (!code) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      department_id: 'Choose an active department',
    });
  }
  return code;
}

/** EDT-02 */
export async function createSlot(actor, body) {
  assertCan(actor, 'slot.view');
  const deptId = resolveDepartmentScope(actor, body.department_id);
  assertCan(actor, 'slot.add', { department_id: deptId });
  const semester = await openSemester(body.semester_id);
  const section = await loadSection(body.section_id, semester.id);
  const check = await checkSlot({ body, section, ownerCode: await ownerCodeOf(deptId) });
  if (check.errors.length) throw slotInvalid(check.errors);
  const { warnings, key } = combineChoice(check, body);
  const r = check.row;
  const clashes = await findBookingClashes([
    place(semester.id, check.roomId, r.day, r.start_min, r.end_min),
  ]);
  const pending = needsAnswer(body, clashes, warnings);
  if (pending) return pending;

  return withTransaction(async (session) => {
    const [slot] = await RoutineSlot.create(
      [
        {
          semester_id: semester.id,
          owner_department_id: deptId,
          section_id: section.id,
          group_id: check.groupId ?? undefined,
          day_of_week: r.day,
          start_min: r.start_min,
          end_min: r.end_min,
          course_code: r.course_code,
          course_name: r.course_name ?? undefined,
          room_id: check.roomId,
          source: 'manual',
          tba: r.tba,
          edited_by_hand: true, // IMP-24
          combined_key: key ?? undefined,
          published: true,
          version: 1,
        },
      ],
      { session },
    );
    if (check.teacherIds.length) {
      await RoutineSlotTeacher.insertMany(
        check.teacherIds.map((teacher_id) => ({ slot_id: slot._id, teacher_id })),
        { session },
      );
    }
    await applyBookingAction({ action: body.booking_action, bookings: clashes, actor, session });
    const view = viewOfRow(check, String(slot._id), section.id, 1);
    await record({
      actor,
      action: 'slot.create',
      scope_department_id: deptId,
      target: { type: 'routine_slot', id: slot._id },
      new_value: view,
      session,
    });
    await notifyRoutineChange({
      semester,
      sectionIds: [section.id],
      teacherIds: check.teacherIds,
    });
    return { saved: true, slot: view };
  });
}

async function loadOwned(actor, id) {
  assertCan(actor, 'slot.view');
  const doc = idOk(id) ? await RoutineSlot.findById(id).lean() : null;
  if (!doc) throw notFound('Slot not found.');
  const owner = String(doc.owner_department_id);
  assertCan(actor, 'slot.manage', { department_id: owner }); // EDT-03
  const [old] = await loadSlots({ _id: doc._id });
  return { doc, owner, old };
}

/** EDT-03, EDT-04, EDT-06, EDT-09 */
export async function updateSlot(actor, id, body) {
  const { doc, owner, old } = await loadOwned(actor, id);
  const semester = await openSemester(doc.semester_id);
  if ((doc.version ?? 1) !== body.version) throw conflict();
  const section = await loadSection(body.section_id ?? String(doc.section_id), semester.id);
  const check = await checkSlot({
    body,
    section,
    ownerCode: await ownerCodeOf(owner),
    excludeSlotId: doc._id,
  });
  if (check.errors.length) throw slotInvalid(check.errors);
  const { warnings, key } = combineChoice(check, body);
  const r = check.row;
  const moved =
    String(doc.room_id) !== String(check.roomId) ||
    doc.day_of_week !== r.day ||
    doc.start_min !== r.start_min ||
    doc.end_min !== r.end_min;
  const clashes = moved
    ? await findBookingClashes([
        place(semester.id, doc.room_id, doc.day_of_week, doc.start_min, doc.end_min),
        place(semester.id, check.roomId, r.day, r.start_min, r.end_min),
      ])
    : [];
  const pending = needsAnswer(body, clashes, warnings);
  if (pending) return pending;

  const set = {
    section_id: section.id,
    day_of_week: r.day,
    start_min: r.start_min,
    end_min: r.end_min,
    course_code: r.course_code,
    room_id: check.roomId,
    tba: r.tba,
    edited_by_hand: true, // EDT-06
  };
  const unset = {};
  if (check.groupId) set.group_id = check.groupId;
  else unset.group_id = 1;
  if (r.course_name) set.course_name = r.course_name;
  else unset.course_name = 1;
  if (key) set.combined_key = key;
  else if (moved || old.section_id !== section.id) unset.combined_key = 1;
  const update = { $set: set, $inc: { version: 1 } };
  if (Object.keys(unset).length) update.$unset = unset;

  const oldRoom = (await roomCodes([doc.room_id])).get(String(doc.room_id));
  return withTransaction(async (session) => {
    const updated = await RoutineSlot.findOneAndUpdate(
      {
        _id: doc._id,
        owner_department_id: owner,
        semester_id: semester.id,
        ...versionIs(body.version),
      },
      update,
      { returnDocument: 'after', session },
    ).lean();
    if (!updated) {
      if (await RoutineSlot.exists({ _id: doc._id }).session(session)) throw conflict();
      throw notFound('Slot not found.');
    }
    await RoutineSlotTeacher.deleteMany({ slot_id: doc._id }, { session });
    if (check.teacherIds.length) {
      await RoutineSlotTeacher.insertMany(
        check.teacherIds.map((teacher_id) => ({ slot_id: doc._id, teacher_id })),
        { session },
      );
    }
    await applyBookingAction({ action: body.booking_action, bookings: clashes, actor, session });
    const view = viewOfRow(check, String(doc._id), section.id, updated.version);
    await record({
      actor,
      action: 'slot.update',
      scope_department_id: owner,
      target: { type: 'routine_slot', id: doc._id },
      old_value: viewOf(old, oldRoom),
      new_value: view,
      session,
    });
    await notifyRoutineChange({
      semester,
      sectionIds: [...new Set([old.section_id, section.id])],
      teacherIds: [...new Set([...old.teacher_ids, ...check.teacherIds])],
    });
    return { saved: true, slot: view };
  });
}

/** EDT-03, EDT-09 */
export async function deleteSlot(actor, id, body) {
  const { doc, owner, old } = await loadOwned(actor, id);
  const semester = await openSemester(doc.semester_id);
  if ((doc.version ?? 1) !== body.version) throw conflict();
  const clashes = await findBookingClashes([
    place(semester.id, doc.room_id, doc.day_of_week, doc.start_min, doc.end_min),
  ]);
  if (clashes.length && !body.booking_action) {
    return { saved: false, warnings: [], booking_clashes: clashes };
  }
  const oldRoom = (await roomCodes([doc.room_id])).get(String(doc.room_id));
  return withTransaction(async (session) => {
    const removed = await RoutineSlot.findOneAndDelete(
      { _id: doc._id, owner_department_id: owner, ...versionIs(body.version) },
      { session },
    ).lean();
    if (!removed) {
      if (await RoutineSlot.exists({ _id: doc._id }).session(session)) throw conflict();
      throw notFound('Slot not found.');
    }
    await RoutineSlotTeacher.deleteMany({ slot_id: doc._id }, { session });
    await applyBookingAction({ action: body.booking_action, bookings: clashes, actor, session });
    await record({
      actor,
      action: 'slot.delete',
      scope_department_id: owner,
      target: { type: 'routine_slot', id: doc._id },
      old_value: viewOf(old, oldRoom),
      session,
    });
    await notifyRoutineChange({
      semester,
      sectionIds: [old.section_id],
      teacherIds: old.teacher_ids,
    });
    return { saved: true };
  });
}

import { SOCKET_EVENTS } from '@crm/shared';
import { Semester } from './organisation.model.js';
import { assertCan, can } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { AppError } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';

const adminView = (s) => ({
  id: String(s._id),
  name: s.name,
  status: s.status,
  start_date: s.start_date,
  end_date: s.end_date,
  made_current_at: s.made_current_at ?? null,
});
// What every signed-in person may see.
const publicView = (s) => ({ name: s.name, start_date: s.start_date, end_date: s.end_date });

// SEM-04: sections, calendar events and roles arrive in later specs. Each registers a function
// `(semesterId) => boolean` that says whether it has anything attached to that semester.
const providers = { inUse: [] };
export function registerSemesterUsage({ inUse } = {}) {
  if (inUse) providers.inUse.push(inUse);
}
/** For tests: forget every registered provider. */
export function resetSemesterUsage() {
  providers.inUse = [];
}

const idOk = (id) => /^[a-f0-9]{24}$/i.test(String(id));
const isDuplicate = (err) => err?.code === 11000;
const notFound = () => new AppError(404, 'NOT_FOUND', 'Semester not found.');
const clash = () =>
  new AppError(409, 'CONFLICT', 'That name is taken, or a draft semester already exists.');
const archived = () =>
  new AppError(409, 'SEMESTER_ARCHIVED', 'An archived semester cannot be changed.');
const inUse = () =>
  new AppError(409, 'SEMESTER_IN_USE', 'Only an empty draft semester can be deleted.');
const badDates = () =>
  new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
    end_date: 'The end date must be after the start date',
  });

/**
 * SEM-06: someone who is not an admin must not learn whether a semester id exists, so the
 * by-id actions answer 404 to them. An admin without the right gets the normal 403.
 */
function assertManageExisting(actor) {
  if (can(actor, 'semester.manage')) return;
  if (can(actor, 'semester.list')) assertCan(actor, 'semester.manage');
  throw notFound();
}

/** SEM-05: the one current semester, or null. Other modules call this, never the collection. */
export async function currentSemester() {
  const s = await Semester.findOne({ status: 'current' }).lean();
  return s ? adminView(s) : null;
}
/** SEM-05: the one draft semester, or null. Admin screens only (SEM-06). */
export async function draftSemester() {
  const s = await Semester.findOne({ status: 'draft' }).lean();
  return s ? adminView(s) : null;
}

/** GET /api/semesters/current: never a draft, never an archived one (SEM-06). */
export async function readCurrentSemester() {
  const s = await Semester.findOne({ status: 'current' }).lean();
  return s ? publicView(s) : null;
}

export async function listSemesters(actor) {
  assertCan(actor, 'semester.list');
  const rows = await Semester.find().sort({ start_date: -1, created_at: -1 }).lean();
  return rows.map(adminView);
}

export async function createSemester(actor, { name, start_date, end_date }) {
  assertCan(actor, 'semester.manage');
  try {
    return await withTransaction(async (session) => {
      const [s] = await Semester.create([{ name, start_date, end_date, status: 'draft' }], {
        session,
      });
      await record({
        actor,
        action: 'semester.create',
        target: { type: 'semester', id: s._id },
        new_value: { name, start_date, end_date, status: 'draft' },
        session,
      });
      return adminView(s);
    });
  } catch (err) {
    if (isDuplicate(err)) throw clash();
    throw err;
  }
}

export async function updateSemester(actor, id, patch) {
  assertManageExisting(actor);
  const current = idOk(id) ? await Semester.findById(id).lean() : null;
  if (!current) throw notFound();
  if (current.status === 'archived') throw archived();
  const set = {};
  for (const key of ['name', 'start_date', 'end_date']) {
    if (patch[key] !== undefined && patch[key] !== current[key]) set[key] = patch[key];
  }
  if (!Object.keys(set).length) return adminView(current);
  const start = set.start_date ?? current.start_date;
  const end = set.end_date ?? current.end_date;
  if (end <= start) throw badDates();
  const datesChanged = 'start_date' in set || 'end_date' in set;

  try {
    return await withTransaction(async (session) => {
      const updated = await Semester.findOneAndUpdate(
        { _id: current._id, status: { $ne: 'archived' } },
        { $set: set },
        { returnDocument: 'after', session },
      ).lean();
      if (!updated) throw archived();
      await record({
        actor,
        action: 'semester.update',
        target: { type: 'semester', id: current._id },
        old_value: {
          name: current.name,
          start_date: current.start_date,
          end_date: current.end_date,
        },
        new_value: {
          name: updated.name,
          start_date: updated.start_date,
          end_date: updated.end_date,
        },
        session,
      });
      // SEM-03: live status depends on the current semester's dates.
      if (updated.status === 'current' && datesChanged) {
        emitAfterCommit('everyone', SOCKET_EVENTS.CALENDAR_CHANGED, {});
      }
      return adminView(updated);
    });
  } catch (err) {
    if (isDuplicate(err)) throw clash();
    throw err;
  }
}

export async function deleteSemester(actor, id) {
  assertManageExisting(actor);
  const current = idOk(id) ? await Semester.findById(id).lean() : null;
  if (!current) throw notFound();
  if (current.status !== 'draft') throw inUse();
  for (const fn of providers.inUse) if (await fn(current._id)) throw inUse();
  await withTransaction(async (session) => {
    const res = await Semester.deleteOne({ _id: current._id, status: 'draft' }, { session });
    if (res.deletedCount !== 1) throw inUse();
    await record({
      actor,
      action: 'semester.delete',
      target: { type: 'semester', id: current._id },
      old_value: { name: current.name, status: 'draft' },
      session,
    });
  });
}

/**
 * SEM-07: make the very first semester current. Refused once any semester has ever been
 * current. Runs in one transaction; the unique index on `current` is the backstop, and the
 * conditional update makes the first caller win.
 */
export async function bootstrapCurrent(actor, id) {
  assertManageExisting(actor);
  const found = idOk(id) ? await Semester.findById(id).lean() : null;
  if (!found) throw notFound();
  const refuse = () =>
    new AppError(409, 'CONFLICT', 'A semester has already been current. Use the rollover.');
  return withTransaction(async (session) => {
    const ever = await Semester.exists({
      $or: [{ made_current_at: { $exists: true } }, { status: { $in: ['current', 'archived'] } }],
    }).session(session);
    if (ever) throw refuse();
    const updated = await Semester.findOneAndUpdate(
      { _id: found._id, status: 'draft' },
      { $set: { status: 'current', made_current_at: clock.now(), made_current_by: actor._id } },
      { returnDocument: 'after', session },
    ).lean();
    if (!updated) throw refuse();
    await record({
      actor,
      action: 'semester.bootstrap_current',
      target: { type: 'semester', id: found._id },
      old_value: { status: 'draft' },
      new_value: { status: 'current' },
      session,
    });
    emitAfterCommit('everyone', SOCKET_EVENTS.CALENDAR_CHANGED, {});
    return adminView(updated);
  });
}

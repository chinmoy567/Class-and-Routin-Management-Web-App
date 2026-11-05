import { rangesOverlap, DATE_OUT_OF_RANGE, STATE_NOT_ALLOWED } from '@crm/shared';
import { Room, RoomShare } from './rooms.model.js';
import { assertCan, stateIn } from '../../policy/index.js';
import { AppError } from '../../lib/errors.js';
import { clock, toInstitutionDate, minutesOfDay, weekStart, addDays } from '../../lib/time.js';
import { currentSemester, departmentNames } from '../organisation/index.js';

// FRV-09: the routine and booking modules plug in here, so rooms never imports them (that would
// be a cycle: routine already imports rooms). Each provider is optional.
//  - publishedDepartments({ semester }) -> [departmentId]   departments with a published routine
//  - runningSlots({ semester, date, from, to }) -> [{ room_id, start_min, end_min }]
//      published class slots that run on the date (spec 11 slotRuns), with effective end
//  - dayRules({ semester, date, departmentIds }) -> Map(key -> dayRule); key is the department
//      id, or 'university' for the university-wide rule
//  - bookedRoomIds({ date, from, to }) -> [roomId]   approved bookings (spec 19)
const providers = { publishedDepartments: [], runningSlots: [], dayRules: [], bookedRoomIds: [] };

export function registerAvailabilityProvider(fns = {}) {
  for (const key of Object.keys(providers)) {
    if (fns[key]) providers[key].push(fns[key]);
  }
}
/** For tests: forget every registered provider. */
export function resetAvailabilityProviders() {
  for (const key of Object.keys(providers)) providers[key] = [];
}

const UNIVERSITY = 'university';
const NON_TEACHING = 'No classes today';
const LAST_MINUTE = 1080; // 18:00
const FIRST_MINUTE = 480; // 08:00
const WINDOW_MINUTES = 55; // FRV-07

const outOfRange = (message) => new AppError(400, DATE_OUT_OF_RANGE, message);

/** FRV-01: the date must be in this week or next week (Sunday to Saturday) and in the semester. */
export function checkWindow(date, semester, today) {
  if (!semester) return 'There is no current semester.';
  const thisWeek = weekStart(today);
  const lastDay = addDays(thisWeek, 13);
  if (date < thisWeek || date > lastDay) return 'Pick a date in this week or next week.';
  if (date < semester.start_date || date > semester.end_date) {
    return 'That date is outside the current semester.';
  }
  return null;
}

/** FRV-04: the request rule for a day, from its dayRule. */
function requestRule(rule) {
  if (!rule) return { requests_allowed: true };
  if (rule.kind === 'closed') return { requests_allowed: false, day_label: rule.label };
  if (rule.kind === 'non_teaching_day' || rule.kind === 'no_semester') {
    return { requests_allowed: false, day_label: NON_TEACHING };
  }
  return { requests_allowed: true };
}

/** Calls each registered provider of one kind and merges the results. */
async function gather(kind, args) {
  const out = [];
  for (const fn of providers[kind]) out.push(...(await fn(args)));
  return out;
}

/**
 * FRV-02: the rooms that are availability known. Owner and every sharing department must have
 * a published routine in the current semester.
 */
async function knownRooms(rooms, semester) {
  const published = new Set(
    (await gather('publishedDepartments', { semester })).map((d) => String(d)),
  );
  const shares = await RoomShare.find({ room_id: { $in: rooms.map((r) => r._id) } }).lean();
  const sharesByRoom = new Map();
  for (const s of shares) {
    const key = String(s.room_id);
    if (!sharesByRoom.has(key)) sharesByRoom.set(key, []);
    sharesByRoom.get(key).push(String(s.department_id));
  }
  const known = new Set();
  for (const room of rooms) {
    const depts = [String(room.owner_department_id), ...(sharesByRoom.get(String(room._id)) ?? [])];
    if (depts.every((d) => published.has(d))) known.add(String(room._id));
  }
  return known;
}

/**
 * FRV-03 to FRV-05 and FRV-09: availability of every active room for a date and a time range.
 * Used by the free-room view and by booking (spec 19). Does not check who is asking.
 * `from` and `to` are minutes since midnight. Returns `{ requests_allowed, day_label?, rooms }`
 * with rooms `{ id, code, type, owner, status, requests_allowed, day_label? }`.
 */
export async function availability({ date, from, to, type, department_id: departmentId }) {
  const semester = await currentSemester();
  const filter = { retired: false };
  if (type) filter.type = type;
  if (departmentId) filter.owner_department_id = departmentId;
  const rooms = await Room.find(filter).sort({ code_norm: 1 }).lean();

  const deptIds = [...new Set(rooms.map((r) => String(r.owner_department_id)))];
  const rules = semester
    ? await gatherRules({ semester, date, departmentIds: deptIds })
    : new Map();
  const top = rules.get(UNIVERSITY) ?? null;

  const known = semester ? await knownRooms(rooms, semester) : new Set();
  const busy = new Set();
  if (semester && known.size) {
    const slots = await gather('runningSlots', { semester, date, from, to });
    for (const s of slots) {
      if (known.has(String(s.room_id)) && rangesOverlap(s.start_min, s.end_min, from, to)) {
        busy.add(String(s.room_id));
      }
    }
  }
  const booked = new Set(
    (await gather('bookedRoomIds', { date, from, to })).map((id) => String(id)),
  );

  const names = await departmentNames(deptIds);
  const rows = rooms.map((room) => {
    const id = String(room._id);
    const ownerId = String(room.owner_department_id);
    let status = 'free';
    if (!known.has(id)) status = 'unknown';
    else if (busy.has(id)) status = 'busy';
    else if (booked.has(id)) status = 'booked';
    return {
      id,
      code: room.code,
      type: room.type,
      owner: { id: ownerId, code: names.get(ownerId)?.code ?? '' },
      status,
      ...requestRule(rules.get(ownerId)),
    };
  });

  // FRV-05: rows carry only the status for busy and booked rooms, so no class, section or teacher leaks.
  return { ...requestRule(top), rooms: rows };
}

/**
 * BKG-04, BKG-05: one room's status for a range (`free`, `unknown`, `busy` or `booked`), or `null`
 * if there is no such room. Booking checks use this; it does not check who is asking.
 */
export async function roomStatusFor({ roomId, date, from, to }) {
  const result = await availability({ date, from, to });
  return result.rooms.find((r) => r.id === String(roomId)) ?? null;
}

async function gatherRules({ semester, date, departmentIds }) {
  const merged = new Map();
  for (const fn of providers.dayRules) {
    const got = await fn({ semester, date, departmentIds });
    for (const [key, rule] of got) merged.set(key, rule);
  }
  return merged;
}

/** The HTTP query for students, teachers and admins: state, policy, FRV-01 window, then availability. */
export async function listAvailability(actor, { date, from, to, type, department_id }) {
  assertState(actor);
  assertCan(actor, 'room.availability.view');
  const semester = await currentSemester();
  const problem = checkWindow(date, semester, toInstitutionDate(clock.now()));
  if (problem) throw outOfRange(problem);
  return { date, from, to, ...(await availability({ date, from, to, type, department_id })) };
}

/**
 * FRV-07: the free-room card. Today from now (rounded down to 5 minutes) for 55 minutes. Outside
 * 08:00 to 18:00, or when today is not a teaching day in the semester, it lists no rooms.
 */
export async function freeNow(actor) {
  assertState(actor);
  assertCan(actor, 'room.availability.view');
  const now = clock.now();
  const date = toInstitutionDate(now);
  const minute = minutesOfDay(now);
  const from = Math.floor(minute / 5) * 5;
  const to = Math.min(from + WINDOW_MINUTES, LAST_MINUTE);
  const semester = await currentSemester();
  const empty = { date, from, to, requests_allowed: false, rooms: [] };
  if (from < FIRST_MINUTE || from >= LAST_MINUTE || checkWindow(date, semester, date)) {
    return empty;
  }
  return { date, from, to, ...(await availability({ date, from, to })) };
}

/** A state other than `active` gets STATE_NOT_ALLOWED (FRV-08), not a generic FORBIDDEN. */
function assertState(actor) {
  if (!stateIn(actor, 'active')) {
    throw new AppError(403, STATE_NOT_ALLOWED, 'This account cannot view free rooms yet.');
  }
}

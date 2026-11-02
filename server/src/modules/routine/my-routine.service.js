import { slotRuns, dayRule } from '@crm/shared';
import { RoutineSlot, RoutineSlotTeacher, SectionGroup, Section } from './routine.model.js';
import { roomCodes } from '../rooms/index.js';
import { currentSemester } from '../organisation/index.js';
import { acceptedEnrolmentOf } from '../enrolments/index.js';
import { recordsOf, teacherLabels } from '../teachers/index.js';
import { getCancellationsForSlots, getEventsForDepartment } from '../calendar/index.js';
import {
  getSectionSlots,
  setSectionSlots,
  getTeacherSlots,
  setTeacherSlots,
} from './routine-cache.js';
import { clock, toInstitutionDate } from '../../lib/time.js';

const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const TBA_ENTRY = [{ short_code: 'TBA', full_name: 'Teacher to be announced' }];

/**
 * Fetch published slots for a section from cache or DB.
 * Returns plain objects (not Mongoose docs).
 */
async function sectionSlotPattern(semesterId, sectionId) {
  const cached = getSectionSlots(semesterId, sectionId);
  if (cached) return cached;

  const rawSlots = await RoutineSlot.find({
    semester_id: semesterId,
    section_id: sectionId,
    published: true,
  }).lean();

  if (!rawSlots.length) {
    setSectionSlots(semesterId, sectionId, []);
    return [];
  }

  const slotIds = rawSlots.map((s) => s._id);

  const [links, groups, roomById] = await Promise.all([
    RoutineSlotTeacher.find({ slot_id: { $in: slotIds } }).lean(),
    SectionGroup.find({
      _id: { $in: rawSlots.map((s) => s.group_id).filter(Boolean) },
    }).lean(),
    roomCodes(rawSlots.map((s) => s.room_id).filter(Boolean)),
  ]);

  const teacherIds = [...new Set(links.map((l) => String(l.teacher_id)))];
  const labels = teacherIds.length ? await teacherLabels(teacherIds) : new Map();

  const teachersOf = new Map();
  for (const l of links) {
    const key = String(l.slot_id);
    const list = teachersOf.get(key) ?? [];
    list.push(String(l.teacher_id));
    teachersOf.set(key, list);
  }

  const groupById = new Map(groups.map((g) => [String(g._id), g.label]));

  const result = rawSlots.map((s) => {
    const ids = teachersOf.get(String(s._id)) ?? [];
    const teachers = s.tba
      ? TBA_ENTRY
      : ids.map((id) => ({
          short_code: labels.get(id)?.short_code ?? null,
          full_name: labels.get(id)?.full_name ?? '',
        }));

    return {
      slot_id: String(s._id),
      course_code: s.course_code,
      course_name: s.course_name ?? null,
      group: s.group_id ? (groupById.get(String(s.group_id)) ?? null) : null,
      group_id: s.group_id ? String(s.group_id) : null,
      day_of_week: s.day_of_week,
      start_min: s.start_min,
      end_min: s.end_min,
      room_code: roomById.get(String(s.room_id)) ?? null,
      teachers,
      department_id: String(s.owner_department_id),
      section_id: String(s.section_id),
    };
  });

  setSectionSlots(semesterId, sectionId, result);
  return result;
}

/**
 * Fetch published slots for a teacher (all their teacher records in any dept) from cache or DB.
 */
async function teacherSlotPattern(semesterId, userId) {
  const cached = getTeacherSlots(semesterId, userId);
  if (cached) return cached;

  const teacherRecs = await recordsOf(userId);
  if (!teacherRecs.length) {
    setTeacherSlots(semesterId, userId, []);
    return [];
  }

  const teacherIds = teacherRecs.map((r) => r._id);
  const links = await RoutineSlotTeacher.find({ teacher_id: { $in: teacherIds } }).lean();
  if (!links.length) {
    setTeacherSlots(semesterId, userId, []);
    return [];
  }

  const slotIds = [...new Set(links.map((l) => String(l.slot_id)))];
  const rawSlots = await RoutineSlot.find({
    _id: { $in: slotIds },
    semester_id: semesterId,
    published: true,
  }).lean();

  if (!rawSlots.length) {
    setTeacherSlots(semesterId, userId, []);
    return [];
  }

  const allSlotIds = rawSlots.map((s) => s._id);
  const [allLinks, groups, roomById, sections] = await Promise.all([
    RoutineSlotTeacher.find({ slot_id: { $in: allSlotIds } }).lean(),
    SectionGroup.find({
      _id: { $in: rawSlots.map((s) => s.group_id).filter(Boolean) },
    }).lean(),
    roomCodes(rawSlots.map((s) => s.room_id).filter(Boolean)),
    Section.find({
      _id: { $in: rawSlots.map((s) => s.section_id).filter(Boolean) },
    })
      .select('level term letter')
      .lean(),
  ]);

  const allTeacherIds = [...new Set(allLinks.map((l) => String(l.teacher_id)))];
  const labels = allTeacherIds.length ? await teacherLabels(allTeacherIds) : new Map();

  const teachersOf = new Map();
  for (const l of allLinks) {
    const key = String(l.slot_id);
    const list = teachersOf.get(key) ?? [];
    list.push(String(l.teacher_id));
    teachersOf.set(key, list);
  }

  const groupById = new Map(groups.map((g) => [String(g._id), g.label]));
  const sectionById = new Map(
    sections.map((s) => [String(s._id), `${s.level}-${s.term}${s.letter ? ' ' + s.letter : ''}`]),
  );

  const result = rawSlots.map((s) => {
    const ids = teachersOf.get(String(s._id)) ?? [];
    const teachers = s.tba
      ? TBA_ENTRY
      : ids.map((id) => ({
          short_code: labels.get(id)?.short_code ?? null,
          full_name: labels.get(id)?.full_name ?? '',
        }));

    return {
      slot_id: String(s._id),
      course_code: s.course_code,
      course_name: s.course_name ?? null,
      group: s.group_id ? (groupById.get(String(s.group_id)) ?? null) : null,
      group_id: s.group_id ? String(s.group_id) : null,
      day_of_week: s.day_of_week,
      start_min: s.start_min,
      end_min: s.end_min,
      room_code: roomById.get(String(s.room_id)) ?? null,
      teachers,
      department_id: String(s.owner_department_id),
      section_id: String(s.section_id),
      section_label: sectionById.get(String(s.section_id)) ?? null,
    };
  });

  setTeacherSlots(semesterId, userId, result);
  return result;
}

/**
 * Apply calendar rules to a slot on a given date.
 * Produces the per-day slot entry for the response.
 */
function applySlotForDate(slotPattern, date, events, cancellations, semester) {
  const result = slotRuns({ ...slotPattern, department_id: slotPattern.department_id }, date, {
    events,
    cancellations,
    semester,
  });

  return {
    ...slotPattern,
    date,
    status: result.status,
    effective_end_min: result.end_min ?? slotPattern.end_min,
    label: result.label ?? null,
    reason: result.reason ?? null,
  };
}

/**
 * RTN-06: assemble the days array for the given date range.
 */
function buildDays(slotsForDays, fromDate, toDate, events, cancellations, semester, departmentId) {
  const days = [];
  let cur = fromDate;
  while (cur <= toDate) {
    const rule = dayRule(cur, departmentId, { events, semester });
    const dow = new Date(`${cur}T00:00:00Z`).getUTCDay(); // 0=Sun
    const todaySlots = slotsForDays
      .filter((s) => s.day_of_week === dow)
      .map((s) => applySlotForDate(s, cur, events, cancellations, semester));

    days.push({ date: cur, dayRule: rule, slots: todaySlots });
    cur = addDays(cur, 1);
  }
  return days;
}

/**
 * RTN-01, RTN-03, RTN-05, RTN-06: main service function.
 * actor must already be checked as active before calling this.
 */
export async function getMyRoutine(actor, { from, to }) {
  const semester = await currentSemester();
  if (!semester) {
    return {
      server_time: clock.now().toISOString(),
      today: toInstitutionDate(clock.now()),
      timezone: 'Asia/Dhaka',
      semester: null,
      week: [],
      days: [],
      bookings: [],
      events: [],
      group_missing: false,
      is_teacher: false,
    };
  }

  const semId = semester.id ?? String(semester._id);
  const today = toInstitutionDate(clock.now());

  const fromDate = from ?? today;
  const toDate = to ?? addDays(today, 1);

  const isTeacher = actor.kind === 'teacher';

  let sectionId = null;
  let groupId = null;
  let groupMissing = false;
  let slotsForDays = [];
  let departmentId = null;

  if (isTeacher) {
    slotsForDays = await teacherSlotPattern(semId, String(actor._id));
    departmentId = actor.department_id ? String(actor.department_id) : null;
  } else {
    const enrolment = await acceptedEnrolmentOf(actor._id, semId);
    if (!enrolment) {
      return {
        server_time: clock.now().toISOString(),
        today: toInstitutionDate(clock.now()),
        timezone: 'Asia/Dhaka',
        semester: {
          name: semester.name,
          start_date: semester.start_date,
          end_date: semester.end_date,
        },
        week: [],
        days: [],
        bookings: [],
        events: [],
        group_missing: false,
        is_teacher: false,
      };
    }

    sectionId = String(enrolment.section_id);
    groupId = enrolment.group_id ? String(enrolment.group_id) : null;
    groupMissing = !groupId;
    departmentId = enrolment.department_id
      ? String(enrolment.department_id)
      : actor.department_id
        ? String(actor.department_id)
        : null;

    const allSectionSlots = await sectionSlotPattern(semId, sectionId);

    // RTN-01, RTN-05: filter to student's own slots only.
    slotsForDays = allSectionSlots.filter((s) => !s.group_id || s.group_id === groupId);

    if (groupMissing) {
      // Only whole-section (no group) slots when group not yet set.
      slotsForDays = allSectionSlots.filter((s) => !s.group_id);
    }
  }

  // Build week pattern (slots by day_of_week, 0–4).
  const weekDays = [0, 1, 2, 3, 4];
  const week = weekDays.map((dow) => ({
    day_of_week: dow,
    slots: slotsForDays
      .filter((s) => s.day_of_week === dow)
      .sort((a, b) => a.start_min - b.start_min),
  }));

  // Fetch calendar data per request (not cached).
  const slotIds = slotsForDays.map((s) => s.slot_id);
  const [events, cancellations] = await Promise.all([
    departmentId ? getEventsForDepartment(departmentId, fromDate, toDate) : Promise.resolve([]),
    slotIds.length
      ? getCancellationsForSlots(slotIds, { from: fromDate, to: toDate })
      : Promise.resolve([]),
  ]);

  const semesterShape = {
    name: semester.name,
    start_date: semester.start_date,
    end_date: semester.end_date,
  };

  const days = buildDays(
    slotsForDays,
    fromDate,
    toDate,
    events,
    cancellations,
    semesterShape,
    departmentId,
  );

  return {
    server_time: clock.now().toISOString(),
    today,
    timezone: 'Asia/Dhaka',
    semester: semesterShape,
    week,
    days,
    bookings: [],
    events: events.map((e) => ({
      id: String(e._id),
      from_date: e.from_date,
      to_date: e.to_date,
      kind: e.kind,
      label: e.label,
      cutoff_min: e.cutoff_min ?? null,
    })),
    group_missing: groupMissing,
    is_teacher: isTeacher,
  };
}

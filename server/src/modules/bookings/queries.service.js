import { RoomRequest } from './bookings.model.js';
import { assertCan, hasRole } from '../../policy/index.js';
import { roomCodes, roomIdsForDepartments } from '../rooms/index.js';
import { currentSemester, departmentNames } from '../organisation/index.js';
import { getSectionBrief } from '../routine/index.js';
import { recordsOf, teachersByIds } from '../teachers/index.js';
import { serialise } from './send.service.js';

const overlapping = (req) => ({
  date: req.date,
  start_min: { $lt: req.end_min },
  end_min: { $gt: req.start_min },
});

/** The department ids the admin decides for. A super admin sees every department. */
const adminDepartmentIds = (actor) =>
  (actor.roles ?? []).filter((r) => r.role === 'dept_admin').map((r) => String(r.department_id));

/** BKG-12: a readable label for who is asking: "CSE 2-II-A" or a teacher's name. */
export async function requesterLabels(requests) {
  const sectionIds = [
    ...new Set(
      requests.filter((r) => r.requester_section_id).map((r) => String(r.requester_section_id)),
    ),
  ];
  const teacherIds = [
    ...new Set(
      requests.filter((r) => r.requester_teacher_id).map((r) => String(r.requester_teacher_id)),
    ),
  ];
  const sections = await Promise.all(sectionIds.map((id) => getSectionBrief(id)));
  const sectionById = new Map(sections.filter(Boolean).map((s) => [s.id, s]));
  const names = await departmentNames([
    ...new Set([...sectionById.values()].map((s) => s.department_id)),
  ]);
  const teachers = teacherIds.length ? await teachersByIds(teacherIds) : [];
  const teacherById = new Map(teachers.map((t) => [String(t._id), t]));
  const label = new Map();
  for (const [id, s] of sectionById) {
    const code = names.get(s.department_id)?.code ?? '';
    label.set(id, `${code} ${s.level}-${s.term}-${s.letter}`.trim());
  }
  for (const [id, t] of teacherById) label.set(id, t.full_name);
  return (r) => label.get(String(r.requester_section_id ?? r.requester_teacher_id)) ?? '';
}

/**
 * BKG-12: the decision queue for the admin's rooms, grouped by room and slot, oldest first. Each
 * entry shows who is asking, the note and the requester's other requests for the same time.
 */
export async function adminQueue(actor, query) {
  const deptIds = hasRole(actor, 'super_admin') ? null : adminDepartmentIds(actor);
  assertCan(actor, 'room_request.view_queue', { department_ids: deptIds ?? [] });
  const filter = { status: query.status ?? 'pending' };
  if (deptIds) filter.room_id = { $in: await roomIdsForDepartments(deptIds) };
  const requests = await RoomRequest.find(filter).sort({ created_at: 1 }).lean();
  if (!requests.length) return { groups: [] };

  const codes = await roomCodes([...new Set(requests.map((r) => String(r.room_id)))]);
  const labelOf = await requesterLabels(requests);
  const noShowsOf = await noShowNotesFor(requests);

  const groups = new Map();
  for (const r of requests) {
    const key = `${r.room_id}|${r.date}|${r.start_min}|${r.end_min}`;
    if (!groups.has(key)) {
      groups.set(key, {
        room_id: String(r.room_id),
        room_code: codes.get(String(r.room_id)) ?? '',
        date: r.date,
        start: r.start_min,
        end: r.end_min,
        requests: [],
      });
    }
    groups.get(key).requests.push({
      ...serialise(r),
      requester_label: labelOf(r),
      requester_no_shows: noShowsOf(r),
      other_requests: await otherRequestsOf(r),
    });
  }
  return { groups: [...groups.values()] };
}

/** The same requester's other requests that overlap this one (any status). */
async function otherRequestsOf(req) {
  const who = req.requester_section_id
    ? { requester_section_id: req.requester_section_id }
    : { requester_teacher_id: req.requester_teacher_id };
  const rows = await RoomRequest.find({ ...who, ...overlapping(req), _id: { $ne: req._id } })
    .select('room_id status start_min end_min')
    .lean();
  return rows.map((r) => ({ id: String(r._id), room_id: String(r.room_id), status: r.status }));
}

/**
 * BKG-26: "My room requests" for the requester: the section's requests (for a CR/DCR) and the
 * teacher's own requests, plus anything this user sent. Newest first.
 */
export async function myRequests(actor) {
  const semester = await currentSemester();
  const sectionIds = (actor.roles ?? [])
    .filter((r) => ['cr', 'dcr'].includes(r.role) && r.section_id)
    .map((r) => r.section_id);
  const teacherIds = (await recordsOf(actor._id)).map((t) => t._id);
  const or = [{ sent_by_user_id: actor._id }];
  if (sectionIds.length) or.push({ requester_section_id: { $in: sectionIds } });
  if (teacherIds.length) or.push({ requester_teacher_id: { $in: teacherIds } });
  const rows = await RoomRequest.find({
    $or: or,
    ...(semester ? { semester_id: semester.id } : {}),
  })
    .sort({ created_at: -1 })
    .limit(100)
    .lean();
  const codes = await roomCodes([...new Set(rows.map((r) => String(r.room_id)))]);
  const noShowsOf = await noShowNotesFor(rows);
  return rows.map((r) => ({
    ...serialise(r),
    room_code: codes.get(String(r.room_id)) ?? '',
    requester_no_shows: noShowsOf(r),
  }));
}

/**
 * BKG-23: the no-show notes on each requester's approved requests, kept on record. Returns a
 * function that gives the notes for one request's requester (a section or a teacher), newest first.
 */
async function noShowNotesFor(rows) {
  const sectionIds = [
    ...new Set(
      rows.filter((r) => r.requester_section_id).map((r) => String(r.requester_section_id)),
    ),
  ];
  const teacherIds = [
    ...new Set(
      rows.filter((r) => r.requester_teacher_id).map((r) => String(r.requester_teacher_id)),
    ),
  ];
  const or = [];
  if (sectionIds.length) or.push({ requester_section_id: { $in: sectionIds } });
  if (teacherIds.length) or.push({ requester_teacher_id: { $in: teacherIds } });
  const notes = new Map();
  if (or.length) {
    const found = await RoomRequest.find({ $or: or, no_show_note: { $type: 'string' } })
      .select('requester_section_id requester_teacher_id date no_show_note')
      .sort({ date: -1 })
      .lean();
    for (const f of found) {
      const key = String(f.requester_section_id ?? f.requester_teacher_id);
      if (!notes.has(key)) notes.set(key, []);
      notes.get(key).push({ date: f.date, note: f.no_show_note });
    }
  }
  return (r) => notes.get(String(r.requester_section_id ?? r.requester_teacher_id)) ?? [];
}

/**
 * ADM-06: the requests waiting for a decision in these departments, earliest decision cutoff
 * first. The card shows the count and the first few; the digest counts them (spec 15).
 */
export async function pendingRequestsSummary(departmentIds) {
  const filter = {
    status: 'pending',
    room_id: { $in: await roomIdsForDepartments(departmentIds) },
  };
  const count = await RoomRequest.countDocuments(filter);
  const rows = await RoomRequest.find(filter).sort({ starts_at: 1 }).limit(10).lean();
  const codes = await roomCodes([...new Set(rows.map((r) => String(r.room_id)))]);
  const labelOf = await requesterLabels(rows);
  return {
    count,
    items: rows.map((r) => ({
      id: String(r._id),
      room_code: codes.get(String(r.room_id)) ?? '',
      date: r.date,
      start: r.start_min,
      end: r.end_min,
      requester_label: labelOf(r),
      decision_cutoff: serialise(r).decision_cutoff,
    })),
  };
}

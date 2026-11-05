import { SOCKET_EVENTS } from '@crm/shared';
import { RoomRequest } from './bookings.model.js';
import { assertRequestAllowed } from './checks.js';
import { assertCan, hasRole } from '../../policy/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock, instantFrom } from '../../lib/time.js';
import { withTransaction } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { t } from '../../i18n/index.js';
import { record } from '../audit/index.js';
import { currentSemester } from '../organisation/index.js';
import { roomForBooking } from '../rooms/index.js';
import {
  getGroupBrief,
  getSectionBrief,
  bumpSectionRequestSeq,
  teacherIdsOfSection,
} from '../routine/index.js';
import { bumpTeacherRequestSeq, recordsOf } from '../teachers/index.js';

const LIMIT = 3; // BKG-11

/** Who is sending: a CR or DCR of the target section, or a teacher who teaches it (BKG-01). */
export async function resolveRequester(actor, body, semester) {
  const targetSection = String(body.target_section_id);
  if (hasRole(actor, ['cr', 'dcr'], { section_id: targetSection })) {
    return { kind: 'section', section_id: targetSection };
  }
  // A teacher sends on their own behalf. The teacher must teach the target section, from the routine.
  const records = await recordsOf(actor._id);
  const taught = await teacherIdsOfSection({ semesterId: semester.id, sectionId: targetSection });
  const mine = records.find((r) => taught.includes(String(r._id)));
  if (!mine) throw new AppError(403, 'FORBIDDEN', 'You do not teach this section.');
  return { kind: 'teacher', teacher_id: String(mine._id) };
}

/** Loads and checks the target section and group, and the room. Returns the brief pieces. */
async function loadTarget(body, semester) {
  const section = await getSectionBrief(body.target_section_id);
  if (!section || String(section.semester_id) !== String(semester.id)) {
    throw notFound('Section not found.');
  }
  if (body.target_group_id) {
    const group = await getGroupBrief(body.target_group_id);
    if (!group || String(group.section_id) !== String(section.id)) {
      throw notFound('Group not found.');
    }
  }
  const room = await roomForBooking(body.room_id);
  if (!room || room.retired) throw notFound('Room not found.');
  return { section, room };
}

/**
 * BKG-02 to BKG-11: send a room request. Runs in one transaction. The requester's document is
 * written first, so two sends from the same section or teacher run one after the other and the
 * limit count is exact (mongo-patterns §6).
 */
export async function sendRequest(actor, body) {
  const semester = await currentSemester();
  if (!semester) throw new AppError(409, 'NOT_TEACHING_DAY', t('bookings.errors.notTeachingDay'));

  // BKG-01: state and role first, so a student is refused with 403 before anything else
  assertCan(actor, 'room_request.send', { section_id: body.target_section_id });
  const { section, room } = await loadTarget(body, semester);
  const requester = await resolveRequester(actor, body, semester);

  // BKG-02: the named teacher must teach the target section (from the routine, never the request)
  let namedTeacherId = null;
  if (body.named_teacher_id) {
    const taught = await teacherIdsOfSection({
      semesterId: semester.id,
      sectionId: section.id,
    });
    if (!taught.includes(String(body.named_teacher_id))) {
      throw notFound('Teacher not found for this section.');
    }
    namedTeacherId = String(body.named_teacher_id);
  }

  const { date, start, end } = { date: body.date, start: body.start, end: body.end };
  const now = clock.now();
  const target = { section_id: section.id, group_id: body.target_group_id ?? null };
  const requesterFilter =
    requester.kind === 'section'
      ? { requester_section_id: requester.section_id }
      : { requester_teacher_id: requester.teacher_id };

  return withTransaction(async (session) => {
    if (requester.kind === 'section') {
      await bumpSectionRequestSeq(requester.section_id, session);
    } else {
      await bumpTeacherRequestSeq(requester.teacher_id, session);
    }

    await assertRequestAllowed({
      semester,
      room,
      date,
      start,
      end,
      target,
      requester: requester.kind === 'teacher' ? { teacher_id: requester.teacher_id } : {},
      namedTeacherId,
      now,
      checkLeadTime: true,
    });

    // BKG-11: at most 3 pending requests of this requester that overlap this time on this date
    const open = await RoomRequest.countDocuments({
      ...requesterFilter,
      status: 'pending',
      date,
      start_min: { $lt: end },
      end_min: { $gt: start },
    }).session(session);
    if (open >= LIMIT) throw new AppError(409, 'REQUEST_LIMIT', t('bookings.errors.limitReached'));

    const [doc] = await RoomRequest.create(
      [
        {
          semester_id: semester.id,
          ...requesterFilter,
          sent_by_user_id: actor._id,
          target_section_id: section.id,
          target_group_id: body.target_group_id ?? null,
          named_teacher_id: namedTeacherId,
          room_id: room.id,
          date,
          start_min: start,
          end_min: end,
          starts_at: instantFrom(date, start),
          note: body.note,
          status: 'pending',
        },
      ],
      { session },
    );

    await record({
      actor,
      action: 'room_request.create',
      scope_department_id: section.department_id,
      target: { type: 'room_request', id: doc._id },
      new_value: { room_id: room.id, date, start, end, status: 'pending' },
      session,
    });

    // BKG-20: ids and the event name only; sent after commit
    emitAfterCommit('everyone', SOCKET_EVENTS.BOOKING_CHANGED, {});
    return serialise(doc);
  });
}

/** Shape a request for the API. Only the requester's own data; never another section's details. */
export function serialise(doc) {
  return {
    id: String(doc._id),
    room_id: String(doc.room_id),
    date: doc.date,
    start: doc.start_min,
    end: doc.end_min,
    note: doc.note,
    status: doc.status,
    target_section_id: String(doc.target_section_id),
    target_group_id: doc.target_group_id ? String(doc.target_group_id) : null,
    named_teacher_id: doc.named_teacher_id ? String(doc.named_teacher_id) : null,
    reason: doc.reason ?? null,
    created_at: doc.created_at,
    decision_cutoff: new Date(doc.starts_at.getTime() - 2 * 60 * 60 * 1000),
  };
}

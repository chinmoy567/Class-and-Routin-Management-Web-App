// BKG-16, BKG-20: the people a booking affects besides the requester (who gets the result email).
import { SOCKET_EVENTS } from '@crm/shared';
import { getAudienceForSections } from '../calendar/index.js';
import { acceptedStudentUserIdsOfGroup } from '../enrolments/index.js';
import { linkedUserIds } from '../teachers/index.js';
import { enqueue } from '../notifications/index.js';
import { emitAfterCommit } from '../../lib/events.js';

/** The students a booking affects: one group's students for a group lab, else the whole section. */
async function studentsOf(req) {
  if (req.target_group_id) {
    return acceptedStudentUserIdsOfGroup(req.target_section_id, req.target_group_id);
  }
  return getAudienceForSections([String(req.target_section_id)]);
}

/** The user accounts of the requesting teacher and the named teacher, if any. */
function teacherUsersOf(req) {
  const teacherIds = [req.requester_teacher_id, req.named_teacher_id].filter(Boolean);
  return teacherIds.length ? linkedUserIds(teacherIds) : [];
}

/**
 * Emails the target students and the teacher on the booking about an approval or a cancellation.
 * The requester is skipped because they already get the result email. Each person gets one email
 * per booking and kind (dedupe key).
 */
export async function emailBookingAudience(req, { template, data, kind }) {
  const recipients = new Set(
    [...(await studentsOf(req)), ...(await teacherUsersOf(req))].map(String),
  );
  recipients.delete(String(req.sent_by_user_id));
  for (const uid of recipients) {
    await enqueue({
      to_user_id: uid,
      template,
      data,
      dedupe_key: `booking.${kind}:${req._id}:${uid}`,
    });
  }
}

/**
 * BKG-20: after commit, push `booking.changed` (ids and the event name only) to the user room of
 * every affected person: the target students (the group's, for a group lab) and the teacher. Each
 * push goes to the room of the person at the time of the change, so a student who moved section
 * gets no stale push and no one joins rooms at connect time.
 */
export async function pushBookingAudience(req) {
  const recipients = new Set(
    [...(await studentsOf(req)), ...(await teacherUsersOf(req))].map(String),
  );
  for (const uid of recipients) {
    emitAfterCommit(`user:${uid}`, SOCKET_EVENTS.BOOKING_CHANGED, {});
  }
}

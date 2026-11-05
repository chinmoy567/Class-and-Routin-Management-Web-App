// BKG-16: the people a booking affects besides the requester (who gets the result email).
import { getAudienceForSections } from '../calendar/index.js';
import { linkedUserIds } from '../teachers/index.js';
import { enqueue } from '../notifications/index.js';

/**
 * Emails the target section's students and the teacher on the booking (the named teacher, or the
 * requesting teacher) about an approval or a cancellation. The requester is skipped because they
 * already get the result email. Each person gets one email per booking and kind (dedupe key).
 */
export async function emailBookingAudience(req, { template, data, kind }) {
  const students = await getAudienceForSections([String(req.target_section_id)]);
  const teacherIds = [req.requester_teacher_id, req.named_teacher_id].filter(Boolean);
  const teachers = teacherIds.length ? await linkedUserIds(teacherIds) : [];
  const requester = String(req.sent_by_user_id);
  const recipients = new Set([...students, ...teachers].map(String));
  recipients.delete(requester);
  for (const uid of recipients) {
    await enqueue({
      to_user_id: uid,
      template,
      data,
      dedupe_key: `booking.${kind}:${req._id}:${uid}`,
    });
  }
}

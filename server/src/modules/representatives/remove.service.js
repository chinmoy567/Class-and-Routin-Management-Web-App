// CRD-08, CRD-09, CRD-10: end a CR/DCR role. The row stays, and so does the enrolment.
import { SOCKET_EVENTS } from '@crm/shared';
import { User, UserRole } from '../auth/index.js';
import { escalatePendingOfSection } from '../enrolments/index.js';
import { bumpSectionRoleSeq } from '../routine/index.js';
import { record } from '../audit/index.js';
import { enqueue } from '../notifications/index.js';
import { getConfig } from '../../config.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { assertManage, assertWritable, loadSection, sectionName } from './common.js';

export async function removeRole(actor, roleId) {
  const found = await UserRole.findOne({ _id: roleId, is_representative: true }).lean();
  if (!found || found.ended_at) throw notFound('Role not found.');
  const { section, semester } = await loadSection(found.section_id);
  assertManage(actor, section);
  assertWritable(semester);
  const current = semester.status === 'current';
  const name = await sectionName(section);
  const student = await User.findById(found.user_id).select('full_name').lean();

  await withTransaction(async (session) => {
    await bumpSectionRoleSeq(section.id, session);
    const ended = await UserRole.findOneAndUpdate(
      { _id: roleId, ended_at: null },
      { $set: { ended_at: clock.now(), ended_by: actor._id, ended_reason: 'removed' } },
      { session },
    );
    if (!ended) throw notFound('Role not found.');
    let escalated = 0;
    if (current && ended.role === 'cr') {
      const crLeft = await UserRole.exists({
        section_id: section.id,
        role: 'cr',
        ended_at: null,
      }).session(session);
      if (!crLeft) escalated = await escalatePendingOfSection(section.id, session);
    }
    await record({
      actor,
      action: 'representative.remove',
      scope_department_id: section.department_id,
      target: { type: 'user', id: ended.user_id },
      old_value: {
        role: ended.role,
        section_id: section.id,
        semester_id: semester.id,
        role_id: String(ended._id),
      },
      new_value: { ended: true, escalated_requests: escalated },
      session,
    });
    afterCommit(() =>
      enqueue({
        to_user_id: ended.user_id,
        template: 'role_removed',
        data: {
          name: student?.full_name ?? '',
          role: ended.role.toUpperCase(),
          section: name,
          semester: semester.name,
          link: `${getConfig().APP_URL}/login`,
        },
      }),
    );
    if (current) emitAfterCommit(`user:${ended.user_id}`, SOCKET_EVENTS.ROUTINE_CHANGED, {});
  });
}

/** CRD-10: spec 14 calls this when a semester is archived, inside its transaction. */
export async function endRolesOfSemester(semesterId, session) {
  const res = await UserRole.updateMany(
    { semester_id: semesterId, role: { $in: ['cr', 'dcr'] }, ended_at: null },
    { $set: { ended_at: clock.now(), ended_reason: 'semester_ended' } },
    { session },
  );
  return res.modifiedCount;
}

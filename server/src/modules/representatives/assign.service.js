// CRD-01 to CRD-05, CRD-09: assign a CR or DCR.
import { SOCKET_EVENTS } from '@crm/shared';
import { UserRole } from '../auth/auth.model.js';
import { representativeCandidate, activateStudentForSemester } from '../auth/index.js';
import {
  acceptedEnrolmentOf,
  createAcceptedForRepresentative,
  withdrawPendingForUser,
} from '../enrolments/index.js';
import { bumpSectionRoleSeq } from '../routine/index.js';
import { record } from '../audit/index.js';
import { enqueue } from '../notifications/index.js';
import { getConfig } from '../../config.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { AppError } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { runCrAssignedHooks, runRepAssignedHooks } from './hooks.js';
import { assertManage, assertWritable, loadSection, sectionName } from './common.js';

const roleLimit = (message) => new AppError(409, 'ROLE_LIMIT', message);
const oneRole = () =>
  new AppError(409, 'CONFLICT', 'This student already has a CR or DCR role this semester.');
const notEligible = () =>
  new AppError(
    422,
    'USER_NOT_ELIGIBLE',
    'Choose a student with a verified email who is not deactivated or graduated.',
  );

function mapDuplicate(err) {
  if (err?.code !== 11000) return err;
  const text = `${err.message} ${JSON.stringify(err.keyPattern ?? {})}`;
  if (text.includes('rep_one_cr_per_section')) return roleLimit('This section already has a CR');
  return oneRole();
}

/**
 * Assign a CR or DCR. `via` is 'manual' or 'reappoint'. Throws AppError.
 * Returns a view of the new role (no email or phone).
 */
export async function assignRole(actor, { sectionId, userId, role, via = 'manual' }) {
  const { section, semester } = await loadSection(sectionId);
  assertManage(actor, section);
  assertWritable(semester);
  const candidate = await representativeCandidate(userId);
  if (!candidate?.eligible) throw notEligible();
  const current = semester.status === 'current';
  const name = await sectionName(section);

  const created = await withTransaction(async (session) => {
    // A write to the section first: concurrent assigns conflict and run one after the other.
    await bumpSectionRoleSeq(section.id, session);
    // CRD-03: one CR/DCR role per student per semester.
    const has = await UserRole.exists({
      user_id: userId,
      semester_id: semester.id,
      is_representative: true,
      ended_at: null,
    }).session(session);
    if (has) throw oneRole();
    // CRD-02: the limits.
    const held = await UserRole.find({
      section_id: section.id,
      role: { $in: ['cr', 'dcr'] },
      ended_at: null,
    })
      .session(session)
      .lean();
    if (role === 'cr' && held.some((r) => r.role === 'cr')) {
      throw roleLimit('This section already has a CR');
    }
    if (role === 'dcr' && held.filter((r) => r.role === 'dcr').length >= 2) {
      throw roleLimit('This section already has two DCRs');
    }
    let row;
    try {
      [row] = await UserRole.create(
        [
          {
            user_id: userId,
            role,
            department_id: section.department_id,
            section_id: section.id,
            semester_id: semester.id,
            is_representative: true,
            granted_by: actor._id,
            granted_at: clock.now(),
            ended_at: null,
          },
        ],
        { session },
      );
    } catch (err) {
      throw mapDuplicate(err);
    }
    // CRD-04: the current semester takes effect at once. CRD-05: a draft only stores the role.
    if (current) {
      const existing = await acceptedEnrolmentOf(userId, semester.id, session);
      if (existing && String(existing.section_id) !== section.id) {
        throw new AppError(409, 'CONFLICT', 'This student is already enrolled in another section.');
      }
      await withdrawPendingForUser(userId, session);
      if (!existing) {
        await createAcceptedForRepresentative(
          { userId, semesterId: semester.id, sectionId: section.id, decidedBy: actor._id },
          session,
        );
      }
      await activateStudentForSemester(userId, semester.id, session);
    }
    await record({
      actor,
      action: 'representative.assign',
      scope_department_id: section.department_id,
      target: { type: 'user', id: userId },
      new_value: {
        role,
        section_id: section.id,
        semester_id: semester.id,
        role_id: String(row._id),
        via,
      },
      session,
    });
    await afterCommit(() =>
      enqueue({
        to_user_id: userId,
        template: 'role_assigned',
        data: {
          name: candidate.full_name,
          role: role.toUpperCase(),
          section: name,
          semester: semester.name,
          link: `${getConfig().APP_URL}/login`,
        },
      }),
    );
    if (current) {
      emitAfterCommit(`user:${userId}`, SOCKET_EVENTS.ROUTINE_CHANGED, {});
      if (role === 'cr') await afterCommit(() => runCrAssignedHooks(section));
      // Spec 20: a CR or DCR taking effect keeps the section group's owners in step.
      if (role === 'cr' || role === 'dcr') await afterCommit(() => runRepAssignedHooks(section));
    }
    return row;
  });
  return {
    role_id: String(created._id),
    user_id: String(userId),
    role,
    section_id: section.id,
    semester_id: semester.id,
  };
}

// ROL-03 to ROL-05: make the draft semester current in one transaction.
import { SOCKET_EVENTS } from '@crm/shared';
import { assertCan } from '../../policy/index.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { emitAfterCommit } from '../../lib/events.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { logger } from '../../lib/logger.js';
import { record } from '../audit/index.js';
import {
  archiveCurrentSemester,
  getSemester,
  promoteDraft,
  setRolloverSummary,
} from '../organisation/index.js';
import { endRolesOfSemester, rolesInEffect } from '../representatives/index.js';
import {
  acceptedEnrolmentOf,
  createAcceptedForRepresentative,
  withdrawPendingOfSemester,
} from '../enrolments/index.js';
import {
  activateStudentForSemester,
  representativeCandidate,
  unconfirmActiveStudents,
} from '../auth/index.js';
import { clearRoutineCaches } from '../routine/index.js';
import { runRolloverHooks } from './hooks.js';
import { computeReadiness, notReadyError } from './readiness.service.js';
import { sendMilestoneReminders } from './reminders.service.js';

/** The steps after the commit. The change is already saved, so a failure here is logged only. */
async function afterRollover({ archivedId, currentId }) {
  try {
    await runRolloverHooks({ archived_semester_id: archivedId, current_semester_id: currentId });
    clearRoutineCaches();
    await sendMilestoneReminders(currentId, 0);
  } catch (err) {
    logger.error({ err, semester_id: currentId }, 'rollover post-commit step failed');
  }
}

const alreadyCurrent = () =>
  new AppError(409, 'ALREADY_DECIDED', 'This semester has already been made current.');

/**
 * ROL-03 to ROL-05. Throws NOT_READY_UNCONFIRMED until every not-ready department is named in
 * `confirm_not_ready`, and ALREADY_DECIDED if the draft is no longer a draft.
 */
export async function makeCurrent(actor, semesterId, { confirm_not_ready = [] } = {}) {
  assertCan(actor, 'rollover.make_current');
  const draft = await getSemester(semesterId);
  if (!draft) throw notFound('Semester not found.');
  if (draft.status !== 'draft') throw alreadyCurrent();

  const notReady = (await computeReadiness(draft.id)).filter((d) => !d.ready);
  const unconfirmed = notReady.filter((d) => !confirm_not_ready.includes(d.code));
  if (unconfirmed.length) throw notReadyError(unconfirmed);

  const summary = await withTransaction(async (session) => {
    // ROL-04(1), (3): archive the old current semester, then promote the draft. A concurrent
    // second press finds no draft here and gets ALREADY_DECIDED (ROL-05).
    const old = await archiveCurrentSemester(session);
    const promoted = await promoteDraft(draft.id, { by: actor._id }, session);
    if (!promoted) throw alreadyCurrent();

    // ROL-04(2): the old semester's CR and DCR roles end; its pending requests are withdrawn (D2).
    const rolesEnded = old ? await endRolesOfSemester(old._id, session) : 0;
    const requestsWithdrawn = old ? await withdrawPendingOfSemester(old._id, session) : 0;

    // ROL-04(4), ROL-07: every active student becomes unconfirmed in one write.
    const studentsUnconfirmed = await unconfirmActiveStudents(session);

    // ROL-04(5): the draft's CR and DCR roles take effect (D3: ineligible accounts are skipped).
    let rolesStarted = 0;
    let rolesSkipped = 0;
    for (const role of await rolesInEffect(draft.id, session)) {
      const candidate = await representativeCandidate(role.user_id);
      if (!candidate?.eligible) {
        rolesSkipped += 1;
        continue;
      }
      const existing = await acceptedEnrolmentOf(role.user_id, draft.id, session);
      if (existing && String(existing.section_id) !== String(role.section_id)) {
        throw new AppError(
          409,
          'CONFLICT',
          'A student is already enrolled in another section this semester.',
        );
      }
      if (!existing) {
        await createAcceptedForRepresentative(
          {
            userId: role.user_id,
            semesterId: draft.id,
            sectionId: role.section_id,
            decidedBy: actor._id,
          },
          session,
        );
      }
      await activateStudentForSemester(role.user_id, draft.id, session, role.department_id);
      rolesStarted += 1;
    }

    const counts = {
      archived_semester_id: old ? old._id : null,
      students_unconfirmed: studentsUnconfirmed,
      roles_ended: rolesEnded,
      roles_started: rolesStarted,
      roles_skipped: rolesSkipped,
      requests_withdrawn: requestsWithdrawn,
      at: clock.now(),
      by: actor._id,
    };
    await setRolloverSummary(draft.id, counts, session);
    await record({
      actor,
      action: 'semester.make_current',
      target: { type: 'semester', id: draft._id },
      old_value: { archived_semester_id: counts.archived_semester_id },
      new_value: {
        students_unconfirmed: counts.students_unconfirmed,
        roles_ended: counts.roles_ended,
        roles_started: counts.roles_started,
        roles_skipped: counts.roles_skipped,
        requests_withdrawn: counts.requests_withdrawn,
      },
      session,
    });

    // After commit only: hooks, caches and the day-0 reminder (ROL-04, ROL-13).
    const archivedId = counts.archived_semester_id ? String(counts.archived_semester_id) : null;
    afterCommit(() => afterRollover({ archivedId, currentId: draft.id }));
    emitAfterCommit('everyone', SOCKET_EVENTS.ROUTINE_CHANGED, {});
    emitAfterCommit('everyone', SOCKET_EVENTS.CALENDAR_CHANGED, {});
    return counts;
  });

  return {
    id: draft.id,
    name: draft.name,
    status: 'current',
    archived_semester_id: summary.archived_semester_id
      ? String(summary.archived_semester_id)
      : null,
    students_unconfirmed: summary.students_unconfirmed,
    roles_ended: summary.roles_ended,
    roles_started: summary.roles_started,
    roles_skipped: summary.roles_skipped,
    requests_withdrawn: summary.requests_withdrawn,
  };
}

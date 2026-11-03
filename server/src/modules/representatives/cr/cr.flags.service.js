// CRD-DSH-11, CRD-DSH-12: a problem flagged to the department admin. At most 5 a CR/DCR a day.
import { clock, toInstitutionDate } from '../../../lib/time.js';
import { withTransaction } from '../../../lib/db.js';
import { AppError } from '../../../lib/errors.js';
import { record } from '../../audit/index.js';
import { enrolmentsOfSection } from '../../enrolments/index.js';
import { loadRepSection } from './cr.access.js';
import { Flag } from './flag.model.js';
import { FlagQuota } from './flag-quota.model.js';

export const FLAGS_PER_DAY = 5;

/**
 * CRD-DSH-11: count one flag against today's quota, inside the flag's transaction. The first write
 * of the day creates the counter (an equality upsert, so two first flags at once cannot both
 * insert). The second write only matches while the count is below the limit, so the check and the
 * count are one atomic step: no match means the limit is reached.
 */
async function takeFlagQuota(userId, date, session) {
  await FlagQuota.updateOne(
    { user_id: userId, date },
    { $setOnInsert: { count: 0 } },
    { upsert: true, session },
  );
  const res = await FlagQuota.updateOne(
    { user_id: userId, date, count: { $lt: FLAGS_PER_DAY } },
    { $inc: { count: 1 } },
    { session },
  );
  if (res.matchedCount === 0) {
    throw new AppError(429, 'FLAG_LIMIT', `You can raise up to ${FLAGS_PER_DAY} flags a day.`);
  }
}

/** CRD-DSH-11: raise a flag. A student, if given, must be an accepted student of this section. */
export async function raiseFlag(actor, sectionId, body) {
  const { section, semester } = await loadRepSection(actor, sectionId, 'cr.flag.raise');
  if (body.student_id) {
    const roster = await enrolmentsOfSection(section.id, semester.id, 'accepted');
    if (!roster.some((e) => String(e.user_id) === body.student_id)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
        student_id: 'Choose a student of this section',
      });
    }
  }
  const date = toInstitutionDate(clock.now());
  const flag = await withTransaction(async (session) => {
    await takeFlagQuota(actor._id, date, session);
    const [row] = await Flag.create(
      [
        {
          section_id: section.id,
          semester_id: semester.id,
          department_id: section.department_id,
          raised_by: actor._id,
          category: body.category,
          student_id: body.student_id,
          description: body.description,
          status: 'open',
        },
      ],
      { session },
    );
    await record({
      actor,
      action: 'cr.flag_raise',
      scope_department_id: section.department_id,
      target: { type: 'flag', id: row._id },
      new_value: {
        section_id: section.id,
        category: body.category,
        student_id: body.student_id ?? null,
      },
      session,
    });
    return row;
  });
  return {
    id: String(flag._id),
    category: flag.category,
    student_id: flag.student_id ? String(flag.student_id) : null,
    description: flag.description,
    status: flag.status,
    created_at: flag.created_at,
  };
}

/** Spec 15 digest: the open flags in the admin's departments (null means all). */
export async function countOpenFlags({ departmentIds }) {
  const filter = { status: 'open' };
  if (departmentIds) filter.department_id = { $in: departmentIds };
  return Flag.countDocuments(filter);
}

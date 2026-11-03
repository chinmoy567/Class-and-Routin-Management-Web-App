// ADM-03, ADM-18: the admin's list of CR/DCR flags, and resolving one. Resolving is first action wins.
import { assertCan, isAdminOf } from '../../../policy/index.js';
import { withTransaction } from '../../../lib/db.js';
import { clock } from '../../../lib/time.js';
import { AppError, notFound } from '../../../lib/errors.js';
import { record } from '../../audit/index.js';
import { studentSummaries } from '../../auth/index.js';
import { departmentNames } from '../../organisation/index.js';
import { getSectionBrief } from '../../routine/index.js';
import { label } from '../common.js';
import { Flag } from './flag.model.js';

const alreadyDecided = () => new AppError(409, 'ALREADY_DECIDED', 'This flag was already decided.');

/** The departments an admin may see flags for: one (if asked), their own, or all (null). */
function scopeFor(actor, departmentId) {
  if (departmentId) {
    // Asking for another department's list is a 403; a single flag of another department is a 404.
    if (!isAdminOf(actor, departmentId)) {
      throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do this.');
    }
    return [departmentId];
  }
  if (isAdminOf(actor, null)) return null; // super admin
  const own = (actor.roles ?? [])
    .filter((r) => r.role === 'dept_admin' && r.department_id)
    .map((r) => String(r.department_id));
  return [...new Set(own)];
}

/** ADM-03, ADM-18: flags in scope, newest first, with the student, section and who raised them. */
export async function listFlagsForAdmin(
  actor,
  { status, department_id } = {},
  { limit = 50 } = {},
) {
  assertCan(actor, 'flag.admin_list');
  const depts = scopeFor(actor, department_id);
  const filter = {};
  if (status) filter.status = status;
  if (depts) filter.department_id = { $in: depts };
  const rows = await Flag.find(filter).sort({ created_at: -1 }).limit(limit).lean();

  const [people, names] = await Promise.all([
    studentSummaries([
      ...rows.map((r) => r.raised_by),
      ...rows.filter((r) => r.student_id).map((r) => r.student_id),
    ]),
    departmentNames([...new Set(rows.map((r) => String(r.department_id)))]),
  ]);
  const sections = new Map();
  for (const sid of new Set(rows.map((r) => String(r.section_id)))) {
    sections.set(sid, await getSectionBrief(sid));
  }
  return rows.map((r) => {
    const section = sections.get(String(r.section_id));
    return {
      id: String(r._id),
      status: r.status,
      category: r.category,
      description: r.description,
      reply: r.reply ?? null,
      department: {
        id: String(r.department_id),
        code: names.get(String(r.department_id))?.code ?? '',
      },
      section: section ? { id: section.id, label: label(section) } : null,
      student: r.student_id
        ? { id: String(r.student_id), name: people.get(String(r.student_id))?.full_name ?? '' }
        : null,
      raised_by: {
        id: String(r.raised_by),
        name: people.get(String(r.raised_by))?.full_name ?? '',
      },
      created_at: r.created_at,
      resolved_at: r.resolved_at ?? null,
    };
  });
}

/**
 * ADM-18: mark an open flag fixed or rejected, with a reply. The update matches only while the flag is
 * still open, so the second decision gets ALREADY_DECIDED. An admin of another department gets 404.
 */
export async function resolveFlag(actor, flagId, { status, reply }) {
  const flag = await Flag.findById(flagId).select('department_id').lean();
  if (!flag) throw notFound('Flag not found.');
  assertCan(actor, 'flag.admin', { department_id: String(flag.department_id) });
  const now = clock.now();
  return withTransaction(async (session) => {
    const before = await Flag.findOneAndUpdate(
      { _id: flagId, status: 'open' },
      { $set: { status, reply, resolved_by: actor._id, resolved_at: now } },
      { new: false, session },
    ).lean();
    if (!before) throw alreadyDecided();
    await record({
      actor,
      action: 'flag.resolve',
      scope_department_id: before.department_id,
      target: { type: 'flag', id: before._id },
      old_value: { status: 'open' },
      new_value: { status, reply },
      session,
    });
    return { id: String(before._id), status, reply, resolved_at: now };
  });
}

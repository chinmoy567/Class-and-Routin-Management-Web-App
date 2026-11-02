// CRD-07: assign last semester's CR and DCRs to the matching section, one by one.
import { UserRole } from '../auth/auth.model.js';
import { studentSummaries } from '../auth/index.js';
import { AppError } from '../../lib/errors.js';
import { assignRole } from './assign.service.js';
import { assertManage, assertWritable, loadSection } from './common.js';
import { lastSemesterMatch } from './query.service.js';

export async function reappoint(actor, sectionId) {
  const { section, semester } = await loadSection(sectionId);
  assertManage(actor, section);
  assertWritable(semester);
  const last = await lastSemesterMatch(section, semester);
  const rows = [...(last?.rows ?? [])].sort((a, b) =>
    a.role === b.role ? 0 : a.role === 'cr' ? -1 : 1,
  ); // CR first
  const people = await studentSummaries(rows.map((r) => r.user_id));
  const assigned = [];
  const skipped = [];
  for (const r of rows) {
    const base = {
      user_id: String(r.user_id),
      full_name: people.get(String(r.user_id))?.full_name ?? '',
      role: r.role,
    };
    const already = await UserRole.exists({
      user_id: r.user_id,
      section_id: section.id,
      semester_id: semester.id,
      is_representative: true,
      ended_at: null,
    });
    if (already) {
      skipped.push({ ...base, reason: 'ALREADY_ASSIGNED' });
      continue;
    }
    try {
      const res = await assignRole(actor, {
        sectionId: section.id,
        userId: String(r.user_id),
        role: r.role,
        via: 'reappoint',
      });
      assigned.push({ ...base, role_id: res.role_id });
    } catch (err) {
      if (!(err instanceof AppError) || err.status === 403) throw err;
      skipped.push({ ...base, reason: err.code });
    }
  }
  return { assigned, skipped };
}

// Spec 18, ADM-01 to ADM-11: the admin home page, in one call. Each card's data is read through the
// owning module's exported service function. Nothing returned carries an email or a phone, except where
// specs 06 and 10 allow it, and this dashboard does not use those exceptions.
import { isReleased } from '@crm/shared';
import { assertCan, hasRole } from '../../policy/index.js';
import { recentEntries } from '../audit/index.js';
import { findDepartmentsWithoutActiveAdmin, listAdmins, userNames } from '../auth/index.js';
import { listForAdmin as listJoinForAdmin } from '../join/index.js';
import { currentSemester, departmentNames, draftSemester } from '../organisation/index.js';
import { listSectionsBrief, routineProblemsFor } from '../routine/index.js';
import { readinessFor, listOverdueUnconfirmed } from '../rollover/index.js';
import { listFlagsForAdmin, unconfirmedOfSection } from '../representatives/index.js';
import { listRegistrations } from '../teachers/index.js';
import { scopeOf } from './scope.js';

const ITEMS = 10;
const LIST = 50;
const card = (count, items) => ({ count, items: items.slice(0, ITEMS) });
const sectionLabel = (s) => `${s.level}-${s.term}-${s.letter}`;

/** ADM-01: pending teacher registrations, without the teacher's email. */
async function teacherRegistrations(actor, departmentId) {
  const rows = await listRegistrations(actor, {
    status: 'pending',
    ...(departmentId && { department_id: departmentId }),
  });
  const items = rows.map(({ email: _email, ...row }) => row);
  return card(items.length, items);
}

/** ADM-02: escalated join requests and the CR/DCR's own UV ID claims, for the admin to decide. */
async function idClaims(actor, departmentId) {
  const scope = departmentId ? { department_id: departmentId } : {};
  const escalated = await listJoinForAdmin(actor, { ...scope, view: 'escalated' }, { limit: LIST });
  const claims = await listJoinForAdmin(actor, { ...scope, view: 'claims' }, { limit: LIST });
  const items = [
    ...escalated.map((r) => ({ kind: 'escalated', ...pick(r) })),
    ...claims.map((r) => ({ kind: 'claim', ...pick(r) })),
  ];
  return card(items.length, items);
}

const pick = (r) => ({
  id: r.id,
  full_name: r.full_name,
  uv_id: r.uv_id ?? null,
  department: r.department ?? null,
  section: r.section ?? null,
  duplicate_pending_claim: Boolean(r.duplicate_pending_claim),
  created_at: r.created_at,
});

/** ADM-03: open flags raised by CR and DCR. */
async function flags(actor, departmentId) {
  const rows = await listFlagsForAdmin(
    actor,
    { status: 'open', ...(departmentId && { department_id: departmentId }) },
    { limit: LIST },
  );
  return card(rows.length, rows);
}

/** ADM-04: open appeals first, then the rejections by CR and DCR. */
async function rejectionsAndAppeals(actor, departmentId) {
  const scope = departmentId ? { department_id: departmentId } : {};
  const appeals = await listJoinForAdmin(actor, { ...scope, view: 'appeals' }, { limit: LIST });
  const rejectedAll = await listJoinForAdmin(
    actor,
    { ...scope, view: 'rejected' },
    { limit: LIST, newestFirst: true },
  );
  // A rejection that was appealed is shown once, as the appeal.
  const appealed = new Set(appeals.map((r) => r.id));
  const rejected = rejectedAll.filter((r) => !appealed.has(r.id));
  const items = [
    ...appeals.map((r) => ({ kind: 'appeal', ...pick(r), appeal: r.appeal, reason: r.reason })),
    ...rejected.map((r) => ({ kind: 'rejected', ...pick(r), reason: r.reason })),
  ];
  return card(items.length, items);
}

/** ADM-05: open import issues, cross-department duplicates and sections created by another import. */
async function routineProblems(scope) {
  const p = await routineProblemsFor(scope.ids);
  const count = p.own_issue_count + p.cross_department_count + p.created_by_other_count;
  const items = [
    ...p.own_issues.map((i) => ({ kind: 'issue', ...i })),
    ...p.cross_department.map((i) => ({ kind: 'cross_department', ...i })),
    ...p.created_by_other.map((i) => ({ kind: 'created_by_other', ...i })),
  ];
  return card(count, items);
}

/** ADM-07: the current semester, and the readiness checklist of a draft, within the admin's scope. */
async function semesterCard(actor, scope) {
  const current = await currentSemester();
  const draft = await draftSemester();
  let readiness = null;
  if (draft) {
    const view = await readinessFor(actor, draft.id);
    readiness = {
      can_make_current: view.can_make_current,
      departments: view.departments.filter((d) => scope.all || scope.ids.includes(d.id)),
    };
  }
  return {
    current: current ? { id: current.id, name: current.name, status: current.status } : null,
    draft: draft ? { id: draft.id, name: draft.name, status: draft.status } : null,
    readiness,
  };
}

/** ADM-08: departments with no active admin, and whether fewer than two super admins exist. Super admin only. */
async function missingAdmin(actor, departmentId) {
  const uncovered = await findDepartmentsWithoutActiveAdmin();
  const shown = uncovered.filter((d) => !departmentId || String(d._id) === String(departmentId));
  const { super_admin_count, fewer_than_two_super_admins } = await listAdmins(actor);
  return {
    departments: card(
      shown.length,
      shown.map((d) => ({ id: String(d._id), code: d.code, name: d.name })),
    ),
    super_admin_count,
    fewer_than_two_super_admins,
  };
}

/**
 * ADM-09: students who are still unconfirmed 14 days after the semester became current, grouped by
 * section. Students who chose "not enrolled" are left out, as in spec 14.
 */
async function unconfirmedBySection(scope) {
  const overdue = new Set(await listOverdueUnconfirmed());
  const semester = await currentSemester();
  if (!overdue.size || !semester) return card(0, []);
  const names = await departmentNames(scope.ids);
  const groups = [];
  let total = 0;
  for (const deptId of scope.ids) {
    for (const section of await listSectionsBrief(semester.id, deptId)) {
      const people = (await unconfirmedOfSection(section, semester)).filter((p) =>
        overdue.has(p.id),
      );
      if (!people.length) continue;
      total += people.length;
      groups.push({
        section: {
          id: section.id,
          label: `${names.get(deptId)?.code ?? ''} ${sectionLabel(section)}`.trim(),
        },
        students: people.map((p) => ({ id: p.id, name: p.name, state: p.state })),
      });
    }
  }
  return card(total, groups);
}

/** ADM-10: the latest 20 audit entries in scope, with the actor's name. */
async function recentActivity(scope) {
  const entries = await recentEntries(scope.all ? null : scope.ids, 20);
  const names = await userNames([...new Set(entries.map((e) => e.actor_id))]);
  const items = entries.map((e) => ({ ...e, actor_name: names.get(e.actor_id) ?? '' }));
  return card(items.length, items);
}

/** ADM-11: every card for the admin's scope, in one response. */
export async function getAdminDashboard(actor, { department_id } = {}) {
  assertCan(actor, 'admin.dashboard.view');
  const scope = await scopeOf(actor, department_id);
  const superAdmin = hasRole(actor, 'super_admin');
  const deptFilter = department_id ?? null;
  const [teachers, claims, openFlags, rejections, problems, semester, unconfirmed, recent] =
    await Promise.all([
      teacherRegistrations(actor, deptFilter),
      idClaims(actor, deptFilter),
      flags(actor, deptFilter),
      rejectionsAndAppeals(actor, deptFilter),
      routineProblems(scope),
      semesterCard(actor, scope),
      unconfirmedBySection(scope),
      recentActivity(scope),
    ]);
  const out = {
    scope: { all: scope.all, department_id: deptFilter },
    released: { room_requests: isReleased('admin.room_requests') },
    teacher_registrations: teachers,
    id_claims: claims,
    flags: openFlags,
    rejections_and_appeals: rejections,
    routine_problems: problems,
    semester,
    unconfirmed,
    recent_activity: recent,
  };
  if (superAdmin) out.missing_admin = await missingAdmin(actor, deptFilter);
  return out;
}

// ADM-05: the routine problems an admin must look at. Read-only. The admin module calls it with the
// departments in the admin's scope and gets plain rows back.
import mongoose from 'mongoose';
import { openSemesterIds, departmentNames } from '../organisation/index.js';
import { RoutineImport, Section } from './routine.model.js';

const SHOWN = 10;
const toOid = (id) => new mongoose.Types.ObjectId(id);

/**
 * ADM-05 (D6): open issues of each in-scope department's latest import, the cross-department duplicate
 * warnings that other departments' imports raised against these departments (IMP-18), and the sections
 * whose import was another department's batch (IMP-27).
 */
export async function routineProblemsFor(departmentIds) {
  if (!departmentIds.length) {
    return {
      own_issues: [],
      own_issue_count: 0,
      cross_department: [],
      cross_department_count: 0,
      created_by_other: [],
      created_by_other_count: 0,
    };
  }
  const semesters = await openSemesterIds();
  const scopeOids = departmentIds.map(toOid);
  const names = await departmentNames(departmentIds);
  const codeById = new Map(departmentIds.map((id) => [id, names.get(id)?.code ?? '']));
  const scopeCodes = new Set(codeById.values());

  // The latest import of each department, without its rows (they can be large).
  const latest = await RoutineImport.aggregate([
    // aggregate() does not cast ids, so the semester ids are converted here.
    { $match: { department_id: { $in: scopeOids }, semester_id: { $in: semesters.map(toOid) } } },
    { $sort: { uploaded_at: -1 } },
    { $project: { rows: 0, teachers: 0 } },
    { $group: { _id: '$department_id', doc: { $first: '$$ROOT' } } },
  ]);
  const ownIssues = [];
  for (const { doc } of latest) {
    const dept = String(doc.department_id);
    for (const issue of doc.issues ?? []) {
      if (issue.confirmed) continue;
      ownIssues.push({
        department: { id: dept, code: codeById.get(dept) ?? '' },
        severity: issue.severity,
        code: issue.code,
        row: issue.row,
        message: issue.message,
      });
    }
  }

  // Other departments' imports that name one of these departments in a cross-department duplicate.
  const others = await RoutineImport.find({
    semester_id: { $in: semesters },
    department_id: { $nin: scopeOids },
    'issues.code': 'CROSS_DEPARTMENT_DUPLICATE',
  })
    .select('department_id issues')
    .lean();
  const otherNames = await departmentNames([
    ...new Set(others.map((o) => String(o.department_id))),
  ]);
  const crossDepartment = [];
  for (const imp of others) {
    for (const issue of imp.issues ?? []) {
      if (issue.code !== 'CROSS_DEPARTMENT_DUPLICATE' || issue.confirmed) continue;
      if (!scopeCodes.has(issue.other_department)) continue;
      crossDepartment.push({
        department: {
          id: String(imp.department_id),
          code: otherNames.get(String(imp.department_id))?.code ?? '',
        },
        other_department: issue.other_department,
        message: issue.message,
      });
    }
  }

  // IMP-27: sections of these departments that another department's import created.
  const sections = await Section.find({
    semester_id: { $in: semesters },
    department_id: { $in: scopeOids },
    created_by_import_of: { $exists: true, $ne: null },
  })
    .select('department_id level term letter created_by_import_of')
    .lean();
  const creators = await departmentNames([
    ...new Set(sections.map((s) => String(s.created_by_import_of))),
  ]);
  const createdBy = [];
  for (const s of sections) {
    if (String(s.created_by_import_of) === String(s.department_id)) continue;
    createdBy.push({
      section: { id: String(s._id), label: `${s.level}-${s.term}-${s.letter}` },
      department: {
        id: String(s.department_id),
        code: codeById.get(String(s.department_id)) ?? '',
      },
      created_by_department: creators.get(String(s.created_by_import_of))?.code ?? '',
    });
  }

  return {
    own_issues: ownIssues.slice(0, SHOWN),
    own_issue_count: ownIssues.length,
    cross_department: crossDepartment.slice(0, SHOWN),
    cross_department_count: crossDepartment.length,
    created_by_other: createdBy.slice(0, SHOWN),
    created_by_other_count: createdBy.length,
  };
}

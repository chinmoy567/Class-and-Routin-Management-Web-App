import { IMPORT_MAX_BYTES } from '@crm/shared';
import { RoutineImport, Section, SectionGroup } from './routine.model.js';
import { parseRoutineRows, parseTeacherSheet } from './parse.js';
import { countIssues, numberIssues, teacherKey, validateRows } from './validate.js';
import { buildDiff } from './diff.js';
import { readTemplate, sniffXlsx } from './xlsx.js';
import { loadSlots, sectionKey } from './slots.loader.js';
import { idOk, resolveDepartmentScope } from './scope.js';
import { assertCan, can } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { putImportFile } from '../../lib/gridfs.js';
import { scanBuffer } from '../../lib/clamav.js';
import { AppError, notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';
import { User } from '../auth/index.js';
import { departmentNames, getSemester, listActiveDepartments } from '../organisation/index.js';
import { resolve as resolveRoom } from '../rooms/index.js';
import { directoryFor } from '../teachers/index.js';

const OPEN = ['draft', 'current'];

export const alreadyDecided = () =>
  new AppError(409, 'ALREADY_DECIDED', 'This import has already been decided.');
const archived = () =>
  new AppError(409, 'SEMESTER_ARCHIVED', 'Only a draft or current semester can be imported.');

const summary = (imp, uploaderNames) => ({
  id: String(imp._id),
  semester_id: String(imp.semester_id),
  department_id: String(imp.department_id),
  status: imp.status,
  uploaded_by: { id: String(imp.uploaded_by), full_name: uploaderNames?.get(String(imp.uploaded_by)) ?? '' },
  uploaded_at: imp.uploaded_at,
  published_at: imp.published_at ?? null,
  counts: imp.counts ?? {},
});

/** Load an import for an admin. Another department's import looks like it does not exist. */
export async function loadImportFor(actor, id) {
  assertCan(actor, 'import.access');
  const imp = idOk(id) ? await RoutineImport.findById(id).lean() : null;
  if (!imp || !can(actor, 'import.manage', { department_id: imp.department_id })) throw notFound();
  return imp;
}

async function activeDepartmentMap() {
  const list = await listActiveDepartments();
  return new Map(list.map((d) => [d.code.toUpperCase(), { id: d.id }]));
}

/** Parse, resolve and check a template. Returns what is stored on the import. */
async function analyse({ read, semesterId, departmentId }) {
  const activeDepartments = await activeDepartmentMap();
  const { rows, issues: rowIssues } = parseRoutineRows(read.routine, { activeDepartments });
  const { entries, issues: teacherIssues } = parseTeacherSheet(
    read.teachers.map((t) => ({ row: t.row, cells: t.cells })),
    { activeDepartments },
  );

  // IMP-06: rooms are matched by code or alias, never created.
  const roomCache = new Map();
  for (const r of rows) {
    if (!r.room_text) continue;
    if (!roomCache.has(r.room_text)) roomCache.set(r.room_text, await resolveRoom(r.room_text));
    const room = roomCache.get(r.room_text);
    r.room_id = room?.id ?? null;
    r.room_code = room?.code ?? null;
  }
  for (const r of rows) {
    r.room_id ??= null;
    r.teacher_keys = r.teachers.map(teacherKey);
    r.combined_key = null;
  }

  // IMP-08: the saved directory, keyed by `DEPT:CODE`.
  const pairs = new Map();
  for (const r of rows) {
    for (const t of r.teachers) {
      const dept = activeDepartments.get(t.department_code);
      if (dept) pairs.set(`${dept.id}:${t.short_code}`, { department_id: dept.id, short_code: t.short_code });
    }
  }
  for (const e of entries) pairs.set(`${e.department_id}:${e.short_code}`, e);
  const saved = await directoryFor([...pairs.values()]);
  const idToCode = new Map([...activeDepartments].map(([code, d]) => [d.id, code]));
  const directory = new Map();
  for (const [key, rec] of saved) {
    const [deptId, code] = key.split(':');
    directory.set(`${idToCode.get(deptId)}:${code}`, rec.full_name);
  }

  // IMP-18, IMP-22: other departments' published slots of this semester.
  const otherSlots = await loadSlots({
    semester_id: semesterId,
    published: true,
    owner_department_id: { $ne: departmentId },
  });
  const owners = await departmentNames(otherSlots.map((s) => s.owner_department_id));
  const others = otherSlots.map((s) => ({
    ...s,
    department_code: owners.get(s.owner_department_id)?.code ?? '',
  }));

  const issues = numberIssues([
    ...rowIssues,
    ...teacherIssues,
    ...validateRows({ rows, teacherEntries: entries, directory, others }),
  ]);
  return {
    rows,
    teachers: entries,
    issues,
    counts: { rows: rows.length, ...countIssues(issues) },
  };
}

/** IMP-02, IMP-03 */
export async function uploadImport(actor, semesterId, departmentId, buffer) {
  assertCan(actor, 'import.access');
  const deptId = resolveDepartmentScope(actor, departmentId);
  assertCan(actor, 'import.manage', { department_id: deptId });
  const semester = await getSemester(semesterId);
  if (!semester) throw notFound('Semester not found.');
  if (!OPEN.includes(semester.status)) throw archived();
  const depts = await activeDepartmentMap();
  if (![...depts.values()].some((d) => d.id === deptId)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      department_id: 'Choose an active department',
    });
  }

  if (!Buffer.isBuffer(buffer) || !buffer.length || !sniffXlsx(buffer)) {
    throw new AppError(415, 'FILE_TYPE_NOT_ALLOWED', 'Upload a plain .xlsx file.');
  }
  if (buffer.length > IMPORT_MAX_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'The file must be 5 MB or smaller.');
  }
  let scan;
  try {
    scan = await scanBuffer(buffer);
  } catch {
    throw new AppError(503, 'SCAN_UNAVAILABLE', 'The file could not be scanned. Try again later.');
  }
  if (scan.infected) throw new AppError(422, 'FILE_INFECTED', 'The file was rejected by the virus scan.');

  const file_id = await putImportFile(buffer, {
    department_id: deptId,
    semester_id: semesterId,
    uploaded_by: String(actor._id),
  });

  const read = await readTemplate(buffer);
  const base = {
    semester_id: semesterId,
    department_id: deptId,
    file_id,
    uploaded_by: actor._id,
    uploaded_at: clock.now(),
  };
  const stored = read
    ? { status: 'checked', ...(await analyse({ read, semesterId, departmentId: deptId })) }
    : {
        status: 'failed',
        rows: [],
        teachers: [],
        issues: [
          {
            id: '0',
            severity: 'error',
            code: 'FILE_UNREADABLE',
            row: 0,
            message: 'The file could not be read as the routine template.',
            related_rows: [],
          },
        ],
        counts: { rows: 0, errors: 1, warnings: 0 },
      };

  const imp = await withTransaction(async (session) => {
    if (stored.status === 'checked') {
      await RoutineImport.updateMany(
        { semester_id: semesterId, department_id: deptId, status: 'checked' },
        { $set: { status: 'replaced' } },
        { session },
      );
    }
    const [created] = await RoutineImport.create([{ ...base, ...stored }], { session });
    await record({
      actor,
      action: 'routine.import_upload',
      scope_department_id: deptId,
      target: { type: 'routine_import', id: created._id },
      new_value: { status: stored.status, ...stored.counts },
      session,
    });
    return created.toObject();
  });
  return summary(imp, new Map([[String(actor._id), actor.full_name]]));
}

/** IMP-32 */
export async function listImports(actor, semesterId, departmentId) {
  assertCan(actor, 'import.access');
  const deptId = resolveDepartmentScope(actor, departmentId);
  if (!can(actor, 'import.manage', { department_id: deptId })) throw notFound();
  if (!(await getSemester(semesterId))) throw notFound('Semester not found.');
  const rows = await RoutineImport.find({ semester_id: semesterId, department_id: deptId })
    .select('-rows -issues -teachers')
    .sort({ uploaded_at: -1, _id: -1 })
    .lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.uploaded_by) } })
    .select('full_name')
    .lean();
  const names = new Map(users.map((u) => [String(u._id), u.full_name]));
  const open = rows.find((r) => r.status === 'checked');
  return {
    imports: rows.map((r) => summary(r, names)),
    open_import_id: open ? String(open._id) : null,
  };
}

const rowForDiff = (r) => ({ ...r, group: r.group ?? null });

/** The department's own published slots and the diff against this import (IMP-24). */
export async function diffFor(imp, { session } = {}) {
  const existing = await loadSlots(
    { semester_id: imp.semester_id, owner_department_id: imp.department_id, published: true },
    { session },
  );
  return { existing, diff: buildDiff(existing, imp.rows.map(rowForDiff)) };
}

const slotView = (s) => ({
  id: s.id,
  section_key: s.section_key,
  group: s.group,
  day: s.day,
  start_min: s.start_min,
  end_min: s.end_min,
  course_code: s.course_code,
  teacher_keys: s.teacher_keys,
  edited_by_hand: s.edited_by_hand,
});
const rowView = (r) => ({
  row: r.row,
  section_key: r.section_key,
  group: r.group,
  day: r.day,
  start_min: r.start_min,
  end_min: r.end_min,
  course_code: r.course_code,
  course_name: r.course_name,
  room_code: r.room_code,
  teacher_keys: r.teacher_keys,
  tba: r.tba,
  combined_key: r.combined_key ?? null,
});

/** IMP-23, IMP-24 */
export async function previewImport(actor, id) {
  const imp = await loadImportFor(actor, id);
  const summaryView = summary(imp);
  if (imp.status === 'failed') {
    return { import: summaryView, sections: [], issues: imp.issues, diff: null, teachers: [] };
  }

  const keys = [...new Set(imp.rows.map((r) => r.section_key).filter(Boolean))];
  const sectionDocs = await Section.find({ semester_id: imp.semester_id }).lean();
  const existingKeys = new Set(sectionDocs.map((s) => sectionKey(s)));
  const groupDocs = await SectionGroup.find({
    section_id: { $in: sectionDocs.map((s) => s._id) },
  }).lean();
  const sectionIdOfKey = new Map(sectionDocs.map((s) => [sectionKey(s), String(s._id)]));
  const groupSet = new Set(groupDocs.map((g) => `${g.section_id}:${g.label}`));
  const names = await departmentNames(imp.rows.map((r) => r.department_id).filter(Boolean));

  const sections = keys.map((key) => {
    const rows = imp.rows.filter((r) => r.section_key === key);
    const first = rows[0];
    const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].sort();
    const sid = sectionIdOfKey.get(key);
    return {
      key,
      department_code: names.get(String(first.department_id))?.code ?? first.department_code,
      level: first.level,
      term: first.term,
      letter: first.letter,
      new: !existingKeys.has(key),
      groups: groups.map((label) => ({ label, new: !sid || !groupSet.has(`${sid}:${label}`) })),
      rows: rows
        .map(rowView)
        .sort((a, b) => a.day - b.day || a.start_min - b.start_min || a.row - b.row),
    };
  });
  sections.sort((a, b) => a.key.localeCompare(b.key));

  let diff = null;
  if (imp.status === 'checked') {
    const { existing, diff: d } = await diffFor(imp);
    if (existing.length) {
      const handEdited = (s) => s.edited_by_hand;
      const keep = imp.keep_choices ?? {};
      diff = {
        added: d.added.map(rowView),
        removed: d.removed.map((s) => ({
          ...slotView(s),
          choice: handEdited(s) ? (keep[s.id] ?? 'keep') : null,
        })),
        changed: d.changed.map(({ slot, row }) => ({
          slot: {
            ...slotView(slot),
            choice: handEdited(slot) ? (keep[slot.id] ?? 'keep') : null,
          },
          row: rowView(row),
        })),
      };
    }
  }
  return {
    import: summaryView,
    sections,
    issues: imp.issues,
    teachers: imp.teachers,
    diff,
  };
}

/** IMP-21: confirm a combined class. */
export async function confirmIssue(actor, id, issueId) {
  const imp = await loadImportFor(actor, id);
  if (imp.status !== 'checked') throw alreadyDecided();
  const issue = imp.issues.find((i) => i.id === issueId);
  if (!issue) throw notFound('Issue not found.');
  if (!issue.offer_combined) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      issueId: 'This issue cannot be confirmed as a combined class',
    });
  }
  if (issue.confirmed) throw alreadyDecided();

  const members = [...new Set([issue.row, ...issue.related_rows])];
  const existingKey = imp.rows.find((r) => members.includes(r.row) && r.combined_key)?.combined_key;
  const key = existingKey ?? `${imp._id}:c${clock.now().getTime().toString(36)}${members[0]}`;
  const groupRows = new Set(
    imp.rows.filter((r) => members.includes(r.row) || r.combined_key === key).map((r) => r.row),
  );
  const confirmIds = imp.issues
    .filter(
      (i) =>
        i.offer_combined &&
        !i.confirmed &&
        [i.row, ...i.related_rows].every((n) => groupRows.has(n)),
    )
    .map((i) => i.id);

  const updated = await RoutineImport.findOneAndUpdate(
    {
      _id: imp._id,
      status: 'checked',
      issues: { $elemMatch: { id: issueId, confirmed: { $ne: true } } },
    },
    {
      $set: { 'rows.$[r].combined_key': key, 'issues.$[i].confirmed': true },
      $inc: { 'counts.warnings': -confirmIds.length },
    },
    {
      arrayFilters: [{ 'r.row': { $in: [...groupRows] } }, { 'i.id': { $in: confirmIds } }],
      returnDocument: 'after',
    },
  ).lean();
  if (!updated) throw alreadyDecided();
  return { combined_key: key, confirmed_issue_ids: confirmIds, counts: updated.counts };
}

/** IMP-24: keep or replace, per hand-edited slot. */
export async function setKeepChoices(actor, id, choices) {
  const imp = await loadImportFor(actor, id);
  if (imp.status !== 'checked') throw alreadyDecided();
  const { diff } = await diffFor(imp);
  const valid = new Set(
    [...diff.removed, ...diff.changed.map((c) => c.slot)]
      .filter((s) => s.edited_by_hand)
      .map((s) => s.id),
  );
  const bad = Object.keys(choices).filter((k) => !valid.has(k));
  if (bad.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
      keep_choices: 'Only slots edited by hand can be kept or replaced',
    });
  }
  const set = Object.fromEntries(Object.entries(choices).map(([k, v]) => [`keep_choices.${k}`, v]));
  const updated = Object.keys(set).length
    ? await RoutineImport.findOneAndUpdate(
        { _id: imp._id, status: 'checked' },
        { $set: set },
        { returnDocument: 'after' },
      ).lean()
    : imp;
  if (!updated) throw alreadyDecided();
  return { keep_choices: updated.keep_choices ?? {} };
}

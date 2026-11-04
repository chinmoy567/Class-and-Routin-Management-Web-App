import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearDb } from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { Semester } from '../../organisation/index.js';
import { RoutineImport, Section } from '../routine.model.js';
import { routineProblemsFor } from '../problems.service.js';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(clearDb);

async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const eee = await createDepartment({ code: 'EEE' });
  const law = await createDepartment({ code: 'LAW' });
  const sem = await Semester.create({
    name: 'Spring 2027',
    start_date: '2027-04-04',
    end_date: '2027-10-04',
    status: 'current',
  });
  const uploader = await makeUser({ kind: 'teacher', state: 'active' });
  const imp = (over) => ({
    semester_id: sem._id,
    status: 'checked',
    rows: [],
    teachers: [],
    counts: {},
    uploaded_by: uploader._id,
    uploaded_at: new Date('2027-04-05T04:00:00Z'),
    ...over,
  });
  return { cse, eee, law, sem, imp };
}

const issue = (row, extra = {}) => ({
  severity: 'error',
  code: 'BAD',
  row,
  message: `row ${row}`,
  ...extra,
});

describe('ADM-05 routine problems reader', () => {
  it('ADM-05 an empty scope gives empty lists and zero counts', async () => {
    await world();
    const out = await routineProblemsFor([]);
    expect(out).toEqual({
      own_issues: [],
      own_issue_count: 0,
      cross_department: [],
      cross_department_count: 0,
      created_by_other: [],
      created_by_other_count: 0,
    });
  });

  it('ADM-05 only the latest import of each department counts; an older import is ignored', async () => {
    const w = await world();
    await RoutineImport.create(
      w.imp({
        department_id: w.cse._id,
        status: 'replaced',
        issues: [issue(1)],
        uploaded_at: new Date('2027-04-01T04:00:00Z'),
      }),
    );
    await RoutineImport.create(
      w.imp({
        department_id: w.cse._id,
        issues: [issue(9)],
        uploaded_at: new Date('2027-04-05T04:00:00Z'),
      }),
    );
    const out = await routineProblemsFor([String(w.cse._id)]);
    expect(out.own_issues.map((i) => i.row)).toEqual([9]);
  });

  it('ADM-05 a confirmed issue is not an open problem', async () => {
    const w = await world();
    await RoutineImport.create(
      w.imp({ department_id: w.cse._id, issues: [issue(2), issue(3, { confirmed: true })] }),
    );
    const out = await routineProblemsFor([String(w.cse._id)]);
    expect(out.own_issues.map((i) => i.row)).toEqual([2]);
  });

  it('ADM-05 the lists show at most 10 items, and the counts give the full number', async () => {
    const w = await world();
    const many = Array.from({ length: 12 }, (_, i) => issue(i + 1));
    await RoutineImport.create(w.imp({ department_id: w.cse._id, issues: many }));
    const out = await routineProblemsFor([String(w.cse._id)]);
    expect(out.own_issues).toHaveLength(10);
    expect(out.own_issue_count).toBe(12);
  });

  it('ADM-05 a cross-department warning naming a department outside the scope is not shown', async () => {
    const w = await world();
    await RoutineImport.create(
      w.imp({
        department_id: w.eee._id,
        issues: [
          issue(4, {
            severity: 'warning',
            code: 'CROSS_DEPARTMENT_DUPLICATE',
            other_department: 'LAW',
          }),
        ],
      }),
    );
    const cseOnly = await routineProblemsFor([String(w.cse._id)]);
    expect(cseOnly.cross_department_count).toBe(0);
    const lawToo = await routineProblemsFor([String(w.law._id)]);
    expect(lawToo.cross_department_count).toBe(1);
    expect(lawToo.cross_department[0]).toMatchObject({
      department: { code: 'EEE' },
      other_department: 'LAW',
    });
  });

  it("ADM-05 a section created by the department's own import is not reported (IMP-27 only for other batches)", async () => {
    const w = await world();
    await Section.create({
      semester_id: w.sem._id,
      department_id: w.cse._id,
      level: 1,
      term: 'I',
      letter: 'A',
      created_by_import_of: w.cse._id,
    });
    const out = await routineProblemsFor([String(w.cse._id)]);
    expect(out.created_by_other_count).toBe(0);
  });

  it('ADM-05 the same issues stay visible to every department named in the scope (IMP-18 both sides)', async () => {
    const w = await world();
    const ids = [String(w.cse._id), String(w.eee._id)];
    await RoutineImport.create(
      w.imp({ department_id: new mongoose.Types.ObjectId(), issues: [issue(5)] }),
    );
    const out = await routineProblemsFor(ids);
    expect(out.own_issue_count).toBe(0);
  });
});

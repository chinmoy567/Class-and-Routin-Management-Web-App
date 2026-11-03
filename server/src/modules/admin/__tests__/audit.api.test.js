import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  fixClock,
  loginAs,
  resetClock,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { AuditLog } from '../../audit/index.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearDb();
  fixClock('2027-04-06T04:00:00Z');
});
afterEach(resetClock);

async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const eee = await createDepartment({ code: 'EEE' });
  const cseAdmin = await makeUser({
    kind: 'teacher',
    state: 'active',
    name: 'CSE Admin',
    roles: [{ role: 'dept_admin', department_id: cse._id }],
  });
  const superAdmin = await makeUser({
    kind: 'staff',
    state: 'active',
    name: 'Super Admin',
    roles: [{ role: 'super_admin' }],
  });
  const student = await makeUser({ kind: 'student', state: 'active', departmentId: cse._id });
  const eeeTarget = new mongoose.Types.ObjectId();
  const row = (over) => ({
    actor_id: cseAdmin._id,
    actor_roles: [],
    action: 'student.graduate',
    target_type: 'user',
    target_id: new mongoose.Types.ObjectId(),
    at: new Date('2027-04-06T04:00:00Z'),
    ...over,
  });
  await AuditLog.create([
    row({ scope_department_id: cse._id, action: 'cse.entry' }),
    row({
      scope_department_id: eee._id,
      action: 'eee.entry',
      target_id: eeeTarget,
      actor_id: superAdmin._id,
    }),
    row({ scope_department_id: undefined, action: 'university.entry', actor_id: superAdmin._id }),
  ]);
  return { cse, eee, cseAdmin, superAdmin, student, eeeTarget };
}

describe('ADM-19 audit log viewer', () => {
  it('ADM-19 a CSE admin never sees an EEE entry, by any filter', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const all = await agent.get('/api/admin/audit');
    expect(all.status).toBe(200);
    expect(all.body.data.entries.map((e) => e.action)).toEqual(['cse.entry']);
    const byTarget = await agent.get('/api/admin/audit').query({ target_id: String(w.eeeTarget) });
    expect(byTarget.body.data.entries).toEqual([]);
    const byActor = await agent
      .get('/api/admin/audit')
      .query({ actor_id: String(w.superAdmin._id) });
    expect(byActor.body.data.entries).toEqual([]);
  });

  it('ADM-19 a super admin sees every entry, university-wide ones included', async () => {
    const w = await world();
    const agent = await loginAs(w.superAdmin, app);
    const res = await agent.get('/api/admin/audit');
    expect(res.body.data.entries.map((e) => e.action).sort()).toEqual([
      'cse.entry',
      'eee.entry',
      'university.entry',
    ]);
  });

  it('ADM-19 filters by exact action and by a family ending with a dot', async () => {
    const w = await world();
    const agent = await loginAs(w.superAdmin, app);
    const exact = await agent.get('/api/admin/audit').query({ action: 'eee.entry' });
    expect(exact.body.data.entries.map((e) => e.action)).toEqual(['eee.entry']);
    const family = await agent.get('/api/admin/audit').query({ action: 'eee.' });
    expect(family.body.data.entries.map((e) => e.action)).toEqual(['eee.entry']);
  });

  it('ADM-19 filters by a date range in Asia/Dhaka days', async () => {
    const w = await world();
    const agent = await loginAs(w.superAdmin, app);
    const onDay = await agent
      .get('/api/admin/audit')
      .query({ from: '2027-04-06', to: '2027-04-06' });
    expect(onDay.body.data.entries).toHaveLength(3);
    const other = await agent
      .get('/api/admin/audit')
      .query({ from: '2027-04-07', to: '2027-04-07' });
    expect(other.body.data.entries).toEqual([]);
  });

  it('ADM-19 shows the actor name, never an email or a phone', async () => {
    const w = await world();
    const agent = await loginAs(w.cseAdmin, app);
    const res = await agent.get('/api/admin/audit');
    expect(res.body.data.entries[0].actor_name).toBe('CSE Admin');
    expect(JSON.stringify(res.body)).not.toMatch(/@|\+?880/);
  });

  it('ADM-19 pages with a cursor, and the cursor reaches every entry', async () => {
    const w = await world();
    const agent = await loginAs(w.superAdmin, app);
    const first = await agent.get('/api/admin/audit').query({ limit: 2 });
    expect(first.body.data.entries).toHaveLength(2);
    expect(first.body.data.next_cursor).toBeTruthy();
    const second = await agent
      .get('/api/admin/audit')
      .query({ limit: 2, cursor: first.body.data.next_cursor });
    expect(second.body.data.entries).toHaveLength(1);
    expect(second.body.data.next_cursor).toBeNull();
  });

  it('ADM-19 the log cannot be edited or deleted: no such endpoint exists', async () => {
    const w = await world();
    const agent = await loginAs(w.superAdmin, app);
    const entry = await AuditLog.findOne({ action: 'cse.entry' }).lean();
    const id = String(entry._id);
    expect((await agent.patch(`/api/admin/audit/${id}`).send({ action: 'changed' })).status).toBe(
      404,
    );
    expect((await agent.put(`/api/admin/audit/${id}`).send({ action: 'changed' })).status).toBe(
      404,
    );
    expect((await agent.delete(`/api/admin/audit/${id}`)).status).toBe(404);
    expect((await agent.delete('/api/admin/audit')).status).toBe(404);
    expect((await AuditLog.findById(id).lean()).action).toBe('cse.entry');
  });

  it('ADM-19 a student cannot read the audit log (403)', async () => {
    const w = await world();
    const agent = await loginAs(w.student, app);
    expect((await agent.get('/api/admin/audit')).status).toBe(403);
  });

  it('ADM-19 an invalid date is refused (400)', async () => {
    const w = await world();
    const agent = await loginAs(w.superAdmin, app);
    expect((await agent.get('/api/admin/audit').query({ from: '06/04/2027' })).status).toBe(400);
  });
});

describe('ADM-19 hostile input is refused cleanly', () => {
  it('ADM-19 an impossible calendar date is refused (400), not a server error', async () => {
    const w = await world();
    const agent = await loginAs(w.superAdmin, app);
    const res = await agent.get('/api/admin/audit').query({ from: '2027-02-30' });
    expect(res.status).toBe(400);
  });

  it('ADM-19 a malformed cursor is refused (400), not a server error', async () => {
    const w = await world();
    const agent = await loginAs(w.superAdmin, app);
    const res = await agent.get('/api/admin/audit').query({ cursor: 'not-a-cursor' });
    expect(res.status).toBe(400);
  });
});

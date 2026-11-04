import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import { resetRoomUsage, resolve } from '../index.js';
import { RoomNameGuard } from '../rooms.model.js';
import { list as auditList } from '../../audit/index.js';
import { STATES_BY_KIND } from '@crm/shared';

// Gaps left open by the spec 05 verification run (test-results/2026-11-02_01-59_05-classrooms):
// CSRF and anonymous refusal on room writes, the account-state matrix on every admin endpoint,
// simultaneous retires, renames and share updates, and the guard upsert branch of the service.

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(clearDb);
afterEach(() => {
  resetRoomUsage();
  vi.restoreAllMocks();
});

const asDeptAdmin = async (dept, state = 'active') =>
  loginAs(
    await makeUser({
      kind: 'staff',
      state,
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    }),
    app,
  );

/** A CSE room with one alias, created by an active CSE admin. */
async function seedRoom(code = '311') {
  const cse = await createDepartment();
  const admin = await asDeptAdmin(cse);
  const room = (
    await admin.post('/api/admin/rooms').send({ code, type: 'classroom', department_id: cse.id })
  ).body.data;
  const alias = (
    await admin.post(`/api/admin/rooms/${room.id}/aliases`).send({ alias: `RN: ${code}` })
  ).body.data;
  return { cse, admin, room, alias };
}

describe('classrooms gaps (spec 05)', () => {
  it('ROOM-04 a room write without a valid CSRF token is refused with 403 and changes nothing', async () => {
    const { admin, room, alias, cse } = await seedRoom();
    const eee = await createDepartment();
    const bad = (req) => req.set('X-CSRF-Token', 'not-the-token');
    const writes = [
      () =>
        bad(admin.post('/api/admin/rooms')).send({
          code: 'LAB1',
          type: 'lab',
          department_id: cse.id,
        }),
      () => bad(admin.patch(`/api/admin/rooms/${room.id}`)).send({ code: '999' }),
      () => bad(admin.post(`/api/admin/rooms/${room.id}/aliases`)).send({ alias: 'New Name' }),
      () => bad(admin.delete(`/api/admin/rooms/${room.id}/aliases/${alias.id}`)),
      () => bad(admin.put(`/api/admin/rooms/${room.id}/shares`)).send({ department_ids: [eee.id] }),
      () => bad(admin.post(`/api/admin/rooms/${room.id}/retire`)),
    ];
    for (const write of writes) {
      const res = await write();
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_FAILED');
    }
    const after = (await admin.get('/api/admin/rooms').query({ department_id: cse.id })).body.data;
    expect(after.owned[0]).toMatchObject({ code: '311', retired: false });
    expect(after.owned[0].aliases.map((a) => a.alias)).toEqual(['RN: 311']);
    expect(await auditList({ action: 'room.retire' })).toHaveLength(0);
  });

  it('ROOM-04 an anonymous caller is refused every admin room endpoint with 401', async () => {
    const { room, alias } = await seedRoom();
    const anon = await loginAs(null, app);
    const calls = [
      anon.get('/api/admin/rooms'),
      anon
        .post('/api/admin/rooms')
        .send({ code: 'X1', type: 'lab', department_id: 'a'.repeat(24) }),
      anon.patch(`/api/admin/rooms/${room.id}`).send({ code: '999' }),
      anon.post(`/api/admin/rooms/${room.id}/aliases`).send({ alias: 'Z' }),
      anon.delete(`/api/admin/rooms/${room.id}/aliases/${alias.id}`),
      anon.put(`/api/admin/rooms/${room.id}/shares`).send({ department_ids: [] }),
      anon.post(`/api/admin/rooms/${room.id}/retire`),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
    expect(await resolve('311')).not.toBeNull();
  });

  it('ROOM-04 every account state that is not allowed to use the admin room endpoints is refused', async () => {
    const { cse, room, alias } = await seedRoom();
    // Staff accounts can only be active or deactivated. A deactivated admin keeps the role but
    // loses the access. Students and teachers hold no admin role, so every state of theirs
    // must be refused too (the same admin endpoints, whatever their state).
    const cases = [
      ...STATES_BY_KIND.student.map((state) => ({ kind: 'student', state, role: false })),
      ...STATES_BY_KIND.teacher.map((state) => ({ kind: 'teacher', state, role: false })),
      { kind: 'staff', state: 'deactivated', role: true },
    ];
    for (const { kind, state, role } of cases) {
      const user = role
        ? await makeUser({ kind, state, roles: [{ role: 'dept_admin', department_id: cse._id }] })
        : await makeUser({ kind, state });
      const agent = await loginAs(user, app);
      const calls = [
        agent.get('/api/admin/rooms').query({ department_id: cse.id }),
        agent
          .post('/api/admin/rooms')
          .send({ code: `L-${state}`, type: 'lab', department_id: cse.id }),
        agent.patch(`/api/admin/rooms/${room.id}`).send({ code: `R-${state}` }),
        agent.post(`/api/admin/rooms/${room.id}/aliases`).send({ alias: `A-${state}` }),
        agent.delete(`/api/admin/rooms/${room.id}/aliases/${alias.id}`),
        agent.put(`/api/admin/rooms/${room.id}/shares`).send({ department_ids: [] }),
        agent.post(`/api/admin/rooms/${room.id}/retire`),
      ];
      for (const res of await Promise.all(calls)) {
        expect([401, 403], `${kind} ${state}`).toContain(res.status);
      }
    }
    // Nothing changed: the code is still 311, the alias is still there, the room is not retired.
    expect(await resolve('311')).toMatchObject({ id: room.id, retired: false });
    expect(await resolve('RN: 311')).toMatchObject({ id: room.id });
    expect(await auditList({ action: 'room.retire' })).toHaveLength(0);
  });

  it('ROOM-06 five retires of one room at the same time: all succeed, one audit entry', async () => {
    const { admin, room, cse } = await seedRoom();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => admin.post(`/api/admin/rooms/${room.id}/retire`)),
    );
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: room.id, retired: true });
    }
    expect(await auditList({ action: 'room.retire' })).toHaveLength(1);
    expect(await resolve('311')).toBeNull();
    const rows = (await admin.get('/api/admin/rooms').query({ department_id: cse.id })).body.data;
    expect(rows.owned[0].retired).toBe(true);
  });

  it('ROOM-05 two renames of one room at the same time: no server error, names stay consistent', async () => {
    const { admin, room } = await seedRoom();
    const results = await Promise.all([
      admin.patch(`/api/admin/rooms/${room.id}`).send({ code: 'AAA1' }),
      admin.patch(`/api/admin/rooms/${room.id}`).send({ code: 'BBB2' }),
    ]);
    const statuses = results.map((r) => r.status);
    for (const s of statuses) expect([200, 409]).toContain(s);

    const winners = results.filter((r) => r.status === 200).map((r) => r.body.data.code);
    expect(winners.length).toBeGreaterThanOrEqual(1);
    expect(winners).toContain((await resolve(winners[winners.length - 1])).code);
    expect(await auditList({ action: 'room.update' })).toHaveLength(winners.length);

    // Whichever rename won, the old code and every earlier code still find the same room.
    const current = await resolve(winners[winners.length - 1]);
    expect(current.id).toBe(room.id);
    expect(await resolve('311')).toMatchObject({ id: room.id });
    expect(await resolve('RN: 311')).toMatchObject({ id: room.id });
  });

  it('ROOM-04 two share updates at the same time leave exactly one of the two lists, never a mix', async () => {
    const { admin, room, cse } = await seedRoom();
    const eee = await createDepartment();
    const mec = await createDepartment();
    const results = await Promise.all([
      admin.put(`/api/admin/rooms/${room.id}/shares`).send({ department_ids: [eee.id] }),
      admin.put(`/api/admin/rooms/${room.id}/shares`).send({ department_ids: [mec.id] }),
    ]);
    for (const res of results) expect(res.status).toBe(200);

    const rows = (await admin.get('/api/admin/rooms').query({ department_id: cse.id })).body.data;
    const shared = rows.owned[0].shares.map((s) => s.department_id).sort();
    expect([[eee.id].sort(), [mec.id].sort()]).toContainEqual(shared);
  });

  it('ROOM-01 a failed write to the name guard stops the create and returns an error', async () => {
    const cse = await createDepartment();
    const admin = await asDeptAdmin(cse);
    vi.spyOn(RoomNameGuard, 'updateOne').mockRejectedValueOnce(new Error('guard unavailable'));
    const res = await admin
      .post('/api/admin/rooms')
      .send({ code: 'G-1', type: 'lab', department_id: cse.id });
    expect(res.status).toBe(500);
    expect(await resolve('G-1')).toBeNull();
  });

  it('ROOM-01 a duplicate-key error on the name guard means another request made it first and the create goes on', async () => {
    const cse = await createDepartment();
    const admin = await asDeptAdmin(cse);
    vi.spyOn(RoomNameGuard, 'updateOne').mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
    );
    const res = await admin
      .post('/api/admin/rooms')
      .send({ code: 'G-2', type: 'lab', department_id: cse.id });
    expect(res.status).toBe(201);
    expect(await resolve('G-2')).toMatchObject({ code: 'G-2' });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
} from '../../../../test/harness.js';
import { createDepartment, makeId, makeUser } from '../../../../test/factories.js';
import { registerRoomUsage, resetRoomUsage, resolve } from '../index.js';
import { list as auditList } from '../../audit/index.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(clearDb);
afterEach(resetRoomUsage);

const asSuper = async () =>
  loginAs(await makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] }), app);
const asDeptAdmin = async (dept, state = 'active') =>
  loginAs(
    await makeUser({
      kind: 'staff',
      state,
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    }),
    app,
  );

const newRoom = async (agent, dept, code = '311', type = 'classroom') =>
  agent.post('/api/admin/rooms').send({ code, type, department_id: dept.id });
const roomOf = async (agent, dept, code = '311', type = 'classroom') =>
  (await newRoom(agent, dept, code, type)).body.data;

describe('classrooms (spec 05)', () => {
  it('ROOM-01 an admin creates a room in their department, and it is audited', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const res = await newRoom(agent, cse, '  LR-407B ', 'lab');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      code: 'LR-407B',
      type: 'lab',
      retired: false,
      owner_department_id: cse.id,
    });
    expect(await auditList({ action: 'room.create' })).toHaveLength(1);
  });

  it('ROOM-01 a super admin can create a room in any department', async () => {
    const eee = await createDepartment();
    const res = await newRoom(await asSuper(), eee);
    expect(res.status).toBe(201);
  });

  it('ROOM-01 the same code in another department (any letter case) is a CONFLICT', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    await roomOf(await asDeptAdmin(cse), cse, 'lr-407b', 'lab');
    const res = await newRoom(await asDeptAdmin(eee), eee, ' LR-407B ', 'lab');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('ROOM-01 the code must be 1 to 20 characters and the type classroom or lab', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    for (const body of [
      { code: '   ', type: 'lab' },
      { code: 'x'.repeat(21), type: 'lab' },
      { code: '311', type: 'hall' },
      { code: '311', type: 'lab', capacity: 40 },
    ]) {
      const res = await agent.post('/api/admin/rooms').send({ ...body, department_id: cse.id });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('ROOM-01 five requests for the same new code at once create exactly one room', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        agent.post('/api/admin/rooms').send({
          code: '311',
          type: 'classroom',
          department_id: cse.id,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });

  it('ROOM-02 an alias that matches another alias after trim, spacing and case is a CONFLICT', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const a = await roomOf(agent, cse, '311');
    const b = await roomOf(agent, cse, '312');
    const ok = await agent.post(`/api/admin/rooms/${a.id}/aliases`).send({ alias: 'RN: 311' });
    expect(ok.status).toBe(201);
    const dup = await agent.post(`/api/admin/rooms/${b.id}/aliases`).send({ alias: 'rn:  311' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });

  it('ROOM-02 an alias equal to a room code (even its own) is a CONFLICT, and so is a code equal to an alias', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const a = await roomOf(agent, cse, '311');
    await roomOf(agent, cse, '312');
    const other = await agent.post(`/api/admin/rooms/${a.id}/aliases`).send({ alias: ' 312 ' });
    expect(other.status).toBe(409);
    const own = await agent.post(`/api/admin/rooms/${a.id}/aliases`).send({ alias: '311' });
    expect(own.status).toBe(409);
    await agent.post(`/api/admin/rooms/${a.id}/aliases`).send({ alias: 'RN: 311' });
    const code = await newRoom(agent, cse, 'rn: 311');
    expect(code.status).toBe(409);
  });

  it('ROOM-02 a new code and the same name as an alias at the same moment: exactly one wins', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const a = await roomOf(agent, cse, '311');
    const [alias, code] = await Promise.all([
      agent.post(`/api/admin/rooms/${a.id}/aliases`).send({ alias: 'Lab X' }),
      agent.post('/api/admin/rooms').send({ code: 'lab x', type: 'lab', department_id: cse.id }),
    ]);
    expect([alias.status, code.status].sort()).toEqual([201, 409]);
  });

  it('ROOM-02 the owner removes an alias, and the name is free again', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const a = await roomOf(agent, cse, '311');
    const alias = (await agent.post(`/api/admin/rooms/${a.id}/aliases`).send({ alias: 'RN: 311' }))
      .body.data;
    const del = await agent.delete(`/api/admin/rooms/${a.id}/aliases/${alias.id}`);
    expect(del.status).toBe(204);
    expect(await resolve('RN: 311')).toBeNull();
    const again = await agent.delete(`/api/admin/rooms/${a.id}/aliases/${alias.id}`);
    expect(again.status).toBe(404);
  });

  it('ROOM-03 resolve finds a room by code or alias, ignoring case and spacing', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const a = await roomOf(agent, cse, '311');
    await agent.post(`/api/admin/rooms/${a.id}/aliases`).send({ alias: 'RN: 311' });
    expect(await resolve('RN: 311')).toMatchObject({ id: a.id, code: '311' });
    expect(await resolve(' rn:   311 ')).toMatchObject({ id: a.id, code: '311' });
    expect(await resolve('311')).toMatchObject({ id: a.id });
    expect(await resolve('999')).toBeNull();
    expect(await resolve('   ')).toBeNull();
  });

  it('ROOM-04 an admin of a sharing department cannot edit the room', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const owner = await asDeptAdmin(cse);
    const room = await roomOf(owner, cse, '311');
    const shared = await owner.put(`/api/admin/rooms/${room.id}/shares`).send({
      department_ids: [eee.id],
    });
    expect(shared.status).toBe(200);
    expect(shared.body.data).toEqual([expect.objectContaining({ department_id: eee.id })]);

    const guest = await asDeptAdmin(eee);
    const calls = [
      guest.patch(`/api/admin/rooms/${room.id}`).send({ code: '999' }),
      guest.post(`/api/admin/rooms/${room.id}/aliases`).send({ alias: 'X' }),
      guest.put(`/api/admin/rooms/${room.id}/shares`).send({ department_ids: [] }),
      guest.post(`/api/admin/rooms/${room.id}/retire`),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
  });

  it('ROOM-04 the owner changes the sharing list; the owner or an unknown department is refused', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const ce = await createDepartment();
    const retired = await createDepartment({ retired: true });
    const owner = await asDeptAdmin(cse);
    const room = await roomOf(owner, cse, '311');
    const put = (ids) =>
      owner.put(`/api/admin/rooms/${room.id}/shares`).send({ department_ids: ids });

    expect((await put([eee.id, ce.id])).status).toBe(200);
    expect((await put([ce.id])).status).toBe(200);
    for (const bad of [[cse.id], [makeId().toString()], [retired.id]]) {
      const res = await put(bad);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const list = await owner.get(`/api/admin/rooms?department_id=${cse.id}`);
    expect(list.body.data.owned[0].shares.map((s) => s.department_id)).toEqual([ce.id]);
    const theirs = await (await asDeptAdmin(ce)).get(`/api/admin/rooms?department_id=${ce.id}`);
    expect(theirs.body.data.owned).toEqual([]);
    expect(theirs.body.data.shared_with_me).toEqual([
      expect.objectContaining({
        id: room.id,
        code: '311',
        owner: expect.objectContaining({ code: cse.code }),
      }),
    ]);
    expect(theirs.body.data.shared_with_me[0].aliases).toBeUndefined();
  });

  it('ROOM-05 renaming keeps the old code as an alias', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const room = await roomOf(agent, cse, 'LR-407B', 'lab');
    const res = await agent.patch(`/api/admin/rooms/${room.id}`).send({ code: '407B' });
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('407B');
    expect(await resolve('LR-407B')).toMatchObject({ id: room.id, code: '407B' });
    expect(await resolve('407b')).toMatchObject({ id: room.id });
    const list = await agent.get(`/api/admin/rooms?department_id=${cse.id}`);
    expect(list.body.data.owned[0].aliases.map((a) => a.alias)).toEqual(['LR-407B']);
  });

  it('ROOM-05 renaming back to its own alias takes the alias over; a taken name is a CONFLICT', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const room = await roomOf(agent, cse, 'LR-407B', 'lab');
    await roomOf(agent, cse, '312');
    await agent.patch(`/api/admin/rooms/${room.id}`).send({ code: '407B' });
    const back = await agent.patch(`/api/admin/rooms/${room.id}`).send({ code: 'lr-407b' });
    expect(back.status).toBe(200);
    expect(back.body.data.code).toBe('lr-407b');
    const list = await agent.get(`/api/admin/rooms?department_id=${cse.id}`);
    expect(list.body.data.owned.find((r) => r.id === room.id).aliases.map((a) => a.alias)).toEqual([
      '407B',
    ]);
    const clash = await agent.patch(`/api/admin/rooms/${room.id}`).send({ code: ' 312' });
    expect(clash.status).toBe(409);
    const type = await agent.patch(`/api/admin/rooms/${room.id}`).send({ type: 'classroom' });
    expect(type.status).toBe(200);
    expect(type.body.data.type).toBe('classroom');
    expect((await agent.patch(`/api/admin/rooms/${room.id}`).send({})).status).toBe(400);
  });

  it('ROOM-06 retiring a room a published slot uses is refused with ROOM_IN_USE', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const room = await roomOf(agent, cse, '311');
    registerRoomUsage({ inUse: async (id) => String(id) === room.id });
    const res = await agent.post(`/api/admin/rooms/${room.id}/retire`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROOM_IN_USE');
    expect(await resolve('311')).not.toBeNull();
    expect(await auditList({ action: 'room.retire' })).toHaveLength(0);
  });

  it('ROOM-06 a retired room leaves the list, resolves to unknown, and cannot be edited', async () => {
    const cse = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const room = await roomOf(agent, cse, '311');
    const other = await roomOf(agent, cse, '312');
    const res = await agent.post(`/api/admin/rooms/${room.id}/retire`);
    expect(res.status).toBe(200);
    expect(res.body.data.retired).toBe(true);
    const again = await agent.post(`/api/admin/rooms/${room.id}/retire`);
    expect(again.status).toBe(200);
    expect(await auditList({ action: 'room.retire' })).toHaveLength(1);

    const listed = await (await asSuper()).get('/api/rooms');
    expect(listed.body.data.map((r) => r.id)).toEqual([other.id]);
    expect(await resolve('311')).toBeNull();
    expect(await resolve('311', { includeRetired: true })).toMatchObject({ id: room.id });

    const edits = [
      () => agent.patch(`/api/admin/rooms/${room.id}`).send({ type: 'lab' }),
      () => agent.post(`/api/admin/rooms/${room.id}/aliases`).send({ alias: 'Z' }),
      () => agent.put(`/api/admin/rooms/${room.id}/shares`).send({ department_ids: [] }),
    ];
    for (const call of edits) expect((await call()).status).toBe(409);
    // its code stays reserved
    expect((await newRoom(agent, cse, '311')).status).toBe(409);
    // admins still see it, marked retired
    const adminList = await agent.get(`/api/admin/rooms?department_id=${cse.id}`);
    expect(adminList.body.data.owned.find((r) => r.id === room.id).retired).toBe(true);
  });

  it('ROOM-07 every change is audited with the owning department as scope', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const agent = await asDeptAdmin(cse);
    const room = await roomOf(agent, cse, '311');
    await agent.patch(`/api/admin/rooms/${room.id}`).send({ code: '312', type: 'lab' });
    const alias = (await agent.post(`/api/admin/rooms/${room.id}/aliases`).send({ alias: 'RN' }))
      .body.data;
    await agent.delete(`/api/admin/rooms/${room.id}/aliases/${alias.id}`);
    await agent.put(`/api/admin/rooms/${room.id}/shares`).send({ department_ids: [eee.id] });
    await agent.post(`/api/admin/rooms/${room.id}/retire`);
    for (const action of [
      'room.create',
      'room.update',
      'room.alias_add',
      'room.alias_remove',
      'room.shares_update',
      'room.retire',
    ]) {
      const rows = await auditList({ action });
      expect(rows, action).toHaveLength(1);
      expect(String(rows[0].scope_department_id)).toBe(cse.id);
      expect(String(rows[0].target_id)).toBe(room.id);
    }
  });

  it('ROOM-08 an active user lists active rooms with code and type only', async () => {
    const cse = await createDepartment();
    const admin = await asDeptAdmin(cse);
    const a = await roomOf(admin, cse, '311');
    await admin.post(`/api/admin/rooms/${a.id}/aliases`).send({ alias: 'RN: 311' });
    await admin.put(`/api/admin/rooms/${a.id}/shares`).send({ department_ids: [] });
    await roomOf(admin, cse, 'LR-1', 'lab');

    for (const kind of ['student', 'teacher']) {
      const agent = await loginAs(await makeUser({ kind }), app);
      const res = await agent.get('/api/rooms');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { id: a.id, code: '311', type: 'classroom' },
        { id: expect.any(String), code: 'LR-1', type: 'lab' },
      ]);
    }
  });

  it('ROOM-08 a person who is not active, or not signed in, gets no list', async () => {
    for (const state of ['unconfirmed', 'deactivated', 'graduated', 'email_unverified']) {
      const agent = await loginAs(await makeUser({ state }), app);
      expect((await agent.get('/api/rooms')).status).toBeGreaterThanOrEqual(401);
    }
    const anon = await loginAs(null, app);
    expect((await anon.get('/api/rooms')).status).toBe(401);
  });

  it('ROOM-08 students and teachers cannot use any admin room endpoint', async () => {
    const cse = await createDepartment();
    const room = await roomOf(await asDeptAdmin(cse), cse, '311');
    for (const kind of ['student', 'teacher']) {
      const agent = await loginAs(await makeUser({ kind }), app);
      const responses = [
        await agent.get('/api/admin/rooms'),
        await agent.get(`/api/admin/rooms?department_id=${cse.id}`),
        await newRoom(agent, cse, '500'),
        await agent.patch(`/api/admin/rooms/${room.id}`).send({ type: 'lab' }),
        await agent.post(`/api/admin/rooms/${room.id}/aliases`).send({ alias: 'Z' }),
        await agent.put(`/api/admin/rooms/${room.id}/shares`).send({ department_ids: [] }),
        await agent.post(`/api/admin/rooms/${room.id}/retire`),
      ];
      for (const res of responses) expect(res.status).toBe(403);
    }
  });

  it('ROOM-01 DEP-14 a CSE admin cannot create or list in EEE, nor touch an EEE room', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const room = await roomOf(await asDeptAdmin(eee), eee, '311');
    const agent = await asDeptAdmin(cse);
    expect((await newRoom(agent, eee, '500')).status).toBe(403);
    expect((await agent.get(`/api/admin/rooms?department_id=${eee.id}`)).status).toBe(403);
    expect((await agent.patch(`/api/admin/rooms/${room.id}`).send({ type: 'lab' })).status).toBe(
      403,
    );
    expect((await agent.post(`/api/admin/rooms/${room.id}/retire`)).status).toBe(403);
    expect((await agent.patch(`/api/admin/rooms/${makeId()}`).send({ type: 'lab' })).status).toBe(
      404,
    );
  });

  it('ROOM-01 a department admin who is not active, and an admin with no department, are refused', async () => {
    const cse = await createDepartment();
    const suspended = await asDeptAdmin(cse, 'deactivated');
    expect((await newRoom(suspended, cse)).status).toBeGreaterThanOrEqual(401);
    expect((await suspended.get('/api/admin/rooms')).status).toBeGreaterThanOrEqual(401);
    const retired = await createDepartment({ retired: true });
    const res = await newRoom(await asSuper(), retired, '600');
    expect(res.status).toBe(400);
    expect(res.body.error.fields.department_id).toBeTruthy();
  });

  it('ROOM-08 an admin without a department sees their own rooms; a super admin sees all', async () => {
    const cse = await createDepartment();
    const eee = await createDepartment();
    const superAgent = await asSuper();
    await roomOf(superAgent, cse, '311');
    await roomOf(superAgent, eee, '400');
    const mine = await (await asDeptAdmin(cse)).get('/api/admin/rooms');
    expect(mine.body.data.owned.map((r) => r.code)).toEqual(['311']);
    const all = await superAgent.get('/api/admin/rooms');
    expect(all.body.data.owned.map((r) => r.code)).toEqual(['311', '400']);
  });

  it('DEP-02 a department that owns a room can no longer change its code', async () => {
    const cse = await createDepartment({ code: 'CSX' });
    const superAgent = await asSuper();
    await roomOf(superAgent, cse, '311');
    const res = await superAgent.patch(`/api/admin/departments/${cse.id}`).send({ code: 'CSY' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CODE_LOCKED');
  });
});

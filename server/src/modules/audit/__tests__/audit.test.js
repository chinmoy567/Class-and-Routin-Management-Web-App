import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb } from '../../../../test/harness.js';
import { makeId } from '../../../../test/factories.js';
import { withTransaction } from '../../../lib/db.js';
import { record, list, AuditLog } from '../index.js';

const actor = { _id: makeId(), roles: [{ role: 'super_admin' }] };

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

describe('audit', () => {
  it('FND-19 record stores who, what, where and when; list reads it back', async () => {
    const dept = makeId();
    const target = makeId();
    await record({
      actor,
      action: 'department.create',
      scope_department_id: dept,
      target: { type: 'department', id: target },
      new_value: { code: 'CSE' },
    });
    const [entry] = await list({ scope_department_id: dept });
    expect(entry).toMatchObject({
      action: 'department.create',
      target_type: 'department',
      new_value: { code: 'CSE' },
    });
    expect(entry.actor_roles).toEqual([{ role: 'super_admin' }]);
    expect(entry.at).toBeInstanceOf(Date);
  });

  it('FND-19 record inside a transaction is rolled back with it', async () => {
    const target = makeId();
    await expect(
      withTransaction(async (session) => {
        await record({ actor, action: 'x.y', target: { type: 't', id: target }, session });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await list({ target_id: target })).toHaveLength(0);

    await withTransaction((session) =>
      record({ actor, action: 'x.y', target: { type: 't', id: target }, session }),
    );
    expect(await list({ target_id: target })).toHaveLength(1);
  });

  it('FND-20 updateOne and deleteMany throw', async () => {
    await record({ actor, action: 'a.b', target: { type: 't', id: makeId() } });
    await expect(AuditLog.updateOne({}, { action: 'hacked' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(AuditLog.findOneAndUpdate({}, { action: 'x' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.findOneAndDelete({})).rejects.toThrow(/append-only/);
  });

  it('FND-20 a saved entry cannot be modified or deleted', async () => {
    const entry = await record({ actor, action: 'c.d', target: { type: 't', id: makeId() } });
    const doc = await AuditLog.findById(entry._id);
    doc.action = 'changed';
    await expect(doc.save()).rejects.toThrow(/append-only/);
    await expect(doc.deleteOne()).rejects.toThrow(/append-only/);
    expect(await AuditLog.countDocuments({ action: 'changed' })).toBe(0);
  });

  it('FND-20 the three required indexes exist', async () => {
    await AuditLog.init();
    const keys = (await mongoose.connection.collection('audit_log').indexes()).map((i) =>
      JSON.stringify(i.key),
    );
    expect(keys).toContain('{"at":-1}');
    expect(keys).toContain('{"scope_department_id":1,"at":-1}');
    expect(keys).toContain('{"target_type":1,"target_id":1,"at":-1}');
  });
});

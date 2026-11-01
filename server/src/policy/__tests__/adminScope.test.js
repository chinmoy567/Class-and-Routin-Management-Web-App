import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { assertCan, can, clearPolicies, isAdminOf, registerPolicies } from '../index.js';
import { connectTestDb, disconnectTestDb, clearDb } from '../../../test/harness.js';
import { createDepartment, makeUser } from '../../../test/factories.js';
import { UserRole } from '../../modules/auth/auth.model.js';
import { loadRequestUser } from '../../modules/auth/auth.service.js';

const id = () => new mongoose.Types.ObjectId();
const cse = id();
const eee = id();
const user = (roles) => ({ _id: id(), kind: 'teacher', state: 'active', roles });

describe('admin scope (spec 03)', () => {
  const root = user([{ role: 'super_admin' }]);
  const cseAdmin = user([{ role: 'dept_admin', department_id: cse }]);
  const teacher = user([{ role: 'teacher', department_id: cse }]);

  it('DEP-13 isAdminOf is true for any super admin and only for the own department of a dept admin', () => {
    expect(isAdminOf(root, cse)).toBe(true);
    expect(isAdminOf(root, eee)).toBe(true);
    expect(isAdminOf(cseAdmin, cse)).toBe(true);
    expect(isAdminOf(cseAdmin, eee)).toBe(false);
    expect(isAdminOf(cseAdmin, undefined)).toBe(false);
    expect(isAdminOf(teacher, cse)).toBe(false);
    expect(isAdminOf(null, cse)).toBe(false);
  });

  describe('DEP-14 refusals', () => {
    beforeEach(() => {
      clearPolicies();
      registerPolicies({
        'room.create': (u, { department_id }) => isAdminOf(u, department_id),
        'teacher.view': {
          allow: (u, { department_id }) => isAdminOf(u, department_id),
          hideExistence: true,
        },
      });
    });

    it('DEP-14 a CSE admin acting in EEE gets 403 FORBIDDEN', () => {
      expect(can(cseAdmin, 'room.create', { department_id: cse })).toBe(true);
      expect(() => assertCan(cseAdmin, 'room.create', { department_id: eee })).toThrow(
        expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
      );
    });

    it('DEP-14 a CSE admin reading an EEE teacher gets 404 NOT_FOUND', () => {
      expect(() => assertCan(cseAdmin, 'teacher.view', { department_id: eee })).toThrow(
        expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
      );
      expect(() => assertCan(root, 'teacher.view', { department_id: eee })).not.toThrow();
    });
  });
});

describe('ended roles are not in effect (DEP-13)', () => {
  beforeAll(connectTestDb);
  afterAll(disconnectTestDb);
  beforeEach(clearDb);

  it('DEP-13 a role with ended_at set no longer makes the person an admin', async () => {
    const dept = await createDepartment();
    const admin = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'dept_admin', department_id: dept._id }],
    });
    expect(isAdminOf(await loadRequestUser(admin._id), dept._id)).toBe(true);
    await UserRole.updateOne({ user_id: admin._id }, { $set: { ended_at: new Date() } });
    const after = await loadRequestUser(admin._id);
    expect(after.roles).toEqual([]);
    expect(isAdminOf(after, dept._id)).toBe(false);
  });

  it('DEP-05 an ended grant can be granted again; two active identical grants cannot exist', async () => {
    const dept = await createDepartment();
    const u = await makeUser({ kind: 'teacher' });
    const base = { user_id: u._id, role: 'dept_admin', department_id: dept._id };
    const first = await UserRole.create(base);
    await expect(UserRole.create(base)).rejects.toMatchObject({ code: 11000 });
    await UserRole.updateOne({ _id: first._id }, { $set: { ended_at: new Date() } });
    await expect(UserRole.create(base)).resolves.toBeTruthy();
  });
});

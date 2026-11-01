import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  can,
  assertCan,
  registerPolicies,
  clearPolicies,
  hasRole,
  isAdminOf,
  stateIn,
} from '../index.js';

const id = () => new mongoose.Types.ObjectId();
const deptA = id();
const deptB = id();
const sectionA = id();
const sectionB = id();

const user = (state, roles = []) => ({ _id: id(), kind: 'student', state, roles });
const superAdmin = user('active', [{ role: 'super_admin' }]);
const adminA = user('active', [{ role: 'dept_admin', department_id: deptA }]);
const crA = user('active', [{ role: 'cr', section_id: sectionA }]);
const pendingCr = user('claim_pending', [{ role: 'cr', section_id: sectionA }]);

beforeEach(() => {
  clearPolicies();
  registerPolicies({
    'room.decide': (u, { department_id }) => stateIn(u, 'active') && isAdminOf(u, department_id),
    'room_request.create': (u, { section_id }) =>
      stateIn(u, 'active') && hasRole(u, ['cr', 'dcr'], { section_id }),
    'student.view': {
      allow: (u, { department_id }) => isAdminOf(u, department_id),
      hideExistence: true,
    },
  });
});

describe('policy engine', () => {
  it('FND-15 can() allows and denies; assertCan throws 403 FORBIDDEN', () => {
    expect(can(adminA, 'room.decide', { department_id: deptA })).toBe(true);
    expect(() => assertCan(adminA, 'room.decide', { department_id: deptB })).toThrow(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    );
  });

  it('FND-15 a policy marked hideExistence throws 404 NOT_FOUND', () => {
    expect(() => assertCan(adminA, 'student.view', { department_id: deptB })).toThrow(
      expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
    );
  });

  it('FND-15 no user means no access', () => {
    expect(can(null, 'room.decide', { department_id: deptA })).toBe(false);
  });

  it('FND-17 isAdminOf: super admin anywhere, dept admin only at home', () => {
    expect(isAdminOf(superAdmin, deptB)).toBe(true);
    expect(isAdminOf(adminA, deptA)).toBe(true);
    expect(isAdminOf(adminA, deptB)).toBe(false);
    expect(isAdminOf(crA, deptA)).toBe(false);
  });

  it('FND-17 hasRole respects scope; stateIn checks the account state', () => {
    expect(hasRole(crA, 'cr', { section_id: sectionA })).toBe(true);
    expect(hasRole(crA, 'cr', { section_id: sectionB })).toBe(false);
    expect(hasRole(crA, 'cr', { section_id: [sectionB, sectionA] })).toBe(true);
    expect(stateIn(pendingCr, ['active', 'unconfirmed'])).toBe(false);
  });

  it('FND-15 cross-scope matrix: every role is refused another department or section', () => {
    expect(can(superAdmin, 'room.decide', { department_id: deptB })).toBe(true);
    expect(can(adminA, 'room.decide', { department_id: deptB })).toBe(false);
    expect(can(crA, 'room.decide', { department_id: deptA })).toBe(false);
    expect(can(crA, 'room_request.create', { section_id: sectionB })).toBe(false);
    expect(can(adminA, 'room_request.create', { section_id: sectionA })).toBe(false);
  });

  it('FND-15 account state is checked: a claim_pending CR is refused', () => {
    expect(can(pendingCr, 'room_request.create', { section_id: sectionA })).toBe(false);
    expect(can(crA, 'room_request.create', { section_id: sectionA })).toBe(true);
  });

  it('FND-18 an unregistered action throws in the test environment', () => {
    expect(() => can(adminA, 'nope.never')).toThrow(/Unregistered/);
  });

  it('FND-18 an unregistered action is denied in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(can(superAdmin, 'nope.never')).toBe(false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

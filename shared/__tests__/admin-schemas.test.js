import { describe, it, expect } from 'vitest';
import {
  dashboardQuery,
  studentsQuery,
  deactivateBody,
  flagsQuery,
  resolveFlagBody,
  auditQuery,
  isReleased,
} from '../index.js';

const id = '64b7f0c2a1b2c3d4e5f60718';

describe('ADM-11 dashboard query', () => {
  it('ADM-11 accepts no department (all) or a department id, and rejects anything else', () => {
    expect(dashboardQuery.safeParse({}).success).toBe(true);
    expect(dashboardQuery.safeParse({ department_id: id }).success).toBe(true);
    expect(dashboardQuery.safeParse({ department_id: 'nope' }).success).toBe(false);
    expect(dashboardQuery.safeParse({ department_id: id, extra: 1 }).success).toBe(false);
  });

  it('ADM-11 the admin dashboard card is released in R1 and room requests in R2', () => {
    expect(isReleased('admin.dashboard')).toBe(true);
    expect(isReleased('admin.room_requests')).toBe(false);
    expect(isReleased('admin.room_requests', 'R2')).toBe(true);
  });
});

describe('ADM-12 student search', () => {
  it('ADM-12 needs at least two characters of a name or UV ID', () => {
    expect(studentsQuery.safeParse({ q: 'ab' }).success).toBe(true);
    expect(studentsQuery.safeParse({ q: '  a  ' }).success).toBe(false);
    expect(studentsQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('ADM-13 deactivation reason', () => {
  it('ADM-13 a reason of 5 to 500 characters is required', () => {
    expect(deactivateBody.safeParse({ reason: 'left' }).success).toBe(false);
    expect(deactivateBody.safeParse({ reason: 'Left the course' }).success).toBe(true);
    expect(deactivateBody.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(deactivateBody.safeParse({}).success).toBe(false);
  });
});

describe('ADM-18 flag filters and resolution', () => {
  it('ADM-18 filters by status and department only', () => {
    expect(flagsQuery.safeParse({ status: 'open' }).success).toBe(true);
    expect(flagsQuery.safeParse({ status: 'pending' }).success).toBe(false);
    expect(flagsQuery.safeParse({ department_id: id }).success).toBe(true);
  });

  it('ADM-18 resolves as fixed or rejected with a reply of 1 to 1,000 characters', () => {
    expect(
      resolveFlagBody.safeParse({ status: 'fixed', reply: 'Moved the student.' }).success,
    ).toBe(true);
    expect(resolveFlagBody.safeParse({ status: 'open', reply: 'x' }).success).toBe(false);
    expect(resolveFlagBody.safeParse({ status: 'fixed', reply: '   ' }).success).toBe(false);
    expect(resolveFlagBody.safeParse({ status: 'rejected', reply: 'x'.repeat(1001) }).success).toBe(
      false,
    );
  });
});

describe('ADM-19 audit query', () => {
  it('ADM-19 takes the filters and a limit of 1 to 100, default 50', () => {
    const parsed = auditQuery.parse({ from: '2027-04-01', to: '2027-04-30', action: 'join.' });
    expect(parsed.limit).toBe(50);
    expect(auditQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(auditQuery.safeParse({ limit: '20' }).data.limit).toBe(20);
    expect(auditQuery.safeParse({ from: '01/04/2027' }).success).toBe(false);
    expect(auditQuery.safeParse({ actor_id: 'nope' }).success).toBe(false);
  });
});

describe('ADM-19 audit dates and cursor', () => {
  it('ADM-19 a date must exist in the calendar (2027-02-30 is refused, 2028-02-29 is accepted)', () => {
    expect(auditQuery.safeParse({ from: '2027-02-30' }).success).toBe(false);
    expect(auditQuery.safeParse({ to: '2028-02-29' }).success).toBe(true);
  });

  it('ADM-19 the cursor is base64url text only', () => {
    expect(auditQuery.safeParse({ cursor: 'abc_-XYZ019' }).success).toBe(true);
    expect(auditQuery.safeParse({ cursor: 'has spaces!' }).success).toBe(false);
  });
});

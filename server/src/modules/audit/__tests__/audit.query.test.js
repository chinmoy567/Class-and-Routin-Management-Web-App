import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb, clearDb } from '../../../../test/harness.js';
import { AuditLog } from '../audit.model.js';
import { queryEntries, recentEntries, sanitiseValue } from '../audit.query.js';

const CSE = new mongoose.Types.ObjectId();
const EEE = new mongoose.Types.ObjectId();
const actor = new mongoose.Types.ObjectId();
const student = new mongoose.Types.ObjectId();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(clearDb);

async function entry(over) {
  return AuditLog.create({
    actor_id: actor,
    actor_roles: [],
    action: 'join.accept',
    target_type: 'enrolment',
    target_id: new mongoose.Types.ObjectId(),
    at: new Date('2027-04-06T04:00:00Z'),
    scope_department_id: CSE,
    ...over,
  });
}

describe('ADM-19 audit scope', () => {
  it('ADM-19 a department admin never sees another department entries or university-wide entries', async () => {
    await entry({ scope_department_id: CSE, action: 'cse.one' });
    await entry({ scope_department_id: EEE, action: 'eee.one' });
    await entry({ scope_department_id: undefined, action: 'university.one' });
    const { entries } = await queryEntries({ departmentIds: [String(CSE)] });
    expect(entries.map((e) => e.action)).toEqual(['cse.one']);
  });

  it('ADM-19 a super admin (no scope) sees every entry', async () => {
    await entry({ scope_department_id: CSE, action: 'cse.one' });
    await entry({ scope_department_id: EEE, action: 'eee.one' });
    await entry({ scope_department_id: undefined, action: 'university.one' });
    const { entries } = await queryEntries({ departmentIds: null });
    expect(entries).toHaveLength(3);
  });

  it('ADM-19 a CSE admin asking for EEE by target id gets nothing from EEE', async () => {
    const eeeTarget = new mongoose.Types.ObjectId();
    await entry({ scope_department_id: EEE, target_id: eeeTarget });
    const { entries } = await queryEntries({
      departmentIds: [String(CSE)],
      target_id: String(eeeTarget),
    });
    expect(entries).toHaveLength(0);
  });
});

describe('ADM-19 audit filters', () => {
  it('ADM-19 filters by exact action, or by a family ending with a dot', async () => {
    await entry({ action: 'join.accept' });
    await entry({ action: 'join.reject' });
    await entry({ action: 'teacher.remove' });
    expect((await queryEntries({ action: 'join.accept' })).entries).toHaveLength(1);
    expect((await queryEntries({ action: 'join.' })).entries).toHaveLength(2);
  });

  it('ADM-19 filters by actor and by target', async () => {
    const target = new mongoose.Types.ObjectId();
    await entry({ actor_id: student, target_id: target });
    await entry({ actor_id: actor });
    expect((await queryEntries({ actor_id: String(student) })).entries).toHaveLength(1);
    expect((await queryEntries({ target_id: String(target) })).entries).toHaveLength(1);
  });

  it('ADM-19 a date range uses Asia/Dhaka days, so 00:30 Dhaka on 6 April is in 6 April and not 5 April', async () => {
    // 2027-04-05T18:30Z is 2027-04-06 00:30 in Asia/Dhaka (UTC+6).
    await entry({ at: new Date('2027-04-05T18:30:00Z'), action: 'edge.early' });
    await entry({ at: new Date('2027-04-06T17:59:00Z'), action: 'edge.late' });
    await entry({ at: new Date('2027-04-06T18:01:00Z'), action: 'edge.next' });
    const onDay6 = await queryEntries({ from: '2027-04-06', to: '2027-04-06' });
    expect(onDay6.entries.map((e) => e.action).sort()).toEqual(['edge.early', 'edge.late']);
    const onDay5 = await queryEntries({ from: '2027-04-05', to: '2027-04-05' });
    expect(onDay5.entries).toHaveLength(0);
  });
});

describe('ADM-19 paging and ADM-10 recent activity', () => {
  it('ADM-19 pages newest first with a cursor, and every entry appears exactly once', async () => {
    for (let i = 0; i < 7; i++) {
      await entry({ at: new Date(Date.UTC(2027, 3, 6, 4, i)), action: `page.${i}` });
    }
    const first = await queryEntries({ limit: 3 });
    expect(first.entries.map((e) => e.action)).toEqual(['page.6', 'page.5', 'page.4']);
    expect(first.next_cursor).toBeTruthy();
    const second = await queryEntries({ limit: 3, cursor: first.next_cursor });
    const third = await queryEntries({ limit: 3, cursor: second.next_cursor });
    const all = [...first.entries, ...second.entries, ...third.entries].map((e) => e.action);
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(7);
    expect(third.next_cursor).toBeNull();
  });

  it('ADM-10 the recent activity is the latest entries in scope', async () => {
    for (let i = 0; i < 25; i++) {
      await entry({ at: new Date(Date.UTC(2027, 3, 6, 4, i)), action: `recent.${i}` });
    }
    const recent = await recentEntries([String(CSE)]);
    expect(recent).toHaveLength(20);
    expect(recent[0].action).toBe('recent.24');
  });
});

describe('ADM-19 values are sanitised', () => {
  it('ADM-19 email, phone, password, token and secret keys are never shown in old or new values', async () => {
    await entry({
      old_value: { state: 'active', email: 'a@baiust.ac.bd' },
      new_value: { state: 'deactivated', phone: '017', nested: { password: 'x', ok: 1 } },
    });
    const [row] = (await queryEntries()).entries;
    expect(JSON.stringify(row)).not.toMatch(/a@baiust|017|"x"/);
    expect(row.old_value).toEqual({ state: 'active' });
    expect(row.new_value).toEqual({ state: 'deactivated', nested: { ok: 1 } });
  });

  it('ADM-19 sanitiseValue leaves arrays and plain values alone', () => {
    expect(sanitiseValue([{ token: 1, a: 2 }])).toEqual([{ a: 2 }]);
    expect(sanitiseValue('plain')).toBe('plain');
  });
});

describe('ADM-19 read-only', () => {
  it('ADM-19 the audit log refuses an update and a delete', async () => {
    const row = await entry({});
    await expect(AuditLog.updateOne({ _id: row._id }, { action: 'changed' })).rejects.toThrow(
      /append-only/,
    );
    await expect(AuditLog.deleteOne({ _id: row._id })).rejects.toThrow(/append-only/);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, disconnectTestDb } from '../../test/harness.js';
import { seedSuperAdmin } from '../../src/modules/auth/index.js';
import { emailHmac } from '../../src/lib/crypto.js';
import { seedDemo } from '../seed-demo.js';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

const db = () => mongoose.connection.db;
const count = (name, filter = {}) => db().collection(name).countDocuments(filter);

describe('npm run seed:demo', () => {
  let first;
  let second;

  beforeAll(async () => {
    await seedSuperAdmin({ email: 'owner@baiust.ac.bd', name: 'Demo Owner', appUrl: 'http://x' });
    first = await seedDemo();
    second = await seedDemo();
  }, 300_000);

  it('creates documents on the first run and none on the second', () => {
    expect(Object.values(first.created).reduce((a, b) => a + b, 0)).toBeGreaterThan(500);
    expect(second.created).toEqual({});
  });

  it('fills every collection the screens read', async () => {
    for (const name of [
      'department',
      'semester',
      'allowed_domain',
      'user',
      'user_role',
      'teacher',
      'teacher_registration',
      'room',
      'room_alias',
      'room_share',
      'section',
      'section_group',
      'routine_slot',
      'routine_slot_teacher',
      'routine_import',
      'enrolment',
      'calendar_event',
      'class_cancellation',
      'room_request',
      'room_slot_lock',
      'conversation',
      'conversation_member',
      'message',
      'block',
      'report',
      'chat_suspension',
      'flag',
      'flag_quota',
      'reminder_log',
      'audit_log',
    ]) {
      expect(await count(name), name).toBeGreaterThan(0);
    }
  });

  it('has the volume the lists and pagination need', async () => {
    expect(await count('user', { kind: 'teacher', state: 'active' })).toBeGreaterThanOrEqual(8);
    const current = await db().collection('semester').findOne({ status: 'current' });
    for (const code of ['CSE', 'BBA']) {
      const d = await db().collection('department').findOne({ code });
      const sections = await db()
        .collection('section')
        .find({ semester_id: current._id, department_id: d._id })
        .toArray();
      expect(sections.length, code).toBeGreaterThanOrEqual(4);
      for (const s of sections) {
        expect(
          await count('enrolment', { section_id: s._id, status: 'accepted' }),
        ).toBeGreaterThanOrEqual(25);
      }
      expect(await count('audit_log', { scope_department_id: d._id })).toBeGreaterThan(50);
    }
  });

  it('gives every active department one admin, teachers, sections and students', async () => {
    const current = await db().collection('semester').findOne({ status: 'current' });
    for (const code of ['CSE', 'BBA', 'EEE', 'CIV', 'LAW', 'ENG']) {
      const d = await db().collection('department').findOne({ code });
      expect(d, code).toBeTruthy();
      expect(
        await count('user_role', { role: 'dept_admin', department_id: d._id, ended_at: null }),
        `${code} admins`,
      ).toBe(1);
      expect(
        await count('user', { kind: 'teacher', state: 'active', department_id: d._id }),
        `${code} teachers`,
      ).toBeGreaterThanOrEqual(5);
      const sections = await db()
        .collection('section')
        .find({ semester_id: current._id, department_id: d._id })
        .toArray();
      expect(sections.length, `${code} sections`).toBeGreaterThanOrEqual(2);
      for (const s of sections) {
        expect(
          await count('enrolment', { section_id: s._id, status: 'accepted' }),
          `${code} students`,
        ).toBeGreaterThanOrEqual(25);
      }
    }
    expect(await count('user_role', { role: 'dept_admin', ended_at: null })).toBe(6);
  });

  it('has one account in every state and join requests in every status', async () => {
    const states = await db().collection('user').distinct('state');
    expect(states.sort()).toEqual([
      'active',
      'claim_pending',
      'deactivated',
      'email_unverified',
      'graduated',
      'pending',
      'suspended',
      'unconfirmed',
    ]);
    const statuses = await db().collection('enrolment').distinct('status');
    expect(statuses.sort()).toEqual(['accepted', 'pending', 'rejected', 'revoked', 'withdrawn']);
    expect(await count('room_request', { status: 'expired' })).toBeGreaterThan(0);
  });

  it('keeps the data rules: no doubled locks, approved bookings fully locked', async () => {
    const dupes = await db()
      .collection('room_slot_lock')
      .aggregate([
        { $group: { _id: { r: '$room_id', d: '$date', b: '$block_start' }, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
      ])
      .toArray();
    expect(dupes).toEqual([]);
    for (const r of await db().collection('room_request').find({ status: 'approved' }).toArray()) {
      expect(await count('room_slot_lock', { room_request_id: r._id })).toBe(
        (r.end_min - r.start_min) / 5,
      );
    }
  });

  it('sets up the refusal cases', async () => {
    const user = (email) =>
      db()
        .collection('user')
        .findOne({ email_hmac: emailHmac(email) });
    // BKG-11: CSE 1-I-B's CR already has 3 overlapping pending requests on one date.
    const crB = await user('b1.student@baiust.ac.bd');
    const pending = await db()
      .collection('room_request')
      .aggregate([
        { $match: { sent_by_user_id: crB._id, status: 'pending' } },
        { $group: { _id: { date: '$date', start: '$start_min' }, n: { $sum: 1 } } },
      ])
      .toArray();
    expect(Math.max(...pending.map((p) => p.n))).toBe(3);
    // CRD-DSH-11: the DCR is at the daily flag limit.
    const dcr = await user('dcr.a@baiust.ac.bd');
    expect((await db().collection('flag_quota').findOne({ user_id: dcr._id })).count).toBe(5);
    // SAF-10: a suspended sender.
    const suspended = await user('a3.student@baiust.ac.bd');
    expect(suspended.chat_suspended_until.getTime()).toBeGreaterThan(Date.now());
    // A teacher with no section this semester.
    const zahid = await db().collection('teacher').findOne({ short_code: 'ZHD' });
    expect(await count('routine_slot_teacher', { teacher_id: zahid._id })).toBe(0);
  });

  it('stores contact details only encrypted and keeps them out of chat and audit', async () => {
    const plain = /@baiust\.ac\.bd|\+8801\d{9}/;
    const users = await db().collection('user').find({}).toArray();
    for (const u of users) {
      expect(JSON.stringify({ ...u, email_hmac: '' })).not.toMatch(plain);
    }
    expect(users.filter((u) => u.phone_enc).length).toBeGreaterThan(5);
    // CHT-06: bodies are stored as iv.tag.data ciphertext; deleted messages keep no body.
    for (const m of await db().collection('message').find({}).toArray()) {
      expect(m.body).toBeUndefined();
      if (m.deleted_at) expect(m.body_enc).toBeUndefined();
      else expect(m.body_enc).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    }
    // The super admin bootstrap's own entry aside, no audit value carries an address.
    const entries = await db()
      .collection('audit_log')
      .find({ action: { $ne: 'super_admin.create' } })
      .toArray();
    for (const e of entries) {
      expect(JSON.stringify([e.old_value, e.new_value])).not.toMatch(plain);
    }
  });
});

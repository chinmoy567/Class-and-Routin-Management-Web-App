import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  connectTestDb,
  disconnectTestDb,
  startTestMail,
  stopTestMail,
  drainMail,
  clearDb,
  clearOutbox,
} from '../../../../test/harness.js';
import { createDepartment, makeUser } from '../../../../test/factories.js';
import mongoose from 'mongoose';
import { TeacherRegistration } from '../../teachers/index.js';
import { Enrolment } from '../../enrolments/index.js';
import { sendAdminDigests, buildDigest } from '../digest.service.js';

beforeAll(async () => {
  await connectTestDb();
  await startTestMail();
});
beforeEach(async () => {
  await clearDb();
  clearOutbox();
});
afterAll(async () => {
  await stopTestMail();
  await disconnectTestDb();
});

const registrationFor = async (department, code) => {
  const applicant = await makeUser({ kind: 'teacher', name: `Applicant ${code}` });
  await TeacherRegistration.create({
    user_id: applicant._id,
    department_id: department._id,
    requested_short_code: code,
    status: 'pending',
  });
  return applicant;
};

describe('admin digest (EML-08)', () => {
  it('EML-08 an admin with nothing waiting gets no digest', async () => {
    const cse = await createDepartment({ code: 'CSE', name: 'Computer Science' });
    const admin = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'dept_admin', department_id: cse._id }],
    });
    expect(await sendAdminDigests()).toEqual([]);
    expect(await drainMail()).toHaveLength(0);
    expect(admin).toBeDefined();
  });

  it('EML-08 a CSE admin never sees EEE items, and the digest holds counts and labels only', async () => {
    const cse = await createDepartment({ code: 'CSE', name: 'Computer Science' });
    const eee = await createDepartment({ code: 'EEE', name: 'Electrical' });
    const cseAdmin = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'dept_admin', department_id: cse._id }],
    });
    const eeeAdmin = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'dept_admin', department_id: eee._id }],
    });
    const eeeApplicant = await registrationFor(eee, 'EEX');
    await registrationFor(eee, 'EEY');

    // Only EEE has waiting items, so the CSE admin gets no digest at all.
    const sent = await sendAdminDigests();
    expect(sent).toEqual([String(eeeAdmin._id)]);
    const mails = await drainMail();
    expect(mails.map((m) => m.to)).toEqual([eeeAdmin.email]);
    expect(mails[0].text).toContain('Teacher registrations waiting: 2');
    expect(mails.some((m) => m.to === cseAdmin.email)).toBe(false);
    // No applicant name, address or phone is in the digest.
    expect(mails[0].text).not.toContain('Applicant');
    expect(eeeApplicant).toBeDefined();
    expect(mails[0].text).not.toContain('@');
  });

  it('EML-08 a deactivated admin gets no digest, even with waiting items', async () => {
    const cse = await createDepartment({ code: 'CSE', name: 'Computer Science' });
    await makeUser({
      kind: 'teacher',
      state: 'deactivated',
      roles: [{ role: 'dept_admin', department_id: cse._id }],
    });
    await registrationFor(cse, 'CSX');
    expect(await sendAdminDigests()).toEqual([]);
    expect(await drainMail()).toHaveLength(0);
  });

  it('EML-08 a super admin digest covers every department', async () => {
    const cse = await createDepartment({ code: 'CSE', name: 'Computer Science' });
    const eee = await createDepartment({ code: 'EEE', name: 'Electrical' });
    const superAdmin = await makeUser({ kind: 'teacher', roles: [{ role: 'super_admin' }] });
    await registrationFor(cse, 'CSX');
    await registrationFor(eee, 'EEX');
    await sendAdminDigests();
    const mail = (await drainMail()).find((m) => m.to === superAdmin.email);
    expect(mail.text).toContain('Teacher registrations waiting: 2');
  });

  it('EML-08 an admin gets one digest per run hour, even if the run repeats', async () => {
    const cse = await createDepartment({ code: 'CSE', name: 'Computer Science' });
    await makeUser({ kind: 'teacher', roles: [{ role: 'dept_admin', department_id: cse._id }] });
    await registrationFor(cse, 'CSX');
    await sendAdminDigests();
    await sendAdminDigests();
    expect(await drainMail()).toHaveLength(1);
  });

  it('EML-08 escalated join requests count only in their own department, and only once escalated', async () => {
    const cse = await createDepartment({ code: 'CSE', name: 'Computer Science' });
    const eee = await createDepartment({ code: 'EEE', name: 'Electrical' });
    const student = await makeUser({ kind: 'student', state: 'active' });
    const base = {
      user_id: student._id,
      semester_id: new mongoose.Types.ObjectId(),
      section_id: new mongoose.Types.ObjectId(),
      status: 'pending',
    };
    await Enrolment.create({ ...base, department_id: eee._id, escalated_at: new Date() });
    const other = await makeUser({ kind: 'student', state: 'active' });
    await Enrolment.create({ ...base, user_id: other._id, department_id: eee._id }); // not escalated: not counted
    const inEee = await buildDigest({ departmentIds: [String(eee._id)] });
    const inCse = await buildDigest({ departmentIds: [String(cse._id)] });
    expect(inEee).toEqual([expect.objectContaining({ key: 'escalated_join_requests', count: 1 })]);
    expect(inCse).toEqual([]);
  });

  it('EML-08 buildDigest scopes the counts to the departments given', async () => {
    const cse = await createDepartment({ code: 'CSE', name: 'Computer Science' });
    const eee = await createDepartment({ code: 'EEE', name: 'Electrical' });
    await registrationFor(eee, 'EEX');
    const inCse = await buildDigest({ departmentIds: [String(cse._id)] });
    const inEee = await buildDigest({ departmentIds: [String(eee._id)] });
    const all = await buildDigest({ departmentIds: null });
    expect(inCse).toEqual([]);
    expect(inEee).toEqual([expect.objectContaining({ key: 'teacher_registrations', count: 1 })]);
    expect(all[0].count).toBe(1);
  });
});

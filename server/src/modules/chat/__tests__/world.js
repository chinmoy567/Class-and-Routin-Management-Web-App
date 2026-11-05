// Shared fixture for the chat tests (spec 20, spec 22): a CSE and EEE world with one current
// semester, two CSE sections, their representatives, students and admins.
import { makeUser, createDepartment } from '../../../../test/factories.js';
import { Semester } from '../../organisation/index.js';
import { Section } from '../../routine/index.js';
import { Enrolment } from '../../enrolments/index.js';
import { Conversation } from '../chat.model.js';
import { onRepAssigned } from '../chat.group.service.js';

/** CSE and EEE, a current semester "Fall 2026", CSE 2-II-A and 2-II-B, and every role we test. */
export async function world() {
  const cse = await createDepartment({ code: 'CSE' });
  const eee = await createDepartment({ code: 'EEE' });
  const sem = await Semester.create({
    name: 'Fall 2026',
    status: 'current',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
  });
  const secA = await Section.create({
    semester_id: sem._id,
    department_id: cse._id,
    level: 2,
    term: 'II',
    letter: 'A',
  });
  const secB = await Section.create({
    semester_id: sem._id,
    department_id: cse._id,
    level: 2,
    term: 'II',
    letter: 'B',
  });
  const rep = (role, sec) =>
    makeUser({
      kind: 'student',
      state: 'active',
      name: `${role.toUpperCase()} ${sec.letter}`,
      roles: [
        {
          role,
          department_id: cse._id,
          section_id: sec._id,
          semester_id: sem._id,
          is_representative: true,
        },
      ],
    });
  const accepted = async (sec, name, state = 'active') => {
    const u = await makeUser({ kind: 'student', state, name, departmentId: cse._id });
    await Enrolment.create({
      user_id: u._id,
      semester_id: sem._id,
      section_id: sec._id,
      department_id: cse._id,
      status: 'accepted',
    });
    return u;
  };
  const w = {
    cse,
    eee,
    sem,
    secA,
    secB,
    cr: await rep('cr', secA),
    dcr: await rep('dcr', secA),
    crB: await rep('cr', secB),
    studentA: await accepted(secA, 'Rahim Ahmed'),
    studentA2: await accepted(secA, 'Karim Hossain'),
    studentB: await accepted(secB, 'Sumi Begum'),
    teacher: await makeUser({
      kind: 'teacher',
      state: 'active',
      name: 'Teacher T',
      departmentId: cse._id,
    }),
    cseAdmin: await makeUser({
      kind: 'staff',
      state: 'active',
      name: 'CSE Admin',
      roles: [{ role: 'dept_admin', department_id: cse._id }],
    }),
    eeeAdmin: await makeUser({
      kind: 'staff',
      state: 'active',
      name: 'EEE Admin',
      roles: [{ role: 'dept_admin', department_id: eee._id }],
    }),
    superAdmin: await makeUser({
      kind: 'staff',
      state: 'active',
      name: 'Super',
      roles: [{ role: 'super_admin' }],
    }),
    unconfirmed: await makeUser({ kind: 'student', state: 'unconfirmed', name: 'Unconfirmed U' }),
    unverified: await makeUser({
      kind: 'student',
      state: 'email_unverified',
      name: 'Unverified U',
    }),
    pendingTeacher: await makeUser({ kind: 'teacher', state: 'pending', name: 'Pending P' }),
  };
  w.claimPending = await makeUser({ kind: 'student', state: 'claim_pending', name: 'Claimer C' });
  await Enrolment.create({
    user_id: w.claimPending._id,
    semester_id: sem._id,
    section_id: secA._id,
    department_id: cse._id,
    status: 'pending',
  });
  // Groups are created by the spec 09 hook when a CR takes effect, and filled by the spec 10 hook.
  await onRepAssigned({ id: String(secA._id) });
  await onRepAssigned({ id: String(secB._id) });
  return w;
}

export const openDirect = (agent, other) =>
  agent.post('/api/chat/direct').send({ user_id: String(other._id) });
export const send = (agent, convId, body) =>
  agent.post(`/api/chat/conversations/${convId}/messages`).send({ body });
export const groupOf = (sec) =>
  Conversation.findOne({ type: 'section_group', section_id: sec._id }).lean();

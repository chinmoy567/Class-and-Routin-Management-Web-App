import { pathToFileURL } from 'node:url';
import { getConfig } from '../src/config.js';
import { connectDb, disconnectDb, syncAllIndexes, withTransaction } from '../src/lib/db.js';
import { encrypt, emailHmac } from '../src/lib/crypto.js';
import {
  clock,
  toInstitutionDate,
  addDays,
  weekdayOf,
  weekStart,
  instantFrom,
} from '../src/lib/time.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { User, UserRole } from '../src/modules/auth/auth.model.js';
import {
  AllowedDomain,
  Department,
  Semester,
} from '../src/modules/organisation/organisation.model.js';
import {
  Section,
  SectionGroup,
  RoutineImport,
  RoutineSlot,
  RoutineSlotTeacher,
} from '../src/modules/routine/routine.model.js';
import { Teacher, TeacherRegistration } from '../src/modules/teachers/teachers.model.js';
import { Room, RoomAlias, RoomShare } from '../src/modules/rooms/rooms.model.js';
import { Enrolment } from '../src/modules/enrolments/enrolment.model.js';
import { CalendarEvent, ClassCancellation } from '../src/modules/calendar/calendar.model.js';
import { RoomRequest, RoomSlotLock } from '../src/modules/bookings/bookings.model.js';
import {
  Conversation,
  ConversationMember,
  Message,
  Block,
  Report,
  ChatSuspension,
} from '../src/modules/chat/chat.model.js';
import { Flag } from '../src/modules/representatives/cr/flag.model.js';
import { FlagQuota } from '../src/modules/representatives/cr/flag-quota.model.js';
import { ReminderLog } from '../src/modules/representatives/cr/reminder.model.js';
import { FLAGS_PER_DAY } from '../src/modules/representatives/cr/cr.flags.service.js';
import { AuditLog } from '../src/modules/audit/audit.model.js';
import { encryptBody, groupName } from '../src/modules/chat/chat.context.js';
import { lockBlocks } from '../src/modules/bookings/decision.service.js';
import { normaliseName } from '../src/modules/rooms/normalise.js';
import { PERIODS } from '@crm/shared';

/**
 * Demo data for trying every feature by hand. Safe to run again: everything is looked up by a
 * natural key first, so a second run on the same day creates nothing. Existing data (super
 * admin, departments, the current semester) is reused, never replaced. Dates are relative to
 * "now" in institution time, so the data stays current whenever it is run.
 *
 *   npm run seed:demo
 *
 * What each account is for: docs/demo-data.md (also printed at the end of a run).
 */
export const PASSWORD = 'Demo@12345';
// A fixed authenticator secret so the demo admins can sign in (the second step is required for admins).
export const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const DOMAIN = 'baiust.ac.bd';
const DAY_MIN = 24 * 60;

/** Seed everything. Needs an open Mongoose connection and an existing super admin. */
export async function seedDemo() {
  if (getConfig().NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data when NODE_ENV=production.');
  }
  const now = clock.now();
  const minutesAgo = (m) => new Date(now.getTime() - m * 60_000);
  const daysAgo = (d) => minutesAgo(d * DAY_MIN);
  const daysAhead = (d) => minutesAgo(-d * DAY_MIN);
  const out = { created: {}, accounts: [] };
  const bump = (k, n = 1) => (out.created[k] = (out.created[k] ?? 0) + n);

  /** Find by `filter`, or create with `filter + extra`. Returns the lean document. */
  async function ensure(Model, filter, extra = {}, label = Model.modelName) {
    const found = await Model.findOne(filter).lean();
    if (found) return found;
    const [doc] = await Model.create([{ ...filter, ...extra }]);
    bump(label);
    return doc.toObject();
  }

  // ---------- organisation ----------
  const superAdminRole = await UserRole.findOne({ role: 'super_admin', ended_at: null }).lean();
  if (!superAdminRole) {
    throw new Error('No super admin yet. Run: npm run seed:super-admin -- --email <e> --name <n>');
  }
  const superAdminId = superAdminRole.user_id;
  // The roles each actor held, for the audit entries (same shape as a signed-in actor's roles).
  const rolesOf = new Map([[String(superAdminId), [{ role: 'super_admin' }]]]);

  const dept = async (code, name, extra = {}) =>
    ensure(Department, { code }, { name, ...extra }, 'department');
  const cse = await dept('CSE', 'Computer Science and Engineering');
  const bba = await dept('BBA', 'Business Administration');
  const eee = await dept('EEE', 'Electrical and Electronic Engineering');
  // A retired department: it stays in history and lists, but nothing new can use it.
  const arch = await dept('ARCH', 'Architecture', { retired: true, retired_at: daysAgo(40) });

  // A second allowed domain, so removing one can be tried (the last one can never be removed).
  await ensure(AllowedDomain, { domain: `demo.${DOMAIN}` }, {}, 'allowed_domain');

  const today = toInstitutionDate(now);
  let semester = await Semester.findOne({ status: 'current' }).lean();
  if (!semester) {
    // Made current 15 days ago, so the "unconfirmed after 14 days" list (ROL-12) has people on it.
    semester = await ensure(
      Semester,
      { name: 'Spring 2027' },
      {
        status: 'current',
        start_date: addDays(today, -21),
        end_date: addDays(today, 160),
        made_current_at: daysAgo(15),
        made_current_by: superAdminId,
      },
      'semester',
    );
  }
  // An archived one, so the rollover and history screens have something to show.
  const archived = await ensure(
    Semester,
    { name: 'Fall 2026' },
    {
      status: 'archived',
      start_date: addDays(semester.start_date, -190),
      end_date: addDays(semester.start_date, -8),
      archived_at: instantFrom(addDays(semester.start_date, -7), 0),
    },
    'semester',
  );
  // A draft, so the rollover readiness checklist has a semester to check.
  const draft =
    (await Semester.findOne({ status: 'draft' }).lean()) ??
    (await ensure(
      Semester,
      { name: 'Fall 2027' },
      {
        status: 'draft',
        start_date: addDays(semester.end_date, 30),
        end_date: addDays(semester.end_date, 210),
      },
      'semester',
    ));

  // ---------- users ----------
  const passwordHash = await hashPassword(PASSWORD);
  let phoneSeq = 0;
  const nextPhone = () =>
    `+88017${String(10_000_000 + ((phoneSeq++ * 7919) % 89_999_999)).slice(0, 8)}`;

  async function user({ email, name, kind, state, department, phone, listed = true, ...extra }) {
    const filter = { email_hmac: emailHmac(email) };
    let doc = await User.findOne(filter).lean();
    if (!doc) {
      const [created] = await User.create([
        {
          ...filter,
          kind,
          state,
          full_name: name,
          email_enc: encrypt(email),
          phone_enc: phone ? encrypt(phone) : undefined,
          email_verified_at: state === 'email_unverified' ? undefined : now,
          password_hash: passwordHash,
          password_changed_at: now,
          department_id: department?._id,
          ...extra,
        },
      ]);
      doc = created.toObject();
      bump('user');
    }
    if (listed) out.accounts.push({ email, name, state, kind });
    return doc;
  }

  async function role(userDoc, fields) {
    const key = String(userDoc._id);
    const { is_representative: _rep, ...shape } = fields;
    rolesOf.set(key, [...(rolesOf.get(key) ?? []), shape]);
    const filter = { user_id: userDoc._id, ended_at: null, ...fields };
    if (await UserRole.exists(filter)) return;
    await UserRole.create([{ ...filter, granted_by: superAdminId, granted_at: now }]);
    bump('user_role');
  }

  const adminExtra = {
    totp_secret_enc: encrypt(ADMIN_TOTP_SECRET),
    totp_enabled_at: now,
  };
  const cseAdmin = await user({
    email: `cse.admin@${DOMAIN}`,
    name: 'Dr. Mahbub Alam',
    kind: 'staff',
    state: 'active',
    department: cse,
    phone: nextPhone(),
    ...adminExtra,
  });
  await role(cseAdmin, { role: 'dept_admin', department_id: cse._id });
  const bbaAdmin = await user({
    email: `bba.admin@${DOMAIN}`,
    name: 'Ms. Nusrat Jahan',
    kind: 'staff',
    state: 'active',
    department: bba,
    phone: nextPhone(),
    ...adminExtra,
  });
  await role(bbaAdmin, { role: 'dept_admin', department_id: bba._id });
  // One active admin per department; the departments added at the end register theirs here.
  const adminByDept = new Map([
    [String(cse._id), cseAdmin],
    [String(bba._id), bbaAdmin],
  ]);
  const adminOf = (deptId) => adminByDept.get(String(deptId)) ?? cseAdmin;

  // EEE's former admin: the role ended and the account was deactivated, so EEE has no admin
  // (the "departments without an admin" card) and the admins page has history.
  const eeeFormer = await user({
    email: `eee.former.admin@${DOMAIN}`,
    name: 'Engr. Shahidul Islam',
    kind: 'staff',
    state: 'deactivated',
    department: eee,
    state_before_deactivation: 'active',
    ...adminExtra,
  });
  const eeeFormerRole = await ensure(
    UserRole,
    {
      user_id: eeeFormer._id,
      role: 'dept_admin',
      department_id: eee._id,
    },
    {
      granted_by: superAdminId,
      granted_at: daysAgo(200),
      ended_at: daysAgo(10),
      ended_by: superAdminId,
    },
    'user_role',
  );

  // ---------- teachers ----------
  const teacherUser = async (email, name, short, department, state = 'active', extra = {}) => {
    const u = await user({
      email,
      name,
      kind: 'teacher',
      state,
      department,
      requested_short_code: short,
      ...extra,
    });
    if (state === 'active') await role(u, { role: 'teacher', department_id: department._id });
    return u;
  };
  const tRhn = await teacherUser(`rahman.t@${DOMAIN}`, 'Md. Rahman', 'RHN', cse, 'active', {
    phone: nextPhone(),
  });
  const tKrm = await teacherUser(`karim.t@${DOMAIN}`, 'Dr. Abdul Karim', 'KRM', cse);
  const tAhm = await teacherUser(`ahmed.t@${DOMAIN}`, 'Farhana Ahmed', 'AHM', cse);
  const tTnj = await teacherUser(`tanjila.t@${DOMAIN}`, 'Tanjila Nowrin', 'TNJ', cse, 'active', {
    phone: nextPhone(),
  });
  const tMzr = await teacherUser(`mizan.t@${DOMAIN}`, 'Mizanur Rahman', 'MZR', cse);
  // Active, but teaches nothing this semester: the "no section" refusal cases.
  const tZhd = await teacherUser(`zahid.t@${DOMAIN}`, 'Dr. Zahid Hossain', 'ZHD', cse);
  const tHsn = await teacherUser(`hasan.t@${DOMAIN}`, 'Kamrul Hasan', 'HSN', bba);
  const tSlm = await teacherUser(`salma.t@${DOMAIN}`, 'Salma Begum', 'SLM', bba);
  const tFrd = await teacherUser(`farid.t@${DOMAIN}`, 'Farid Ahmed', 'FRD', bba);
  const tBba4 = await teacherUser(`rubina.t@${DOMAIN}`, 'Rubina Yeasmin', 'RBN', bba);
  const tBba5 = await teacherUser(`shahin.t@${DOMAIN}`, 'Shahin Alam', 'SHN', bba);
  const tPending = await teacherUser(`nasir.t@${DOMAIN}`, 'Nasir Uddin', 'NSR', cse, 'pending');
  const tPendingBba = await teacherUser(`jannat.t@${DOMAIN}`, 'Jannat Ara', 'JNT', bba, 'pending');
  const tRejected = await teacherUser(`babul.t@${DOMAIN}`, 'Babul Mia', 'BBL', cse, 'pending');
  const tSuspended = await teacherUser(
    `suspended.t@${DOMAIN}`,
    'Rafiq Islam',
    'RFQ',
    cse,
    'suspended',
  );
  const tDeactivated = await teacherUser(
    `selina.t@${DOMAIN}`,
    'Selina Parvin',
    'SLN',
    cse,
    'deactivated',
    {
      state_before_deactivation: 'active',
    },
  );
  await teacherUser(`unverified.t@${DOMAIN}`, 'Rashed Khan', 'RSK', cse, 'email_unverified');

  const teacherRecord = (department, short_code, full_name, userDoc) =>
    ensure(
      Teacher,
      { department_id: department._id, short_code },
      {
        full_name,
        user_id: userDoc?._id,
        created_from: 'manual',
      },
      'teacher',
    );
  const RHN = await teacherRecord(cse, 'RHN', 'Md. Rahman', tRhn);
  const KRM = await teacherRecord(cse, 'KRM', 'Dr. Abdul Karim', tKrm);
  const AHM = await teacherRecord(cse, 'AHM', 'Farhana Ahmed', tAhm);
  const TNJ = await teacherRecord(cse, 'TNJ', 'Tanjila Nowrin', tTnj);
  const MZR = await teacherRecord(cse, 'MZR', 'Mizanur Rahman', tMzr);
  await teacherRecord(cse, 'ZHD', 'Dr. Zahid Hossain', tZhd);
  await teacherRecord(cse, 'RFQ', 'Rafiq Islam', tSuspended);
  await teacherRecord(cse, 'SLN', 'Selina Parvin', tDeactivated);
  const SMT = await teacherRecord(cse, 'SMT', 'Sumaiya Tabassum', null); // no account yet
  const HSN = await teacherRecord(bba, 'HSN', 'Kamrul Hasan', tHsn);
  const SLM = await teacherRecord(bba, 'SLM', 'Salma Begum', tSlm);
  const FRD = await teacherRecord(bba, 'FRD', 'Farid Ahmed', tFrd);
  await teacherRecord(bba, 'RBN', 'Rubina Yeasmin', tBba4);
  await teacherRecord(bba, 'SHN', 'Shahin Alam', tBba5);

  const registration = (u, department, short, status, extra = {}) =>
    ensure(
      TeacherRegistration,
      { user_id: u._id, status },
      {
        department_id: department._id,
        requested_short_code: short,
        ...extra,
      },
      'teacher_registration',
    );
  await registration(tPending, cse, 'NSR', 'pending');
  await registration(tPendingBba, bba, 'JNT', 'pending');
  const rejectedReg = await registration(tRejected, cse, 'BBL', 'rejected', {
    reason: 'No teaching assignment in CSE this semester. Please contact the department office.',
    decided_by: cseAdmin._id,
    decided_at: daysAgo(2),
  });
  const approvedRegs = [];
  for (const [u, d, s] of [
    [tRhn, cse, 'RHN'],
    [tKrm, cse, 'KRM'],
    [tAhm, cse, 'AHM'],
    [tTnj, cse, 'TNJ'],
    [tMzr, cse, 'MZR'],
    [tZhd, cse, 'ZHD'],
    [tHsn, bba, 'HSN'],
    [tSlm, bba, 'SLM'],
    [tFrd, bba, 'FRD'],
    [tBba4, bba, 'RBN'],
    [tBba5, bba, 'SHN'],
  ]) {
    approvedRegs.push(
      await registration(u, d, s, 'approved', {
        decided_by: adminOf(d._id)._id,
        decided_at: daysAgo(30),
      }),
    );
  }

  // ---------- rooms ----------
  const room = async (department, code, type, extra = {}) =>
    ensure(
      Room,
      { code_norm: normaliseName(code) },
      {
        code,
        type,
        owner_department_id: department._id,
        ...extra,
      },
      'room',
    );
  const r101 = await room(cse, 'CSE-101', 'classroom');
  const r102 = await room(cse, 'CSE-102', 'classroom');
  const r201 = await room(cse, 'CSE-201', 'classroom');
  const r202 = await room(cse, 'CSE-202', 'classroom');
  const r301 = await room(cse, 'CSE-301', 'classroom');
  const r302 = await room(cse, 'CSE-302', 'classroom');
  const lab1 = await room(cse, 'CSE-LAB-1', 'lab');
  const lab2 = await room(cse, 'CSE-LAB-2', 'lab');
  const r401 = await room(cse, 'CSE-401', 'classroom', { retired: true, retired_at: daysAgo(20) });
  const b101 = await room(bba, 'BBA-101', 'classroom');
  const b102 = await room(bba, 'BBA-102', 'classroom');
  const b201 = await room(bba, 'BBA-201', 'classroom');
  const b202 = await room(bba, 'BBA-202', 'classroom');
  await room(eee, 'EEE-101', 'classroom');
  const alias = (name, rm) =>
    ensure(
      RoomAlias,
      { alias_norm: normaliseName(name) },
      { alias: name, room_id: rm._id },
      'room_alias',
    );
  await alias('Main Lab', lab1);
  await alias('Seminar Room', r302);
  await ensure(RoomShare, { room_id: r201._id, department_id: bba._id }, {}, 'room_share'); // CSE-201 shared to BBA

  // ---------- sections ----------
  const section = (department, level, term, letter, sem = semester, extra = {}) =>
    ensure(
      Section,
      {
        semester_id: sem._id,
        department_id: department._id,
        level,
        term,
        letter,
      },
      extra,
      'section',
    );
  const secA = await section(cse, 1, 'I', 'A');
  const secB = await section(cse, 1, 'I', 'B');
  const secC2 = await section(cse, 2, 'I', 'A');
  const secC3 = await section(cse, 3, 'I', 'A');
  const secBba = await section(bba, 1, 'I', 'A');
  const secBbaB = await section(bba, 1, 'I', 'B');
  const secB2 = await section(bba, 2, 'I', 'A');
  // IMP-27: a BBA section that CSE's import created (CSE teaches a course to it).
  const secB3 = await section(bba, 3, 'II', 'A', semester, { created_by_import_of: cse._id });
  // Last semester's sections one term earlier (CRD-07), so 2-I-A has students to remind.
  const oldCse = await section(cse, 1, 'II', 'A', archived);
  const oldBba = await section(bba, 1, 'II', 'A', archived);
  const sectionGroup = (sec, label) =>
    ensure(SectionGroup, { section_id: sec._id, label }, {}, 'section_group');
  const g1 = await sectionGroup(secA, 'G1');
  const g2 = await sectionGroup(secA, 'G2');
  const c2g1 = await sectionGroup(secC2, 'G1');
  const c2g2 = await sectionGroup(secC2, 'G2');

  // ---------- routine (Sunday = 0 … Thursday = 4; period index into PERIODS) ----------
  const slotDefs = [
    // [section, day, firstPeriod, lastPeriod, code, name, room, teacher, group]
    [secA, 0, 0, 0, 'CSE101', 'Introduction to Programming', r101, RHN],
    [secA, 0, 1, 1, 'CSE101', 'Introduction to Programming', r101, RHN],
    [secA, 1, 0, 0, 'CSE103', 'Discrete Mathematics', r101, KRM],
    [secA, 1, 1, 1, 'MATH101', 'Calculus I', r101, AHM],
    [secA, 2, 0, 2, 'CSE102', 'Programming Lab', lab1, RHN, g1],
    [secA, 3, 0, 2, 'CSE102', 'Programming Lab', lab1, RHN, g2],
    [secA, 3, 3, 3, 'CSE103', 'Discrete Mathematics', r101, KRM],
    [secA, 4, 0, 0, 'MATH101', 'Calculus I', r101, AHM],
    [secA, 4, 1, 1, 'PHY101', 'Physics', r101, SMT],
    [secB, 0, 2, 2, 'CSE101', 'Introduction to Programming', r102, RHN],
    [secB, 0, 3, 3, 'CSE101', 'Introduction to Programming', r102, RHN],
    [secB, 1, 2, 2, 'CSE103', 'Discrete Mathematics', r102, KRM],
    [secB, 1, 3, 3, 'MATH101', 'Calculus I', r102, AHM],
    [secB, 2, 4, 6, 'CSE102', 'Programming Lab', lab2, RHN],
    [secB, 3, 4, 4, 'CSE103', 'Discrete Mathematics', r102, KRM],
    [secB, 4, 2, 2, 'MATH101', 'Calculus I', r102, AHM],
    [secB, 4, 3, 3, 'PHY101', 'Physics', r102, SMT],
    [secBba, 0, 0, 1, 'BBA101', 'Principles of Management', b101, HSN],
    [secBba, 2, 2, 2, 'BBA102', 'Business Mathematics', b101, HSN],
  ];

  // The other sections get a full week from a small scheduler that never puts a section, a room
  // or a teacher in two places at once. Classes stay in periods 0-5, so the afternoon periods
  // (6-8) of CSE-201, CSE-202 and the BBA rooms stay free for the demo bookings below.
  const busy = new Set();
  const mark = (sec, rm, teacher, day, p1, p2) => {
    for (let p = p1; p <= p2; p++) {
      busy.add(`s${sec._id}:${day}:${p}`);
      busy.add(`r${rm._id}:${day}:${p}`);
      busy.add(`t${teacher._id}:${day}:${p}`);
    }
  };
  const isFree = (sec, rm, teacher, day, p1, p2) => {
    for (let p = p1; p <= p2; p++) {
      if (
        busy.has(`s${sec._id}:${day}:${p}`) ||
        busy.has(`r${rm._id}:${day}:${p}`) ||
        busy.has(`t${teacher._id}:${day}:${p}`)
      )
        return false;
    }
    return true;
  };
  for (const [sec, day, p1, p2, , , rm, teacher] of slotDefs) mark(sec, rm, teacher, day, p1, p2);

  const courses = [
    // [section, owner, code, name, room, teacher, sessions, length, groups]
    [secC2, cse, 'CSE201', 'Data Structures', r301, TNJ, 3, 1],
    [secC2, cse, 'CSE202', 'Data Structures Lab', lab2, TNJ, 1, 3, [c2g1, c2g2]],
    [secC2, cse, 'CSE203', 'Digital Logic Design', r301, MZR, 2, 1],
    [secC2, cse, 'CSE205', 'Object Oriented Programming', r301, KRM, 2, 1],
    [secC2, cse, 'MATH201', 'Linear Algebra', r301, AHM, 2, 1],
    [secC3, cse, 'CSE301', 'Database Systems', r302, MZR, 3, 1],
    [secC3, cse, 'CSE302', 'Database Systems Lab', lab1, MZR, 1, 3],
    [secC3, cse, 'CSE303', 'Operating Systems', r302, KRM, 2, 1],
    [secC3, cse, 'CSE305', 'Computer Networks', r302, TNJ, 2, 1],
    [secC3, cse, 'HUM301', 'Technical Writing', r302, SMT, 1, 1],
    [secBba, bba, 'BBA103', 'Financial Accounting', b101, SLM, 2, 1],
    [secBba, bba, 'ECO101', 'Microeconomics', b101, FRD, 2, 1],
    [secBbaB, bba, 'BBA101', 'Principles of Management', b102, HSN, 2, 1],
    [secBbaB, bba, 'BBA103', 'Financial Accounting', b102, SLM, 2, 1],
    [secBbaB, bba, 'ECO101', 'Microeconomics', b102, FRD, 2, 1],
    [secBbaB, bba, 'ENG101', 'Business English', b102, SLM, 1, 1],
    [secB2, bba, 'BBA201', 'Principles of Marketing', b201, FRD, 2, 1],
    [secB2, bba, 'BBA203', 'Cost Accounting', b201, SLM, 2, 1],
    [secB2, bba, 'BBA205', 'Business Statistics', b201, HSN, 2, 1],
    [secB2, bba, 'BBA207', 'Organisational Behaviour', b201, FRD, 1, 1],
    [secB3, cse, 'CSE391', 'Management Information Systems', b202, KRM, 2, 1],
    [secB3, bba, 'BBA321', 'Strategic Management', b202, HSN, 2, 1],
    [secB3, bba, 'BBA323', 'Entrepreneurship', b202, FRD, 1, 1],
  ];
  const sectionOrder = [secC2, secC3, secBba, secBbaB, secB2, secB3].map((s) => String(s._id));
  for (const [sec, owner, code, name, rm, teacher, sessions, len, groups] of courses) {
    const runs = groups ? groups.map((g) => ({ g })) : Array.from({ length: sessions }, () => ({}));
    const usedDays = new Set();
    const offset = sectionOrder.indexOf(String(sec._id));
    for (const [i, run] of runs.entries()) {
      const starts = len === 3 ? [0, 3] : [0, 1, 2, 3, 4, 5];
      let placed = false;
      for (let k = 0; k < 5 && !placed; k++) {
        const day = (offset + i * 2 + k) % 5;
        if (usedDays.has(day)) continue;
        for (const p1 of starts) {
          const p2 = p1 + len - 1;
          if (!isFree(sec, rm, teacher, day, p1, p2)) continue;
          mark(sec, rm, teacher, day, p1, p2);
          usedDays.add(day);
          slotDefs.push([sec, day, p1, p2, code, name, rm, teacher, run.g, owner]);
          placed = true;
          break;
        }
      }
      if (!placed) throw new Error(`Demo routine: no free time for ${code}`);
    }
  }

  const ownerOf = (sec, ownerDept) =>
    ownerDept ?? (String(sec.department_id) === String(bba._id) ? bba : cse);
  const slotByKey = {};
  for (const [sec, day, p1, p2, code, name, rm, teacher, grp, ownerDept] of slotDefs) {
    const start_min = PERIODS[p1].start_min;
    const filter = { semester_id: semester._id, section_id: sec._id, day_of_week: day, start_min };
    const owner = ownerOf(sec, ownerDept);
    const slot = await ensure(
      RoutineSlot,
      filter,
      {
        owner_department_id: owner._id,
        group_id: grp?._id,
        end_min: PERIODS[p2].end_min,
        course_code: code,
        course_name: name,
        room_id: rm._id,
        source: 'manual',
        published: true,
      },
      'routine_slot',
    );
    slotByKey[`${sec._id}:${day}:${start_min}`] = slot;
    await ensure(
      RoutineSlotTeacher,
      { slot_id: slot._id, teacher_id: teacher._id },
      {},
      'routine_slot_teacher',
    );
  }

  // ---------- routine imports (IMP-03, ADM-05) ----------
  const routineImport = async (department, status, uploadedDaysAgo, extra = {}) => {
    const filter = { semester_id: semester._id, department_id: department._id, status };
    const found = await RoutineImport.findOne(filter).lean();
    if (found) return found;
    const [doc] = await RoutineImport.create([
      {
        ...filter,
        uploaded_by: adminOf(department._id)._id,
        uploaded_at: daysAgo(uploadedDaysAgo),
        rows: [],
        teachers: [],
        issues: [],
        counts: { rows: 0, errors: 0, warnings: 0 },
        ...extra,
      },
    ]);
    bump('routine_import');
    return doc.toObject();
  };
  const cseSlots = slotDefs.filter(([sec, , , , , , , , , o]) => ownerOf(sec, o) === cse).length;
  await routineImport(cse, 'replaced', 12, { counts: { rows: cseSlots, errors: 0, warnings: 2 } });
  const csePublished = await routineImport(cse, 'published', 10, {
    counts: { rows: cseSlots, errors: 0, warnings: 0 },
    published_by: cseAdmin._id,
    published_at: daysAgo(10),
  });
  await routineImport(bba, 'failed', 4, {
    issues: [
      {
        id: '0',
        severity: 'error',
        code: 'FILE_UNREADABLE',
        row: 0,
        message: 'The file could not be read as the routine template.',
        related_rows: [],
      },
    ],
    counts: { rows: 0, errors: 1, warnings: 0 },
  });
  // The open (checked) BBA import: one error blocks publishing, one warning names CSE.
  const bbaChecked = await routineImport(bba, 'checked', 1, {
    issues: [
      {
        id: '0',
        severity: 'error',
        code: 'UNKNOWN_ROOM',
        row: 7,
        message: 'Room "BBA-305" is not in the room list.',
        related_rows: [],
      },
      {
        id: '1',
        severity: 'warning',
        code: 'CROSS_DEPARTMENT_DUPLICATE',
        row: 12,
        message: 'CSE already has CSE391 for this section at this time.',
        related_rows: [],
        other_department: 'CSE',
      },
      {
        id: '2',
        severity: 'warning',
        code: 'TEACHER_TBA',
        row: 15,
        message: 'Row 15 has no teacher yet (TBA).',
        related_rows: [],
      },
    ],
    counts: { rows: 18, errors: 1, warnings: 2 },
  });

  // ---------- students and enrolments ----------
  const student = (email, name, state, department, extra = {}) =>
    user({ email, name, kind: 'student', state, department, ...extra });
  const enrol = async (u, sec, status, grp, extra = {}) => {
    const sem = extra.semester ?? semester;
    const { semester: _s, ...rest } = extra;
    const filter = { user_id: u._id, semester_id: sem._id, section_id: sec._id, status };
    // The request was sent before it was decided (or escalated): a day earlier, or 13 days ago.
    const decidedAt = rest.decided_at ?? (status === 'accepted' ? daysAgo(12) : null);
    const sentAt = rest.escalated_at ?? decidedAt;
    return ensure(
      Enrolment,
      filter,
      {
        created_at: sentAt ? new Date(sentAt.getTime() - DAY_MIN * 60_000) : minutesAgo(90),
        department_id: sec.department_id,
        group_id: grp?._id,
        group_set_by: grp ? 'cr' : undefined,
        decided_at: status === 'accepted' ? daysAgo(12) : undefined,
        decided_by: status === 'accepted' ? adminOf(sec.department_id)._id : undefined,
        ...rest,
      },
      'enrolment',
    );
  };
  const base = { confirmed_semester_id: semester._id };

  const sCr = await student(`cr.a@${DOMAIN}`, 'Tanvir Hossain', 'active', cse, {
    ...base,
    phone: nextPhone(),
    uv_id: '0822310205101001',
  });
  const sDcr = await student(`dcr.a@${DOMAIN}`, 'Ayesha Siddika', 'active', cse, {
    ...base,
    phone: nextPhone(),
    uv_id: '0822310205101002',
  });
  const sA = [];
  const aNames = [
    'Sabbir Ahmed',
    'Mim Akter',
    'Rakib Hasan',
    'Nusrat Sultana',
    'Imran Khan',
    'Lamia Rahman',
  ];
  for (let i = 0; i < aNames.length; i++) {
    sA.push(
      await student(`a${i + 1}.student@${DOMAIN}`, aNames[i], 'active', cse, {
        ...base,
        phone: nextPhone(),
        uv_id: `08223102051010${String(i + 3).padStart(2, '0')}`,
      }),
    );
  }
  const sB = [];
  for (const [i, n] of ['Shakil Mahmud', 'Tasnim Jahan', 'Arif Billah'].entries()) {
    sB.push(
      await student(`b${i + 1}.student@${DOMAIN}`, n, 'active', cse, {
        ...base,
        phone: nextPhone(),
      }),
    );
  }
  const sBba = await student(`bba1.student@${DOMAIN}`, 'Sadia Afrin', 'active', bba, {
    ...base,
    phone: nextPhone(),
  });

  // Bulk students: 25 or more per section, generated from name lists (not listed one by one).
  const FIRST = [
    'Abir',
    'Anika',
    'Arnob',
    'Bushra',
    'Fahim',
    'Farzana',
    'Habib',
    'Ishrat',
    'Jubayer',
    'Kaniz',
    'Mahfuz',
    'Maliha',
    'Nafis',
    'Nadia',
    'Omar',
    'Priya',
    'Rafsan',
    'Riya',
    'Sakib',
    'Sanjida',
    'Tahmid',
    'Tania',
    'Wasif',
    'Zarin',
    'Yasin',
    'Sumaiya',
    'Ratul',
    'Afsana',
  ];
  const LAST = [
    'Ahmed',
    'Akter',
    'Chowdhury',
    'Das',
    'Hossain',
    'Islam',
    'Karim',
    'Mahmud',
    'Rahman',
    'Sarkar',
    'Siddique',
    'Talukder',
    'Uddin',
    'Barua',
    'Khan',
  ];
  const bulk = async (prefix, department, count, startAt = 1, extra = () => ({})) => {
    const list = [];
    for (let i = startAt; i < startAt + count; i++) {
      // Steps coprime with the list lengths (28 and 15), so names in a section do not repeat.
      const base = [...prefix].reduce((a, c) => a + c.charCodeAt(0), 0);
      const seed = base + i * 7;
      const name = `${FIRST[(base + i * 5) % FIRST.length]} ${LAST[(base + i * 11) % LAST.length]}`;
      list.push(
        await student(
          `${prefix}.${String(i).padStart(2, '0')}@${DOMAIN}`,
          name,
          'active',
          department,
          {
            ...base,
            listed: false,
            uv_id: i % 3 ? `${seed}${String(i).padStart(4, '0')}` : undefined,
            ...extra(i),
          },
        ),
      );
    }
    return list;
  };
  // ADM-15: a temporary password was issued, so this student must choose a new one at sign-in.
  const sTemp = await student(`temp.password@${DOMAIN}`, 'Rubel Hossain', 'active', cse, {
    ...base,
    must_change_password: true,
  });
  // EML-09: the email bounced; the profile reminder says so.
  const sBounce = await student(`bouncing@${DOMAIN}`, 'Sharmin Akter', 'active', cse, {
    ...base,
    email_bouncing: true,
  });
  const aMore = await bulk('cse1ia', cse, 16);
  const bMore = await bulk('cse1ib', cse, 23);
  const c2 = await bulk('cse2ia', cse, 26);
  const c3 = await bulk('cse3ia', cse, 26);
  const bbaA = await bulk('bba1ia', bba, 25);
  const bbaB = await bulk('bba1ib', bba, 26);
  const bba2 = await bulk('bba2ia', bba, 26);
  const bba3 = await bulk('bba3iia', bba, 26);

  const accept = async (list, sec, groups = null) => {
    for (const [i, u] of list.entries())
      await enrol(u, sec, 'accepted', groups ? groups[i % groups.length] : undefined);
  };
  await accept([sCr, sDcr, ...sA, sTemp, sBounce, ...aMore], secA, [g1, g2]);
  await accept([...sB, ...bMore], secB);
  await accept(c2, secC2, [c2g1, c2g2]);
  await accept(c3, secC3);
  await accept([sBba, ...bbaA], secBba);
  await accept(bbaB, secBbaB);
  await accept(bba2, secB2);
  await accept(bba3, secB3);

  // Representatives (one CR and one DCR per section). CSE 3-I-A and BBA 3-II-A have none yet.
  const rep = (u, r, department, sec) =>
    role(u, {
      role: r,
      department_id: department._id,
      section_id: sec._id,
      semester_id: semester._id,
      is_representative: true,
    });
  await rep(sCr, 'cr', cse, secA);
  await rep(sDcr, 'dcr', cse, secA);
  await rep(sB[0], 'cr', cse, secB);
  await rep(sB[1], 'dcr', cse, secB);
  await rep(c2[0], 'cr', cse, secC2);
  await rep(c2[1], 'dcr', cse, secC2);
  await rep(sBba, 'cr', bba, secBba);
  await rep(bbaA[0], 'dcr', bba, secBba);
  await rep(bbaB[0], 'cr', bba, secBbaB);
  await rep(bba2[0], 'cr', bba, secB2);

  // Students in other account states, to see each screen.
  const sJoin = await student(`join.student@${DOMAIN}`, 'Jahid Hasan', 'claim_pending', cse);
  await enrol(sJoin, secA, 'pending');
  const sUnconf = await student(
    `unconfirmed.student@${DOMAIN}`,
    'Mahin Chowdhury',
    'unconfirmed',
    cse,
  );
  await student(`unverified.student@${DOMAIN}`, 'Pritom Das', 'email_unverified', null);
  const sGrad = await student(`graduated.student@${DOMAIN}`, 'Old Student', 'graduated', cse, {
    graduated_at: daysAgo(50),
  });
  const sDeact = await student(
    `deactivated.student@${DOMAIN}`,
    'Inactive Student',
    'deactivated',
    cse,
    { state_before_deactivation: 'active' },
  );

  // Last semester (CRD-07): most of CSE 1-II-A moved on to 2-I-A; the rest have not confirmed yet.
  const sUnconf2 = await student(`unconfirmed2.student@${DOMAIN}`, 'Shuvo Roy', 'unconfirmed', cse);
  const sNotEnrolled = await student(`not.enrolled@${DOMAIN}`, 'Moumita Paul', 'unconfirmed', cse, {
    not_enrolled_semester_id: semester._id,
  });
  const oldExtra = await bulk('cse1iia', cse, 2, 1, () => ({
    state: 'unconfirmed',
    confirmed_semester_id: undefined,
  }));
  const bbaUnconf = await bulk('bba1iia', bba, 2, 1, () => ({
    state: 'unconfirmed',
    confirmed_semester_id: undefined,
  }));
  const old = { semester: archived, decided_at: daysAgo(200) };
  for (const u of [...c2.slice(0, 20), sUnconf, sUnconf2, sNotEnrolled, sGrad, ...oldExtra])
    await enrol(u, oldCse, 'accepted', null, old);
  for (const u of [...bba2.slice(0, 20), ...bbaUnconf])
    await enrol(u, oldBba, 'accepted', null, old);
  // Last semester's CR of CSE 1-II-A (ended with the semester), the reappoint suggestion.
  await ensure(
    UserRole,
    {
      user_id: c2[0]._id,
      role: 'cr',
      section_id: oldCse._id,
      semester_id: archived._id,
    },
    {
      department_id: cse._id,
      is_representative: true,
      granted_by: cseAdmin._id,
      granted_at: daysAgo(200),
      ended_at: instantFrom(addDays(semester.start_date, -7), 0),
      ended_reason: 'semester_ended',
    },
    'user_role',
  );
  // Shuvo also asked to join 2-I-A: he shows as "applied" in the CR's unconfirmed list.
  await enrol(sUnconf2, secC2, 'pending');

  // Join requests in every state (spec 10). Rejected, withdrawn and revoked students wait again.
  const waiting = (email, name, department) => student(email, name, 'claim_pending', department);
  const jPend2 = await waiting(`join2.student@${DOMAIN}`, 'Sohel Rana', cse);
  const jPend3 = await waiting(`join3.student@${DOMAIN}`, 'Keya Moni', cse);
  await enrol(jPend2, secA, 'pending');
  await enrol(jPend3, secA, 'pending');
  const jEsc = await waiting(`escalated.student@${DOMAIN}`, 'Rony Barua', cse);
  await enrol(jEsc, secB, 'pending', null, { escalated_at: daysAgo(2) });
  const jRej = await waiting(`rejected.student@${DOMAIN}`, 'Nabil Hasan', cse);
  const rejEnrol = await enrol(jRej, secA, 'rejected', null, {
    reason: 'Not in this section according to the class list.',
    decided_by: sCr._id,
    decided_at: daysAgo(3),
  });
  const jApp = await waiting(`appeal.student@${DOMAIN}`, 'Tamanna Islam', cse);
  const appEnrol = await enrol(jApp, secA, 'rejected', null, {
    reason: 'We do not know this student.',
    decided_by: sDcr._id,
    decided_at: daysAgo(4),
    appeal: { at: daysAgo(3), status: 'open' },
  });
  const jWd = await waiting(`withdrawn.student@${DOMAIN}`, 'Rashid Alam', cse);
  await enrol(jWd, secB, 'withdrawn', null, { decided_at: daysAgo(5) });
  const jRev = await waiting(`revoked.student@${DOMAIN}`, 'Faria Rahman', cse);
  const revEnrol = await enrol(jRev, secB, 'revoked', null, {
    reason: 'Moved to another university.',
    decided_by: cseAdmin._id,
    decided_at: daysAgo(6),
  });
  const jBba = await waiting(`join.bba@${DOMAIN}`, 'Munira Haque', bba);
  await enrol(jBba, secBba, 'pending');
  const jBbaRej = await waiting(`rejected.bba@${DOMAIN}`, 'Ovi Sarkar', bba);
  await enrol(jBbaRej, secBba, 'rejected', null, {
    reason: 'Please request BBA 1-I-B instead.',
    decided_by: sBba._id,
    decided_at: daysAgo(1),
  });

  // ---------- calendar ----------
  const nextOccurrence = (mmdd) => {
    const thisYear = `${today.slice(0, 4)}-${mmdd}`;
    return thisYear >= today ? thisYear : `${Number(today.slice(0, 4)) + 1}-${mmdd}`;
  };
  const holidays = [
    ['12-16', 'Victory Day'],
    ['12-25', 'Christmas Day'],
    ['02-21', 'International Mother Language Day'],
    ['03-26', 'Independence Day'],
  ].map(([mmdd, label]) => [nextOccurrence(mmdd), label]);
  const holidaySet = new Set(holidays.map(([d]) => d));
  const nextWorkday = (from, offset, wanted = null) => {
    let d = addDays(from, offset);
    while (weekdayOf(d) > 4 || holidaySet.has(d) || (wanted !== null && weekdayOf(d) !== wanted))
      d = addDays(d, 1);
    return d;
  };
  const event = (kind, from_date, to_date, label, extra = {}) =>
    ensure(
      CalendarEvent,
      { kind, from_date, to_date, label },
      { created_by: superAdminId, ...extra },
      'calendar_event',
    );
  const events = [];
  for (const [d, label] of holidays) events.push(await event('holiday', d, d, label));
  const prep = nextWorkday(today, 35, 0);
  events.push(
    await event('prep_leave', prep, addDays(prep, 6), 'Preparatory leave before midterm', {
      scope_department_id: cse._id,
      created_by: cseAdmin._id,
    }),
  );
  events.push(
    await event('exam', addDays(prep, 7), addDays(prep, 11), 'CSE Midterm Examination', {
      scope_department_id: cse._id,
      created_by: cseAdmin._id,
    }),
  );
  // Kept after the booking dates below, so no demo booking falls after an early cutoff.
  const early = nextWorkday(today, 8);
  events.push(
    await event('early_closing', early, early, 'Early closing: staff meeting', { cutoff_min: 780 }),
  );
  const fest = nextWorkday(today, 12);
  events.push(
    await event('dept_event', fest, fest, 'CSE Tech Fest', {
      scope_department_id: cse._id,
      cutoff_min: 840,
      created_by: cseAdmin._id,
    }),
  );
  const fair = nextWorkday(today, 15);
  events.push(
    await event('dept_event', fair, fair, 'BBA Career Fair', {
      scope_department_id: bba._id,
      cutoff_min: 840,
      created_by: bbaAdmin._id,
    }),
  );

  const nextSunday = nextWorkday(today, 1, 0);
  const cancelled = slotByKey[`${secA._id}:0:${PERIODS[0].start_min}`];
  const cancel1 = await ensure(
    ClassCancellation,
    { slot_id: cancelled._id, date: nextSunday },
    {
      reason: 'Teacher is on leave',
      created_by: cseAdmin._id,
    },
    'class_cancellation',
  );
  const bbaCancelled = slotByKey[`${secBba._id}:0:${PERIODS[0].start_min}`];
  const cancel2 = await ensure(
    ClassCancellation,
    { slot_id: bbaCancelled._id, date: nextSunday },
    {
      reason: 'Teacher is attending a workshop',
      created_by: bbaAdmin._id,
    },
    'class_cancellation',
  );

  // ---------- room requests ----------
  // Every (room, period) pair below is used once, so no two demo requests share a natural key
  // and no two approved ones can cover the same lock block, whatever day the script runs.
  const d1 = nextWorkday(today, 1);
  const d2 = nextWorkday(today, 2);
  const d3 = nextWorkday(today, 3);
  const d4 = nextWorkday(today, 4);
  const d5 = nextWorkday(today, 5);
  const lastWeek = (day) => addDays(weekStart(today), -7 + day);
  const requesters = {
    teacher: {
      requester_teacher_id: RHN._id,
      sent_by_user_id: tRhn._id,
      target_section_id: secA._id,
    },
    cr: { requester_section_id: secA._id, sent_by_user_id: sCr._id, target_section_id: secA._id },
    crB: {
      requester_section_id: secB._id,
      sent_by_user_id: sB[0]._id,
      target_section_id: secB._id,
    },
    tnj: { requester_teacher_id: TNJ._id, sent_by_user_id: tTnj._id, target_section_id: secC2._id },
    bba: {
      requester_section_id: secBba._id,
      sent_by_user_id: sBba._id,
      target_section_id: secBba._id,
    },
  };
  const requests = [];
  const request = async (date, rm, p, status, who, extra = {}) => {
    const start_min = extra.start_min ?? PERIODS[p].start_min;
    const end_min = extra.end_min ?? PERIODS[p].end_min;
    const { start_min: _s, end_min: _e, ...fields } = extra;
    const filter = { room_id: rm._id, date, start_min, end_min };
    const values = {
      semester_id: semester._id,
      ...requesters[who],
      starts_at: instantFrom(date, start_min),
      note: fields.note ?? 'Extra class for the upcoming test',
      status,
      ...fields,
    };
    if (status !== 'approved') {
      const doc = await ensure(RoomRequest, filter, values, 'room_request');
      requests.push(doc);
      return doc;
    }
    // BKG-13: an approved booking and its 5-minute locks are written in one transaction. A lock
    // that already exists (a booking from an earlier run) means this one is skipped, never doubled.
    const { doc, isNew } = await withTransaction(async (session) => {
      const found = await RoomRequest.findOne(filter).session(session).lean();
      if (found) return { doc: found, isNew: false };
      const clash = await RoomSlotLock.exists({
        room_id: rm._id,
        date,
        block_start: { $gte: start_min, $lt: end_min },
      }).session(session);
      if (clash) return { doc: null, isNew: false };
      const [created] = await RoomRequest.create([{ ...filter, ...values }], { session });
      await RoomSlotLock.insertMany(lockBlocks(rm._id, date, created._id, start_min, end_min), {
        session,
      });
      return { doc: created.toObject(), isNew: true };
    });
    if (isNew) {
      bump('room_request');
      bump('room_slot_lock', (end_min - start_min) / 5);
    }
    if (doc) requests.push(doc);
    return doc;
  };
  const decided = (by, days = 0) => ({ decided_by: by._id, decided_at: daysAgo(days) });
  await request(d1, r201, 6, 'pending', 'cr');
  await request(d2, r202, 3, 'approved', 'cr', decided(cseAdmin));
  await request(d2, r201, 5, 'rejected', 'cr', {
    ...decided(cseAdmin),
    reason: 'The room is reserved for a department meeting.',
  });
  await request(d3, r202, 7, 'cancelled', 'cr', { cancelled_by: sCr._id, cancelled_at: now });
  await request(d3, lab1, 6, 'pending', 'teacher', { note: 'Make-up lab session' });
  await request(d4, r201, 4, 'approved', 'teacher', {
    ...decided(cseAdmin),
    note: 'Doubt-clearing class',
  });
  // An approval and what it did to the requests that overlapped it (BKG-13).
  await request(d1, r202, 6, 'approved', 'crB', {
    ...decided(cseAdmin),
    note: 'Lab report review session',
  });
  await request(d1, r202, 6, 'rejected', 'cr', {
    start_min: PERIODS[6].start_min + 30,
    end_min: PERIODS[6].end_min + 30,
    ...decided(cseAdmin),
    reason: 'room_given_to_another',
    note: 'Quiz preparation',
  });
  await request(d1, r302, 6, 'cancelled', 'crB', {
    reason: 'another_request_approved',
    note: 'Lab report review (backup room)',
  });
  // BKG-11: CSE 1-I-B already has 3 pending requests for the same time; a 4th is refused.
  await request(d3, r201, 8, 'pending', 'crB', { note: 'Extra class before the quiz' });
  await request(d3, lab2, 8, 'pending', 'crB', { note: 'Extra lab practice' });
  await request(d3, r302, 8, 'pending', 'crB', { note: 'Group study session' });
  await request(d5, r202, 8, 'approved', 'tnj', {
    ...decided(cseAdmin),
    note: 'Data Structures make-up class',
  });
  // BBA: a pending request for the room CSE shares with BBA, an approval and a rejection.
  await request(d2, r201, 3, 'pending', 'bba', { note: 'Presentation practice' });
  await request(d2, b102, 7, 'approved', 'bba', {
    ...decided(bbaAdmin),
    note: 'Case study discussion',
  });
  await request(d4, b201, 7, 'rejected', 'bba', {
    ...decided(bbaAdmin),
    reason: 'The room is being repaired.',
  });
  await request(d1, b101, 6, 'cancelled', 'bba', {
    cancelled_by: sBba._id,
    cancelled_at: minutesAgo(30),
    late_cancel: true,
    ...decided(bbaAdmin, 1),
  });
  // History: last week's bookings, one with a no-show note, and a request that expired unanswered.
  await request(lastWeek(1), r201, 7, 'approved', 'cr', {
    ...decided(cseAdmin, 9),
    note: 'Extra class for the class test',
  });
  await request(lastWeek(2), r202, 4, 'approved', 'teacher', {
    ...decided(cseAdmin, 8),
    note: 'Make-up class',
    no_show_note: 'The class did not take place; the room stayed empty.',
  });
  await request(lastWeek(3), r301, 7, 'expired', 'cr', { note: 'Revision class' });

  // ---------- chat ----------
  const memberRow = (conversation, u, role = 'member', extra = {}) =>
    ensure(
      ConversationMember,
      { conversation_id: conversation._id, user_id: u._id },
      {
        role,
        last_read_at: minutesAgo(5),
        last_delivered_at: minutesAgo(5),
        ...extra,
      },
      'conversation_member',
    );

  const groupOf = async (sec, createdDaysAgo) =>
    ensure(
      Conversation,
      { type: 'section_group', section_id: sec._id, semester_id: semester._id },
      {
        name: await groupName(sec._id, semester._id),
        closed_at: null,
        created_at: daysAgo(createdDaysAgo),
      },
      'conversation',
    );
  const pairKey = (a, b) => [String(a._id), String(b._id)].sort().join(':');
  const directOf = (a, b, createdDaysAgo) =>
    ensure(
      Conversation,
      { type: 'direct', pair_key: pairKey(a, b) },
      {
        closed_at: null,
        created_at: daysAgo(createdDaysAgo),
      },
      'conversation',
    );

  // Message times move with the clock, so "already seeded" is judged per conversation.
  const seededChats = new Set();
  const checkSeeded = async (c) => {
    if (await Message.exists({ conversation_id: c._id })) seededChats.add(String(c._id));
  };
  const said = new Map(); // per conversation, the messages created this run, in order
  const say = async (conversation, sender, text, ago, extra = {}) => {
    if (seededChats.has(String(conversation._id))) return null;
    const deleted = extra.deleted;
    const [doc] = await Message.create([
      {
        conversation_id: conversation._id,
        sender_id: sender._id,
        created_at: minutesAgo(ago),
        ...(deleted
          ? { deleted_at: minutesAgo(ago - 2), deleted_by: sender._id }
          : { body_enc: encryptBody(text) }),
      },
    ]);
    bump('message');
    const list = said.get(String(conversation._id)) ?? [];
    list.push(doc.toObject());
    said.set(String(conversation._id), list);
    return doc.toObject();
  };
  const touch = (conversation, ago) =>
    Conversation.updateOne(
      { _id: conversation._id },
      { $set: { last_message_at: minutesAgo(ago) } },
    );

  // CSE 1-I-A group: nine days of messages, a deleted one, a removed member who appealed.
  const group = await groupOf(secA, 12);
  await checkSeeded(group);
  await memberRow(group, sCr, 'owner');
  await memberRow(group, sDcr, 'owner');
  await memberRow(group, sA[5], 'member', {
    removed_at: daysAgo(2),
    removed_by: sCr._id,
    appeal_text: 'I only asked about the exam date. Please add me back.',
    appealed_at: daysAgo(1),
  });
  for (const u of [...sA, sTemp, sBounce, ...aMore]) await memberRow(group, u);
  // Some members have not read the newest messages yet.
  await ConversationMember.updateMany(
    { conversation_id: group._id, user_id: { $in: aMore.slice(0, 8).map((u) => u._id) } },
    { $set: { last_read_at: daysAgo(1) } },
  );
  const D = DAY_MIN;
  const groupLines = [
    [sCr, 'Welcome to the CSE 1-I-A group. Please keep it about classes.', 9 * D],
    [sA[0], 'Thanks! Where can we find the routine?', 9 * D - 30],
    [sDcr, 'It is under Routine in the menu. It updates by itself.', 9 * D - 25],
    [sA[1], 'Is there a lab on Tuesday?', 8 * D],
    [sCr, 'Yes, G1 has the programming lab on Tuesday and G2 on Wednesday.', 8 * D - 15],
    [sA[4], 'Who has the CSE101 book?', 7 * D],
    [sA[2], 'Library has three copies.', 7 * D - 40],
    [aMore[0], 'Is the class test next week?', 6 * D],
    [sDcr, 'Next Monday, chapters 1 to 3.', 6 * D - 20],
    [sA[5], 'When is the midterm exactly?', 5 * D],
    [sA[2], 'Stop posting here, nobody cares about your questions.', 4 * D],
    [sCr, 'Please be respectful in this group.', 4 * D - 10],
    [sA[3], 'Sorry, wrong group.', 3 * D, { deleted: true }],
    [aMore[1], 'Can we get the Calculus notes?', 2 * D],
    [sA[1], 'I uploaded them to the drive yesterday.', 2 * D - 30],
    [sCr, "Assalamu alaikum everyone. Tomorrow's CSE101 class is in room 101.", 300],
    [sA[0], 'Is the lab report due this week?', 280],
    [sDcr, 'Yes, submit it before Thursday.', 270],
    [sA[2], 'Can someone share the Discrete Math slides?', 200],
    [sA[1], 'I will upload them tonight.', 190],
    [sA[2], 'Buy cheap exam answers, message me now!!!', 120],
    [sCr, 'Reminder: we requested room 201 for an extra class.', 60],
  ];
  const lineMsg = [];
  for (const [who, text, ago, extra] of groupLines)
    lineMsg.push(await say(group, who, text, ago, extra));
  await touch(group, 60);

  // Safety: an open report (with its message window held, SAF-09), a closed one with a
  // suspension, a lifted suspension, and a block.
  const windowAround = (msg) => {
    const list = said.get(String(group._id)) ?? [];
    const i = list.findIndex((m) => String(m._id) === String(msg._id));
    return list.slice(Math.max(0, i - 5), i + 6).map((m) => m._id);
  };
  const spam = lineMsg[20];
  const rude = lineMsg[10];
  if (spam) {
    const ids = windowAround(spam);
    await ensure(
      Report,
      { reporter_id: sA[1]._id, target_user_id: sA[2]._id, status: 'open' },
      {
        message_id: spam._id,
        conversation_id: group._id,
        category: 'spam',
        note: 'Selling exam answers in the class group.',
        department_id: cse._id,
        window_ids: ids,
        created_at: minutesAgo(110),
      },
      'report',
    );
    await Message.updateMany({ _id: { $in: ids } }, { $set: { hold_open: true } });
  }
  const closedAt = daysAgo(3);
  if (rude) {
    const ids = windowAround(rude);
    const holdUntil = new Date(closedAt.getTime() + 90 * DAY_MIN * 60_000);
    await ensure(
      Report,
      { reporter_id: sA[0]._id, target_user_id: sA[2]._id, status: 'closed' },
      {
        message_id: rude._id,
        conversation_id: group._id,
        category: 'harassment',
        note: 'Rude to classmates.',
        department_id: cse._id,
        window_ids: ids,
        outcome: 'suspended',
        outcome_note: 'Suspended from sending for one week.',
        closed_by: cseAdmin._id,
        closed_at: closedAt,
        hold_until: holdUntil,
        created_at: daysAgo(4),
      },
      'report',
    );
    await Message.updateMany({ _id: { $in: ids } }, { $max: { hold_until: holdUntil } });
  }
  const suspension = await ensure(
    ChatSuspension,
    { user_id: sA[2]._id, reason: 'Harassment in the class group.' },
    {
      until: daysAhead(4),
      by: cseAdmin._id,
      created_at: closedAt,
    },
    'chat_suspension',
  );
  await User.updateOne({ _id: sA[2]._id }, { $max: { chat_suspended_until: suspension.until } });
  const lifted = await ensure(
    ChatSuspension,
    { user_id: sB[1]._id, reason: 'Spam links in the group.' },
    {
      until: daysAhead(2),
      by: cseAdmin._id,
      created_at: daysAgo(5),
      lifted_at: daysAgo(1),
      lifted_by: cseAdmin._id,
    },
    'chat_suspension',
  );
  await ensure(
    Block,
    { blocker_id: sA[3]._id, blocked_id: sA[4]._id },
    { created_at: daysAgo(2) },
    'block',
  );

  // The other sections' groups (only sections with a CR have one, CHT-08).
  const otherGroups = [
    [
      secB,
      [sB[0], sB[1]],
      [sB[2], ...bMore],
      [
        [sB[0], 'Hi all, this is the CSE 1-I-B group.', 8 * D],
        [bMore[0], 'Is Physics on Thursday?', 6 * D],
        [sB[1], 'Yes, period four.', 6 * D - 10],
        [bMore[2], 'Our lab is in Lab 2 this week.', 1 * D],
      ],
    ],
    [
      secC2,
      [c2[0], c2[1]],
      c2.slice(2),
      [
        [c2[0], 'Welcome back everyone, new semester!', 10 * D],
        [c2[3], 'Who is teaching Data Structures?', 9 * D],
        [c2[1], 'Tanjila Madam.', 9 * D - 5],
        [c2[5], 'Lab groups are on the routine now.', 3 * D],
      ],
    ],
    [
      secBba,
      [sBba, bbaA[0]],
      bbaA.slice(1),
      [
        [sBba, 'Assalamu alaikum, BBA 1-I-A group is open.', 8 * D],
        [bbaA[2], 'When is the accounting quiz?', 5 * D],
        [bbaA[0], 'Next week, Sunday.', 5 * D - 15],
        [sBba, 'We booked BBA-102 for a case study discussion.', 90],
      ],
    ],
    [
      secBbaB,
      [bbaB[0]],
      bbaB.slice(1),
      [
        [bbaB[0], 'BBA 1-I-B group. Ask anything here.', 7 * D],
        [bbaB[4], 'Is Business English cancelled today?', 2 * D],
      ],
    ],
    [
      secB2,
      [bba2[0]],
      bba2.slice(1),
      [
        [bba2[0], 'Marketing slides are uploaded.', 4 * D],
        [bba2[6], 'Thank you!', 4 * D - 3],
      ],
    ],
  ];
  for (const [sec, owners, members, lines] of otherGroups) {
    const c = await groupOf(sec, 11);
    await checkSeeded(c);
    for (const u of owners) await memberRow(c, u, 'owner');
    for (const u of members) await memberRow(c, u);
    for (const [who, text, ago] of lines) await say(c, who, text, ago);
    await touch(c, lines[lines.length - 1][2]);
  }

  // One-to-one chats.
  const directs = [
    [
      sCr,
      tRhn,
      [
        [sCr, 'Sir, can we move the Sunday class by one period?', 120],
        [tRhn, 'Send a room request for it and I will confirm.', 100],
      ],
    ],
    // Imran was talking to Nusrat before she blocked him: he can no longer send here.
    [
      sA[3],
      sA[4],
      [
        [sA[4], 'Can you send me your notes?', 3 * D],
        [sA[3], 'Please stop messaging me.', 3 * D - 60],
        [sA[4], 'Why? Just send them.', 2 * D + 30],
      ],
    ],
    // Unread for the teacher.
    [
      sA[0],
      tKrm,
      [
        [sA[0], 'Sir, I missed the Discrete Math class. Is the quiz still on Monday?', 6 * D],
        [tKrm, 'Yes, chapters 1 and 2.', 6 * D - 120],
        [sA[0], 'Thank you, sir. One more question about the assignment.', 45],
      ],
      { [String(tKrm._id)]: daysAgo(5) },
    ],
    [
      sDcr,
      sA[1],
      [
        [sDcr, 'Can you collect the lab reports from G2?', 5 * D],
        [sA[1], 'Sure, I will bring them on Wednesday.', 5 * D - 20],
      ],
    ],
    [
      sBba,
      tHsn,
      [
        [sBba, 'Sir, can we have the management class in BBA-102 next week?', 2 * D],
        [tHsn, 'Yes, please book it through the app.', 2 * D - 60],
      ],
    ],
  ];
  for (const [a, b, lines, unreadFor = {}] of directs) {
    const c = await directOf(a, b, 10);
    await checkSeeded(c);
    for (const u of [a, b]) {
      await memberRow(
        c,
        u,
        'member',
        unreadFor[String(u._id)] ? { last_read_at: unreadFor[String(u._id)] } : {},
      );
    }
    for (const [who, text, ago] of lines) await say(c, who, text, ago);
    await touch(c, lines[lines.length - 1][2]);
  }

  // ---------- CR and DCR: flags, the daily flag limit, reminders ----------
  const flag = (sec, department, by, category, description, status, createdAgo, extra = {}) =>
    ensure(
      Flag,
      { section_id: sec._id, raised_by: by._id, category, description },
      {
        semester_id: semester._id,
        department_id: department._id,
        status,
        created_at: minutesAgo(createdAgo),
        ...(status !== 'open' && {
          resolved_by: adminOf(department._id)._id,
          resolved_at: minutesAgo(createdAgo > 60 ? createdAgo - 30 : createdAgo / 2),
        }),
        ...extra,
      },
      'flag',
    );
  const flags = [
    await flag(
      secA,
      cse,
      sCr,
      'missing_student',
      'Keya Moni attends our classes but is not in the section list.',
      'fixed',
      3 * D,
      { student_id: jPend3._id, reply: 'Thanks, her request is now with the CR to accept.' },
    ),
    await flag(
      secA,
      cse,
      sCr,
      'routine_mistake',
      'Physics on Thursday shows the wrong room.',
      'open',
      2 * D,
    ),
  ];
  // Ayesha (DCR) has raised the daily maximum today (CRD-DSH-11): her next flag is refused.
  const todayFlags = [
    ['routine_mistake', 'Calculus on Sunday clashes with the lab in the routine.', 'open'],
    [
      'wrong_group',
      'Lamia Rahman is in G2 but attends the G1 lab.',
      'open',
      { student_id: sA[5]._id },
    ],
    ['other', 'The projector in CSE-101 does not work.', 'open'],
    [
      'missing_student',
      'Sabbir Ahmed is missing from the attendance list.',
      'fixed',
      { student_id: sA[0]._id, reply: 'He is in the section; the attendance sheet was old.' },
    ],
    [
      'wrong_section',
      'Rakib Hasan says he belongs to 1-I-B.',
      'rejected',
      { student_id: sA[2]._id, reply: 'He is in 1-I-A according to the office records.' },
    ],
  ];
  const minutesToday = Math.max(
    1,
    Math.floor((now.getTime() - instantFrom(today, 0).getTime()) / 60_000) - 1,
  );
  for (const [i, [category, description, status, extra]] of todayFlags.entries()) {
    // Spread over today so far, oldest first.
    flags.push(
      await flag(
        secA,
        cse,
        sDcr,
        category,
        description,
        status,
        Math.max(1, Math.floor((minutesToday * (5 - i)) / 6)),
        extra ?? {},
      ),
    );
  }
  await ensure(
    FlagQuota,
    { user_id: sDcr._id, date: today },
    { count: FLAGS_PER_DAY },
    'flag_quota',
  );
  flags.push(
    await flag(
      secC2,
      cse,
      c2[0],
      'routine_mistake',
      'Linear Algebra is missing from Wednesday.',
      'open',
      1 * D,
    ),
  );
  flags.push(
    await flag(
      secBba,
      bba,
      sBba,
      'missing_student',
      'Munira Haque is waiting for approval for a week.',
      'open',
      4 * D,
      { student_id: jBba._id },
    ),
  );
  // A reminder already went to Shuvo today, so a second one is refused (CRD-DSH-04).
  const reminder = await ensure(
    ReminderLog,
    { student_id: sUnconf2._id, date: today },
    {
      section_id: secC2._id,
      sent_by: c2[0]._id,
    },
    'reminder_log',
  );

  // ---------- more departments: EEE, Civil, Law, English ----------
  // Each gets exactly one active department admin, five teachers (one more waiting for approval),
  // rooms, two sections (1-I-A and 2-I-A) with a full routine, 26 students per section and a CR
  // and DCR for each, plus one join request waiting.
  const civ = await dept('CIV', 'Civil Engineering');
  const law = await dept('LAW', 'Law');
  const eng = await dept('ENG', 'English');
  // [section index, course code, course name, teacher index, sessions a week, periods per session]
  // A 3-period session is a lab session, so it needs the department's lab room.
  const moreDepts = [
    {
      dept: eee,
      lab: true,
      admin: 'Dr. Anwar Hossain',
      teachers: [
        ['Dr. Rezaul Karim', 'RZK'],
        ['Engr. Mahmudul Haque', 'MDH'],
        ['Sharmin Sultana', 'SHS'],
        ['Engr. Tarek Aziz', 'TRK'],
        ['Nilufa Yasmin', 'NLY'],
      ],
      pending: ['Engr. Faisal Ahmed', 'FSL'],
      joiner: 'Imtiaz Hasan',
      courses: [
        [0, 'EEE101', 'Electrical Circuits I', 0, 2, 1],
        [0, 'EEE103', 'Basic Electronics', 1, 2, 1],
        [0, 'MATH101', 'Calculus I', 2, 2, 1],
        [0, 'PHY101', 'Physics', 3, 2, 1],
        [0, 'EEE102', 'Electrical Circuits Lab', 0, 1, 3],
        [0, 'ENG101', 'Technical English', 4, 1, 1],
        [1, 'EEE201', 'Electronic Circuits', 1, 2, 1],
        [1, 'EEE203', 'Signals and Systems', 0, 2, 1],
        [1, 'EEE205', 'Electrical Machines', 3, 2, 1],
        [1, 'MATH201', 'Differential Equations', 2, 2, 1],
        [1, 'EEE202', 'Electronics Lab', 1, 1, 3],
        [1, 'EEE207', 'Energy Conversion', 4, 1, 1],
      ],
    },
    {
      dept: civ,
      lab: true,
      admin: 'Dr. Habibur Rahman',
      teachers: [
        ['Dr. Anisur Rahman', 'ANR'],
        ['Engr. Shafiqul Islam', 'SFQ'],
        ['Rokeya Khatun', 'RKY'],
        ['Engr. Mostafa Kamal', 'MKL'],
        ['Shirin Akter', 'SHR'],
      ],
      pending: ['Engr. Jahidul Alam', 'JHD'],
      joiner: 'Sajib Mondal',
      courses: [
        [0, 'CE101', 'Engineering Mechanics', 0, 2, 1],
        [0, 'CE103', 'Surveying', 1, 2, 1],
        [0, 'MATH101', 'Calculus I', 2, 2, 1],
        [0, 'CHEM101', 'Chemistry', 3, 2, 1],
        [0, 'CE102', 'Engineering Drawing', 1, 1, 3],
        [0, 'ENG101', 'Technical English', 4, 1, 1],
        [1, 'CE201', 'Structural Analysis', 0, 2, 1],
        [1, 'CE203', 'Fluid Mechanics', 3, 2, 1],
        [1, 'CE205', 'Geotechnical Engineering', 1, 2, 1],
        [1, 'MATH201', 'Differential Equations', 2, 2, 1],
        [1, 'CE202', 'Materials Testing Lab', 0, 1, 3],
        [1, 'CE207', 'Engineering Economics', 4, 1, 1],
      ],
    },
    {
      dept: law,
      lab: false,
      admin: 'Adv. Kamrul Islam',
      teachers: [
        ['Adv. Sultana Razia', 'SRZ'],
        ['Dr. Fazlul Haque', 'FZH'],
        ['Adv. Monirul Islam', 'MNR'],
        ['Tahmina Akter', 'TMA'],
        ['Adv. Golam Mostafa', 'GLM'],
      ],
      pending: ['Adv. Nazmul Huda', 'NZH'],
      joiner: 'Mehedi Hasan',
      courses: [
        [0, 'LAW101', 'Legal Method', 0, 2, 1],
        [0, 'LAW103', 'Constitutional Law of Bangladesh', 1, 2, 1],
        [0, 'LAW105', 'Law of Contract', 2, 2, 1],
        [0, 'LAW107', 'Jurisprudence', 3, 2, 1],
        [0, 'ENG101', 'English for Lawyers', 4, 1, 1],
        [0, 'SOC101', 'Sociology', 3, 1, 1],
        [1, 'LAW201', 'Law of Torts', 0, 2, 1],
        [1, 'LAW203', 'Criminal Law', 1, 2, 1],
        [1, 'LAW205', 'Family Law', 2, 2, 1],
        [1, 'LAW207', 'Administrative Law', 4, 2, 1],
        [1, 'LAW209', 'Legal Writing', 3, 1, 1],
        [1, 'HIS201', 'Legal History', 0, 1, 1],
      ],
    },
    {
      dept: eng,
      lab: true,
      admin: 'Dr. Rubina Chowdhury',
      teachers: [
        ['Dr. Mahfuzur Rahman', 'MFR'],
        ['Shamima Nasrin', 'SMN'],
        ['Arifur Rahman', 'ARR'],
        ['Dr. Lutfun Nahar', 'LTN'],
        ['Zakir Hossain', 'ZKR'],
      ],
      pending: ['Samia Rahman', 'SMR'],
      joiner: 'Tonmoy Das',
      courses: [
        [0, 'ENG111', 'Introduction to Poetry', 0, 2, 1],
        [0, 'ENG113', 'English Phonetics', 1, 2, 1],
        [0, 'ENG115', 'Grammar and Composition', 2, 2, 1],
        [0, 'ENG117', 'Introduction to Drama', 3, 2, 1],
        [0, 'ENG112', 'Language Lab', 1, 1, 3],
        [0, 'BAN101', 'Bangla Language', 4, 1, 1],
        [1, 'ENG211', 'Introduction to Fiction', 0, 2, 1],
        [1, 'ENG213', 'Linguistics', 2, 2, 1],
        [1, 'ENG215', 'Shakespeare', 3, 2, 1],
        [1, 'ENG217', 'Literary Criticism', 4, 2, 1],
        [1, 'ENG212', 'Communication Skills Lab', 1, 1, 3],
        [1, 'ENG219', 'Translation Studies', 0, 1, 1],
      ],
    },
  ];

  for (const spec of moreDepts) {
    const d = spec.dept;
    const dc = d.code.toLowerCase();
    const admin = await user({
      email: `${dc}.admin@${DOMAIN}`,
      name: spec.admin,
      kind: 'staff',
      state: 'active',
      department: d,
      phone: nextPhone(),
      ...adminExtra,
    });
    await role(admin, { role: 'dept_admin', department_id: d._id });
    adminByDept.set(String(d._id), admin);

    const teachers = [];
    for (const [i, [name, short]] of spec.teachers.entries()) {
      const u = await teacherUser(
        `${dc}.t${i + 1}@${DOMAIN}`,
        name,
        short,
        d,
        'active',
        i < 2 ? { phone: nextPhone() } : {},
      );
      teachers.push(await teacherRecord(d, short, name, u));
      await registration(u, d, short, 'approved', {
        decided_by: admin._id,
        decided_at: daysAgo(30),
      });
    }
    const [pName, pShort] = spec.pending;
    const pendingTeacher = await teacherUser(
      `${dc}.pending.t@${DOMAIN}`,
      pName,
      pShort,
      d,
      'pending',
    );
    await registration(pendingTeacher, d, pShort, 'pending');

    const classrooms = [
      await room(d, `${d.code}-101`, 'classroom'),
      await room(d, `${d.code}-102`, 'classroom'),
      await room(d, `${d.code}-201`, 'classroom'),
    ];
    const labRoom = spec.lab ? await room(d, `${d.code}-LAB-1`, 'lab') : null;
    const secs = [await section(d, 1, 'I', 'A'), await section(d, 2, 'I', 'A')];

    // The same clash-free scheduler as above: classes stay in periods 0-5, so the afternoon is
    // free for bookings.
    for (const [si, code, name, ti, sessions, len] of spec.courses) {
      const sec = secs[si];
      const rm = len === 3 ? labRoom : classrooms[si === 0 ? 0 : 2];
      const teacher = teachers[ti];
      const starts = len === 3 ? [0, 3] : [0, 1, 2, 3, 4, 5];
      const usedDays = new Set();
      for (let i = 0; i < sessions; i++) {
        let placed = false;
        for (let k = 0; k < 5 && !placed; k++) {
          const day = (si + i * 2 + k) % 5;
          if (usedDays.has(day)) continue;
          for (const p1 of starts) {
            const p2 = p1 + len - 1;
            if (!isFree(sec, rm, teacher, day, p1, p2)) continue;
            mark(sec, rm, teacher, day, p1, p2);
            usedDays.add(day);
            const slot = await ensure(
              RoutineSlot,
              {
                semester_id: semester._id,
                section_id: sec._id,
                day_of_week: day,
                start_min: PERIODS[p1].start_min,
              },
              {
                owner_department_id: d._id,
                end_min: PERIODS[p2].end_min,
                course_code: code,
                course_name: name,
                room_id: rm._id,
                source: 'manual',
                published: true,
              },
              'routine_slot',
            );
            await ensure(
              RoutineSlotTeacher,
              { slot_id: slot._id, teacher_id: teacher._id },
              {},
              'routine_slot_teacher',
            );
            placed = true;
            break;
          }
        }
        if (!placed) throw new Error(`Demo routine: no free time for ${d.code} ${code}`);
      }
    }

    const confirmed = () => ({ confirmed_semester_id: semester._id });
    for (const [si, prefix] of [`${dc}1ia`, `${dc}2ia`].entries()) {
      const list = await bulk(prefix, d, 26, 1, confirmed);
      await accept(list, secs[si]);
      await rep(list[0], 'cr', d, secs[si]);
      await rep(list[1], 'dcr', d, secs[si]);
    }
    const joiner = await waiting(`${dc}.join@${DOMAIN}`, spec.joiner, d);
    await enrol(joiner, secs[0], 'pending');
  }

  // ---------- audit log (append-only: only inserted, never changed) ----------
  // Backdated entries that match the demo data, so the audit screen, its filters and its
  // pagination (50 per page) have something to show. Values never carry an email or a phone.
  const audit = async (actor, action, target_type, target_id, at, extra = {}) => {
    const filter = { action, target_type, target_id, actor_id: actor._id ?? actor };
    if (await AuditLog.exists(filter)) return;
    await AuditLog.create([
      {
        ...filter,
        actor_roles: rolesOf.get(String(actor._id ?? actor)) ?? [],
        at,
        ...extra,
      },
    ]);
    bump('audit_log');
  };
  const scoped = (department, rest = {}) => ({ scope_department_id: department._id, ...rest });
  for (const d of [cse, bba, eee, civ, law, eng, arch])
    await audit(superAdminId, 'department.create', 'department', d._id, daysAgo(60), {
      new_value: { code: d.code, name: d.name },
    });
  await audit(superAdminId, 'department.retire', 'department', arch._id, daysAgo(40), {
    old_value: { retired: false },
    new_value: { retired: true },
  });
  await audit(superAdminId, 'allowed_domain.add', 'allowed_domain', `demo.${DOMAIN}`, daysAgo(59), {
    new_value: { domain: `demo.${DOMAIN}` },
  });
  await audit(superAdminId, 'semester.create', 'semester', semester._id, daysAgo(30), {
    new_value: { name: semester.name },
  });
  await audit(superAdminId, 'semester.make_current', 'semester', semester._id, daysAgo(15), {
    new_value: { status: 'current' },
  });
  await audit(superAdminId, 'semester.create', 'semester', draft._id, daysAgo(2), {
    new_value: { name: draft.name },
  });
  for (const [u, d] of [
    [cseAdmin, cse],
    [bbaAdmin, bba],
    ...moreDepts.map((m) => [adminByDept.get(String(m.dept._id)), m.dept]),
  ]) {
    await audit(
      superAdminId,
      'admin_role.grant',
      'user',
      u._id,
      daysAgo(58),
      scoped(d, { new_value: { role: 'dept_admin', name: u.full_name } }),
    );
  }
  await audit(
    superAdminId,
    'admin_role.remove',
    'user_role',
    eeeFormerRole._id,
    daysAgo(10),
    scoped(eee, { old_value: { role: 'dept_admin', name: eeeFormer.full_name } }),
  );
  for (const reg of approvedRegs) {
    await audit(
      adminOf(reg.department_id),
      'teacher.registration.approve',
      'teacher_registration',
      reg._id,
      daysAgo(30),
      {
        scope_department_id: reg.department_id,
        new_value: { short_code: reg.requested_short_code },
      },
    );
  }
  await audit(
    cseAdmin,
    'teacher.registration.reject',
    'teacher_registration',
    rejectedReg._id,
    daysAgo(2),
    scoped(cse, { new_value: { reason: rejectedReg.reason } }),
  );
  await audit(
    cseAdmin,
    'teacher.suspend',
    'user',
    tSuspended._id,
    daysAgo(7),
    scoped(cse, { old_value: { state: 'active' }, new_value: { state: 'suspended' } }),
  );
  for (const rm of [r101, r102, r201, r202, r301, r302, lab1, lab2, r401]) {
    await audit(
      cseAdmin,
      'room.create',
      'room',
      rm._id,
      daysAgo(45),
      scoped(cse, { new_value: { code: rm.code, type: rm.type } }),
    );
  }
  for (const rm of [b101, b102, b201, b202]) {
    await audit(
      bbaAdmin,
      'room.create',
      'room',
      rm._id,
      daysAgo(44),
      scoped(bba, { new_value: { code: rm.code, type: rm.type } }),
    );
  }
  await audit(
    cseAdmin,
    'room.retire',
    'room',
    r401._id,
    daysAgo(20),
    scoped(cse, { new_value: { retired: true } }),
  );
  await audit(
    cseAdmin,
    'room.alias_add',
    'room',
    r302._id,
    daysAgo(19),
    scoped(cse, { new_value: { alias: 'Seminar Room' } }),
  );
  await audit(
    cseAdmin,
    'room.shares_update',
    'room',
    r201._id,
    daysAgo(18),
    scoped(cse, { new_value: { shared_with: ['BBA'] } }),
  );
  await audit(
    cseAdmin,
    'routine.import_upload',
    'routine_import',
    csePublished._id,
    daysAgo(10),
    scoped(cse, { new_value: { status: 'checked' } }),
  );
  await audit(
    cseAdmin,
    'routine.publish',
    'routine_import',
    csePublished._id,
    daysAgo(10),
    scoped(cse, { new_value: { status: 'published' } }),
  );
  await audit(
    bbaAdmin,
    'routine.import_upload',
    'routine_import',
    bbaChecked._id,
    daysAgo(1),
    scoped(bba, { new_value: { status: 'checked', errors: 1, warnings: 2 } }),
  );
  for (const ev of events) {
    const actor = ev.created_by ?? superAdminId;
    const extra = ev.scope_department_id ? { scope_department_id: ev.scope_department_id } : {};
    await audit(actor, 'calendar.event.create', 'calendar_event', ev._id, daysAgo(14), {
      ...extra,
      new_value: { kind: ev.kind, label: ev.label },
    });
  }
  await audit(
    cseAdmin,
    'class.cancel',
    'routine_slot',
    cancel1.slot_id,
    daysAgo(1),
    scoped(cse, { new_value: { date: cancel1.date, reason: cancel1.reason } }),
  );
  await audit(
    bbaAdmin,
    'class.cancel',
    'routine_slot',
    cancel2.slot_id,
    daysAgo(1),
    scoped(bba, { new_value: { date: cancel2.date, reason: cancel2.reason } }),
  );
  const reps = await UserRole.find({
    semester_id: semester._id,
    is_representative: true,
    ended_at: null,
  }).lean();
  for (const r of reps) {
    await audit(
      adminOf(r.department_id),
      'representative.assign',
      'user_role',
      r._id,
      daysAgo(13),
      {
        scope_department_id: r.department_id,
        new_value: { role: r.role, section_id: String(r.section_id) },
      },
    );
  }
  // Every accepted join request of this semester, decided by the department admin (spec 10).
  const accepted = await Enrolment.find({ semester_id: semester._id, status: 'accepted' })
    .select('_id department_id section_id')
    .lean();
  for (const [i, e] of accepted.entries()) {
    await audit(
      adminOf(e.department_id),
      'join.accept',
      'enrolment',
      e._id,
      minutesAgo(12 * D - i * 7),
      { scope_department_id: e.department_id, new_value: { section_id: String(e.section_id) } },
    );
  }
  await audit(
    sCr,
    'join.reject',
    'enrolment',
    rejEnrol._id,
    daysAgo(3),
    scoped(cse, { new_value: { reason: rejEnrol.reason } }),
  );
  await audit(
    sDcr,
    'join.reject',
    'enrolment',
    appEnrol._id,
    daysAgo(4),
    scoped(cse, { new_value: { reason: appEnrol.reason } }),
  );
  await audit(
    jApp,
    'join.appeal',
    'enrolment',
    appEnrol._id,
    daysAgo(3),
    scoped(cse, { new_value: { appeal: 'open' } }),
  );
  await audit(
    cseAdmin,
    'join.remove',
    'enrolment',
    revEnrol._id,
    daysAgo(6),
    scoped(cse, {
      old_value: { status: 'accepted' },
      new_value: { status: 'revoked', reason: revEnrol.reason },
    }),
  );
  for (const r of requests) {
    const department = String(r.target_section_id) === String(secBba._id) ? bba : cse;
    await audit(
      r.sent_by_user_id,
      'room_request.create',
      'room_request',
      r._id,
      minutesAgo(2 * D),
      scoped(department, {
        new_value: { date: r.date, start_min: r.start_min, end_min: r.end_min },
      }),
    );
    if (r.status === 'approved' || r.status === 'rejected') {
      if (!r.decided_by) continue;
      await audit(
        r.decided_by,
        `room_request.${r.status === 'approved' ? 'approve' : 'reject'}`,
        'room_request',
        r._id,
        r.decided_at ?? now,
        scoped(department, { new_value: { status: r.status, reason: r.reason ?? null } }),
      );
    }
  }
  for (const f of flags) {
    const department = String(f.department_id) === String(bba._id) ? bba : cse;
    await audit(
      f.raised_by,
      'cr.flag_raise',
      'flag',
      f._id,
      f.created_at,
      scoped(department, { new_value: { category: f.category } }),
    );
    if (f.status !== 'open')
      await audit(
        f.resolved_by,
        'flag.resolve',
        'flag',
        f._id,
        f.resolved_at,
        scoped(department, { new_value: { status: f.status } }),
      );
  }
  await audit(
    c2[0],
    'cr.reminder',
    'user',
    reminder.student_id,
    minutesAgo(Math.min(60, minutesToday)),
    scoped(cse, { new_value: { section_id: String(secC2._id) } }),
  );
  const openReport = await Report.findOne({
    reporter_id: sA[1]._id,
    target_user_id: sA[2]._id,
    status: 'open',
  }).lean();
  const closedReport = await Report.findOne({
    reporter_id: sA[0]._id,
    target_user_id: sA[2]._id,
    status: 'closed',
  }).lean();
  if (openReport)
    await audit(
      cseAdmin,
      'chat.report_view',
      'report',
      openReport._id,
      minutesAgo(100),
      scoped(cse),
    );
  if (closedReport) {
    await audit(
      cseAdmin,
      'chat.report_view',
      'report',
      closedReport._id,
      daysAgo(3.1),
      scoped(cse),
    );
    await audit(
      cseAdmin,
      'chat.report_closed',
      'report',
      closedReport._id,
      closedAt,
      scoped(cse, { new_value: { outcome: 'suspended' } }),
    );
  }
  await audit(
    cseAdmin,
    'chat.suspended',
    'user',
    sA[2]._id,
    closedAt,
    scoped(cse, { new_value: { until: suspension.until } }),
  );
  await audit(
    cseAdmin,
    'chat.suspended',
    'user',
    sB[1]._id,
    lifted.created_at,
    scoped(cse, { new_value: { until: lifted.until } }),
  );
  await audit(cseAdmin, 'chat.suspension_lifted', 'user', sB[1]._id, lifted.lifted_at, scoped(cse));
  await audit(
    sCr,
    'chat.member_removed',
    'conversation_member',
    sA[5]._id,
    daysAgo(2),
    scoped(cse, { new_value: { conversation_id: String(group._id) } }),
  );
  await audit(cseAdmin, 'student.temp_password', 'user', sTemp._id, daysAgo(1), scoped(cse));
  await audit(
    cseAdmin,
    'student.deactivate',
    'user',
    sDeact._id,
    daysAgo(9),
    scoped(cse, { old_value: { state: 'active' }, new_value: { state: 'deactivated' } }),
  );
  await audit(
    cseAdmin,
    'student.graduate',
    'user',
    sGrad._id,
    daysAgo(50),
    scoped(cse, { new_value: { state: 'graduated' } }),
  );

  return out;
}

/** The demo accounts and what to try with each. Printed after a run; docs/demo-data.md has more. */
export const GUIDE = [
  [
    '(your super admin)',
    'super admin',
    'active',
    'Every department, semesters, admins, audit log',
    'Nothing in scope; at least one super admin must remain',
  ],
  [
    `cse.admin@${DOMAIN}`,
    'dept admin CSE',
    'active',
    'CSE dashboard, join appeals, flags, reports, audit (2+ pages)',
    'Any BBA student, room, section or audit entry',
  ],
  [
    `bba.admin@${DOMAIN}`,
    'dept admin BBA',
    'active',
    'BBA import with an error, BBA requests, the BBA teacher queue',
    'Any CSE data; publishing the import with an error',
  ],
  ...[
    ['eee', 'EEE'],
    ['civ', 'Civil'],
    ['law', 'Law'],
    ['eng', 'English'],
  ].map(([dc, name]) => [
    `${dc}.admin@${DOMAIN}`,
    `dept admin ${name}`,
    'active',
    `${name} dashboard, teacher queue, join requests, students, routine`,
    `Any other department's data`,
  ]),
  [
    `eee.former.admin@${DOMAIN}`,
    'former EEE admin',
    'deactivated',
    'Sign-in is refused',
    'Everything',
  ],
  [
    `rahman.t@${DOMAIN}`,
    'teacher CSE',
    'active',
    'Routine, students of 1-I-A/1-I-B, room requests, chat',
    'Requests for a section he does not teach',
  ],
  [
    `tanjila.t@${DOMAIN}`,
    'teacher CSE',
    'active',
    '2-I-A and 3-I-A routine, an approved booking',
    'Requests for 1-I-A',
  ],
  [
    `zahid.t@${DOMAIN}`,
    'teacher CSE',
    'active',
    'Empty routine and student list',
    'Any room request (teaches no section)',
  ],
  [`hasan.t@${DOMAIN}`, 'teacher BBA', 'active', 'BBA routine and students', 'Any CSE section'],
  [
    `nasir.t@${DOMAIN}`,
    'teacher',
    'pending',
    'The waiting-for-approval screen',
    'Every app screen',
  ],
  [
    `babul.t@${DOMAIN}`,
    'teacher',
    'pending (rejected)',
    'The registration-rejected screen with its reason',
    'Every app screen',
  ],
  [
    `suspended.t@${DOMAIN}`,
    'teacher',
    'suspended',
    'Sign-in is refused (account disabled)',
    'Everything',
  ],
  [`selina.t@${DOMAIN}`, 'teacher', 'deactivated', 'Sign-in is refused', 'Everything'],
  [
    `unverified.t@${DOMAIN}`,
    'teacher',
    'email_unverified',
    'The verify-email screen',
    'Everything else',
  ],
  [
    `cr.a@${DOMAIN}`,
    'CR CSE 1-I-A',
    'active',
    'CR dashboard, join requests, flags, group chat owner, requests',
    "Another section's requests, roster or flags",
  ],
  [
    `dcr.a@${DOMAIN}`,
    'DCR CSE 1-I-A',
    'active',
    'Flags raised today',
    'A 6th flag today (limit 5)',
  ],
  [
    `b1.student@${DOMAIN}`,
    'CR CSE 1-I-B',
    'active',
    '3 pending requests at one time',
    'A 4th overlapping request (limit 3)',
  ],
  [
    `cse2ia.01@${DOMAIN}`,
    'CR CSE 2-I-A',
    'active',
    'Unconfirmed students from last semester',
    'A second reminder to Shuvo Roy today',
  ],
  [
    `bba1.student@${DOMAIN}`,
    'CR BBA 1-I-A',
    'active',
    'BBA requests, BBA group chat',
    'Any CSE section',
  ],
  [
    `a1.student@${DOMAIN}`,
    'student CSE 1-I-A',
    'active',
    'Routine, free rooms, chat, profile',
    "Admin pages; other sections' rosters",
  ],
  [
    `a3.student@${DOMAIN}`,
    'student CSE 1-I-A',
    'active, chat-suspended',
    'Reading chat',
    'Sending any message (suspended for 4 more days)',
  ],
  [
    `a4.student@${DOMAIN}`,
    'student CSE 1-I-A',
    'active',
    'Her blocked-users list (blocks Imran Khan)',
    '-',
  ],
  [
    `a5.student@${DOMAIN}`,
    'student CSE 1-I-A',
    'active',
    'Reading his old chat with Nusrat',
    'Messaging Nusrat Sultana (blocked)',
  ],
  [
    `a6.student@${DOMAIN}`,
    'student CSE 1-I-A',
    'active',
    'Her appeal against removal from the group',
    'Posting in the 1-I-A group',
  ],
  [
    `temp.password@${DOMAIN}`,
    'student CSE 1-I-A',
    'active, temporary password',
    'The forced change-password screen',
    'Everything else until the password is changed',
  ],
  [
    `bouncing@${DOMAIN}`,
    'student CSE 1-I-A',
    'active, email bouncing',
    'The "email bouncing" reminder',
    '-',
  ],
  [
    `join.student@${DOMAIN}`,
    'student',
    'claim_pending',
    'The waiting screen for 1-I-A; withdraw the request',
    'Routine, rooms, the group chat',
  ],
  [
    `appeal.student@${DOMAIN}`,
    'student',
    'claim_pending',
    'The join form, with the rejected request and its open appeal',
    'A second appeal',
  ],
  [
    `rejected.student@${DOMAIN}`,
    'student',
    'claim_pending',
    'The join form with the rejection reason; appeal it or ask again',
    'Routine, rooms, the group chat',
  ],
  [
    `unconfirmed.student@${DOMAIN}`,
    'student',
    'unconfirmed',
    'The semester-update screen (confirm a section)',
    'App screens until confirmed',
  ],
  [
    `not.enrolled@${DOMAIN}`,
    'student',
    'unconfirmed (not enrolled)',
    'Already chose "not enrolled" this semester',
    'Being listed or reminded by a CR',
  ],
  [
    `graduated.student@${DOMAIN}`,
    'student',
    'graduated',
    'A limited dashboard; chat still works',
    'Join requests, room requests',
  ],
  [`deactivated.student@${DOMAIN}`, 'student', 'deactivated', 'Sign-in is refused', 'Everything'],
  [
    `unverified.student@${DOMAIN}`,
    'student',
    'email_unverified',
    'The verify-email screen',
    'Everything else',
  ],
];

async function main() {
  const config = getConfig();
  if (config.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data when NODE_ENV=production.');
    process.exitCode = 1;
    return;
  }
  await connectDb(config.MONGO_URL, { dnsServers: config.DNS_SERVERS });
  try {
    await syncAllIndexes();
    const out = await seedDemo();
    const total = Object.values(out.created).reduce((a, b) => a + b, 0);
    console.log(`\nDemo data applied. ${total} new documents.`);
    if (total) console.table(out.created);
    console.log('\nDemo accounts (details and what to try: docs/demo-data.md)');
    console.table(
      GUIDE.map(([email, role, state, tryIt, refused]) => ({
        email,
        role,
        state,
        try: tryIt,
        refused,
      })),
    );
    console.log(`Every demo account uses the password: ${PASSWORD}`);
    console.log('Admins also need a 6-digit code from an authenticator app (time-based, 30 s).');
    console.log(`Add this key to the app once: ${ADMIN_TOTP_SECRET}`);
    console.log('Bulk students sign in as <section>.<nn>@baiust.ac.bd, e.g. cse1ia.01, bba2ia.07.');
    if (config.SMTP_HOST && config.SMTP_USER) {
      console.warn(
        '\nWARNING: SMTP is configured. The demo addresses use the real university domain.',
      );
      console.warn(
        'Run the dev server with SMTP_USER= (empty) so emails go to /dev/outbox, not out.',
      );
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

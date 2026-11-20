import { getConfig } from '../src/config.js';
import { connectDb, disconnectDb, syncAllIndexes } from '../src/lib/db.js';
import { encrypt, emailHmac } from '../src/lib/crypto.js';
import { clock, toInstitutionDate, addDays, weekdayOf, instantFrom } from '../src/lib/time.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { User, UserRole } from '../src/modules/auth/auth.model.js';
import { Department, Semester } from '../src/modules/organisation/organisation.model.js';
import { Section, SectionGroup, RoutineSlot, RoutineSlotTeacher } from '../src/modules/routine/routine.model.js';
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
} from '../src/modules/chat/chat.model.js';
import { encryptBody } from '../src/modules/chat/chat.context.js';
import { lockBlocks } from '../src/modules/bookings/decision.service.js';
import { normaliseName } from '../src/modules/rooms/normalise.js';
import { PERIODS } from '@crm/shared';

/**
 * Demo data for trying every feature by hand. Safe to run again: everything is looked up by a
 * natural key first, so a second run changes nothing. Existing data (super admin, departments,
 * the current semester) is reused, never replaced.
 *
 *   npm run seed:demo
 */
const config = getConfig();
if (config.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data when NODE_ENV=production.');
  process.exit(1);
}

const PASSWORD = 'Demo@12345';
// A fixed authenticator secret so the demo admins can sign in (the second step is required for admins).
const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const DOMAIN = 'baiust.ac.bd';
const now = clock.now();
const minutesAgo = (m) => new Date(now.getTime() - m * 60_000);
const out = { created: {}, accounts: [] };
const bump = (k, n = 1) => (out.created[k] = (out.created[k] ?? 0) + n);

await connectDb(config.MONGO_URL, { dnsServers: config.DNS_SERVERS });
await syncAllIndexes();

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
  console.error('No super admin yet. Run: npm run seed:super-admin -- --email <e> --name <n>');
  process.exit(1);
}
const superAdminId = superAdminRole.user_id;

const dept = async (code, name) => ensure(Department, { code }, { name }, 'department');
const cse = await dept('CSE', 'Computer Science and Engineering');
const bba = await dept('BBA', 'Business Administration');
const eee = await dept('EEE', 'Electrical and Electronic Engineering');

let semester = await Semester.findOne({ status: 'current' }).lean();
if (!semester) {
  semester = await ensure(Semester, { name: 'Spring 2027' }, {
    status: 'current',
    start_date: '2026-11-06',
    end_date: '2027-05-06',
    made_current_at: now,
    made_current_by: superAdminId,
  }, 'semester');
}
// An archived one, so the rollover and history screens have something to show.
await ensure(Semester, { name: 'Fall 2026' }, {
  status: 'archived',
  start_date: '2026-06-01',
  end_date: '2026-10-31',
  archived_at: new Date('2026-11-01T00:00:00Z'),
}, 'semester');

// ---------- users ----------
const passwordHash = await hashPassword(PASSWORD);

async function user({ email, name, kind, state, department, ...extra }) {
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
  out.accounts.push({ email, name, state, kind });
  return doc;
}

async function role(userDoc, fields) {
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
  email: `cse.admin@${DOMAIN}`, name: 'Dr. Mahbub Alam', kind: 'staff', state: 'active',
  department: cse, ...adminExtra,
});
await role(cseAdmin, { role: 'dept_admin', department_id: cse._id });
const bbaAdmin = await user({
  email: `bba.admin@${DOMAIN}`, name: 'Ms. Nusrat Jahan', kind: 'staff', state: 'active',
  department: bba, ...adminExtra,
});
await role(bbaAdmin, { role: 'dept_admin', department_id: bba._id });

// ---------- teachers ----------
const teacherUser = async (email, name, short, department, state = 'active') => {
  const u = await user({
    email, name, kind: 'teacher', state, department, requested_short_code: short,
  });
  if (state === 'active') await role(u, { role: 'teacher', department_id: department._id });
  return u;
};
const tRhn = await teacherUser(`rahman.t@${DOMAIN}`, 'Md. Rahman', 'RHN', cse);
const tKrm = await teacherUser(`karim.t@${DOMAIN}`, 'Dr. Abdul Karim', 'KRM', cse);
const tAhm = await teacherUser(`ahmed.t@${DOMAIN}`, 'Farhana Ahmed', 'AHM', cse);
const tHsn = await teacherUser(`hasan.t@${DOMAIN}`, 'Kamrul Hasan', 'HSN', bba);
const tPending = await teacherUser(`nasir.t@${DOMAIN}`, 'Nasir Uddin', 'NSR', cse, 'pending');
await teacherUser(`suspended.t@${DOMAIN}`, 'Rafiq Islam', 'RFQ', cse, 'suspended');

const teacherRecord = (department, short_code, full_name, userDoc) =>
  ensure(Teacher, { department_id: department._id, short_code }, {
    full_name,
    user_id: userDoc?._id,
    created_from: 'manual',
  }, 'teacher');
const RHN = await teacherRecord(cse, 'RHN', 'Md. Rahman', tRhn);
const KRM = await teacherRecord(cse, 'KRM', 'Dr. Abdul Karim', tKrm);
const AHM = await teacherRecord(cse, 'AHM', 'Farhana Ahmed', tAhm);
const SMT = await teacherRecord(cse, 'SMT', 'Sumaiya Tabassum', null); // no account yet
const HSN = await teacherRecord(bba, 'HSN', 'Kamrul Hasan', tHsn);
await ensure(TeacherRegistration, { user_id: tPending._id, status: 'pending' }, {
  department_id: cse._id, requested_short_code: 'NSR',
}, 'teacher_registration');

// ---------- rooms ----------
const room = async (department, code, type) =>
  ensure(Room, { code_norm: normaliseName(code) }, {
    code, type, owner_department_id: department._id,
  }, 'room');
const r101 = await room(cse, 'CSE-101', 'classroom');
const r102 = await room(cse, 'CSE-102', 'classroom');
const r201 = await room(cse, 'CSE-201', 'classroom');
const r202 = await room(cse, 'CSE-202', 'classroom');
const lab1 = await room(cse, 'CSE-LAB-1', 'lab');
const lab2 = await room(cse, 'CSE-LAB-2', 'lab');
const b101 = await room(bba, 'BBA-101', 'classroom');
await room(eee, 'EEE-101', 'classroom');
await ensure(RoomAlias, { alias_norm: normaliseName('Main Lab') }, { alias: 'Main Lab', room_id: lab1._id }, 'room_alias');
await ensure(RoomShare, { room_id: r201._id, department_id: bba._id }, {}, 'room_share'); // CSE-201 shared to BBA

// ---------- sections ----------
const section = (department, level, term, letter) =>
  ensure(Section, {
    semester_id: semester._id, department_id: department._id, level, term, letter,
  }, {}, 'section');
const secA = await section(cse, 1, 'I', 'A');
const secB = await section(cse, 1, 'I', 'B');
const secBba = await section(bba, 1, 'I', 'A');
const sectionGroup = (sec, label) => ensure(SectionGroup, { section_id: sec._id, label }, {}, 'section_group');
const g1 = await sectionGroup(secA, 'G1');
const g2 = await sectionGroup(secA, 'G2');

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
const slotByKey = {};
for (const [sec, day, p1, p2, code, name, rm, teacher, grp] of slotDefs) {
  const start_min = PERIODS[p1].start_min;
  const filter = { semester_id: semester._id, section_id: sec._id, day_of_week: day, start_min };
  const owner = sec === secBba ? bba : cse;
  const slot = await ensure(RoutineSlot, filter, {
    owner_department_id: owner._id, group_id: grp?._id, end_min: PERIODS[p2].end_min,
    course_code: code, course_name: name, room_id: rm._id, source: 'manual', published: true,
  }, 'routine_slot');
  slotByKey[`${sec._id}:${day}:${start_min}`] = slot;
  await ensure(RoutineSlotTeacher, { slot_id: slot._id, teacher_id: teacher._id }, {}, 'routine_slot_teacher');
}

// ---------- students and enrolments ----------
const student = (email, name, state, department, extra = {}) =>
  user({ email, name, kind: 'student', state, department, ...extra });
const enrol = async (u, sec, status, grp) => {
  const filter = { user_id: u._id, semester_id: semester._id, section_id: sec._id, status };
  return ensure(Enrolment, filter, {
    department_id: sec.department_id,
    group_id: grp?._id,
    group_set_by: grp ? 'cr' : undefined,
    decided_at: status === 'accepted' ? now : undefined,
    decided_by: status === 'accepted' ? cseAdmin._id : undefined,
  }, 'enrolment');
};
const base = { confirmed_semester_id: semester._id };

const sCr = await student(`cr.a@${DOMAIN}`, 'Tanvir Hossain', 'active', cse, base);
const sDcr = await student(`dcr.a@${DOMAIN}`, 'Ayesha Siddika', 'active', cse, base);
const sA = [];
const aNames = ['Sabbir Ahmed', 'Mim Akter', 'Rakib Hasan', 'Nusrat Sultana', 'Imran Khan', 'Lamia Rahman'];
for (let i = 0; i < aNames.length; i++) {
  sA.push(await student(`a${i + 1}.student@${DOMAIN}`, aNames[i], 'active', cse, base));
}
const sB = [];
for (const [i, n] of ['Shakil Mahmud', 'Tasnim Jahan', 'Arif Billah'].entries()) {
  sB.push(await student(`b${i + 1}.student@${DOMAIN}`, n, 'active', cse, base));
}
const sBba = await student(`bba1.student@${DOMAIN}`, 'Sadia Afrin', 'active', bba, base);

for (const [i, u] of [sCr, sDcr, ...sA].entries()) await enrol(u, secA, 'accepted', i % 2 ? g2 : g1);
for (const u of sB) await enrol(u, secB, 'accepted');
await enrol(sBba, secBba, 'accepted');

// Representatives (one CR and one DCR per section).
await role(sCr, { role: 'cr', department_id: cse._id, section_id: secA._id, semester_id: semester._id, is_representative: true });
await role(sDcr, { role: 'dcr', department_id: cse._id, section_id: secA._id, semester_id: semester._id, is_representative: true });
await role(sB[0], { role: 'cr', department_id: cse._id, section_id: secB._id, semester_id: semester._id, is_representative: true });

// Students in other account states, to see each screen.
const sJoin = await student(`join.student@${DOMAIN}`, 'Jahid Hasan', 'claim_pending', cse);
await enrol(sJoin, secA, 'pending');
await student(`unconfirmed.student@${DOMAIN}`, 'Mahin Chowdhury', 'unconfirmed', cse);
await student(`unverified.student@${DOMAIN}`, 'Pritom Das', 'email_unverified', null);
await student(`graduated.student@${DOMAIN}`, 'Old Student', 'graduated', cse, { graduated_at: new Date('2026-09-30') });
await student(`deactivated.student@${DOMAIN}`, 'Inactive Student', 'deactivated', cse, { state_before_deactivation: 'active' });

// ---------- calendar ----------
const today = toInstitutionDate(now);
const nextWorkday = (from, offset, wanted = null) => {
  let d = addDays(from, offset);
  while (weekdayOf(d) > 4 || (wanted !== null && weekdayOf(d) !== wanted)) d = addDays(d, 1);
  return d;
};
const event = (kind, from_date, to_date, label, extra = {}) =>
  ensure(CalendarEvent, { kind, from_date, to_date, label }, { created_by: superAdminId, ...extra }, 'calendar_event');
await event('holiday', '2026-12-16', '2026-12-16', 'Victory Day');
await event('holiday', '2026-12-25', '2026-12-25', 'Christmas Day');
await event('holiday', '2027-02-21', '2027-02-21', 'International Mother Language Day');
await event('holiday', '2027-03-26', '2027-03-26', 'Independence Day');
await event('prep_leave', '2027-01-03', '2027-01-09', 'Preparatory leave before midterm', { scope_department_id: cse._id, created_by: cseAdmin._id });
await event('exam', '2027-01-10', '2027-01-14', 'CSE Midterm Examination', { scope_department_id: cse._id, created_by: cseAdmin._id });
const early = nextWorkday(today, 3);
await event('early_closing', early, early, 'Early closing: staff meeting', { cutoff_min: 780 });
const fest = nextWorkday(today, 6);
await event('dept_event', fest, fest, 'CSE Tech Fest', { scope_department_id: cse._id, cutoff_min: 840, created_by: cseAdmin._id });

const nextSunday = nextWorkday(today, 1, 0);
const cancelled = slotByKey[`${secA._id}:0:${PERIODS[0].start_min}`];
await ensure(ClassCancellation, { slot_id: cancelled._id, date: nextSunday }, {
  reason: 'Teacher is on leave', created_by: cseAdmin._id,
}, 'class_cancellation');

// ---------- room requests ----------
const d1 = nextWorkday(today, 1);
const d2 = nextWorkday(today, 2);
const d3 = nextWorkday(today, 3);
const d4 = nextWorkday(today, 4);
const request = async (date, rm, p, status, who, extra = {}) => {
  const start_min = PERIODS[p].start_min;
  const end_min = PERIODS[p].end_min;
  const requester = who === 'teacher'
    ? { requester_teacher_id: RHN._id, sent_by_user_id: tRhn._id, target_section_id: secA._id }
    : { requester_section_id: secA._id, sent_by_user_id: sCr._id, target_section_id: secA._id };
  const doc = await ensure(RoomRequest, { room_id: rm._id, date, start_min, end_min }, {
    semester_id: semester._id, ...requester, starts_at: instantFrom(date, start_min),
    note: extra.note ?? 'Extra class for the upcoming test', status, ...extra,
  }, 'room_request');
  if (status === 'approved' && !(await RoomSlotLock.exists({ room_request_id: doc._id }))) {
    await RoomSlotLock.insertMany(lockBlocks(rm._id, date, doc._id, start_min, end_min));
    bump('room_slot_lock', (end_min - start_min) / 5);
  }
  return doc;
};
await request(d1, r201, 6, 'pending', 'cr');
await request(d2, r202, 3, 'approved', 'cr', { decided_by: cseAdmin._id, decided_at: now });
await request(d2, r201, 5, 'rejected', 'cr', { decided_by: cseAdmin._id, decided_at: now, reason: 'The room is reserved for a department meeting.' });
await request(d3, r202, 7, 'cancelled', 'cr', { cancelled_by: sCr._id, cancelled_at: now });
await request(d3, lab1, 6, 'pending', 'teacher', { note: 'Make-up lab session' });
await request(d4, r201, 4, 'approved', 'teacher', { decided_by: cseAdmin._id, decided_at: now, note: 'Doubt-clearing class' });

// ---------- chat ----------
const memberRow = (conversation, u, role = 'member') =>
  ensure(ConversationMember, { conversation_id: conversation._id, user_id: u._id }, {
    role, last_read_at: minutesAgo(5), last_delivered_at: minutesAgo(5),
  }, 'conversation_member');

const group = await ensure(Conversation, { type: 'section_group', section_id: secA._id, semester_id: semester._id }, {
  name: `CSE 1-I-A · ${semester.name}`, closed_at: null, created_at: minutesAgo(600),
}, 'conversation');
await memberRow(group, sCr, 'owner');
for (const u of [sDcr, ...sA]) await memberRow(group, u);

const direct0 = await Conversation.findOne({ type: 'direct', pair_key: [String(sCr._id), String(tRhn._id)].sort().join(':') }).lean();
// Message times move with the clock, so "already seeded" is judged per conversation.
const seededChats = new Set();
for (const c of [group, direct0]) {
  if (c && (await Message.exists({ conversation_id: c._id }))) seededChats.add(String(c._id));
}
const say = async (conversation, sender, text, ago) => {
  if (seededChats.has(String(conversation._id))) {
    return Message.findOne({ conversation_id: conversation._id, sender_id: sender._id }).lean();
  }
  const [doc] = await Message.create([
    { conversation_id: conversation._id, sender_id: sender._id, created_at: minutesAgo(ago), body_enc: encryptBody(text) },
  ]);
  bump('message');
  return doc.toObject();
};
const groupLines = [
  [sCr, 'Assalamu alaikum everyone. Tomorrow\'s CSE101 class is in room 101.', 300],
  [sA[0], 'Is the lab report due this week?', 280],
  [sDcr, 'Yes, submit it before Thursday.', 270],
  [sA[2], 'Can someone share the Discrete Math slides?', 200],
  [sA[1], 'I will upload them tonight.', 190],
  [sCr, 'Reminder: we requested room 201 for an extra class.', 60],
];
let lastGroup = null;
for (const [who, text, ago] of groupLines) lastGroup = await say(group, who, text, ago);
await Conversation.updateOne({ _id: group._id }, { $set: { last_message_at: minutesAgo(60) } });

const pairKey = [String(sCr._id), String(tRhn._id)].sort().join(':');
const direct = await ensure(Conversation, { type: 'direct', pair_key: pairKey }, { closed_at: null, created_at: minutesAgo(500) }, 'conversation');
await memberRow(direct, sCr);
await memberRow(direct, tRhn);
await say(direct, sCr, 'Sir, can we move the Sunday class by one period?', 120);
await say(direct, tRhn, 'Send a room request for it and I will confirm.', 100);
await Conversation.updateOne({ _id: direct._id }, { $set: { last_message_at: minutesAgo(100) } });

// Safety features: a block and an open report.
await ensure(Block, { blocker_id: sA[3]._id, blocked_id: sA[4]._id }, { created_at: now }, 'block');
await ensure(Report, { reporter_id: sA[1]._id, target_user_id: sA[2]._id }, {
  message_id: lastGroup._id,
  conversation_id: group._id, category: 'spam', note: 'Demo report', department_id: cse._id,
  window_ids: [lastGroup._id], status: 'open', created_at: now,
}, 'report');

await disconnectDb();

console.log('\nDemo data applied. New documents per collection:');
console.table(out.created);
console.log(`\nEvery demo account uses the password: ${PASSWORD}`);
console.log(`Admins also need a 6-digit code. Add this key to an authenticator app (time-based): ${ADMIN_TOTP_SECRET}`);
console.table(out.accounts);

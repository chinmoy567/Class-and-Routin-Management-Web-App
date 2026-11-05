// Spec 20: section groups (CHT-08 to CHT-13, CHT-22). Hooks from spec 09 (CR/DCR), spec 10
// (acceptance, removal) and spec 14 (rollover) keep the groups in step with the section.
import { AppError, notFound } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { afterCommit, withTransaction } from '../../lib/db.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { assertCan, isAdminOf, hasRole } from '../../policy/index.js';
import { record } from '../audit/index.js';
import { peopleById } from '../auth/index.js';
import { listAcceptedOfSection } from '../enrolments/index.js';
import { crDcrOf, repRolesOfUsers } from '../representatives/index.js';
import { getSectionBrief } from '../routine/index.js';
import { Conversation, ConversationMember } from './chat.model.js';
import { groupName, isOwnerOf, loadConversation, membershipOf } from './chat.context.js';
import { joinUserRoom, leaveUserRoom } from '../../lib/socket.js';
import { upsertMember } from './chat.direct.service.js';

const DUPLICATE_KEY = 11000;
const roomOf = (conversationId) => `conversation:${conversationId}`;

/** CHT-08: the group of a section and semester, created on first need. Race-safe (upsert). */
export async function ensureGroup(section) {
  const filter = {
    type: 'section_group',
    section_id: section.id,
    semester_id: section.semester_id,
  };
  const existing = await Conversation.findOne(filter).lean();
  if (existing) return existing;
  const name = await groupName(section.id, section.semester_id);
  try {
    return await Conversation.findOneAndUpdate(
      filter,
      {
        $setOnInsert: {
          ...filter,
          name,
          closed_at: null,
          created_at: clock.now(),
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
  } catch (err) {
    if (err.code !== DUPLICATE_KEY) throw err;
    return Conversation.findOne(filter).lean();
  }
}

async function setRole(conversationId, userId, role) {
  await ConversationMember.updateOne(
    { conversation_id: conversationId, user_id: userId },
    { $set: { role } },
  );
}

/**
 * CHT-08, CHT-09, CHT-11: a CR or DCR takes effect. The group is created when the section has a
 * CR in effect (a DCR alone does not create it). Owners are the reps in effect.
 */
export async function onRepAssigned(section) {
  const current = await getSectionBrief(section.id);
  if (!current) return;
  const reps = await crDcrOf(current.id);
  if (!reps.some((r) => r.role === 'cr')) return;
  const conversation = await ensureGroup(current);
  for (const rep of reps) {
    await upsertMember(conversation._id, rep.user_id, 'owner');
    await setRole(conversation._id, rep.user_id, 'owner');
    if (!conversation.closed_at) joinUserRoom(rep.user_id, roomOf(conversation._id));
  }
  for (const e of await listAcceptedOfSection(current.id, current.semester_id)) {
    await upsertMember(conversation._id, e.user_id, 'member');
  }
}

/** CHT-09: an accepted student joins the section's group (spec 10 hook). Reinstates a removed row. */
export async function onAccepted({ user_id, section_id, semester_id }) {
  const section = await getSectionBrief(section_id);
  if (!section || String(section.semester_id) !== String(semester_id)) return;
  const conversation = await ensureGroup(section);
  await upsertMember(conversation._id, user_id, 'member');
  await ConversationMember.updateOne(
    { conversation_id: conversation._id, user_id },
    { $set: { removed_at: null, removed_by: null, appeal_text: null, appealed_at: null } },
  );
  if (!conversation.closed_at) joinUserRoom(user_id, roomOf(conversation._id));
}

/** CHT-09: the student was removed from the section (spec 10 JR-19). Their sockets leave at once. */
export async function onMembershipRemoved({ user_id, section_id, semester_id, actor }) {
  const conversation = await Conversation.findOne({
    type: 'section_group',
    section_id,
    semester_id,
  }).lean();
  if (!conversation) return;
  const section = await getSectionBrief(section_id);
  await withTransaction(async (session) => {
    const row = await ConversationMember.findOneAndUpdate(
      { conversation_id: conversation._id, user_id, removed_at: null },
      { $set: { removed_at: clock.now(), removed_by: actor?._id ?? null } },
      { returnDocument: 'after', session },
    ).lean();
    // CHT-22: the audit entry is written with the membership change, in one transaction.
    if (row && actor) {
      await record({
        actor,
        action: 'chat.member_removed',
        scope_department_id: section?.department_id,
        target: { type: 'conversation_member', id: row._id },
        new_value: { conversation_id: String(conversation._id), user_id: String(user_id) },
        session,
      });
    }
  });
  leaveUserRoom(user_id, roomOf(conversation._id));
}

/** CHT-12: at rollover the old semester's groups close. History stays readable to members. */
export async function onRollover({ archived_semester_id }) {
  const now = clock.now();
  const groups = await Conversation.find({
    type: 'section_group',
    semester_id: archived_semester_id,
    closed_at: null,
  }).lean();
  if (!groups.length) return;
  await Conversation.updateMany(
    { _id: { $in: groups.map((g) => g._id) } },
    { $set: { closed_at: now } },
  );
  for (const group of groups) {
    const members = await ConversationMember.find({
      conversation_id: group._id,
      removed_at: null,
    })
      .select('user_id')
      .lean();
    for (const m of members) leaveUserRoom(m.user_id, roomOf(group._id));
  }
}

/** CHT-10: an owner removes a member. Another section's owner gets 404 (not a member there). */
export async function removeMember(me, conversationId, userId) {
  const conversation = await loadConversation(conversationId);
  if (conversation.type !== 'section_group') throw notFound();
  assertCan(me, 'chat.read', { member: await membershipOf(conversation._id, me._id) });
  const isOwner = await isOwnerOf(me._id, conversation);
  assertCan(me, 'chat.moderate_group', { conversation, isOwner });
  const target = await membershipOf(conversation._id, userId);
  if (!target || target.removed_at) throw notFound();
  if (await isOwnerOf(userId, conversation)) {
    throw new AppError(403, 'FORBIDDEN', 'You are not allowed to do this.');
  }
  const section = await getSectionBrief(conversation.section_id);
  await withTransaction(async (session) => {
    const row = await ConversationMember.findOneAndUpdate(
      { _id: target._id, removed_at: null },
      { $set: { removed_at: clock.now(), removed_by: me._id } },
      { returnDocument: 'after', session },
    ).lean();
    if (!row) throw notFound();
    await record({
      actor: me,
      action: 'chat.member_removed',
      scope_department_id: section?.department_id,
      target: { type: 'conversation_member', id: row._id },
      new_value: { conversation_id: String(conversation._id), user_id: String(userId) },
      session,
    });
  });
  afterCommit(() => leaveUserRoom(userId, roomOf(conversation._id)));
  return { removed: true };
}

/** CHT-10b: the member list. Owners and the department admin see removed members too. */
export async function listMembers(me, conversationId) {
  const conversation = await loadConversation(conversationId);
  if (conversation.type !== 'section_group') throw notFound();
  assertCan(me, 'chat.read', { member: await membershipOf(conversation._id, me._id) });
  const section = await getSectionBrief(conversation.section_id);
  const privileged =
    (await isOwnerOf(me._id, conversation)) || isAdminOf(me, section?.department_id);
  const rows = await ConversationMember.find({
    conversation_id: conversation._id,
    ...(privileged ? {} : { removed_at: null }),
  })
    .sort({ created_at: 1 })
    .lean();
  const people = await peopleById(rows.map((r) => r.user_id));
  const reps = await repRolesOfUsers(rows.map((r) => String(r.user_id)));
  return rows.map((r) => {
    const person = people.get(String(r.user_id));
    const base = {
      user_id: String(r.user_id),
      full_name: person?.full_name ?? '',
      photo_url: person?.photo_url ?? null,
    };
    if (!privileged) return base;
    const roles = (reps.get(String(r.user_id)) ?? []).map((x) => x.role.toUpperCase());
    return { ...base, role_label: roles[0] ?? 'student', removed: Boolean(r.removed_at) };
  });
}

/** CHT-10a: a removed member appeals once per removal. A second one is a CONFLICT. */
export async function appealRemoval(me, conversationId, text) {
  const conversation = await loadConversation(conversationId);
  const member = await membershipOf(conversation._id, me._id);
  assertCan(me, 'chat.appeal', { member });
  const row = await ConversationMember.findOneAndUpdate(
    { _id: member._id, removed_at: { $ne: null }, appealed_at: null },
    { $set: { appeal_text: encrypt(text), appealed_at: clock.now() } },
    { returnDocument: 'after' },
  ).lean();
  if (!row) throw new AppError(409, 'CONFLICT', 'You have already appealed this removal.');
  return { id: String(row._id) };
}

/** CHT-10a, CHT-10: the admin of the section's department restores a removed member. */
export async function restoreMember(me, memberId) {
  const member = await ConversationMember.findById(memberId).lean();
  if (!member) throw notFound();
  const conversation = await Conversation.findById(member.conversation_id).lean();
  if (!conversation || conversation.type !== 'section_group') throw notFound();
  const section = await getSectionBrief(conversation.section_id);
  assertCan(me, 'chat.restore_member', { department_id: section?.department_id });
  if (!member.removed_at) {
    throw new AppError(409, 'ALREADY_DECIDED', 'This member is already in the group.');
  }
  await withTransaction(async (session) => {
    const row = await ConversationMember.findOneAndUpdate(
      { _id: member._id, removed_at: { $ne: null } },
      { $set: { removed_at: null, removed_by: null, appeal_text: null, appealed_at: null } },
      { returnDocument: 'after', session },
    ).lean();
    if (!row) throw new AppError(409, 'ALREADY_DECIDED', 'This member has already been restored.');
    await record({
      actor: me,
      action: 'chat.member_restored',
      scope_department_id: section?.department_id,
      target: { type: 'conversation_member', id: member._id },
      new_value: { conversation_id: String(conversation._id), user_id: String(member.user_id) },
      session,
    });
  });
  afterCommit(() => joinUserRoom(member.user_id, roomOf(conversation._id)));
  return { restored: true };
}

/** CHT-10a: appeals waiting for the admin, in scope (super admin: all; dept admin: own depts). */
export async function listChatAppeals(me) {
  assertCan(me, 'chat.admin_appeals', {});
  const rows = await ConversationMember.find({
    removed_at: { $ne: null },
    appealed_at: { $ne: null },
  })
    .sort({ appealed_at: -1 })
    .limit(200)
    .lean();
  const conversations = await Conversation.find({
    _id: { $in: rows.map((r) => r.conversation_id) },
    type: 'section_group',
  }).lean();
  const byId = new Map(conversations.map((c) => [String(c._id), c]));
  const people = await peopleById(rows.map((r) => r.user_id));
  const ownDepartments = (me.roles ?? [])
    .filter((r) => r.role === 'dept_admin')
    .map((r) => String(r.department_id));
  const out = [];
  for (const row of rows) {
    const conversation = byId.get(String(row.conversation_id));
    if (!conversation) continue;
    const section = await getSectionBrief(conversation.section_id);
    if (!section) continue;
    if (!hasRole(me, 'super_admin') && !ownDepartments.includes(section.department_id)) continue;
    out.push({
      id: String(row._id),
      conversation_id: String(conversation._id),
      group_name: conversation.name ?? null,
      department_id: section.department_id,
      user_id: String(row.user_id),
      full_name: people.get(String(row.user_id))?.full_name ?? '',
      appeal_text: row.appeal_text ? decrypt(row.appeal_text) : '',
      appealed_at: row.appealed_at,
      removed_at: row.removed_at,
    });
  }
  return out;
}

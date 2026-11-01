import { Room, RoomAlias, RoomShare, RoomNameGuard } from './rooms.model.js';
import { normaliseName } from './normalise.js';
import { assertCan, hasRole } from '../../policy/index.js';
import { withTransaction } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { clock } from '../../lib/time.js';
import { record } from '../audit/index.js';
import { departmentNames, isActiveDepartment } from '../organisation/index.js';

const GUARD_ID = 'rooms';
const idOk = (id) => /^[a-f0-9]{24}$/i.test(String(id));
const isDuplicate = (err) => err?.code === 11000;
const same = (a, b) => String(a) === String(b);

const taken = () => new AppError(409, 'CONFLICT', 'That name is already used by a room or alias.');
const retiredRoom = () => new AppError(409, 'CONFLICT', 'A retired room cannot be changed.');
const invalid = (fields) =>
  new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', fields);

const roomView = (r) => ({
  id: String(r._id),
  code: r.code,
  type: r.type,
  retired: Boolean(r.retired),
  owner_department_id: String(r.owner_department_id),
});

// ROOM-06: published routine slots arrive in spec 07. Each later spec registers a function
// `(roomId) => boolean` that says whether a published slot of the current or draft semester
// uses the room.
const providers = { inUse: [] };
export function registerRoomUsage({ inUse } = {}) {
  if (inUse) providers.inUse.push(inUse);
}
/** For tests: forget every registered provider. */
export function resetRoomUsage() {
  providers.inUse = [];
}

async function ensureGuard() {
  try {
    await RoomNameGuard.updateOne(
      { _id: GUARD_ID },
      { $setOnInsert: { version: 0 } },
      { upsert: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err; // another request created it first
  }
}
const touchGuard = (session) =>
  RoomNameGuard.updateOne({ _id: GUARD_ID }, { $inc: { version: 1 } }, { session });

async function loadRoom(id) {
  const room = idOk(id) ? await Room.findById(id).lean() : null;
  if (!room) throw new AppError(404, 'NOT_FOUND', 'Room not found.');
  return room;
}

/** Is this normalised name already a room code or an alias? */
async function nameInUse(norm, session) {
  return Boolean(
    (await Room.exists({ code_norm: norm }).session(session)) ||
    (await RoomAlias.exists({ alias_norm: norm }).session(session)),
  );
}

/** ROOM-08: every active room, code and type only. */
export async function listActiveRooms(actor) {
  assertCan(actor, 'room.list');
  const rows = await Room.find({ retired: false }).sort({ code_norm: 1 }).lean();
  return rows.map((r) => ({ id: String(r._id), code: r.code, type: r.type }));
}

/**
 * The Classrooms page. A super admin without a department sees every room; a department admin
 * without one sees the rooms of the departments they administer.
 */
export async function listAdminRooms(actor, departmentId) {
  assertCan(actor, 'room.admin_list', { department_id: departmentId });
  let ownerFilter = {};
  let scopeIds = null;
  if (departmentId) {
    ownerFilter = { owner_department_id: departmentId };
    scopeIds = [departmentId];
  } else if (!hasRole(actor, 'super_admin')) {
    scopeIds = actor.roles.filter((r) => r.role === 'dept_admin').map((r) => r.department_id);
    ownerFilter = { owner_department_id: { $in: scopeIds } };
  }

  const owned = await Room.find(ownerFilter).sort({ code_norm: 1 }).lean();
  const ids = owned.map((r) => r._id);
  const [aliases, shares] = await Promise.all([
    RoomAlias.find({ room_id: { $in: ids } })
      .sort({ alias_norm: 1 })
      .lean(),
    RoomShare.find({ room_id: { $in: ids } }).lean(),
  ]);

  let sharedRooms = [];
  if (scopeIds) {
    const links = await RoomShare.find({ department_id: { $in: scopeIds } }).lean();
    sharedRooms = await Room.find({
      _id: { $in: links.map((l) => l.room_id) },
      retired: false,
      owner_department_id: { $nin: scopeIds },
    })
      .sort({ code_norm: 1 })
      .lean();
  }

  const names = await departmentNames([
    ...shares.map((s) => s.department_id),
    ...sharedRooms.map((r) => r.owner_department_id),
  ]);
  const nameOf = (id) => names.get(String(id)) ?? { code: '', name: '' };

  return {
    owned: owned.map((r) => ({
      ...roomView(r),
      aliases: aliases
        .filter((a) => same(a.room_id, r._id))
        .map((a) => ({ id: String(a._id), alias: a.alias })),
      shares: shares
        .filter((s) => same(s.room_id, r._id))
        .map((s) => ({ department_id: String(s.department_id), ...nameOf(s.department_id) })),
    })),
    shared_with_me: sharedRooms.map((r) => ({
      id: String(r._id),
      code: r.code,
      type: r.type,
      owner: { department_id: String(r.owner_department_id), ...nameOf(r.owner_department_id) },
    })),
  };
}

/** ROOM-01 */
export async function createRoom(actor, { code, type, department_id }) {
  assertCan(actor, 'room.create', { department_id });
  if (!(await isActiveDepartment(department_id))) {
    throw invalid({ department_id: 'Choose an active department' });
  }
  const norm = normaliseName(code);
  await ensureGuard();
  try {
    return await withTransaction(async (session) => {
      await touchGuard(session);
      if (await nameInUse(norm, session)) throw taken();
      const [room] = await Room.create(
        [{ code, code_norm: norm, type, owner_department_id: department_id }],
        { session },
      );
      await record({
        actor,
        action: 'room.create',
        scope_department_id: room.owner_department_id,
        target: { type: 'room', id: room._id },
        new_value: { code, type },
        session,
      });
      return roomView(room);
    });
  } catch (err) {
    if (isDuplicate(err)) throw taken();
    throw err;
  }
}

/** ROOM-04, ROOM-05: edit the code and/or type. A renamed code stays behind as an alias. */
export async function updateRoom(actor, id, patch) {
  const found = await loadRoom(id);
  assertCan(actor, 'room.manage', found);
  if (found.retired) throw retiredRoom();
  await ensureGuard();
  try {
    return await withTransaction(async (session) => {
      await touchGuard(session);
      const room = await Room.findById(found._id).session(session).lean();
      if (room.retired) throw retiredRoom();
      const set = {};
      if (patch.type !== undefined && patch.type !== room.type) set.type = patch.type;

      let newAlias = null;
      if (patch.code !== undefined && patch.code !== room.code) {
        const norm = normaliseName(patch.code);
        set.code = patch.code;
        if (norm !== room.code_norm) {
          if (await Room.exists({ code_norm: norm }).session(session)) throw taken();
          const own = await RoomAlias.findOne({ alias_norm: norm }).session(session).lean();
          if (own && !same(own.room_id, room._id)) throw taken();
          // ROOM-05: renaming back to one of its own aliases takes that alias over as the code.
          if (own) await RoomAlias.deleteOne({ _id: own._id }, { session });
          set.code_norm = norm;
          newAlias = { alias: room.code, alias_norm: room.code_norm, room_id: room._id };
        }
      }
      if (!Object.keys(set).length) return roomView(room);

      if (newAlias) await RoomAlias.create([newAlias], { session });
      const updated = await Room.findOneAndUpdate(
        { _id: room._id, retired: false },
        { $set: set },
        { returnDocument: 'after', session },
      ).lean();
      if (!updated) throw retiredRoom();
      await record({
        actor,
        action: 'room.update',
        scope_department_id: room.owner_department_id,
        target: { type: 'room', id: room._id },
        old_value: { code: room.code, type: room.type },
        new_value: { code: updated.code, type: updated.type },
        session,
      });
      return roomView(updated);
    });
  } catch (err) {
    if (isDuplicate(err)) throw taken();
    throw err;
  }
}

/** ROOM-02 */
export async function addAlias(actor, id, { alias }) {
  const found = await loadRoom(id);
  assertCan(actor, 'room.manage', found);
  if (found.retired) throw retiredRoom();
  const norm = normaliseName(alias);
  await ensureGuard();
  try {
    return await withTransaction(async (session) => {
      await touchGuard(session);
      const room = await Room.findById(found._id).session(session).lean();
      if (room.retired) throw retiredRoom();
      if (await nameInUse(norm, session)) throw taken();
      const [row] = await RoomAlias.create([{ alias, alias_norm: norm, room_id: room._id }], {
        session,
      });
      await record({
        actor,
        action: 'room.alias_add',
        scope_department_id: room.owner_department_id,
        target: { type: 'room', id: room._id },
        new_value: { alias },
        session,
      });
      return { id: String(row._id), alias: row.alias };
    });
  } catch (err) {
    if (isDuplicate(err)) throw taken();
    throw err;
  }
}

export async function removeAlias(actor, id, aliasId) {
  const room = await loadRoom(id);
  assertCan(actor, 'room.manage', room);
  if (room.retired) throw retiredRoom();
  await withTransaction(async (session) => {
    const row = await RoomAlias.findOneAndDelete(
      { _id: aliasId, room_id: room._id },
      { session },
    ).lean();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Alias not found.');
    await record({
      actor,
      action: 'room.alias_remove',
      scope_department_id: room.owner_department_id,
      target: { type: 'room', id: room._id },
      old_value: { alias: row.alias },
      session,
    });
  });
}

/** ROOM-04: replace the list of sharing departments. */
export async function setShares(actor, id, departmentIds) {
  const room = await loadRoom(id);
  assertCan(actor, 'room.manage', room);
  if (room.retired) throw retiredRoom();
  const wanted = [...new Set(departmentIds.map((d) => String(d).toLowerCase()))];
  if (wanted.includes(String(room.owner_department_id))) {
    throw invalid({ department_ids: 'The owning department cannot also be a sharing department' });
  }
  for (const d of wanted) {
    if (!(await isActiveDepartment(d))) {
      throw invalid({ department_ids: 'Choose active departments only' });
    }
  }
  return withTransaction(async (session) => {
    const before = (await RoomShare.find({ room_id: room._id }).session(session).lean()).map((s) =>
      String(s.department_id),
    );
    const add = wanted.filter((d) => !before.includes(d));
    const drop = before.filter((d) => !wanted.includes(d));
    if (drop.length) {
      await RoomShare.deleteMany({ room_id: room._id, department_id: { $in: drop } }, { session });
    }
    if (add.length) {
      await RoomShare.create(
        add.map((d) => ({ room_id: room._id, department_id: d })),
        { session, ordered: true },
      );
    }
    if (add.length || drop.length) {
      await record({
        actor,
        action: 'room.shares_update',
        scope_department_id: room.owner_department_id,
        target: { type: 'room', id: room._id },
        old_value: { department_ids: before },
        new_value: { department_ids: wanted },
        session,
      });
    }
    const names = await departmentNames(wanted);
    return wanted.map((d) => ({ department_id: d, ...(names.get(d) ?? { code: '', name: '' }) }));
  });
}

/** ROOM-06: retire, never delete. Refused while a published slot of an open semester uses it. */
export async function retireRoom(actor, id) {
  const room = await loadRoom(id);
  assertCan(actor, 'room.manage', room);
  if (room.retired) return roomView(room);
  for (const fn of providers.inUse) {
    if (await fn(room._id)) {
      throw new AppError(
        409,
        'ROOM_IN_USE',
        'A published class of the current or draft semester still uses this room.',
      );
    }
  }
  return withTransaction(async (session) => {
    // First action wins: only the call that flips `retired` writes the audit entry.
    const updated = await Room.findOneAndUpdate(
      { _id: room._id, retired: false },
      { $set: { retired: true, retired_at: clock.now() } },
      { returnDocument: 'after', session },
    ).lean();
    if (!updated) return roomView({ ...room, retired: true });
    await record({
      actor,
      action: 'room.retire',
      scope_department_id: room.owner_department_id,
      target: { type: 'room', id: room._id },
      old_value: { retired: false },
      new_value: { retired: true },
      session,
    });
    return roomView(updated);
  });
}

/**
 * ROOM-03: find a room by its code or an alias (trim, collapse spaces, ignore case). Returns
 * `{ id, code, type, retired, owner_department_id }` or `null`. A retired room counts as unknown
 * (ROOM-06) unless `includeRetired` is set. Routine import and edit call this.
 */
export async function resolve(text, { includeRetired = false } = {}) {
  const norm = normaliseName(text);
  if (!norm) return null;
  let room = await Room.findOne({ code_norm: norm }).lean();
  if (!room) {
    const alias = await RoomAlias.findOne({ alias_norm: norm }).lean();
    if (alias) room = await Room.findById(alias.room_id).lean();
  }
  if (!room || (room.retired && !includeRetired)) return null;
  return roomView(room);
}

/** DEP-02: has this department got any room? Then its code can no longer change. */
export const departmentHasRooms = async (departmentId) =>
  Boolean(await Room.exists({ owner_department_id: departmentId }));

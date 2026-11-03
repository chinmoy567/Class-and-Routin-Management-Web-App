// ADM-19, ADM-10: reading the audit log. Read-only: this file only ever calls `find`.
import mongoose from 'mongoose';
import { AuditLog } from './audit.model.js';
import { instantFrom } from '../../lib/time.js';
import { AppError } from '../../lib/errors.js';

const DEFAULT_LIMIT = 50;
const SECRET_KEY = /email|phone|password|token|secret/i;

/** ADM-19: keys that can carry a secret or contact detail are dropped from every value shown. */
export function sanitiseValue(value) {
  if (Array.isArray(value)) return value.map(sanitiseValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!SECRET_KEY.test(key)) out[key] = sanitiseValue(inner);
    }
    return out;
  }
  return value;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
const encodeCursor = (at, id) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
const badCursor = () =>
  new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', {
    cursor: 'Use the cursor the page gave you',
  });

/** A cursor that does not decode to a time and an id is the caller's mistake: 400, not 500. */
const decodeCursor = (cursor) => {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || !mongoose.isValidObjectId(id)) throw badCursor();
  return { at, id };
};

/** ADM-19: the institution day range [from, to] as UTC instants (the end day is included). */
function dateRange(from, to) {
  const range = {};
  if (from) range.$gte = instantFrom(from, 0);
  if (to) {
    const next = new Date(instantFrom(to, 0).getTime() + 24 * 60 * 60 * 1000);
    range.$lt = next;
  }
  return Object.keys(range).length ? range : null;
}

/** ADM-19: an exact action, or every action in a family when the filter ends with a dot. */
const actionFilter = (action) =>
  action.endsWith('.') ? { $regex: `^${escapeRegex(action)}` } : action;

/** The ids are stored as ObjectIds for most targets; match either form. */
const idMatch = (id) => {
  const oid = new mongoose.Types.ObjectId(id);
  return { $in: [oid, id] };
};

/**
 * ADM-19: entries newest first. `departmentIds` null means every entry (super admin). A list means
 * only entries whose scope_department_id is one of them; university-wide entries (no scope) are
 * never shown to a department admin.
 */
export async function queryEntries({
  departmentIds = null,
  from,
  to,
  action,
  actor_id,
  target_id,
  cursor,
  limit = DEFAULT_LIMIT,
} = {}) {
  const filter = {};
  if (departmentIds) filter.scope_department_id = { $in: departmentIds };
  const range = dateRange(from, to);
  if (range) filter.at = range;
  if (action) filter.action = actionFilter(action);
  if (actor_id) filter.actor_id = new mongoose.Types.ObjectId(actor_id);
  if (target_id) filter.target_id = idMatch(target_id);
  if (cursor) {
    const c = decodeCursor(cursor);
    filter.$or = [
      { at: { $lt: c.at } },
      { at: c.at, _id: { $lt: new mongoose.Types.ObjectId(c.id) } },
    ];
  }

  const rows = await AuditLog.find(filter)
    .sort({ at: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    entries: page.map(toView),
    next_cursor: rows.length > limit && last ? encodeCursor(last.at, last._id) : null,
  };
}

/** ADM-10: the latest entries in scope, for the dashboard's recent activity card. */
export async function recentEntries(departmentIds, n = 20) {
  const { entries } = await queryEntries({ departmentIds, limit: n });
  return entries;
}

function toView(row) {
  return {
    id: String(row._id),
    at: row.at,
    action: row.action,
    actor_id: String(row.actor_id),
    scope_department_id: row.scope_department_id ? String(row.scope_department_id) : null,
    target: { type: row.target_type, id: row.target_id == null ? null : String(row.target_id) },
    old_value: sanitiseValue(row.old_value ?? null),
    new_value: sanitiseValue(row.new_value ?? null),
  };
}

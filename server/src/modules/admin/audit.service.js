// Spec 18, ADM-19: the audit log viewer. Read-only: this module only reads through the audit module's
// query, which never updates or deletes an entry.
import { assertCan, hasRole } from '../../policy/index.js';
import { queryEntries } from '../audit/index.js';
import { userNames } from '../auth/index.js';
import { scopeOf } from './scope.js';

/** ADM-19: entries in scope, newest first, with the actor's name. A super admin sees every entry. */
export async function auditLog(actor, query) {
  assertCan(actor, 'admin.audit.read');
  const departmentIds = hasRole(actor, 'super_admin') ? null : (await scopeOf(actor, null)).ids;
  const { entries, next_cursor } = await queryEntries({ ...query, departmentIds });
  const names = await userNames([...new Set(entries.map((e) => e.actor_id))]);
  return {
    entries: entries.map((e) => ({ ...e, actor_name: names.get(e.actor_id) ?? '' })),
    next_cursor,
  };
}

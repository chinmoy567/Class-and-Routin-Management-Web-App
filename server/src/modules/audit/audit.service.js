import { AuditLog } from './audit.model.js';
import { clock } from '../../lib/time.js';
import { currentRequestId } from '../../lib/requestContext.js';

/** Append an audit entry. Pass `session` when the action runs in a transaction. */
export async function record({
  actor,
  action,
  scope_department_id,
  target,
  old_value,
  new_value,
  session,
}) {
  const [entry] = await AuditLog.create(
    [
      {
        actor_id: actor._id,
        actor_roles: actor.roles ?? [],
        action,
        scope_department_id,
        target_type: target.type,
        target_id: target.id,
        old_value,
        new_value,
        at: clock.now(),
        request_id: currentRequestId(),
      },
    ],
    { session },
  );
  return entry;
}

export async function list(filter = {}, { limit = 50 } = {}) {
  return AuditLog.find(filter).sort({ at: -1 }).limit(limit).lean();
}

// Spec 20, CHT-03, CHT-04: finding people to message. Results only include people the caller may
// open a chat with, and only name, photo, department and role labels.
import { findPeopleByName } from '../auth/index.js';
import { repRolesOfUsers } from '../representatives/index.js';
import { departmentNames } from '../organisation/index.js';
import { can } from '../../policy/index.js';
import { CHAT_STATES } from './chat.policy.js';
import { assertChatState, sideFor } from './chat.context.js';
import { blockedEitherWay } from './chat.safety.service.js';

const MAX_RESULTS = 20;
const CANDIDATES = 80;

const kindLabel = (kind) =>
  kind === 'teacher' ? 'teacher' : kind === 'staff' ? 'staff' : 'student';

/** CHT-03: at least 2 characters (checked by the schema), prefix on any word, at most 20 results. */
export async function searchPeople(me, q) {
  assertChatState(me);
  const candidates = await findPeopleByName({
    q,
    states: CHAT_STATES,
    excludeId: me._id,
    limit: CANDIDATES,
  });
  // SAF-03: blocked people are hidden both ways.
  const hidden = await blockedEitherWay(me._id);
  const visible = candidates.filter((p) => !hidden.has(p.id));
  const meSide = await sideFor(me._id, me.state);
  const reps = await repRolesOfUsers(visible.map((p) => p.id));
  const depts = await departmentNames([
    ...new Set(visible.map((p) => p.department_id).filter(Boolean)),
  ]);
  const results = [];
  for (const p of visible) {
    const other = await sideFor(p.id, p.state);
    if (!can(me, 'chat.open_direct', { me: meSide, other })) continue;
    const dept = depts.get(String(p.department_id));
    results.push({
      id: p.id,
      full_name: p.full_name,
      photo_url: p.photo_url,
      department: p.department_id
        ? { id: p.department_id, code: dept?.code ?? '', name: dept?.name ?? '' }
        : null,
      role_labels: [kindLabel(p.kind), ...(reps.get(p.id) ?? []).map((r) => r.role.toUpperCase())],
    });
    if (results.length === MAX_RESULTS) break;
  }
  return results;
}

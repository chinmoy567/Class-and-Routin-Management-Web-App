// Spec 20: what the chat module may ask about accounts. Never returns email or phone.
import { User } from './auth.model.js';

const photoUrl = (u) => (u.photo_file_id ? `/api/users/${u._id}/photo` : null);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);

const shape = (u) => ({
  id: String(u._id),
  kind: u.kind,
  state: u.state,
  full_name: u.full_name,
  department_id: u.department_id ? String(u.department_id) : null,
  photo_url: photoUrl(u),
});

/** CHT-03: accounts whose name has a word starting with `q` (case-insensitive). */
export async function findPeopleByName({ q, states, excludeId, limit }) {
  const rows = await User.find({
    _id: { $ne: excludeId },
    kind: { $in: ['student', 'teacher', 'staff'] },
    state: { $in: states },
    full_name: { $regex: `(^|\\s)${escapeRegex(q)}`, $options: 'i' },
  })
    .select('kind state full_name department_id photo_file_id')
    .sort({ full_name: 1 })
    .limit(limit)
    .lean();
  return rows.map(shape);
}

/** CHT-10b, CHT-19: names and photos of the given accounts, keyed by id string. */
export async function peopleById(userIds) {
  const rows = await User.find({ _id: { $in: userIds } })
    .select('kind state full_name department_id photo_file_id')
    .lean();
  return new Map(rows.map((u) => [String(u._id), shape(u)]));
}

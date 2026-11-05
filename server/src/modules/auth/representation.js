import { UserRole } from './auth.model.js';

/**
 * The sections a user currently represents as CR or DCR in this semester (role not ended).
 * Used to decide which section push rooms a socket may join (BKG-20).
 */
export async function representedSectionIdsOf(userId, semesterId) {
  const rows = await UserRole.find({
    user_id: userId,
    role: { $in: ['cr', 'dcr'] },
    semester_id: semesterId,
    section_id: { $ne: null },
    ended_at: null,
  })
    .select('section_id')
    .lean();
  return rows.map((r) => String(r.section_id));
}

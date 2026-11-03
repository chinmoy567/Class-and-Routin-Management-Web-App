import { z } from 'zod';

/** ROL-03: the department codes the super admin confirms as not ready. */
export const makeCurrentBody = z.strictObject({
  confirm_not_ready: z.array(z.string().trim().min(1).max(20)).max(50).optional(),
});

/**
 * ROL-08: the suggested next term for the semester update form. 2-I becomes 2-II, 2-II becomes
 * 3-I, and 4-II has no next term (the student can graduate instead). Returns null for 4-II.
 */
export function nextTerm(level, term) {
  if (term === 'I') return { level, term: 'II' };
  if (level >= 4) return null;
  return { level: level + 1, term: 'I' };
}

/** CRD-07: the (level, term) one term earlier. 2-II → 2-I, 2-I → 1-II, 1-I → null. */
export function previousTerm(level, term) {
  if (term === 'II') return { level, term: 'I' };
  if (level > 1) return { level: level - 1, term: 'II' };
  return null;
}

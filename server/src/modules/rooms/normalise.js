/**
 * ROOM-02, ROOM-03: how room codes and aliases are compared. Trim, collapse runs of white space
 * into one space, and ignore letter case. `RN:  311` and ` rn: 311 ` are the same name.
 */
export const normaliseName = (text) =>
  String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

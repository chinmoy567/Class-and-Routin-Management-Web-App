/**
 * RTN-14: in-memory cache for the per-section and per-teacher weekly slot patterns.
 * Cache is keyed by "s:{semesterId}:{sectionId}" (section) or "t:{semesterId}:{userId}" (teacher).
 * Values are plain arrays of slot summary objects (no Mongoose docs).
 * Cleared on routine publish, slot edit, teacher link/unlink, and group change.
 */

const cache = new Map();

export function getSectionSlots(semesterId, sectionId) {
  return cache.get(`s:${semesterId}:${sectionId}`) ?? null;
}

export function setSectionSlots(semesterId, sectionId, slots) {
  cache.set(`s:${semesterId}:${sectionId}`, slots);
}

export function getTeacherSlots(semesterId, userId) {
  return cache.get(`t:${semesterId}:${userId}`) ?? null;
}

export function setTeacherSlots(semesterId, userId, slots) {
  cache.set(`t:${semesterId}:${userId}`, slots);
}

export function clearSectionCache(semesterId, sectionId) {
  cache.delete(`s:${semesterId}:${sectionId}`);
}

export function clearTeacherCache(semesterId, userId) {
  cache.delete(`t:${semesterId}:${userId}`);
}

export function clearAllForSemester(semesterId) {
  for (const key of cache.keys()) {
    if (key.startsWith(`s:${semesterId}:`) || key.startsWith(`t:${semesterId}:`)) {
      cache.delete(key);
    }
  }
}

export function clearAll() {
  cache.clear();
}

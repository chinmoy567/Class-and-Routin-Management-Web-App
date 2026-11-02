// Audience providers: spec 12 registers a function (sectionIds) => userIds[]
// so cancellation emails reach the right students.
const audienceProviders = [];

export const registerCalendarAudienceProvider = (fn) => audienceProviders.push(fn);
export const resetCalendarAudienceProviders = () => (audienceProviders.length = 0);

export async function getAudienceForSections(sectionIds) {
  const ids = new Set();
  for (const fn of audienceProviders) {
    for (const id of await fn(sectionIds)) ids.add(String(id));
  }
  return [...ids];
}

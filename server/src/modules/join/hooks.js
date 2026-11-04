// JR-11, JR-19: spec 20 registers functions that add a student to the section group chat on
// acceptance and remove them when the admin removes them from the section, and the routine module
// can register its cache clearing. No-ops until then.
let acceptedHooks = [];
let removedHooks = [];

export const registerJoinAcceptedHook = (fn) => {
  acceptedHooks.push(fn);
};
export const registerMembershipRemovedHook = (fn) => {
  removedHooks.push(fn);
};
export const resetJoinAcceptedHooks = () => {
  acceptedHooks = [];
  removedHooks = [];
};
export async function runJoinAcceptedHooks(info) {
  for (const fn of acceptedHooks) await fn(info);
}
export async function runMembershipRemovedHooks(info) {
  for (const fn of removedHooks) await fn(info);
}

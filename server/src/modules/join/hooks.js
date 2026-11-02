// JR-11: spec 20 registers a function that adds the student to the section group chat, and the
// routine module can register its cache clearing. No-ops until then.
let hooks = [];
export const registerJoinAcceptedHook = (fn) => {
  hooks.push(fn);
};
export const resetJoinAcceptedHooks = () => {
  hooks = [];
};
export async function runJoinAcceptedHooks(info) {
  for (const fn of hooks) await fn(info);
}

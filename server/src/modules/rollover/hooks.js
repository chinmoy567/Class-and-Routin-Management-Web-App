// ROL-04: spec 20 registers a function that closes the old section groups and creates the new
// ones. Runs after the rollover commits; no-op until then.
let hooks = [];
export const registerRolloverHook = (fn) => {
  hooks.push(fn);
};
export const resetRolloverHooks = () => {
  hooks = [];
};
export async function runRolloverHooks(info) {
  for (const fn of hooks) await fn(info);
}

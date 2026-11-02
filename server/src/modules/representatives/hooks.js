// CRD-11: spec 20 registers a function that creates the section group chat.
let hooks = [];
export const registerCrAssignedHook = (fn) => {
  hooks.push(fn);
};
export const resetCrAssignedHooks = () => {
  hooks = [];
};
export async function runCrAssignedHooks(section) {
  for (const fn of hooks) await fn(section);
}

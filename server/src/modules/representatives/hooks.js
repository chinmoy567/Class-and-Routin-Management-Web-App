// CRD-11: spec 20 registers a function that creates the section group chat when the CR takes
// effect. Only a CR creates the group (CRD-15: the hook fires for a current CR only).
let hooks = [];
export const registerCrAssignedHook = (fn) => {
  hooks.push(fn);
};
export const resetCrAssignedHooks = () => {
  hooks = [];
  repHooks = [];
};
export async function runCrAssignedHooks(section) {
  for (const fn of hooks) await fn(section);
}

// Spec 20: a CR or DCR taking effect keeps the group's owners in step. A DCR does not create a group.
let repHooks = [];
export const registerRepAssignedHook = (fn) => {
  repHooks.push(fn);
};
export async function runRepAssignedHooks(section) {
  for (const fn of repHooks) await fn(section);
}

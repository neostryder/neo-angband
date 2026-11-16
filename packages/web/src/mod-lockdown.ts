import { readSetting } from "./settings-store";

// Lockdown cannot be undone, so storage changes only affect the next page load.
export const modCompartmentsEnabled = (() => {
  try { return readSetting(globalThis.localStorage, "modCompartments") === true; }
  catch { return false; }
})();

export let compartmentRuntime: typeof import("./mod-compartment") | undefined;

const desktop = (globalThis as { neoDesktop?: { configureModCompartments?(enabled: boolean): void } }).neoDesktop;
desktop?.configureModCompartments?.(modCompartmentsEnabled);

if (modCompartmentsEnabled) {
  compartmentRuntime = await import("./mod-compartment");
  compartmentRuntime.initializeModCompartments();
}

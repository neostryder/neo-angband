import { readSetting, writeSetting } from "./settings-store";

/** Device defaults are preferences, independent of character saves and keysets. */
export type ControlProfile = "desktop" | "touch";

export function controlProfile(): ControlProfile {
  try {
    const saved = readSetting(localStorage, "controlProfile");
    if (saved === "desktop" || saved === "touch") return saved;
  } catch { /* Device default remains available without storage. */ }
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
    ? "touch" : "desktop";
}

export function saveControlProfile(profile: ControlProfile): void {
  try { writeSetting(localStorage, "controlProfile", profile); } catch { /* Session remains usable. */ }
}

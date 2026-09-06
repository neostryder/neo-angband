/** Device defaults are preferences, independent of character saves and keysets. */
export type ControlProfile = "desktop" | "touch";
const PROFILE_KEY = "neo-angband:control-profile";

export function controlProfile(): ControlProfile {
  try {
    const saved = localStorage.getItem(PROFILE_KEY);
    if (saved === "desktop" || saved === "touch") return saved;
  } catch { /* Device default remains available without storage. */ }
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
    ? "touch" : "desktop";
}

export function saveControlProfile(profile: ControlProfile): void {
  try { localStorage.setItem(PROFILE_KEY, profile); } catch { /* Session remains usable. */ }
}

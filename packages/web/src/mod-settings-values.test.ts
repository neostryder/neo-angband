import { describe, expect, it, vi } from "vitest";
import { resolveSettingValue, validateManifest, type PackSetting } from "@rpgm-tools/neo-angband-mod-sdk";
import { ModStore, MOD_SETTINGS_STORAGE_KEY, MOD_STATE_STORAGE_KEY } from "./mod-store";
import { clearModSettingListeners, modSettingsFor, notifyModSettingChanged, setModSettingSource } from "./mod-settings-values";

const strength: PackSetting = { id: "strength", title: "Strength", description: "d", min: 0, max: 100, step: 5, default: 50 };
const delay: PackSetting = { id: "delay", title: "Delay", description: "d", min: 0.1, max: 1, step: 0.1, default: 0.5, unit: " s" };

function memoryStorage() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}

describe("resolveSettingValue", () => {
  it("clamps to the range, snaps to the step, and falls back to the default", () => {
    expect(resolveSettingValue(strength, 250)).toBe(100);
    expect(resolveSettingValue(strength, -3)).toBe(0);
    expect(resolveSettingValue(strength, 52)).toBe(50);
    expect(resolveSettingValue(strength, 53)).toBe(55);
    expect(resolveSettingValue(strength, "60")).toBe(50);
    expect(resolveSettingValue(strength, Number.NaN)).toBe(50);
    expect(resolveSettingValue(delay, 0.30000000000000004)).toBe(0.3);
    expect(resolveSettingValue({ ...strength, max: 98 }, 98)).toBe(95);
  });
});

describe("manifest settings", () => {
  const base = { id: "fx", name: "Fx", version: "1.0.0", shape: "plugin", rules: [{ flag: "fx.on", title: "On", description: "d", default: true }] };
  it("accepts a manifest without settings, and one with valid settings", () => {
    expect(() => validateManifest(base)).not.toThrow();
    expect(() => validateManifest({ ...base, settings: [{ ...strength, parent: "fx.on" }, delay] })).not.toThrow();
  });
  it("refuses a default off the step, a bad range, an unknown parent and a reused id", () => {
    expect(() => validateManifest({ ...base, settings: [{ ...strength, default: 52 }] })).toThrow(/on a step/u);
    expect(() => validateManifest({ ...base, settings: [{ ...strength, min: 100, max: 0 }] })).toThrow(/min below max/u);
    expect(() => validateManifest({ ...base, settings: [{ ...strength, step: 0 }] })).toThrow(/step above 0/u);
    expect(() => validateManifest({ ...base, settings: [{ ...strength, parent: "fx.missing" }] })).toThrow(/parent/u);
    expect(() => validateManifest({ ...base, settings: [strength, strength] })).toThrow(/already used/u);
    expect(() => validateManifest({ ...base, settings: [{ ...strength, id: "fx.on" }] })).toThrow(/already used/u);
  });
});

describe("mod setting storage", () => {
  it("keeps values in their own document and leaves the mod state alone", () => {
    const storage = memoryStorage();
    const store = new ModStore(storage);
    store.setModEnabled("fx", true);
    const stateBefore = storage.map.get(MOD_STATE_STORAGE_KEY);
    store.setSettingValue("fx", "strength", 70);
    expect(store.getSettingValues()).toEqual({ fx: { strength: 70 } });
    expect(storage.map.get(MOD_STATE_STORAGE_KEY)).toBe(stateBefore);
    expect(storage.map.has(MOD_SETTINGS_STORAGE_KEY)).toBe(true);
    storage.map.set(MOD_SETTINGS_STORAGE_KEY, "not json");
    expect(store.getSettingValues()).toEqual({});
  });
});

describe("ctx.settings", () => {
  it("is absent for a mod that declares no settings", () => {
    setModSettingSource({ declared: () => [], stored: () => ({}) });
    expect(modSettingsFor("plain")).toBeUndefined();
  });

  it("reads resolved values and tells listeners about a live change", () => {
    const stored: Record<string, unknown> = { strength: 999 };
    const fault = vi.fn();
    setModSettingSource({ declared: (id) => (id === "fx" ? [strength, delay] : []), stored: () => stored }, fault);
    const settings = modSettingsFor("fx")!;
    expect(settings.all()).toEqual({ strength: 100, delay: 0.5 });
    expect(settings.get("missing")).toBeUndefined();
    expect(Object.isFrozen(settings.all())).toBe(true);
    const seen = vi.fn();
    const stop = settings.onChange(seen);
    settings.onChange(() => { throw new Error("boom"); });
    stored["strength"] = 35;
    expect(settings.get("strength")).toBe(100);
    notifyModSettingChanged("fx", "strength");
    expect(settings.get("strength")).toBe(35);
    expect(seen).toHaveBeenCalledWith("strength", 35);
    expect(fault).toHaveBeenCalledTimes(1);
    stop();
    notifyModSettingChanged("fx", "strength");
    expect(seen).toHaveBeenCalledTimes(1);
    clearModSettingListeners();
    setModSettingSource(null);
  });
  it("lets a mod move its own settings, clamped and saved", () => {
    const stored: Record<string, Record<string, number>> = {};
    const reloadOnly: PackSetting = { ...delay, id: "frames", requiresReload: true };
    setModSettingSource({
      declared: (id) => (id === "fx" ? [strength, reloadOnly] : []),
      stored: (id) => stored[id] ?? {},
      write: (id, settingId, value) => { stored[id] = { ...(stored[id] ?? {}), [settingId]: value }; },
    });
    const settings = modSettingsFor("fx")!;
    const seen = vi.fn();
    settings.onChange(seen);
    expect(settings.set("strength", 73)).toBe(75);
    expect(stored).toEqual({ fx: { strength: 75 } });
    expect(settings.get("strength")).toBe(75);
    expect(seen).toHaveBeenCalledWith("strength", 75);
    expect(settings.set("frames", 0.7)).toBe(0.7);
    expect(stored["fx"]).toEqual({ strength: 75, frames: 0.7 });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(settings.set("missing", 1)).toBeUndefined();
    expect(settings.set("strength", Number.NaN)).toBeUndefined();
    expect(settings.set("strength", "60" as unknown as number)).toBeUndefined();
    expect(stored["fx"]).toEqual({ strength: 75, frames: 0.7 });
    setModSettingSource({ declared: (id) => (id === "fx" ? [strength] : []), stored: () => ({}) });
    expect(modSettingsFor("fx")!.set("strength", 20)).toBeUndefined();
    clearModSettingListeners();
    setModSettingSource(null);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_WM_SETTINGS, WM_SETTINGS_STORAGE_KEY, readWmSettings, writeWmSettings } from "./wm-settings";

function memory(): Pick<Storage, "getItem" | "setItem"> & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("window-manager settings", () => {
  it("reads the defaults when nothing is stored", () => {
    expect(readWmSettings(memory())).toEqual(DEFAULT_WM_SETTINGS);
    expect(DEFAULT_WM_SETTINGS).toEqual({ tabs: true, fitSmallWindows: true, lockDividers: false, moveDungeonView: true, fitToContent: true });
  });

  it("round-trips through a house JSON document", () => {
    const storage = memory();
    expect(writeWmSettings(storage, { tabs: false, fitSmallWindows: true, lockDividers: true, moveDungeonView: false, fitToContent: false })).toBe(true);
    const raw = JSON.parse(storage.values.get(WM_SETTINGS_STORAGE_KEY)!) as Record<string, unknown>;
    expect(raw).toEqual({
      format: "neo-angband/web/window-manager",
      schemaVersion: 1,
      data: { tabs: false, fitSmallWindows: true, lockDividers: true, moveDungeonView: false, fitToContent: false },
    });
    expect(readWmSettings(storage)).toEqual({ tabs: false, fitSmallWindows: true, lockDividers: true, moveDungeonView: false, fitToContent: false });
  });

  it("falls back to the defaults for a corrupt document without throwing", () => {
    const storage = memory();
    storage.setItem(WM_SETTINGS_STORAGE_KEY, "{not json");
    expect(readWmSettings(storage)).toEqual(DEFAULT_WM_SETTINGS);
  });

  it("leaves a newer build's document alone", () => {
    const storage = memory();
    const future = JSON.stringify({ format: "neo-angband/web/window-manager", schemaVersion: 99, data: {} });
    storage.setItem(WM_SETTINGS_STORAGE_KEY, future);
    expect(readWmSettings(storage)).toEqual(DEFAULT_WM_SETTINGS);
    expect(writeWmSettings(storage, DEFAULT_WM_SETTINGS)).toBe(false);
    expect(storage.values.get(WM_SETTINGS_STORAGE_KEY)).toBe(future);
  });
});

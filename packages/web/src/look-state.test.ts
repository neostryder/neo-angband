import { describe, expect, it, vi } from "vitest";
import { validateManifest, lookFormat, parseDocument, serializeDocument, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { LOOK_STORAGE_KEY, LookStore, vanillaLook } from "./look-state";
import { ModStore } from "./mod-store";
import { isCoreDrawn } from "./core-drawn";
import { titleKeyChoice, titleRows } from "./news";

const manifest: PackManifest = {
  id: "anybandui", name: "AnybandUI", version: "1.0.0", shape: "content",
  settings: [{ id: "contrast", title: "Contrast", description: "Screen contrast", default: 0, min: 0, max: 100, step: 1 }],
  lookPreset: { look: "Neo", settings: { contrast: 80 } },
};

function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { data.set(key, value); }), removeItem: (key: string) => { data.delete(key); } };
  const mods = new ModStore(storage);
  const look = new LookStore(storage, mods);
  return { storage, mods, look };
}

describe("look state", () => {
  it("snapshots the latest Vanilla setting when a pending preset becomes ready", () => {
    const { look, mods } = fixture();
    mods.setSettingValue("anybandui", "contrast", 20);
    look.choose("Neo");
    mods.setSettingValue("anybandui", "contrast", 35);
    mods.setModEnabled("anybandui", true);
    expect(look.complete(manifest).snapshot?.settings).toEqual({ contrast: 35 });
    look.choose("Vanilla");
    expect(mods.getSettingValues()["anybandui"]).toEqual({ contrast: 35 });
  });

  it("accepts effective enablement from a folder and snapshots it", () => {
    const { look, mods } = fixture();
    expect(mods.isEnabled("anybandui")).toBe(false);
    look.choose("Neo", true);
    expect(look.complete(manifest, true)).toMatchObject({ active: "Neo", pending: null, snapshot: { enabled: true } });
  });

  it("returns to pending when AnybandUI disappears and restores the pre-Neo settings on switch-back", () => {
    const { look, mods } = fixture();
    mods.setSettingValue("anybandui", "contrast", 20);
    look.choose("Neo");
    mods.setModEnabled("anybandui", true);
    look.complete(manifest);
    mods.setModEnabled("anybandui", false);
    expect(look.complete(undefined)).toMatchObject({ desired: "Neo", active: "Vanilla", pending: { look: "Neo" } });
    look.choose("Vanilla");
    expect(mods.getSettingValues()["anybandui"]).toEqual({ contrast: 20 });
  });

  it("completes a pending look again when AnybandUI returns", () => {
    const { look, mods } = fixture();
    look.choose("Neo");
    mods.setModEnabled("anybandui", true);
    look.complete(manifest);
    look.complete(undefined, false);
    expect(look.complete(manifest)).toMatchObject({ desired: "Neo", active: "Neo", pending: null });
  });

  it("starts in Vanilla and keeps an offline Neo request pending", () => {
    const { look, mods } = fixture();
    expect(look.read()).toEqual(vanillaLook());
    expect(look.choose("Neo")).toMatchObject({ desired: "Neo", active: "Vanilla", pending: { look: "Neo", modId: "anybandui" } });
    expect(look.complete(undefined).active).toBe("Vanilla");
    expect(look.complete(manifest).active).toBe("Vanilla");
    expect(mods.getSettingValues()).toEqual({});
  });

  it("requires an installed preset and enablement, then completes in one look write", () => {
    const { look, mods, storage } = fixture();
    look.choose("Neo");
    mods.setModEnabled("anybandui", true);
    expect(look.complete({ id: manifest.id }).pending).not.toBeNull();
    storage.setItem.mockClear();
    expect(look.complete(manifest)).toMatchObject({ desired: "Neo", active: "Neo", pending: null });
    expect(mods.getSettingValues()["anybandui"]).toEqual({ contrast: 80 });
    expect(storage.setItem.mock.calls.filter(([key]) => key === LOOK_STORAGE_KEY)).toHaveLength(1);
  });

  it("cancels a pending request without changing settings or enablement", () => {
    const { look, mods } = fixture();
    mods.setSettingValue("anybandui", "contrast", 20);
    look.choose("Neo");
    expect(look.choose("Vanilla")).toMatchObject({ desired: "Vanilla", active: "Vanilla", pending: null, snapshot: null });
    expect(look.complete(manifest).active).toBe("Vanilla");
    expect(mods.getSettingValues()["anybandui"]).toEqual({ contrast: 20 });
  });

  it.each([false, true])("restores the snapshot and keeps player changes across a round trip (enabled: %s)", (enabled) => {
    const { look, mods, storage } = fixture();
    mods.setModEnabled("anybandui", enabled);
    mods.setSettingValue("anybandui", "contrast", 20);
    mods.setSettingValue("anybandui", "untouched", 7);
    look.choose("Neo");
    mods.setModEnabled("anybandui", true);
    expect(look.complete(manifest).snapshot).toEqual({ enabled, settings: { contrast: 20, untouched: 7 }, presetKeys: ["contrast"] });
    mods.setSettingValue("anybandui", "contrast", 60);
    look.recordSetting("anybandui", "contrast", 60);
    const reopened = new LookStore(storage, mods);
    expect(reopened.read().playerChanges).toEqual({ contrast: 60 });
    reopened.choose("Vanilla");
    expect(mods.isEnabled("anybandui")).toBe(false);
    expect(mods.getSettingValues()["anybandui"]).toEqual({ contrast: 20, untouched: 7 });
    reopened.choose("Neo");
    mods.setModEnabled("anybandui", true);
    reopened.complete(manifest);
    expect(mods.getSettingValues()["anybandui"]).toEqual({ contrast: 60, untouched: 7 });
  });

  it("restores an absent setting as absent", () => {
    const { look, mods } = fixture();
    look.choose("Neo");
    mods.setModEnabled("anybandui", true);
    look.complete(manifest);
    look.choose("Vanilla");
    expect(mods.getSettingValues()["anybandui"]).toEqual({});
  });

  it.each(["{", "{}", JSON.stringify({ format: lookFormat.format, schemaVersion: 2, data: vanillaLook() }), JSON.stringify({ format: lookFormat.format, schemaVersion: 1, data: { ...vanillaLook(), active: "Neo" } })])("falls back to Vanilla for corrupt state: %s", (text) => {
    const { look, storage } = fixture();
    storage.setItem(LOOK_STORAGE_KEY, text);
    expect(look.read()).toEqual(vanillaLook());
  });

  it("validates the envelope and the preset without changing defaults", () => {
    expect(parseDocument(serializeDocument(lookFormat, vanillaLook()), lookFormat).ok).toBe(true);
    expect(validateManifest(manifest).settings?.[0]?.default).toBe(0);
    expect(() => validateManifest({ ...manifest, lookPreset: { look: "Neo", settings: { unknown: 2 } } })).toThrow(/lookPreset/u);
    expect(() => validateManifest({ ...manifest, lookPreset: { look: "Neo", settings: { contrast: 200 } } })).toThrow(/lookPreset/u);
  });

  it("keeps the choice Core-drawn and adds the title toggle", () => {
    expect(isCoreDrawn("core:look-choice")).toBe(true);
    const rows = titleRows({ look: "Vanilla", canLoad: false, canOpen: false, canQuit: false, canInstall: false, canUpdate: false, updateReady: false });
    expect(titleKeyChoice("l", rows, false)).toBe("look");
  });
});

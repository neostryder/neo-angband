import { describe, expect, it, vi } from "vitest";
import { modListsFormat, parseDocument, type SaveModList } from "@rpgm-tools/neo-angband-mod-sdk";
import { buildCatalog, MOD_INSTALL_REVISION_STORAGE_KEY, ModStore } from "../mod-store";
import { captureModList, MOD_LISTS_STORAGE_KEY, ModListStore, ModSaveGuard, retainMissingModList, sameModList } from "./mod-lists";
import { buildDelveFile, decodeDelve, encodeDelve } from "../mod-delve";

function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: (key: string) => { values.delete(key); } };
  const store = new ModStore(storage);
  const catalog = () => buildCatalog({ content: [{ id: "a", name: "A proper name", version: "1.0.0", shape: "content", api: "*" }], sandbox: [], trusted: [], enabled: store.getEnabled(), consents: {} });
  store.setModEnabled("a", true);
  const capture = () => captureModList("My list", store, catalog(), [{ id: "a", name: "A proper name", repo: "owner/a", tag: "v1.0.0", sha: "abc", digests: { "manifest.json": "digest" }, files: [], installedAt: "today" }]);
  return { store, storage, capture };
}

describe("named mod lists", () => {
  it("records explicit opt-outs for folder-enabled mods when restoring an empty list", () => {
    const f = fixture();
    const saved = f.capture();
    expect(f.store.applyModList({ ...saved, mods: [], resolvedOrder: [] }, f.store.configurationRevision(), ["folder-mod"])).toBe(true);
    expect(f.store.getModChoices()["folder-mod"]).toBe(false);
    expect(f.store.getEnabled()).toEqual([]);
  });

  it("captures provenance, settings, sections, order pins, and overrides", () => {
    const f = fixture();
    f.store.setSettingValue("a", "amount", 9);
    f.store.setSectionChoice("a", "part", false);
    f.store.pinAgainst("a", "b", "before");
    f.store.setConflictOverride("hud", "a");
    expect(f.capture()).toMatchObject({ name: "My list", resolvedOrder: ["a"], orderPins: [{ id: "a", before: ["b"] }], conflictOverrides: { hud: "a" }, mods: [{ id: "a", name: "A proper name", repository: "owner/a", commit: "abc", payloadDigest: { "manifest.json": "digest" }, api: "*", settings: { amount: 9 }, sections: { part: false } }] });
  });

  it("stores named lists inside the profile envelope and round trips them through a Delve", () => {
    const f = fixture();
    const lists = new ModListStore(f.storage);
    const list = f.capture();
    lists.save(list);
    expect(parseDocument(f.storage.getItem(MOD_LISTS_STORAGE_KEY)!, modListsFormat)).toMatchObject({ ok: true, data: { lists: { "My list": list } } });
    const file = buildDelveFile({ name: list.name, mods: [], createdAt: "today", createdWithEngine: "test", modList: list });
    expect(decodeDelve(encodeDelve(file))).toMatchObject({ ok: true, file: { modList: list } });
  });

  it("keeps the missing mod's full restore target across subsequent saves", () => {
    const f = fixture();
    const saved = f.capture();
    const empty: SaveModList = { ...saved, mods: [], resolvedOrder: [] };
    expect(retainMissingModList(empty, saved)).toEqual(saved);
    expect(sameModList(saved, { ...saved, name: "Another name" })).toBe(true);
  });

  it("activates a configuration in one write and rejects stale revisions", () => {
    const f = fixture();
    const saved = f.capture();
    const list = { ...saved, mods: saved.mods.map((m) => ({ ...m, settings: { amount: 8 }, sections: { part: false } })), orderPins: [{ id: "a", before: ["b"] }], conflictOverrides: { hud: "a" } };
    const revision = f.store.configurationRevision();
    f.storage.setItem.mockClear();
    expect(f.store.applyModList(list, revision)).toBe(true);
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
    expect(f.store.getEnabled()).toEqual(["a"]);
    expect(f.store.getSettingValues()["a"]).toEqual({ amount: 8 });
    expect(f.store.getSectionChoices()["a"]).toEqual({ part: false });
    expect(f.store.getConflictOverrides()).toEqual({ hud: "a" });
    expect(f.store.applyModList(saved, revision)).toBe(false);
    f.store.setSettingValue("a", "amount", 3);
    expect(f.store.getSettingValues()["a"]).toEqual({ amount: 3 });
  });

  it("leaves the previous configuration untouched when storage refuses activation", () => {
    const f = fixture();
    const previous = f.store.configurationRevision();
    f.storage.setItem.mockImplementationOnce(() => { throw new Error("full"); });
    expect(f.store.applyModList({ ...f.capture(), resolvedOrder: [] }, previous)).toBe(false);
    expect(f.store.configurationRevision()).toBe(previous);
  });
});

describe("save mod-set protection", () => {
  it("requires the player's yes before overwriting the last good save under another set", () => {
    const f = fixture();
    const saved = f.capture();
    const guard = new ModSaveGuard(f.store);
    const other = { ...saved, mods: [], resolvedOrder: [] };
    expect(guard.canOverwrite(saved, other, false)).toBe(false);
    expect(guard.canOverwrite(saved, other, true)).toBe(true);
    expect(guard.canOverwrite(undefined, other, false)).toBe(true);
    expect(guard.canOverwrite(saved, saved, false)).toBe(true);
  });

  it("refuses an old tab even after it previously approved an overwrite", () => {
    const f = fixture();
    const saved = f.capture();
    const guard = new ModSaveGuard(f.store);
    const anotherTab = new ModStore(f.storage);
    anotherTab.setModEnabled("a", false);
    expect(guard.canOverwrite(saved, saved, true)).toBe(false);
    anotherTab.setModEnabled("a", true);
    expect(guard.current()).toBe(false);
    guard.acknowledge();
    expect(guard.canOverwrite(saved, saved, false)).toBe(true);
  });

  it("keeps numeric setting changes writable and detects version replacement by another tab", () => {
    const f = fixture();
    vi.stubGlobal("localStorage", f.storage);
    try {
      const guard = new ModSaveGuard(f.store);
      f.store.setSettingValue("a", "amount", 8);
      expect(guard.current()).toBe(true);
      f.storage.setItem(MOD_INSTALL_REVISION_STORAGE_KEY, "another version");
      expect(guard.current()).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});

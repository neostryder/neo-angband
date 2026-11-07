import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CapabilitySet, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { modPluginContext, setModControllerArmedControl, setModProfilesControl } from "./mod-context";
import { ModStore, MOD_SETTINGS_STORAGE_KEY } from "./mod-store";
import { consumeProfileAction, createModProfiles, PROFILE_ACTION_KEY } from "./profile-runtime";
import { ProfileStore } from "./profiles";
import { scopedStorage, type ScopedStorage } from "./profile-scope";

function fakeStorage(): ScopedStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

function fixture(grants = ["profiles:manage", "saves:manage"]) {
  const storage = fakeStorage();
  const pendingStorage = fakeStorage();
  const store = new ProfileStore(storage);
  const manifest: PackManifest = { id: "test-player", name: "Test Player", version: "1.0.0", shape: "plugin", modApi: 1, capabilities: grants };
  const installed: PackManifest[] = [manifest, { id: "helper", name: "Helper", version: "1.0.0", shape: "content" }];
  const caps = CapabilitySet.fromManifest(manifest);
  new ModStore(storage).setConsent(manifest.id, grants);
  const reload = vi.fn();
  const deps = { storage, pendingStorage, store, installed: () => installed, reload, hasController: () => true, canSwitch: () => ({ ok: true as const }) };
  const api = createModProfiles(manifest.id, caps, deps);
  return { storage, pendingStorage, store, caps, api, deps, reload, installed };
}

function created(f: ReturnType<typeof fixture>, options?: { copyFrom?: string | null }): string {
  const result = f.api.create("Test profile", options);
  expect(result.ok).toBe(true);
  if (!result.ok || result.value.id === null) throw new Error("Profile creation failed.");
  return result.value.id;
}

describe("mod profiles", () => {
  it("creates a fresh profile with its creator enabled and lists the active profile", () => {
    const f = fixture();
    f.storage.setItem("neo-angband-user:customized_birth_options.json", "source options");
    const id = created(f);
    const target = scopedStorage(f.storage, id);
    expect(target.getItem("neo-angband-user:customized_birth_options.json")).toBeNull();
    expect(new ModStore(target).getEnabled()).toEqual(["test-player"]);
    expect(new ModStore(target).getConsent("test-player")).toEqual(["profiles:manage", "saves:manage"]);
    expect(f.api.list()).toEqual({ ok: true, value: [{ id: null, name: "Default", active: true }, { id, name: "Test profile", active: false }] });
  });

  it.each([null, "source"])("copies configuration from %s without saves, roster or global keys", (fromId) => {
    const f = fixture();
    const sourceId = fromId === null ? null : f.store.create("Source");
    const source = scopedStorage(f.storage, sourceId);
    const sourceMods = new ModStore(source);
    sourceMods.setEnabled(["helper"]);
    source.setItem("neo-angband-user:customized_interface_options.json", "options");
    source.setItem(MOD_SETTINGS_STORAGE_KEY, "settings");
    source.setItem("neo:modPrefs:helper", "preferences");
    for (const key of ["neo-angband-save:slot", "neo-angband-roster", "neo-angband:roster", "neo-angband:active-slot", "neo-angband:deaths", "neo:profiles", "profile:sibling:k", "neo-angband-user:hero.json", "global"]) source.setItem(key, "excluded");
    const id = created(f, { copyFrom: sourceId });
    const target = scopedStorage(f.storage, id);
    expect(target.getItem("neo-angband-user:customized_interface_options.json")).toBe("options");
    expect(target.getItem(MOD_SETTINGS_STORAGE_KEY)).toBe("settings");
    expect(target.getItem("neo:modPrefs:helper")).toBe("preferences");
    expect(new ModStore(target).getEnabled()).toEqual(["test-player", "helper"]);
    for (const key of ["neo-angband-save:slot", "neo-angband-roster", "neo-angband:roster", "neo-angband:active-slot", "neo-angband:deaths", "neo:profiles", "profile:sibling:k", "neo-angband-user:hero.json", "global"]) expect(target.getItem(key)).toBeNull();
    expect(source.getItem("neo-angband-save:slot")).toBe("excluded");
  });

  it("sets installed enabled mods only in profiles the caller created", () => {
    const f = fixture();
    const id = created(f);
    expect(f.api.setEnabledMods(id, ["helper", "helper"])).toEqual({ ok: true, value: undefined });
    const mods = new ModStore(scopedStorage(f.storage, id));
    expect(mods.getEnabled()).toEqual(["test-player", "helper"]);
    expect(f.api.setEnabledMods(id, ["unknown"])).toEqual({ ok: false, reason: 'Mod "unknown" is not installed.' });
    expect(mods.getEnabled()).toEqual(["test-player", "helper"]);
    expect(f.api.setEnabledMods(f.store.create("Player profile"), [])).toMatchObject({ ok: false });
    const playerCopy = f.store.create("Player copy", { copyFrom: id, realStorage: f.storage });
    expect(f.api.setEnabledMods(playerCopy, [])).toMatchObject({ ok: false });
    const other = createModProfiles("helper", f.caps, f.deps);
    expect(other.setEnabledMods(id, [])).toMatchObject({ ok: false });
    expect(f.api.setEnabledMods(id, [])).toMatchObject({ ok: true });
    expect(mods.getEnabled()).toEqual(["test-player"]);
    expect(mods.getModChoices().helper).toBe(false);
  });

  it("refuses unapproved code instead of granting new permissions", () => {
    const f = fixture();
    f.installed.push({ id: "other", name: "Other", version: "1.0.0", shape: "plugin", modApi: 1, capabilities: ["input:intent"] });
    expect(f.api.setEnabledMods(created(f), ["other"])).toMatchObject({ ok: false, reason: expect.stringContaining("needs your permission") });
  });

  it("reloads into a profile and consumes the pending action once", () => {
    const f = fixture();
    const id = created(f);
    const action = { kind: "create-character" as const, armController: true };
    expect(f.api.switchTo(id, action)).toEqual({ ok: true, value: undefined });
    expect(f.store.activeId()).toBe(id);
    expect(f.reload).toHaveBeenCalledOnce();
    const run = vi.fn(() => ({ ok: true as const }));
    expect(consumeProfileAction(f.pendingStorage, id, run)).toEqual({ ok: true });
    expect(run).toHaveBeenCalledExactlyOnceWith({ profileId: id, modId: "test-player", action });
    expect(consumeProfileAction(f.pendingStorage, id, run)).toBeNull();
    expect(f.pendingStorage.getItem(PROFILE_ACTION_KEY)).toBeNull();
  });

  it("reports a failed or mismatched action and never retries it", () => {
    const f = fixture();
    const id = created(f);
    f.api.switchTo(id, { kind: "create-character" });
    const run = vi.fn(() => ({ ok: false as const, reason: "Controller unavailable." }));
    expect(consumeProfileAction(f.pendingStorage, id, run)).toEqual({ ok: false, reason: "Controller unavailable." });
    expect(consumeProfileAction(f.pendingStorage, id, run)).toBeNull();
    f.api.switchTo(id, { kind: "create-character" });
    expect(consumeProfileAction(f.pendingStorage, null, run)).toMatchObject({ ok: false });
    expect(run).toHaveBeenCalledOnce();
  });

  it("refuses unknown profiles, missing creation grants, missing controllers and unavailable storage", () => {
    const f = fixture(["profiles:manage"]);
    expect(f.api.create("Copy", { copyFrom: "unknown" })).toMatchObject({ ok: false });
    expect(f.api.switchTo("unknown")).toMatchObject({ ok: false });
    const id = created(f);
    expect(f.api.switchTo(id, { kind: "create-character" })).toMatchObject({ ok: false, reason: expect.stringContaining("saves:manage") });
    expect(f.store.activeId()).toBeNull();
    const normal = fixture();
    const noController = createModProfiles("test-player", normal.caps, { ...normal.deps, hasController: () => false });
    expect(noController.switchTo(created(normal), { kind: "create-character", armController: true })).toMatchObject({ ok: false });
    const unavailable = createModProfiles("test-player", normal.caps, { ...normal.deps, storage: null });
    expect(unavailable.create("Fresh")).toMatchObject({ ok: false });
    expect(unavailable.switchTo(null)).toMatchObject({ ok: false });
  });

  it("rolls back a failed reload and refuses switches during play", () => {
    const f = fixture();
    const id = created(f);
    const failed = createModProfiles("test-player", f.caps, { ...f.deps, reload: () => { throw new Error("reload failed"); } });
    expect(failed.switchTo(id, { kind: "create-character" })).toMatchObject({ ok: false });
    expect(f.store.activeId()).toBeNull();
    expect(f.pendingStorage.getItem(PROFILE_ACTION_KEY)).toBeNull();
    const playing = createModProfiles("test-player", f.caps, { ...f.deps, canSwitch: () => ({ ok: false, reason: "Playing." }) });
    expect(playing.switchTo(id)).toEqual({ ok: false, reason: "Playing." });
  });

  it("withholds the profile door and refuses direct calls without the capability", () => {
    const f = fixture([]);
    for (const call of [() => f.api.list(), () => f.api.create("Fresh"), () => f.api.setEnabledMods("id", []), () => f.api.switchTo(null)]) expect(call).toThrow(/profiles:manage/u);
    setModProfilesControl((id, caps) => createModProfiles(id, caps, f.deps));
    try {
      expect(modPluginContext("test-player", {}).profiles).toBeUndefined();
      expect(modPluginContext("test-player", {}, undefined, {}, { capabilities: fixture().caps }).profiles).toBeDefined();
    } finally {
      setModProfilesControl(undefined);
    }
  });

  it("publishes controller arming only to the requested mod with both grants", () => {
    const f = fixture();
    setModControllerArmedControl((id) => id === "test-player");
    try {
      expect(modPluginContext("test-player", {}).controllerArmed).toBeUndefined();
      expect(modPluginContext("test-player", {}, undefined, {}, { capabilities: fixture(["profiles:manage"]).caps }).controllerArmed).toBeUndefined();
      expect(modPluginContext("test-player", {}, undefined, {}, { capabilities: f.caps }).controllerArmed).toBe(true);
      expect(modPluginContext("other", {}, undefined, {}, { capabilities: f.caps }).controllerArmed).toBeUndefined();
    } finally {
      setModControllerArmedControl(undefined);
    }
  });

  it("leaves an inaccessible empty action store quiet and reports malformed saved actions once", () => {
    const storage = fakeStorage();
    const run = vi.fn(() => ({ ok: true as const }));
    expect(consumeProfileAction({ ...storage, getItem: () => { throw new Error("Denied."); } }, null, run)).toBeNull();
    storage.setItem(PROFILE_ACTION_KEY, "invalid JSON");
    expect(consumeProfileAction(storage, null, run)).toEqual({ ok: false, reason: "The saved profile action is unreadable." });
    expect(consumeProfileAction(storage, null, run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("returns a refusal if reload storage refuses writes or clearing", () => {
    const f = fixture();
    const id = created(f);
    const unavailable = createModProfiles("test-player", f.caps, {
      ...f.deps,
      pendingStorage: { ...f.pendingStorage, removeItem: () => { throw new Error("Denied."); } },
    });
    expect(unavailable.switchTo(id, { kind: "create-character" })).toMatchObject({ ok: false });
    expect(f.store.activeId()).toBeNull();
    expect(f.reload).not.toHaveBeenCalled();
    f.api.switchTo(id, { kind: "create-character" });
    const run = vi.fn(() => ({ ok: true as const }));
    expect(consumeProfileAction({ ...f.pendingStorage, removeItem: () => undefined }, id, run)).toMatchObject({ ok: false });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    { schemaVersion: 2 },
    { extra: true },
    { data: { profileId: null, modId: "test-player", action: { kind: "unsupported" } } },
    { data: { profileId: null, modId: "test-player", action: { kind: "create-character", armController: "yes" } } },
    { data: { profileId: null, modId: "test-player", action: { kind: "create-character", extra: true } } },
  ])("rejects a pending document with invalid fields %j", (override) => {
    const storage = fakeStorage();
    storage.setItem(PROFILE_ACTION_KEY, JSON.stringify({
      format: "neo-angband/web/profile-action", schemaVersion: 1,
      data: { profileId: null, modId: "test-player", action: { kind: "create-character" } },
      ...override,
    }));
    const run = vi.fn(() => ({ ok: true as const }));
    expect(consumeProfileAction(storage, null, run)).toMatchObject({ ok: false });
    expect(consumeProfileAction(storage, null, run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("connects boot consumption to creation and controller arming before startGame", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
    expect(source.indexOf("consumeProfileAction(reloadStorage")).toBeLessThan(source.indexOf("const game = startGame(pack"));
    expect(source).toContain('reloadStorage.setItem(AUTOPLAYER_ROLL_ON_KEY, pending.modId)');
    expect(source).toContain('reloadStorage.setItem(FORCE_NEW_KEY, "1")');
    expect(source).toContain("setActiveId(newCharId())");
    expect(source).toContain("setModProfilesControl((id, caps) => createModProfiles(id, caps");
    expect(source).toContain("requestedControllerId === id && (birthPending || sessionFacts.newCharacter === true)");
  });
});

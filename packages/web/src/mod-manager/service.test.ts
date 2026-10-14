import { afterEach, describe, expect, it, vi } from "vitest";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { buildCatalog, ModStore, type StorageLike } from "../mod-store";
import { assignTier, effectiveGrants, resetModTiers, setModGrants, setModTiers, TRUTH_MAP } from "../mod-tier";
import type { DiscoveredMod } from "../mod-discover";
import type { InstalledModMeta } from "../mod-install";
import type { ModRefresh } from "../mod-refresh";
import type { BrowseEntry } from "./browse-types";
import { createModManagerService, type ModManagerService, type CoreModManager } from "./service";
import { createManageAdapter } from "./manage-adapter";
import type { ManagerResult, ModManagerEnvironment, ConfirmationDecision } from "./types";

function manifest(id: string, over: Partial<PackManifest> = {}): PackManifest {
  return { id, name: `Mod ${id}`, version: "1.0.0", shape: "content", ...over } as PackManifest;
}

function storage(): StorageLike {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}

function discovered(m: PackManifest): DiscoveredMod {
  return { id: m.id, name: m.name, version: m.version, repo: `owner/${m.id}`, tag: `v${m.version}`, tags: [`v${m.version}`], author: "owner", description: "A mod for the catalog.", engine: null, screenshots: [], compatible: true, engineNote: null, channelHeld: null, engineHeld: null, payload: [{ kind: "file", path: "manifest.json" }], bytes: 120, guessedPayload: false, sha: `commit-${m.version}`, capabilities: m.capabilities ?? [], compat: m.compat ?? [] };
}

function fixture(manifests: PackManifest[] = [manifest("a"), manifest("b")], overrides: Partial<ModManagerEnvironment> = {}) {
  const store = new ModStore(storage());
  const local = new Map(manifests.map((m) => [m.id, m]));
  const remote = new Map(manifests.map((m) => [m.id, m]));
  const metadata = new Map<string, InstalledModMeta>();
  const conflictOverrides: Record<string, string> = {};
  let thirdParty = true;
  let safeMode = false;
  const discover = vi.fn(async (ref: { readonly repo: string }): Promise<BrowseEntry> => {
    const m = remote.get(ref.repo.split("/").at(-1)!);
    return m ? { ok: true, ref, mod: discovered(m) } : { ok: false, ref, problem: "The repository could not be read." };
  });
  const install = vi.fn(async (mod: DiscoveredMod) => {
    const m = remote.get(mod.id)!;
    local.set(mod.id, m);
    const meta: InstalledModMeta = { id: mod.id, name: mod.name, repo: mod.repo, tag: mod.tag, sha: mod.sha!, files: ["manifest.json"], installedAt: "2026-10-13T00:00:00Z", digests: { "manifest.json": "digest" } };
    metadata.set(mod.id, meta);
    return { ok: true as const, meta };
  });
  const uninstall = vi.fn(async (id: string) => local.delete(id));
  const readManifest = vi.fn(async (mod: DiscoveredMod) => remote.get(mod.id)!);
  const env: ModManagerEnvironment = {
    store,
    listCatalog: () => buildCatalog({ content: [...local.values()].filter((m) => m.shape !== "plugin"), sandbox: [], trusted: [...local.values()].filter((m) => m.shape === "plugin"), enabled: store.getEnabled(), consents: store.getConsents(), refusals: store.getRefusals() }),
    discover, install, uninstall, readManifest,
    resolveDependency: async (id) => discover({ repo: `owner/${id}` }),
    installedMetadata: async () => [...metadata.values()],
    rediscover: async () => {},
    curated: async () => ({ registry: { name: "Mods", url: "catalog", mods: [{ repo: "owner/a" }], community: [{ repo: "owner/b" }], problems: [] }, problem: null }),
    refreshUpdates: async () => [...local.values()].map((m): ModRefresh => ({ id: m.id, name: m.name, repo: `owner/${m.id}`, installed: `v${m.version}`, newest: `v${remote.get(m.id)!.version}`, standing: remote.get(m.id)!.version === m.version ? "same" : "behind", problem: null, channelHeld: null, engineHeld: null })),
    consent: { read: () => thirdParty, write: (allow) => { thirdParty = allow; return true; } },
    safeMode: () => safeMode,
    profile: () => ({ id: "test-profile", name: "Test profile", createdAt: 0 }),
    conflictOverrides: { read: () => conflictOverrides, write: (slot, winner) => { if (winner === null) delete conflictOverrides[slot]; else conflictOverrides[slot] = winner; return true; } },
    ...overrides,
  };
  const manager = createModManagerService(env);
  return { ...manager, store, local, remote, metadata, discover, install, uninstall, readManifest, env, setThirdParty: (value: boolean) => { thirdParty = value; }, setSafeMode: (value: boolean) => { safeMode = value; } };
}

async function accept(core: CoreModManager, result: ManagerResult<unknown>, decision: ConfirmationDecision = { accepted: true }) {
  expect(result.status).toBe("confirmation");
  if (result.status !== "confirmation") throw new Error("The command did not request confirmation.");
  return core.resolveConfirmation(result.confirmation.id, decision);
}

afterEach(() => { resetModTiers(); });

describe("ModManagerService snapshots and catalog", () => {
  it("copies and freezes every nested state field", () => {
    const f = fixture();
    const before = f.service.state;
    f.local.get("a")!.name = "Changed name";
    expect(before.installed[0]!.name).toBe("Mod a");
    expect(Object.isFrozen(before.installed[0]!.catalogMod.manifest)).toBe(true);
    expect(() => { (before.loadOrder as string[]).push("a"); }).toThrow();
    f.service.refreshState();
    expect(f.service.state.installed[0]!.name).toBe("Changed name");
  });

  it("publishes changes and lets a view unsubscribe", () => {
    const f = fixture();
    const listener = vi.fn();
    const off = f.service.subscribe(listener);
    expect(f.service.enable("a").status).toBe("ok");
    expect(listener).toHaveBeenCalledOnce();
    off();
    f.service.disable("a");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("includes measured provenance, choices, permissions, profile, and safe mode", async () => {
    const f = fixture();
    f.metadata.set("a", { id: "a", repo: "owner/a", tag: "v1.0.0", sha: "abc", files: [], digests: { "manifest.json": "hash" }, installedAt: "today" });
    f.store.setModEnabled("a", true);
    f.store.setSectionChoice("a", "part", false);
    f.store.setSettingValue("a", "amount", 2);
    f.setSafeMode(true);
    expect((await f.service.refresh()).status).toBe("ok");
    expect(f.service.state.installed.find((m) => m.id === "a")).toMatchObject({ repository: "owner/a", commit: "abc", digests: { "manifest.json": "hash" }, loadOrder: 0, sectionChoices: { part: false }, settings: { amount: 2 } });
    expect(f.service.state.profile?.name).toBe("Test profile");
    expect(f.service.state.safeMode).toBe(true);
    expect(f.service.state.modList.find((m) => m.id === "a")?.enabled).toBe(true);
  });

  it("browses both curated and community lists and searches names and descriptions", async () => {
    const f = fixture();
    expect((await f.service.browse()).status).toBe("ok");
    expect(f.service.state.catalog.curated).toHaveLength(1);
    expect(f.service.state.catalog.community).toHaveLength(1);
    expect(f.service.search("owner/a")).toMatchObject({ status: "ok", value: [{ ok: true, mod: { id: "a" } }] });
    expect(f.service.search("catalog")).toMatchObject({ status: "ok", value: [{ ok: true }, { ok: true }] });
    expect((await f.service.discover({ repo: "owner/missing" })).status).toBe("ok");
    expect(f.service.state.catalog.sideloads[0]).toMatchObject({ ok: false });
  });

  it("returns a typed refusal for a catalog failure", async () => {
    const f = fixture([], { curated: async () => ({ registry: null, problem: "offline" }) });
    expect(await f.service.browse()).toEqual({ status: "refused", code: "catalog", reason: "offline" });
  });
});

describe("install planning and application without a screen", () => {
  it("resolves all required downloads before confirmation and installs dependencies first", async () => {
    const f = fixture([]);
    f.remote.set("a", manifest("a", { dependencies: { b: ">=1.0.0" } }));
    f.remote.set("b", manifest("b"));
    const plan = await f.service.planInstall([{ ref: { repo: "owner/a" }, origin: "curated" }]);
    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") return;
    expect(plan.value.downloads.map((d) => d.mod.id)).toEqual(["b", "a"]);
    expect(plan.value.downloads[0]).toMatchObject({ bytes: 120, files: ["manifest.json"] });
    const pending = f.service.applyPlan(plan.value.id);
    expect(f.install).not.toHaveBeenCalled();
    expect(f.service.state.pendingConfirmation?.mods[0]).toMatchObject({ name: "Mod b", commit: "commit-1.0.0", digests: null });
    expect((await accept(f.core, pending)).status).toBe("ok");
    expect(f.install.mock.calls.map(([mod]) => mod.id)).toEqual(["b", "a"]);
    expect(f.service.state.pendingPlans).toHaveLength(0);
    expect(f.store.getEnabled()).toEqual([]);
  });

  it("keeps install plans immutable", async () => {
    const f = fixture();
    const plan = await f.service.planInstall([{ ref: { repo: "owner/a" }, origin: "curated" }]);
    if (plan.status !== "ok") throw new Error("The plan was refused.");
    expect(Reflect.set(plan.value.downloads[0]!.mod, "payload", [])).toBe(false);
  });

  it("refuses dependency cycles and incompatible ranges before any install", async () => {
    const f = fixture([]);
    f.remote.set("a", manifest("a", { dependencies: { b: ">=2.0.0" } }));
    f.remote.set("b", manifest("b"));
    expect(await f.service.planInstall([{ ref: { repo: "owner/a" }, origin: "curated" }])).toMatchObject({ status: "refused", code: "dependency-version" });
    f.remote.set("b", manifest("b", { dependencies: { a: ">=1.0.0" } }));
    expect(await f.service.planInstall([{ ref: { repo: "owner/a" }, origin: "curated" }])).toMatchObject({ status: "refused", code: "dependency-cycle" });
    expect(f.install).not.toHaveBeenCalled();
  });

  it("refuses third-party downloads when consent is off", async () => {
    const f = fixture();
    f.setThirdParty(false);
    expect(await f.service.planInstall([{ ref: { repo: "owner/b" }, origin: "third-party" }])).toMatchObject({ status: "refused", code: "consent" });
    expect(f.install).not.toHaveBeenCalled();
  });

  it("checks the origin pin and engine compatibility", async () => {
    const f = fixture();
    f.metadata.set("a", { id: "a", repo: "old/a", tag: "v1.0.0", files: [], installedAt: "today" });
    expect(await f.service.planInstall([{ ref: { repo: "owner/a" }, origin: "curated" }])).toMatchObject({ status: "refused", code: "origin" });
    f.metadata.clear();
    f.discover.mockResolvedValue({ ok: true, ref: { repo: "owner/a" }, mod: { ...discovered(manifest("a")), compatible: false, engineNote: "Needs another engine." } });
    expect(await f.service.planInstall([{ ref: { repo: "owner/a" }, origin: "curated" }])).toMatchObject({ status: "refused", code: "engine" });
  });

  it("reports each new permission with its consent and missing behavior", async () => {
    const f = fixture();
    f.remote.set("a", manifest("a", { shape: "plugin", capabilities: ["ui:messages.replace"] }));
    const plan = await f.service.planInstall([{ ref: { repo: "owner/a" }, origin: "curated" }]);
    expect(plan).toMatchObject({ status: "ok", value: { newGrants: [{ capability: "ui:messages.replace", consentText: expect.any(String), withoutIt: expect.any(String), canRunWithout: true }] } });
  });

  it("rejects a stale plan after consent changes while its dialog is open", async () => {
    const f = fixture();
    const plan = await f.service.planInstall([{ ref: { repo: "owner/b" }, origin: "third-party" }]);
    if (plan.status !== "ok") throw new Error("The plan was refused.");
    const pending = f.service.applyPlan(plan.value.id);
    f.setThirdParty(false);
    expect(await accept(f.core, pending)).toMatchObject({ status: "refused", code: "consent" });
    expect(f.install).not.toHaveBeenCalled();
  });

  it("cancels without storing bytes and rejects a replayed answer", async () => {
    const f = fixture();
    const plan = await f.service.planInstall([{ ref: { repo: "owner/a" }, origin: "curated" }]);
    if (plan.status !== "ok") throw new Error("The plan was refused.");
    const pending = f.service.applyPlan(plan.value.id);
    expect(await accept(f.core, pending, { accepted: false })).toMatchObject({ status: "refused", code: "cancelled" });
    if (pending.status !== "confirmation") return;
    expect(await f.core.resolveConfirmation(pending.confirmation.id, { accepted: true })).toMatchObject({ status: "refused", code: "confirmation" });
    expect(f.install).not.toHaveBeenCalled();
  });
});

describe("enablement, permission records, and settings", () => {
  it("enables and disables an ordinary content mod and refuses a missing mod", () => {
    const f = fixture();
    expect(f.service.enable("a").status).toBe("ok");
    expect(f.store.isEnabled("a")).toBe(true);
    expect(f.service.disable("a").status).toBe("ok");
    expect(f.store.isEnabled("a")).toBe(false);
    expect(f.service.enable("missing")).toMatchObject({ status: "refused", code: "missing" });
  });

  it("asks for new permissions before enabling and records individual refusals", async () => {
    const f = fixture([manifest("a", { shape: "plugin", capabilities: ["ui:messages.replace", "ui:sidebar.replace"] })]);
    const pending = f.service.enable("a");
    expect(f.store.isEnabled("a")).toBe(false);
    expect((await accept(f.core, pending, { accepted: true, permissions: { a: { granted: ["ui:messages.replace"], refused: ["ui:sidebar.replace"] } } })).status).toBe("ok");
    expect(f.store.getDecisions("a")).toEqual({ granted: ["ui:messages.replace"], refused: ["ui:sidebar.replace"] });
    expect(f.store.isEnabled("a")).toBe(true);
  });

  it("refuses an enable answer that did not decide each permission", async () => {
    const f = fixture([manifest("a", { shape: "plugin", capabilities: ["ui:messages.replace"] })]);
    expect(await accept(f.core, f.service.enable("a"))).toMatchObject({ status: "refused", code: "permissions" });
    expect(f.store.isEnabled("a")).toBe(false);
  });

  it("requires confirmation for a permission grant and preserves older decisions", async () => {
    const f = fixture([manifest("a", { shape: "plugin", capabilities: ["ui:messages.replace", "ui:sidebar.replace"] })]);
    f.store.setDecisions("a", { granted: ["ui:messages.replace"], refused: [] }, "0.9.0");
    expect(await accept(f.core, f.service.recordConsent("a", { granted: ["ui:sidebar.replace"], refused: [] }))).toMatchObject({ status: "ok" });
    expect(f.store.getConsent("a")).toEqual(["ui:messages.replace", "ui:sidebar.replace"]);
    expect(f.store.getConsentVersion("a")).toBe("1.0.0");
    expect(f.service.recordConsent("a", { granted: [], refused: ["ui:sidebar.replace"] }).status).toBe("ok");
  });

  it("refuses a permission the mod did not request", () => {
    const f = fixture();
    expect(f.service.recordConsent("a", { granted: [TRUTH_MAP], refused: [] })).toMatchObject({ status: "refused", code: "permission" });
  });

  it("refuses a manage grant when the target has no measured first-party tier", () => {
    const f = fixture([manifest("a", { shape: "plugin", capabilities: ["mod:install"] })]);
    expect(f.service.recordConsent("a", { granted: ["mod:install"], refused: [] })).toMatchObject({ status: "refused", code: "tier" });
    expect(f.store.getConsent("a")).toEqual([]);
  });

  it("requires confirmation when enabling a mod that already holds truth", async () => {
    const f = fixture([manifest("a", { shape: "plugin", capabilities: [TRUTH_MAP] })]);
    f.store.setConsent("a", [TRUTH_MAP]);
    expect((await accept(f.core, f.service.enable("a"))).status).toBe("ok");
  });

  it("stores section choices and clamps settings through the existing resolver", () => {
    const f = fixture([manifest("a", { sections: [{ id: "part", title: "Part", flag: "a.part" }], settings: [{ id: "amount", title: "Amount", description: "Amount", min: 0, max: 10, step: 2, default: 0 }] })]);
    expect(f.service.setSectionChoice("a", "part", false).status).toBe("ok");
    expect(f.service.setSettingValue("a", "amount", 50).status).toBe("ok");
    expect(f.store.getSettingValues()).toEqual({ a: { amount: 10 } });
    expect(f.service.setSettingValue("a", "missing", 0)).toMatchObject({ status: "refused", code: "setting" });
    expect(f.service.setSectionChoice("a", "missing", true)).toMatchObject({ status: "refused", code: "section" });
  });

  it("confirms third-party consent and reports storage refusal", async () => {
    const f = fixture();
    f.setThirdParty(false);
    const pending = f.service.setThirdPartyConsent(true);
    expect(f.service.state.pendingConfirmation?.riskNotice.length).toBeGreaterThan(0);
    expect((await accept(f.core, pending)).status).toBe("ok");
    expect(f.service.state.thirdPartyAllowed).toBe(true);
    expect(f.service.setThirdPartyConsent(false).status).toBe("ok");
    const denied = fixture([], { consent: { read: () => false, write: () => false } });
    expect(await accept(denied.core, denied.service.setThirdPartyConsent(true))).toMatchObject({ status: "refused", code: "storage" });
  });
});

describe("updates, removal, restoration, and order", () => {
  it("stages update-all as one plan and keeps the current metadata and decisions", async () => {
    const stagePlan = vi.fn(async () => ({ ok: true as const, results: [] }));
    const restart = vi.fn();
    const f = fixture(undefined, { stagePlan, restart });
    f.store.setEnabled(["a", "b"]);
    f.remote.set("a", manifest("a", { version: "2.0.0", capabilities: ["ui:sidebar.replace"] }));
    f.remote.set("b", manifest("b", { version: "2.0.0" }));
    const pending = await f.service.updateAll();
    expect((await accept(f.core, pending, { accepted: true, permissions: { a: { granted: ["ui:sidebar.replace"], refused: [] } } })).status).toBe("ok");
    expect(stagePlan).toHaveBeenCalledTimes(1);
    expect(stagePlan.mock.calls[0]).toMatchObject([{ downloads: [{ mod: { id: "a" } }, { mod: { id: "b" } }] }, { a: { granted: ["ui:sidebar.replace"] } }]);
    expect(f.install).not.toHaveBeenCalled();
    expect(f.store.getConsent("a")).toEqual([]);
    expect(f.service.state.installed.map((mod) => mod.version)).toEqual(["1.0.0", "1.0.0"]);
    expect(f.service.state).toMatchObject({ staged: true, installStatus: "staged, applies on next start", canRestart: true });
    expect(f.service.restart().status).toBe("ok");
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("does not stage an incomplete or undeclared permission answer", async () => {
    const stagePlan = vi.fn(async () => ({ ok: true as const, results: [] }));
    const f = fixture(undefined, { stagePlan });
    f.remote.set("a", manifest("a", { version: "2.0.0", capabilities: ["ui:sidebar.replace"] }));
    expect(await accept(f.core, await f.service.update("a"))).toMatchObject({ status: "refused", code: "permissions" });
    expect(await accept(f.core, await f.service.update("a"), { accepted: true, permissions: { a: { granted: [TRUTH_MAP], refused: [] } } })).toMatchObject({ status: "refused", code: "permissions" });
    expect(stagePlan).not.toHaveBeenCalled();
  });

  it("reports a refused transaction and leaves its staged status clear", async () => {
    const f = fixture(undefined, { stagePlan: async () => ({ ok: false, problem: "Storage quota reached." }) });
    f.remote.set("a", manifest("a", { version: "2.0.0" }));
    expect(await accept(f.core, await f.service.update("a"))).toMatchObject({ status: "refused", code: "install", reason: "Storage quota reached." });
    expect(f.service.state.staged).toBe(false);
    expect(f.install).not.toHaveBeenCalled();
  });

  it("stages retained rollback only after Core confirmation", async () => {
    const stageRollback = vi.fn(async () => ({ ok: true as const, results: [] }));
    const f = fixture(undefined, { stageRollback, previousVersion: async () => ({ ok: true, ref: { repo: "owner/a" }, mod: discovered(manifest("a", { version: "0.9.0" })) }) });
    const pending = await f.service.rollback("a");
    expect(pending).toMatchObject({ status: "confirmation", confirmation: { operation: "rollback", mods: [{ name: "Mod a", version: "0.9.0" }] } });
    expect(stageRollback).not.toHaveBeenCalled();
    expect((await accept(f.core, pending)).status).toBe("ok");
    expect(stageRollback).toHaveBeenCalledWith("a");
    expect(f.service.state.staged).toBe(true);
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });

  it("passes the version to save retention when the player confirms an install", async () => {
    const referenced = vi.fn((id: string, tag?: string) => id === "a" && tag === "v0.9.0");
    const release = vi.fn(async (id: string, saves: (id: string, tag: string) => boolean) => {
      expect(saves(id, "v0.9.0")).toBe(true);
      return true;
    });
    const f = fixture(undefined, { saveReferences: referenced, releasePreviousVersions: release });
    expect((await f.service.confirmInstalledVersion("a")).status).toBe("ok");
    expect(referenced).toHaveBeenCalledWith("a", "v0.9.0");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("plans update-all conflicts before installing any of the set", async () => {
    const f = fixture();
    f.store.setEnabled(["a", "b"]);
    f.remote.set("a", manifest("a", { version: "2.0.0", compat: [{ with: "b", claim: "conflicts", because: "They change the same rule." }] }));
    f.remote.set("b", manifest("b", { version: "2.0.0" }));
    const pending = await f.service.updateAll();
    expect(pending).toMatchObject({ status: "confirmation", confirmation: { operation: "update", conflicts: [{ packId: "a", with: "b" }] } });
    expect(f.discover).toHaveBeenCalledTimes(2);
    expect(f.install).not.toHaveBeenCalled();
    expect((await accept(f.core, pending)).status).toBe("ok");
    expect(f.install).toHaveBeenCalledTimes(2);
    expect(f.store.getEnabled()).toEqual(["a", "b"]);
  });

  it("updates only the chosen mod", async () => {
    const f = fixture();
    f.remote.set("a", manifest("a", { version: "2.0.0" }));
    f.remote.set("b", manifest("b", { version: "2.0.0" }));
    expect((await accept(f.core, await f.service.update("a"))).status).toBe("ok");
    expect(f.install.mock.calls.map(([mod]) => mod.id)).toEqual(["a"]);
  });

  it("stores nothing when one member of update-all cannot resolve", async () => {
    const f = fixture();
    f.remote.set("a", manifest("a", { version: "2.0.0" }));
    f.remote.set("b", manifest("b", { version: "2.0.0", dependencies: { missing: ">=1.0.0" } }));
    expect(await f.service.updateAll()).toMatchObject({ status: "refused", code: "discovery" });
    expect(f.install).not.toHaveBeenCalled();
  });

  it("asks before removing a mod referenced by a save", async () => {
    const f = fixture(undefined, { saveReferences: (id) => id === "a" });
    const pending = await f.service.remove("a");
    expect(f.uninstall).not.toHaveBeenCalled();
    expect((await accept(f.core, pending)).status).toBe("ok");
    expect(f.local.has("a")).toBe(false);
    expect((await f.service.remove("b")).status).toBe("ok");
    expect(await f.service.remove("missing")).toMatchObject({ status: "refused", code: "missing" });
  });

  it("restores a local mod list and maps rule and section flags to their owners", async () => {
    const f = fixture([manifest("a", { rules: [{ flag: "a.rule", title: "Rule", description: "Rule", default: false }], sections: [{ id: "part", title: "Part", flag: "a.part" }] }), manifest("b")]);
    f.store.setEnabled(["b"]);
    const pending = f.service.restoreModList([{ id: "a", enabled: true, flags: { "a.rule": true, "a.part": false } }], true);
    expect((await accept(f.core, pending)).status).toBe("ok");
    expect(f.store.getEnabled()).toEqual(["a"]);
    expect(f.store.getRuleChoices()).toEqual({ "a.rule": true });
    expect(f.store.getSectionChoices()).toEqual({ a: { part: false } });
  });

  it("reports the previous-version seam honestly and rolls back through the install planner", async () => {
    const missing = fixture();
    expect(await missing.service.rollback("a")).toMatchObject({ status: "refused", code: "previous-version" });
    const old = manifest("a", { version: "0.9.0" });
    const f = fixture(undefined, { previousVersion: async () => ({ ok: true, ref: { repo: "owner/a", tag: "v0.9.0" }, mod: discovered(old) }) });
    f.remote.set("a", old);
    expect((await accept(f.core, await f.service.rollback("a"))).status).toBe("ok");
    expect(f.local.get("a")?.version).toBe("0.9.0");
  });

  it("pins a manual move and refuses a reordered set that crosses that pin", () => {
    const f = fixture();
    f.store.setEnabled(["a", "b"]);
    expect(f.service.moveEnabled("b", -1).status).toBe("ok");
    expect(f.service.state.orderPins).toHaveLength(1);
    expect(f.service.reorder(["a", "b"])).toMatchObject({ status: "refused", code: "pins" });
    expect(f.service.reorder(["b", "a"]).status).toBe("ok");
    expect(f.service.reorder(["a", "a"])).toMatchObject({ status: "refused", code: "order" });
    expect(f.service.proposeOrder()).toMatchObject({ status: "ok", value: { order: ["b", "a"] } });
  });

  it("sets and clears a conflict override through the host writer", () => {
    const f = fixture();
    expect(f.service.setConflictOverride("hook", "a").status).toBe("ok");
    expect(f.service.state.conflictOverrides).toEqual({ hook: "a" });
    expect(f.service.setConflictOverride("hook", null).status).toBe("ok");
    expect(f.service.state.conflictOverrides).toEqual({});
    expect(f.service.setConflictOverride("hook", "missing")).toMatchObject({ status: "refused", code: "missing" });
  });

  it("returns expected host failures without throwing", async () => {
    const f = fixture([], { discover: async () => { throw new Error("offline"); } });
    expect(await f.service.discover({ repo: "owner/a" })).toMatchObject({ status: "refused", code: "host", reason: "offline" });
  });
});

describe("Core-private confirmations and the first-party adapter", () => {
  function grantManager(id = "anybandui") {
    const tier = assignTier({ id, source: "installed", execution: "in-process", repo: "neostryder/neo-angband-mod-anybandui", listing: "curated", sha: "abc", digestsMatch: true });
    setModTiers(new Map([[id, tier]]));
    setModGrants(new Map([[id, effectiveGrants(["mod:install"], tier, { granted: ["mod:install"], refused: [] })]]));
  }

  it("refuses an unknown caller and a caller spoofing a first-party repository", () => {
    const f = fixture();
    expect(createManageAdapter(f.service, "stranger")).toMatchObject({ status: "refused", code: "first-party" });
    grantManager("stranger");
    expect(createManageAdapter(f.service, "stranger")).toMatchObject({ status: "refused", code: "first-party" });
  });

  it("gives the adapter no route to answer a pending confirmation", async () => {
    grantManager();
    const f = fixture();
    const result = createManageAdapter(f.service, "anybandui");
    if (result.status !== "ok") throw new Error("The caller was refused.");
    const adapter = result.value;
    expect("resolveConfirmation" in adapter).toBe(false);
    expect("core" in adapter).toBe(false);
    expect("resolveConfirmation" in (f.service as unknown as ModManagerService)).toBe(false);
    const pending = adapter.enable("a");
    expect(f.store.isEnabled("a")).toBe(false);
    expect(pending).toMatchObject({ status: "confirmation", confirmation: { operation: "enable", requestedBy: "anybandui" } });
    expect((await accept(f.core, pending)).status).toBe("ok");
    expect(f.store.isEnabled("a")).toBe(true);
    const removal = await adapter.remove("a");
    expect(removal.status).toBe("confirmation");
    expect(f.uninstall).not.toHaveBeenCalled();
  });

  it("rechecks measured grants when a saved adapter mutates state", () => {
    grantManager();
    const f = fixture();
    const result = createManageAdapter(f.service, "anybandui");
    if (result.status !== "ok") throw new Error("The caller was refused.");
    resetModTiers();
    expect(result.value.enable("a")).toMatchObject({ status: "refused", code: "first-party" });
    expect(f.service.state.pendingConfirmation).toBeNull();
  });

  it("does not treat profile management as permission to install mods", () => {
    const tier = assignTier({ id: "borg", source: "installed", execution: "in-process", repo: "neostryder/neo-angband-mod-borg", listing: "curated", sha: "abc", digestsMatch: true });
    setModTiers(new Map([["borg", tier]]));
    setModGrants(new Map([["borg", effectiveGrants(["profiles:manage"], tier, { granted: ["profiles:manage"], refused: [] })]]));
    expect(createManageAdapter(fixture().service, "borg")).toMatchObject({ status: "refused", code: "first-party" });
  });

  it("derives catalog consent from Core rather than a caller-supplied origin", async () => {
    grantManager();
    const f = fixture();
    f.setThirdParty(false);
    const result = createManageAdapter(f.service, "anybandui");
    if (result.status !== "ok") throw new Error("The caller was refused.");
    expect(await result.value.planInstall([{ repo: "owner/b" }])).toMatchObject({ status: "refused", code: "consent" });
    const plan = await result.value.planInstall([{ repo: "owner/a" }]);
    if (plan.status !== "ok") throw new Error("The plan was refused.");
    expect(result.value.applyPlan(plan.value.id)).toMatchObject({ status: "confirmation", confirmation: { operation: "install", requestedBy: "anybandui" } });
    expect(f.install).not.toHaveBeenCalled();
  });

  it("requires confirmation for an update requested through the adapter", async () => {
    grantManager();
    const f = fixture();
    f.remote.set("a", manifest("a", { version: "2.0.0" }));
    const result = createManageAdapter(f.service, "anybandui");
    if (result.status !== "ok") throw new Error("The caller was refused.");
    expect(await result.value.update("a")).toMatchObject({ status: "confirmation", confirmation: { operation: "update", requestedBy: "anybandui" } });
    expect(f.install).not.toHaveBeenCalled();
  });

  it("publishes the same pending object while Core draws an existing dialog", async () => {
    const f = fixture();
    const listener = vi.fn();
    f.service.subscribe(listener);
    await f.core.drawConfirmation({ operation: "sideload", riskNotice: ["Existing disclaimer."] }, async () => {
      expect(f.service.state.pendingConfirmation?.operation).toBe("sideload");
      expect(Object.isFrozen(f.service.state.pendingConfirmation)).toBe(true);
    });
    expect(f.service.state.pendingConfirmation).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

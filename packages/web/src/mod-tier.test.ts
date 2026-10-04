/**
 * Loader tiering and per-permission consent (mod-tier.ts and the places that
 * read it: mod-code.ts, mod-store.ts, mods.ts and the Core-drawn screens).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilitySet, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  FIRST_PARTY_ORIGINS,
  TRUTH_MAP,
  assignTier,
  effectiveGrants,
  installListing,
  installedDigestsMatch,
  isUnreviewed,
  modStartGrants,
  needsOwnConfirmation,
  playerHeld,
  resetModTiers,
  saveMarkingGrantHeld,
  setModGrants,
  setModTiers,
  tierRefusal,
  type ModTierFacts,
} from "./mod-tier";
import { loadModCode, measureModTiers, settledGrants, PLUGIN_FILE } from "./mod-code";
import type { CodeUrlResolver, DiskPack } from "./disk-packs";
import { MOD_API_VERSION } from "./mod-plugin";
import { ModStore, buildCatalog, readEnabledModIds, type StorageLike } from "./mod-store";
import { CORE_DRAWN_IDS, isCoreDrawn } from "./core-drawn";
import { MODELLED_SCREENS } from "./screen-view";
import { rowLabel, unreviewedNoticeDue, unreviewedNoticeScreen } from "./mods";
import { showThroughPresenter, setScreenPresenter, type InstalledScreen } from "./screen-runtime";
import { askInstalledPresenter, setMenuPresenter, type InstalledMenu } from "./menu-runtime";
import { enterSafeLaunch, resetSafeLaunch } from "./safe-launch";
import { parseRegistry } from "./mod-curated";
import { createApi2Host } from "./mod-api2-host";
import type { ModPluginContext } from "./mod-plugin";

const ANYBANDUI = "neostryder/neo-angband-mod-anybandui";

function installed(over: Partial<ModTierFacts> = {}, without: readonly (keyof ModTierFacts)[] = []): ModTierFacts {
  const facts: Record<string, unknown> = {
    id: "anybandui",
    source: "installed",
    execution: "in-process",
    repo: ANYBANDUI,
    listing: "curated",
    sha: "abc123",
    digestsMatch: true,
    ...over,
  };
  for (const key of without) delete facts[key];
  return facts as unknown as ModTierFacts;
}

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function codePack(id: string, capabilities: string[]): DiskPack {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      shape: "plugin",
      facets: ["plugin"],
      modApi: MOD_API_VERSION,
      capabilities,
    } as PackManifest,
    files: {},
    code: [PLUGIN_FILE],
    assets: [],
  };
}

const codeUrl = ((id: string, file: string) => Promise.resolve(`mem://${id}/${file}`)) as CodeUrlResolver;
const plugin = { default: { api: MOD_API_VERSION, hooks: () => ({}) } };

afterEach(() => {
  resetModTiers();
  resetSafeLaunch();
  setScreenPresenter(null);
  setMenuPresenter(null);
});

describe("a tier comes from where the bytes came from", () => {
  it("is first-party only for a fetched copy of a listed origin whose digests match", () => {
    const tier = assignTier(installed());
    expect(tier.trust).toBe("first-party");
    expect(tier.capabilityTier).toBe("first-party");
    expect(tier.seams).toContain(TRUTH_MAP);
  });

  it("is sideloaded when the installed files no longer match their digests", () => {
    expect(assignTier(installed({ digestsMatch: false })).trust).toBe("sideloaded");
    expect(assignTier(installed({}, ["digestsMatch"])).trust).toBe("sideloaded");
  });

  it("does not believe a zip that claims a first-party repository", () => {
    expect(assignTier(installed({ listing: "file" })).trust).toBe("sideloaded");
  });

  it("counts an old record as fetched only when it holds a commit", () => {
    expect(assignTier(installed({}, ["listing"])).trust).toBe("first-party");
    expect(assignTier(installed({}, ["listing", "sha"])).trust).toBe("sideloaded");
  });

  it("is sideloaded for a pack another mod installed, or one with another id", () => {
    expect(assignTier(installed({ installedByModId: "forge" })).trust).toBe("sideloaded");
    expect(assignTier(installed({ id: "not-anybandui" })).trust).toBe("sideloaded");
  });

  it("is sideloaded from a folder or a session load, whatever the manifest claims", () => {
    expect(assignTier({ id: "anybandui", source: "folder", execution: "in-process" }).trust).toBe("sideloaded");
    expect(assignTier({ id: "anybandui", source: "session", execution: "in-process" }).trust).toBe("sideloaded");
  });

  it("reads the registry list a community install came from", () => {
    const facts = { id: "c", source: "installed" as const, execution: "in-process" as const, repo: "c/c" };
    expect(assignTier({ ...facts, listing: "community" }).trust).toBe("listed");
    expect(assignTier({ ...facts, listing: "reviewed" }).trust).toBe("reviewed");
    expect(assignTier({ ...facts, listing: "address" }).trust).toBe("sideloaded");
  });

  it("finds the reviewed label on a registry entry and records the listing", () => {
    const parsed = parseRegistry(
      JSON.stringify({ schema: 1, name: "r", mods: [], community: [{ repo: "a/one", tier: "R" }, { repo: "b/two" }] }),
      "https://example.invalid/registry.json",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.registry.reviewed).toEqual(["a/one"]);
    expect(installListing("A/One", false, parsed.registry)).toBe("reviewed");
    expect(installListing("b/two", false, parsed.registry)).toBe("community");
    expect(installListing("c/three", false, parsed.registry)).toBe("address");
    expect(installListing("c/three", true, parsed.registry)).toBe("curated");
  });

  it("hashes every installed file against its recorded digest", async () => {
    const meta = { id: "m", files: ["a.js", "b.json"], digests: { "a.js": "AA", "b.json": "bb" } };
    const read = (_id: string, path: string): Promise<Uint8Array> => Promise.resolve(new TextEncoder().encode(path));
    const hash = (bytes: Uint8Array): Promise<string> =>
      Promise.resolve(new TextDecoder().decode(bytes) === "a.js" ? "aa" : "bb");
    expect(await installedDigestsMatch(meta, read, hash)).toBe(true);
    expect(await installedDigestsMatch(meta, read, () => Promise.resolve("cc"))).toBe(false);
    expect(await installedDigestsMatch({ ...meta, digests: { "a.js": "aa" } }, read, hash)).toBe(false);
  });

  it("measures every pack, hashing only those whose record names a first-party origin", async () => {
    const verify = vi.fn(() => Promise.resolve(true));
    const tiers = await measureModTiers(
      [codePack("anybandui", []), codePack("other", []), codePack("dev", [])],
      { session: new Set(), folder: new Set(["dev"]) },
      [
        { id: "anybandui", repo: ANYBANDUI, listing: "curated", sha: "s" },
        { id: "other", repo: "someone/other", listing: "community" },
      ],
      verify,
    );
    expect(tiers.get("anybandui")?.trust).toBe("first-party");
    expect(tiers.get("other")?.trust).toBe("listed");
    expect(tiers.get("dev")?.trust).toBe("sideloaded");
    expect(verify).toHaveBeenCalledTimes(1);
  });
});

describe("the seam policy", () => {
  const sideloaded = assignTier({ id: "s", source: "folder", execution: "in-process" });
  const worker = assignTier({ id: "w", source: "folder", execution: "worker" });
  const anybandui = assignTier(installed());
  const squire = assignTier(installed({ id: "squire", repo: "neostryder/neo-angband-mod-squire" }));

  it("refuses manage to a mod that is not first-party, visibly", () => {
    expect(tierRefusal("profiles:manage", sideloaded)).toBe("only the game's own mods can have it");
    const grants = effectiveGrants(["profiles:manage", "command:add"], sideloaded, {
      granted: ["profiles:manage", "command:add"],
      refused: [],
    });
    expect(grants.granted).toEqual(["command:add"]);
    expect(grants.refusedByTier.map((r) => r.capability)).toEqual(["profiles:manage"]);
  });

  it("refuses manage to a first-party mod its entry does not name", () => {
    expect(tierRefusal("screens:manage", squire)).toBe("this version of the game does not give it to this mod");
    expect(tierRefusal("profiles:manage", squire)).toBeNull();
  });

  it("asks about manage on its own question", () => {
    expect(needsOwnConfirmation("mod:install")).toBe(true);
    expect(needsOwnConfirmation(TRUTH_MAP)).toBe(false);
    expect(needsOwnConfirmation("command:add")).toBe(false);
  });

  it("lets any in-process mod hold the real map with consent, but not a sideloaded Worker", () => {
    expect(tierRefusal(TRUTH_MAP, sideloaded)).toBeNull();
    expect(tierRefusal(TRUTH_MAP, worker)).toBe("only the game's own mods can have it");
    const held = effectiveGrants([TRUTH_MAP], sideloaded, { granted: [TRUTH_MAP], refused: [] });
    expect(held.granted).toEqual([TRUTH_MAP]);
  });

  it("never narrows a public capability for code in the page, whatever the tier", () => {
    for (const cap of ["registry:effect", "registry:*", "state:*.read", "network:*", "command:add"]) {
      expect(tierRefusal(cap, sideloaded)).toBeNull();
    }
    expect(tierRefusal("registry:effect", worker)).toBe("Worker mods cannot have it");
  });

  it("never grants a capability the vocabulary does not know", () => {
    expect(tierRefusal("nonsense:thing", anybandui)).toBe("the game does not know this permission");
  });

  it("lists only manage seams for first-party mods, and truth for any mod holding it", () => {
    setModTiers(new Map([["anybandui", anybandui], ["s", sideloaded]]));
    setModGrants(
      new Map([
        ["anybandui", effectiveGrants(["profiles:manage", TRUTH_MAP], anybandui, { granted: ["profiles:manage", TRUTH_MAP], refused: [] })],
        ["s", effectiveGrants([TRUTH_MAP], sideloaded, { granted: [TRUTH_MAP], refused: [] })],
      ]),
    );
    expect(modStartGrants("anybandui").firstParty).toEqual({ manage: true, truth: true });
    expect(modStartGrants("s").firstParty).toEqual({ truth: true });
    expect(modStartGrants("unknown")).toMatchObject({ granted: [] });
    expect(modStartGrants("unknown").firstParty).toBeUndefined();
  });

  it("marks the save only while a mod holds a capability its own entry marks", () => {
    setModTiers(new Map([["anybandui", anybandui], ["s", sideloaded]]));
    setModGrants(new Map([["s", effectiveGrants([TRUTH_MAP], sideloaded, { granted: [TRUTH_MAP], refused: [] })]]));
    expect(saveMarkingGrantHeld()).toBe(false);
    setModGrants(new Map([["anybandui", effectiveGrants([TRUTH_MAP], anybandui, { granted: [TRUTH_MAP], refused: [] })]]));
    expect(saveMarkingGrantHeld()).toBe(true);
    expect(FIRST_PARTY_ORIGINS.find((o) => o.id === "anybandui")?.marksSave).toEqual([TRUTH_MAP]);
  });
});

describe("per-permission consent", () => {
  const tier = assignTier({ id: "p", source: "folder", execution: "in-process" });

  it("hands over exactly what was allowed, and a refused permission answers not-granted", async () => {
    setModTiers(new Map([["p", tier]]));
    const report = await loadModCode({
      packs: [codePack("p", ["state:monsters.read", "command:add"])],
      codeUrl,
      enabled: () => true,
      consented: () => ["command:add"],
      refused: () => ["state:monsters.read"],
      tier: () => tier,
      importer: () => Promise.resolve(plugin),
    });
    const loaded = report.plugins[0];
    expect(loaded?.declared).toEqual(["state:monsters.read", "command:add"]);
    expect(loaded?.manifest.capabilities).toEqual(["command:add"]);
    const caps = CapabilitySet.fromManifest(loaded!.manifest);
    expect(caps.has("state:monsters.read")).toBe(false);
    const host = createApi2Host({ state: {} } as unknown as ModPluginContext, { grants: caps });
    const monsters = await host.view.monsters();
    expect(monsters).toMatchObject({ ok: false, reason: "not-granted", capability: "state:monsters.read" });
    expect(settledGrants(report).get("p")?.refusedByPlayer).toEqual(["state:monsters.read"]);
  });

  it("skips a mod with an undecided permission, and one that cannot start without a refused one", async () => {
    const importer = vi.fn(() => Promise.resolve(plugin));
    const report = await loadModCode({
      packs: [codePack("undecided", ["command:add"]), codePack("needs", ["registry:effect"])],
      codeUrl,
      enabled: () => true,
      consented: () => [],
      refused: (id) => (id === "needs" ? ["registry:effect"] : []),
      tier: () => tier,
      importer,
    });
    expect(importer).not.toHaveBeenCalled();
    expect(report.skipped.map((s) => s.why)).toEqual([
      "awaiting consent for command:add",
      "cannot start without registry:effect, which you turned off",
    ]);
  });

  it("reports a permission the tier withholds and loads the mod without it", async () => {
    const report = await loadModCode({
      packs: [codePack("p", ["profiles:manage", "command:add"])],
      codeUrl,
      enabled: () => true,
      consented: () => ["command:add"],
      tier: () => tier,
      importer: () => Promise.resolve(plugin),
    });
    expect(report.plugins[0]?.manifest.capabilities).toEqual(["command:add"]);
    expect(report.problems.map((p) => p.why)).toContain(
      "runs without profiles:manage: only the game's own mods can have it",
    );
  });

  it("asks an update only about what is new, keeping earlier choices", () => {
    const store = new ModStore(fakeStorage());
    store.setDecisions("m", { granted: ["command:add"], refused: ["state:monsters.read"] }, "1.0.0");
    const row = (caps: string[]) =>
      buildCatalog({
        content: [],
        sandbox: [],
        trusted: [{ id: "m", name: "M", version: "1.1.0", shape: "plugin", capabilities: caps } as PackManifest],
        enabled: ["m"],
        consents: store.getConsents(),
        refusals: store.getRefusals(),
        tierOf: () => tier,
      }).find((m) => m.id === "m");
    expect(row(["command:add", "state:monsters.read"])?.consented).toBe(true);
    expect(row(["command:add", "state:monsters.read", "event:message"])?.consented).toBe(false);
    store.setDecisions("m", { granted: ["event:message"], refused: [] }, "1.1.0");
    expect(store.getDecisions("m")).toEqual({
      granted: ["command:add", "event:message"],
      refused: ["state:monsters.read"],
    });
    expect(store.getConsentVersion("m")).toBe("1.1.0");
    store.clearConsent("m");
    expect(store.getDecisions("m")).toEqual({ granted: [], refused: [] });
  });

  it("applies refusals to mods built into the game", () => {
    expect(playerHeld(["command:add", "event:message"], { granted: ["command:add"], refused: ["event:message"] }))
      .toEqual({ held: ["command:add"], start: true });
    expect(playerHeld(["registry:effect"], { granted: [], refused: ["registry:effect"] }).start).toBe(false);
    expect(playerHeld(["command:add"], { granted: [], refused: [] }).start).toBe(false);
  });
});

describe("the unreviewed notice and badge", () => {
  const sideloaded = assignTier({ id: "s", source: "folder", execution: "in-process" });
  const firstParty = assignTier(installed());
  const catalogRow = (tierOf: typeof sideloaded) =>
    buildCatalog({
      content: [],
      sandbox: [],
      trusted: [{ id: "s", name: "S", version: "1.0.0", shape: "plugin" } as PackManifest],
      enabled: [],
      consents: {},
      tierOf: () => tierOf,
    })[0]!;

  it("badges unreviewed mods wherever the manager lists them", () => {
    expect(isUnreviewed(sideloaded)).toBe(true);
    expect(isUnreviewed(assignTier({ id: "l", source: "installed", execution: "in-process", listing: "community" }))).toBe(true);
    expect(isUnreviewed(assignTier({ id: "l", source: "installed", execution: "worker", listing: "community" }))).toBe(false);
    expect(isUnreviewed(firstParty)).toBe(false);
    expect(catalogRow(sideloaded).unreviewed).toBe(true);
    expect(rowLabel(catalogRow(sideloaded)).label).toContain("unreviewed");
    expect(rowLabel(catalogRow(firstParty)).label).not.toContain("unreviewed");
  });

  it("is due once, before the first enable, and only for a mod that runs code", () => {
    const store = new ModStore(fakeStorage());
    const row = catalogRow(sideloaded);
    expect(unreviewedNoticeDue(row, store)).toBe(true);
    store.markUnreviewedNotice("s", "1.0.0");
    expect(unreviewedNoticeDue(row, store)).toBe(false);
    const data = { ...row, tier: assignTier({ id: "s", source: "folder", execution: "data" }) };
    expect(unreviewedNoticeDue(data, new ModStore(fakeStorage()))).toBe(false);
  });

  it("is a Core-drawn screen that no presenter is offered", () => {
    const view = unreviewedNoticeScreen(catalogRow(sideloaded));
    expect(isCoreDrawn(view.id)).toBe(true);
    expect(MODELLED_SCREENS).toContain(view.id);
    const show = vi.fn(() => Promise.resolve());
    setScreenPresenter({ id: "presenter", presenter: { show } } as unknown as InstalledScreen);
    expect(showThroughPresenter(view)).toBeNull();
    expect(show).not.toHaveBeenCalled();
  });

  it("keeps every consent and notice menu from a menu presenter", async () => {
    const ask = vi.fn(() => Promise.resolve({ pick: 0 }));
    setMenuPresenter({ id: "presenter", presenter: { ask } } as unknown as InstalledMenu);
    for (const id of CORE_DRAWN_IDS) {
      expect(await askInstalledPresenter({ id, title: "t", items: [] } as never)).toBeUndefined();
    }
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("safe mode", () => {
  it("still turns every mod off, first-party ones included", () => {
    setModTiers(new Map([["anybandui", assignTier(installed())]]));
    enterSafeLaunch();
    expect(readEnabledModIds({ discovered: ["anybandui", "other"] })).toEqual([]);
  });
});

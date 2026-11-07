import { readFileSync } from "node:fs";
import ts from "typescript";
import { coreOnlyManifest, NOSCORE, type SaveManifest } from "@rpgm-tools/neo-angband-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConsentBindings } from "./mod-consent-binding";
import { ModStore, type StorageLike } from "./mod-store";
import { TRUTH_MAP, TRUTH_MONSTERS, modHolds, modStartGrants, resetModTiers, setModGrants, setModTiers, type ModTier } from "./mod-tier";
import { markPlayerForTruth, mayAskForTruth, recordTruthUse, requestTruthConsent, type TruthCapability } from "./mod-truth-consent";

function storage(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const tier = (over: Partial<ModTier> = {}): ModTier => ({
  trust: "first-party",
  execution: "in-process",
  capabilityTier: "first-party",
  seams: [TRUTH_MAP],
  marksSave: [TRUTH_MAP],
  why: "test",
  ...over,
});

function deps(store: ModStore, answer: boolean) {
  return { store, ask: vi.fn(async () => answer), markSave: vi.fn(() => true) };
}

beforeEach(() => { setConsentBindings(new Map([["glow", "bound"], ["quiet", "bound"]])); });
afterEach(() => { resetModTiers(); setConsentBindings(new Map()); });

describe("requestTruthConsent", () => {
  it("grants, stores the choice, and marks the save on a yes", async () => {
    setModTiers(new Map([["glow", tier()]]));
    const store = new ModStore(storage());
    store.setDecisions("glow", { granted: [], refused: [TRUTH_MAP] }, "1.0.0");
    const d = deps(store, true);
    expect(await requestTruthConsent("glow", "Shows hidden magic.", d)).toBe("granted");
    expect(d.ask).toHaveBeenCalledWith("glow", "Shows hidden magic.", true);
    expect(d.markSave).toHaveBeenCalledOnce();
    expect(store.getConsent("glow")).toContain(TRUTH_MAP);
    expect(store.getRefusal("glow")).not.toContain(TRUTH_MAP);
    expect(modHolds("glow", TRUTH_MAP)).toBe(true);
    expect(modStartGrants("glow").firstParty?.truth).toBe(true);
    /* Holding it already, the question is not drawn again. */
    expect(await requestTruthConsent("glow", "Again.", d)).toBe("granted");
    expect(d.ask).toHaveBeenCalledOnce();
  });

  it("changes nothing on a no, and asks again next time", async () => {
    setModTiers(new Map([["glow", tier()]]));
    const store = new ModStore(storage());
    const d = deps(store, false);
    expect(await requestTruthConsent("glow", "Why.", d)).toBe("declined");
    expect(await requestTruthConsent("glow", "Why.", d)).toBe("declined");
    expect(d.ask).toHaveBeenCalledTimes(2);
    expect(d.markSave).not.toHaveBeenCalled();
    expect(store.getConsent("glow")).toEqual([]);
    expect(modHolds("glow", TRUTH_MAP)).toBe(false);
  });

  it("marks truth even when the mod's origin entry has no consequence", async () => {
    setModTiers(new Map([["quiet", tier({ marksSave: [] })]]));
    const d = deps(new ModStore(storage()), true);
    expect(await requestTruthConsent("quiet", "Why.", d)).toBe("granted");
    expect(d.ask).toHaveBeenCalledWith("quiet", "Why.", true);
    expect(d.markSave).toHaveBeenCalledWith("quiet");
  });

  it("refuses a mod the game does not let hold the real map", async () => {
    setModTiers(new Map([
      ["third", tier({ trust: "sideloaded", seams: [] })],
      ["worker", tier({ execution: "worker" })],
      ["noseam", tier({ seams: ["profiles:manage"] })],
    ]));
    for (const id of ["third", "worker", "noseam", "missing"]) {
      const d = deps(new ModStore(storage()), true);
      expect(mayAskForTruth(id)).toBe(false);
      expect(await requestTruthConsent(id, "Why.", d)).toBe("unavailable");
      expect(d.ask).not.toHaveBeenCalled();
    }
  });

  it("keeps an earlier grant for other capabilities when it records the new one", async () => {
    setModTiers(new Map([["glow", tier()]]));
    setModGrants(new Map([["glow", { granted: ["state:view.read"], refusedByTier: [], refusedByPlayer: [], undecided: [], blocking: [] }]]));
    const store = new ModStore(storage());
    store.setDecisions("glow", { granted: ["state:view.read"], refused: [], binding: "bound" }, "1.0.0");
    await requestTruthConsent("glow", "Why.", deps(store, true));
    expect(store.getConsent("glow")).toEqual(["state:view.read", TRUTH_MAP]);
    expect(modHolds("glow", "state:view.read")).toBe(true);
  });

  it("withholds authority when the permanent mark cannot be saved", async () => {
    setModTiers(new Map([["quiet", tier({ marksSave: [] })]]));
    const store = new ModStore(storage());
    const d = deps(store, true);
    d.markSave.mockReturnValue(false);
    expect(await requestTruthConsent("quiet", "Why.", d)).toBe("unavailable");
    expect(store.getConsent("quiet")).toEqual([]);
    expect(modHolds("quiet", TRUTH_MAP)).toBe(false);
  });

  it("rejects a stale consent binding before marking or granting", async () => {
    setModTiers(new Map([["quiet", tier()]]));
    const store = new ModStore(storage());
    const d = deps(store, true);
    d.ask.mockImplementation(async () => { setConsentBindings(new Map([["quiet", "replacement"]])); return true; });
    expect(await requestTruthConsent("quiet", "Why.", d)).toBe("unavailable");
    expect(d.markSave).not.toHaveBeenCalled();
    expect(modHolds("quiet", TRUTH_MAP)).toBe(false);
    expect(store.getConsent("quiet")).toEqual([]);
  });

  it("refuses an unmeasured installation before asking or mutating", async () => {
    setModTiers(new Map([["unmeasured", tier()]]));
    const d = deps(new ModStore(storage()), true);
    expect(await requestTruthConsent("unmeasured", "Why.", d)).toBe("unavailable");
    expect(d.ask).not.toHaveBeenCalled();
    expect(d.markSave).not.toHaveBeenCalled();
    expect(modHolds("unmeasured", TRUTH_MAP)).toBe(false);
  });

  it("does not grant truth when a save callback changes the binding", async () => {
    setModTiers(new Map([["quiet", tier()]]));
    const store = new ModStore(storage());
    const d = deps(store, true);
    d.markSave.mockImplementation(() => { setConsentBindings(new Map([["quiet", "replacement"]])); return true; });
    expect(await requestTruthConsent("quiet", "Why.", d)).toBe("unavailable");
    expect(modHolds("quiet", TRUTH_MAP)).toBe(false);
    expect(store.getConsent("quiet")).toEqual([]);
  });
});

describe("markPlayerForTruth", () => {
  it("sets the debug mark and leaves the other bits", () => {
    const player = { noscore: 0 };
    markPlayerForTruth(player);
    expect(player.noscore).not.toBe(0);
    const once = player.noscore;
    markPlayerForTruth(player);
    expect(player.noscore).toBe(once);
  });
});

describe("main.ts truth save writer", () => {
  /* main.ts boots on import, so this test supplies save and loader dependencies to its actual writer declaration. */
  const source = ts.createSourceFile("main.ts", readFileSync(new URL("./main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "saveTruthUse")!;
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const bind = new Function("activeModCode", "consentBinding", "game", "recordTruthUse", "persistSave", "suppressSave", "birthPending", "attachedSlot", `${compiled}\nreturn saveTruthUse;`) as (
    code: () => unknown, binding: (id: string) => string, game: unknown, record: typeof recordTruthUse, persist: () => boolean,
    suppress: boolean, birth: boolean, slot: () => string | null,
  ) => (id: string, capability: TruthCapability) => boolean;

  it.each([TRUTH_MAP, TRUTH_MONSTERS] as const)("records a Worker identity holding %s for either author", (capability) => {
    for (const firstParty of [true, false]) {
      const worker = { id: "worker", permissionBinding: "installation", contentDigest: "payload", manifest: { version: "2.0.0" }, tier: { trust: firstParty ? "first-party" : "sideloaded" } };
      const game = { manifest: coreOnlyManifest(), state: { actor: { player: { noscore: 0 } }, turn: 42, chunk: { depth: 10 } } };
      let saved: SaveManifest | undefined;
      const persist = vi.fn(() => { saved = structuredClone(game.manifest); return true; });
      const write = bind(() => ({ plugins: [], workers: [worker] }), () => "installation", game, recordTruthUse, persist, false, false, () => "slot");
      expect(write("worker", capability)).toBe(true);
      expect(persist).toHaveBeenCalledOnce();
      expect(saved?.capabilityUse?.entries).toEqual([{ installation: "installation", id: "worker", version: "2.0.0", digest: "payload", capability,
        activation: { turn: 42, depth: 10 }, consequence: "hidden-information" }]);
      expect(saved?.modNoscore).toBe(true);
      expect(game.state.actor.player.noscore & NOSCORE.DEBUG).not.toBe(0);
    }
  });

  it.each(["unknown", "replaced", "title", "birth", "detached", "failed-save"])("refuses %s without disclosing truth", (failure) => {
    const game = { manifest: coreOnlyManifest(), state: { actor: { player: { noscore: 0 } }, turn: 0, chunk: { depth: 0 } } };
    const worker = { id: "worker", permissionBinding: "installation", manifest: { version: "1.0.0" } };
    const persist = vi.fn(() => failure !== "failed-save");
    const write = bind(() => ({ plugins: [], workers: [worker] }), () => failure === "replaced" ? "replacement" : "installation", game, recordTruthUse, persist,
      failure === "title", failure === "birth", () => failure === "detached" ? null : "slot");
    expect(write(failure === "unknown" ? "spoof" : "worker", TRUTH_MAP)).toBe(false);
    if (failure !== "failed-save") {
      expect(persist).not.toHaveBeenCalled();
      expect(game.manifest.modNoscore).toBe(false);
      expect(game.state.actor.player.noscore).toBe(0);
    }
  });
});

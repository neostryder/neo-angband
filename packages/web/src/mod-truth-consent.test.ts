import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConsentBindings } from "./mod-consent-binding";
import { ModStore, type StorageLike } from "./mod-store";
import { TRUTH_MAP, modHolds, modStartGrants, resetModTiers, setModGrants, setModTiers, type ModTier } from "./mod-tier";
import { markPlayerForTruth, mayAskForTruth, requestTruthConsent } from "./mod-truth-consent";

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

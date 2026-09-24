/**
 * The context a plugin is handed - specifically the two session facts added for
 * "remember my settings", and the wiring that supplies them.
 *
 * The wiring half is a source scan, and it is the half that matters. A context
 * field the host builds but never passes is the failure this project keeps
 * finding: everything compiles, every unit test passes, and the mod is handed
 * the default forever.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  modPluginContext,
  setModCharacterStoreControl,
  setModDisplayControl,
  setModInstallDoor,
  setModReadDoor,
  setModRegistries,
  setModSubwindowsControl,
  setModKeyRepeatControl,
  setModTilesControl,
} from "./mod-context";
import type { ModCharacterStoreControl } from "./mod-context";
import type { ModCharacterStore, ModDisplay, ModSubwindows, ModTiles } from "./mod-plugin";
import type { KeyRepeatVerdict } from "./key-repeat";
import type { CoreRegistries, ModBag } from "@rpgm-tools/neo-angband-core";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { modPrefs, modPrefsKey } from "./mod-prefs";

const MAIN_TS_SOURCE = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("modPluginContext session facts", () => {
  it("defaults newCharacter to false, the answer that changes nothing", () => {
    /* A caller that forgets must not make a mod seed a character who already
     * lived a life. The safe default is the one that does nothing. */
    expect(modPluginContext("qol", {}).newCharacter).toBe(false);
  });

  it("passes newCharacter through when the host says so", () => {
    expect(
      modPluginContext("qol", {}, undefined, {}, { newCharacter: true }).newCharacter,
    ).toBe(true);
  });

  it("gives every mod a prefs store, scoped to its own id", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const a = modPluginContext("qol", {}, undefined, {}, { prefs: modPrefs("qol", storage) });
    a.prefs.set({ x: 1 });
    expect(store.has(modPrefsKey("qol"))).toBe(true);
    expect(a.prefs.get()).toEqual({ x: 1 });
  });

  it("builds a real prefs store when the host supplies none", () => {
    /* Not a stub and not undefined: a plugin can call ctx.prefs unconditionally
     * without checking whether this host bothered. */
    const ctx = modPluginContext("qol", {});
    expect(typeof ctx.prefs.get).toBe("function");
    expect(typeof ctx.prefs.set).toBe("function");
  });

  it("publishes the latched display door after boot and omits it before boot", () => {
    const display = {
      snapshot: () => ({ mode: "play" }),
      setGrid: () => undefined,
      setCamera: () => undefined,
      setMapView: () => undefined,
      setSidebarExtent: () => undefined,
      setTileScaling: () => undefined,
      setFullMapOverview: () => undefined,
      setVisualFilter: () => undefined,
      repaint: () => undefined,
    } as unknown as ModDisplay;
    setModDisplayControl(undefined);
    expect(modPluginContext("qol", {}).display).toBeUndefined();
    setModDisplayControl(display);
    try {
      expect(modPluginContext("qol", {}).display?.snapshot()).toEqual({ mode: "play" });
    } finally {
      setModDisplayControl(undefined);
    }
  });

  it("publishes the latched subwindows door after boot and omits it before boot, fully ungated (#241)", () => {
    const setGrid = vi.fn();
    const addControl = vi.fn(() => () => undefined);
    const registerPrefBlock = vi.fn(() => () => undefined);
    const subwindows: ModSubwindows = {
      list: () => [
        {
          id: "messages",
          label: "Display messages",
          bounds: { x: 0, y: 0, width: 100, height: 40 },
          focused: false,
          grid: { cols: 20, rows: 3, cellWidth: 8, cellHeight: 16 },
        },
      ],
      setGrid,
      addControl,
      registerPrefBlock,
    };
    setModSubwindowsControl(undefined);
    expect(modPluginContext("qol", {}).subwindows).toBeUndefined();
    setModSubwindowsControl(subwindows);
    try {
      const ctx = modPluginContext("qol", {});
      expect(ctx.subwindows?.list()).toHaveLength(1);
      ctx.subwindows?.setGrid("messages", null);
      expect(setGrid).toHaveBeenCalledWith("messages", null);
      ctx.subwindows?.addControl("messages", "zoom-out", { glyph: "-", onActivate: () => undefined });
      expect(addControl).toHaveBeenCalledTimes(1);
      const block = { serialize: () => "8", parse: (text: string) => text, apply: () => undefined };
      ctx.subwindows?.registerPrefBlock("qol-zoom", block);
      expect(registerPrefBlock).toHaveBeenCalledWith("qol-zoom", block);
    } finally {
      setModSubwindowsControl(undefined);
    }
  });

  it("publishes the latched tiles door after boot and omits it before boot, fully ungated (#256)", () => {
    const hasMonsterTile = vi.fn((ridx: number) => ridx === 7);
    const drawMonster = vi.fn(() => true);
    const tiles: ModTiles = {
      active: true,
      hasMonsterTile,
      drawMonster,
    };
    setModTilesControl(undefined);
    expect(modPluginContext("qol", {}).tiles).toBeUndefined();
    setModTilesControl(tiles);
    try {
      const ctx = modPluginContext("qol", {});
      expect(ctx.tiles?.active).toBe(true);
      expect(ctx.tiles?.hasMonsterTile(7)).toBe(true);
      expect(hasMonsterTile).toHaveBeenCalledWith(7);
      const fakeCanvasCtx = {} as CanvasRenderingContext2D;
      expect(ctx.tiles?.drawMonster(fakeCanvasCtx, 7, 0, 0, 24, 24)).toBe(true);
      expect(drawMonster).toHaveBeenCalledWith(fakeCanvasCtx, 7, 0, 0, 24, 24);
    } finally {
      setModTilesControl(undefined);
    }
  });

  it("publishes the latched key-repeat door after boot and omits it before boot, fully ungated (#35)", () => {
    const verdict: KeyRepeatVerdict = { isRepeat: true, reportedRepeat: true, intervalMs: 10, ageMs: 1 };
    setModKeyRepeatControl(undefined);
    expect(modPluginContext("qol", {}).keyRepeat).toBeUndefined();
    setModKeyRepeatControl(() => verdict);
    try {
      const ctx = modPluginContext("qol", {});
      expect(ctx.keyRepeat?.()).toEqual(verdict);
    } finally {
      setModKeyRepeatControl(undefined);
    }
  });

  it("requires display:filter before a mod can change final canvas pixels", () => {
    const setVisualFilter = vi.fn();
    const display = {
      snapshot: () => ({ mode: "play" }),
      onKey: () => () => undefined,
      setGrid: () => undefined,
      setCamera: () => undefined,
      setMapView: () => undefined,
      setSidebarExtent: () => undefined,
      setTileScaling: () => undefined,
      setFullMapOverview: () => undefined,
      setVisualFilter,
      repaint: () => undefined,
    } as unknown as ModDisplay;
    const without = CapabilitySet.fromManifest({
      id: "plain-display",
      name: "Plain display",
      version: "1.0.0",
      shape: "plugin",
      facets: ["plugin"],
      modApi: 1,
      capabilities: [],
    });
    expect(() =>
      modPluginContext("plain-display", {}, undefined, {}, { display, capabilities: without })
        .display?.setVisualFilter("contrast(1.5)"),
    ).toThrow(/display:filter/);

    const withFilter = CapabilitySet.fromManifest({
      id: "filtered-display",
      name: "Filtered display",
      version: "1.0.0",
      shape: "plugin",
      facets: ["plugin"],
      modApi: 1,
      capabilities: ["display:filter"],
    });
    modPluginContext("filtered-display", {}, undefined, {}, { display, capabilities: withFilter })
      .display?.setVisualFilter("contrast(1.5)");
    expect(setVisualFilter).toHaveBeenCalledWith("contrast(1.5)");
  });

  it("forwards the full-detail map choice through the display facade", () => {
    const setFullMapOverview = vi.fn();
    const display = {
      snapshot: () => ({ mode: "play" }),
      onKey: () => () => undefined,
      setGrid: () => undefined,
      setCamera: () => undefined,
      setMapView: () => undefined,
      setSidebarExtent: () => undefined,
      setTileScaling: () => undefined,
      setFullMapOverview,
      setVisualFilter: () => undefined,
      repaint: () => undefined,
    } as unknown as ModDisplay;
    modPluginContext("qol", {}, undefined, {}, { display }).display?.setFullMapOverview(true);
    expect(setFullMapOverview).toHaveBeenCalledWith(true);
  });

  it("forwards the store item-name ellipsis choice through the display facade", () => {
    const setStoreItemNameEllipsis = vi.fn();
    const display = {
      snapshot: () => ({ mode: "play" }),
      onKey: () => () => undefined,
      setGrid: () => undefined,
      setCamera: () => undefined,
      setMapView: () => undefined,
      setSidebarExtent: () => undefined,
      setTileScaling: () => undefined,
      setFullMapOverview: () => undefined,
      setStoreItemNameEllipsis,
      setVisualFilter: () => undefined,
      repaint: () => undefined,
    } as unknown as ModDisplay;
    modPluginContext("qol", {}, undefined, {}, { display }).display?.setStoreItemNameEllipsis(true);
    expect(setStoreItemNameEllipsis).toHaveBeenCalledWith(true);
  });

  it("forwards the quiver itemization choice through the display facade", () => {
    const setQuiverItemization = vi.fn();
    const display = {
      snapshot: () => ({ mode: "play" }),
      onKey: () => () => undefined,
      setGrid: () => undefined,
      setCamera: () => undefined,
      setMapView: () => undefined,
      setSidebarExtent: () => undefined,
      setTileScaling: () => undefined,
      setFullMapOverview: () => undefined,
      setQuiverItemization,
      setVisualFilter: () => undefined,
      repaint: () => undefined,
    } as unknown as ModDisplay;
    modPluginContext("qol", {}, undefined, {}, { display }).display?.setQuiverItemization(true);
    expect(setQuiverItemization).toHaveBeenCalledWith(true);
  });

  it("forwards the monster list colour key choice through the display facade", () => {
    const setMonsterListColorKey = vi.fn();
    const display = {
      snapshot: () => ({ mode: "play" }),
      onKey: () => () => undefined,
      setGrid: () => undefined,
      setCamera: () => undefined,
      setMapView: () => undefined,
      setSidebarExtent: () => undefined,
      setTileScaling: () => undefined,
      setFullMapOverview: () => undefined,
      setMonsterListColorKey,
      setVisualFilter: () => undefined,
      repaint: () => undefined,
    } as unknown as ModDisplay;
    modPluginContext("qol", {}, undefined, {}, { display }).display?.setMonsterListColorKey(true);
    expect(setMonsterListColorKey).toHaveBeenCalledWith(true);
  });

  it("hands keymaps over only with the existing keymap:write capability", () => {
    const state = { options: { get: () => false } } as never;
    const denied = CapabilitySet.fromManifest({
      id: "plain-keys",
      name: "Plain keys",
      version: "1.0.0",
      shape: "plugin",
      facets: ["plugin"],
      modApi: 1,
      capabilities: [],
    });
    expect(modPluginContext("plain-keys", {}, state, {}, { capabilities: denied }).keymaps).toBeUndefined();

    const granted = CapabilitySet.fromManifest({
      id: "key-owner",
      name: "Key owner",
      version: "1.0.0",
      shape: "plugin",
      facets: ["plugin"],
      modApi: 1,
      capabilities: ["keymap:write"],
    });
    const keymaps = modPluginContext("key-owner", {}, state, {}, { capabilities: granted }).keymaps;
    expect(keymaps).toBeDefined();
    expect(typeof keymaps?.entries).toBe("function");
    expect(typeof keymaps?.rebind).toBe("function");
    expect(typeof keymaps?.remove).toBe("function");
  });
});

describe("ctx.characterStore - a mod's own live per-character bag (#171)", () => {
  /* `characterStoreFor` only checks truthiness, the same shape keymapsFor's own
   * test above uses: a live game is whatever has a character to key storage to,
   * not any particular GameState field this seam reads. */
  const state = {} as never;

  function fakeControl(): ModCharacterStoreControl & { readonly bags: Map<string, ModBag> } {
    const bags = new Map<string, ModBag>();
    return {
      bags,
      getBag: (id) => bags.get(id),
      setBag: (id, bag) => {
        if (bag) bags.set(id, bag);
        else bags.delete(id);
      },
      saveSchemaOf: () => 2,
    };
  }

  it("is absent without a live character, even with a control latched", () => {
    setModCharacterStoreControl(fakeControl());
    try {
      expect(modPluginContext("qol", {}).characterStore).toBeUndefined();
    } finally {
      setModCharacterStoreControl(undefined);
    }
  });

  it("is absent with a live character but no control latched", () => {
    setModCharacterStoreControl(undefined);
    expect(modPluginContext("qol", {}, state).characterStore).toBeUndefined();
  });

  it("reads null before any write, and round-trips a write through the latched control", () => {
    const control = fakeControl();
    setModCharacterStoreControl(control);
    try {
      const ctx = modPluginContext("qol", {}, state);
      expect(ctx.characterStore?.get()).toBeNull();
      ctx.characterStore?.set({ seenWyrms: 3 });
      expect(ctx.characterStore?.get()).toEqual({ seenWyrms: 3 });
      expect(control.bags.get("qol")).toEqual({ schema: 2, data: { seenWyrms: 3 } });
    } finally {
      setModCharacterStoreControl(undefined);
    }
  });

  it("scopes storage to each mod's own id - one mod cannot read or overwrite another's (#171)", () => {
    const control = fakeControl();
    setModCharacterStoreControl(control);
    try {
      const a = modPluginContext("mod-a", {}, state);
      const b = modPluginContext("mod-b", {}, state);
      a.characterStore?.set({ mine: "a" });
      b.characterStore?.set({ mine: "b" });
      expect(a.characterStore?.get()).toEqual({ mine: "a" });
      expect(b.characterStore?.get()).toEqual({ mine: "b" });
      expect(control.bags.size).toBe(2);
    } finally {
      setModCharacterStoreControl(undefined);
    }
  });

  it("clears the bag when set with null or undefined, the same convention ctx.prefs.set uses", () => {
    const control = fakeControl();
    setModCharacterStoreControl(control);
    try {
      const ctx = modPluginContext("qol", {}, state);
      ctx.characterStore?.set({ x: 1 });
      ctx.characterStore?.set(null);
      expect(ctx.characterStore?.get()).toBeNull();
      expect(control.bags.has("qol")).toBe(false);
    } finally {
      setModCharacterStoreControl(undefined);
    }
  });

  it("survives a value that cannot round-trip through JSON, leaving the old bag untouched", () => {
    const control = fakeControl();
    control.bags.set("qol", { schema: 1, data: { safe: true } });
    setModCharacterStoreControl(control);
    try {
      const ctx = modPluginContext("qol", {}, state);
      const circular: Record<string, unknown> = {};
      circular["self"] = circular;
      expect(() => ctx.characterStore?.set(circular)).not.toThrow();
      expect(ctx.characterStore?.get()).toEqual({ safe: true });
    } finally {
      setModCharacterStoreControl(undefined);
    }
  });

  it("stamps a write with this mod's CURRENT saveSchema, not a fixed number", () => {
    const bags = new Map<string, ModBag>();
    setModCharacterStoreControl({
      getBag: (id) => bags.get(id),
      setBag: (id, bag) => {
        if (bag) bags.set(id, bag);
        else bags.delete(id);
      },
      saveSchemaOf: (id) => (id === "qol" ? 5 : undefined),
    });
    try {
      modPluginContext("qol", {}, state).characterStore?.set({ x: 1 });
      expect(bags.get("qol")?.schema).toBe(5);
      modPluginContext("other", {}, state).characterStore?.set({ y: 1 });
      /* Declares no saveSchema: tagged 0 rather than a fabricated number, and it
       * never matters because migrateModBags skips a mod with none declared. */
      expect(bags.get("other")?.schema).toBe(0);
    } finally {
      setModCharacterStoreControl(undefined);
    }
  });

  it("a test may override ctx.characterStore directly, without a control latched", () => {
    const store: ModCharacterStore = { get: () => ({ fixed: true }), set: () => undefined };
    const ctx = modPluginContext("qol", {}, state, {}, { characterStore: store });
    expect(ctx.characterStore).toBe(store);
  });
});

describe("main.ts actually passes the session facts (drift guard)", () => {
  it("uses the full-detail map path when a display mod requests it", () => {
    expect(MAIN_TS_SOURCE).toMatch(
      /return mainTileMode\.tileset \|\| fullMapOverview \? buildGraphicsOverview\(overviewParams\) : buildOverview\(overviewParams\);/u,
    );
  });

  it("builds them once, from bootedNew and the birth screen being done", () => {
    /* bootedNew ALONE is true of the throwaway game running behind the birth
     * screen. Pinning the conjunction keeps a later simplification from seeding
     * a character that is about to be discarded. */
    expect(MAIN_TS_SOURCE).toMatch(
      /const sessionFacts: ModSessionFacts = \{ newCharacter: bootedNew && !birthPending \}/,
    );
  });

  it("hands them to EVERY context it builds, not just one", () => {
    /* Four call sites: migrateBag, register, controller and candidate-zero. A
     * field passed to some but not others is a mod whose behaviour depends on
     * which entry point it used, which is not a distinction any mod author
     * would expect to exist. `register`'s call site spreads sessionFacts
     * rather than passing it bare, because it ALSO hands this mod's own
     * CapabilitySet (ticket #133's ctx.backupFolder gate) - still every fact
     * sessionFacts carries, plus one more, not a substitute for it. */
    const contexts = MAIN_TS_SOURCE.match(/modPluginContext\(/gu) ?? [];
    const passed =
      MAIN_TS_SOURCE.match(/^\s*(?:sessionFacts,|\{\s*\.\.\.sessionFacts,.*\},)\s*$/gmu) ?? [];
    expect(contexts.length).toBeGreaterThan(0);
    expect(passed).toHaveLength(contexts.length);
  });
});

describe("ctx.registries - the bound content a mod can ask about", () => {
  /* A registry fixture, not a booted game. The claim under test is that whatever
   * the host latched is what the plugin sees, unchanged; what a REAL registry
   * contains after a mod composes into it is proved where real ones are built
   * (tutorial-mods.node.test.ts, kin-tiles.node.test.ts). Keeping the two apart
   * matters, because a fixture asserting its own shape proves nothing about the
   * producer. */
  const fixture = (): CoreRegistries =>
    ({
      monsters: {
        races: [
          { ridx: 0, name: "soldier ant" },
          /* Provenance is the ONLY thing that marks this one as a mod's. */
          { ridx: 1, name: "joiner ant", from: { owner: "tutorial-03" } },
        ],
      },
      objects: { kinds: [{ kidx: 0, tval: 37 }] },
    }) as unknown as CoreRegistries;

  it("is absent until the host latches one, the composition-time shape", () => {
    /* Content composition runs before binding, so during it there is no answer
     * to give. Absent rather than an empty registry: an empty one reads as "this
     * session has no monsters", which is a different and false claim. */
    setModRegistries(undefined);
    expect(modPluginContext("qol", {}).registries).toBeUndefined();
    expect("registries" in modPluginContext("qol", {})).toBe(false);
  });

  it("reaches EVERY context once latched, with no call site passing it", () => {
    /* The reason it is a latch. Seven call sites across three modules build a
     * context today; none of them mentions registries, and all seven get it. */
    setModRegistries(fixture());
    try {
      for (const id of ["qol", "borg", "linoleum"]) {
        expect(modPluginContext(id, {}).registries?.monsters.races).toHaveLength(2);
      }
    } finally {
      setModRegistries(undefined);
    }
  });

  it("shows a mod's monster on the same terms as core's own", () => {
    /* A hard requirement of the mod system: modded creatures and items must work
     * the same as vanilla ones. This is the mechanism that makes that free rather than
     * something each consumer opts into - a consumer indexing by ridx cannot
     * treat the two differently, because nothing in the lookup distinguishes
     * them. `from` is present and is deliberately not consulted here. */
    setModRegistries(fixture());
    try {
      const races = modPluginContext("borg", {}).registries?.monsters.races ?? [];
      const byRidx = new Map(races.map((r) => [r.ridx, r]));
      expect(byRidx.get(0)?.name).toBe("soldier ant");
      expect(byRidx.get(1)?.name).toBe("joiner ant");
      /* Contiguous ridx values, because mods APPEND: an index that resolves for
       * core's content resolves for a mod's, so there is no gap for a consumer
       * to fall into a default through. */
      expect(races.map((r) => r.ridx)).toEqual([0, 1]);
    } finally {
      setModRegistries(undefined);
    }
  });

  it("a test may override the latch without booting a game", () => {
    setModRegistries(undefined);
    const ctx = modPluginContext("qol", {}, undefined, {}, { registries: fixture() });
    expect(ctx.registries?.monsters.races).toHaveLength(2);
  });

  it("the capability-gated doors are ABSENT without the capability", () => {
    /* The gate is the whole product of these three fields, and none of them had a
     * test for absence. `undefined` rather than a facade that refuses is the shape:
     * a mod guards with `if (!ctx.installMod) return;`, so a present-but-throwing
     * door would move every refusal from a branch the author wrote to a crash they
     * did not. */
    const ctx = modPluginContext("qol", {});
    expect(ctx.installMod).toBeUndefined();
    expect(ctx.reloadGame).toBeUndefined();
    expect(ctx.loadModForSession).toBeUndefined();
    expect(ctx.ui).toBeUndefined();
    expect(ctx.debug).toBeUndefined();
    expect(ctx.readMod).toBeUndefined();
  });

  it("reloadGame arrives with either staging door and with nothing else", () => {
    /* TWO CAPABILITIES, ONE DOOR, checked here because it is the kind of pairing
     * that gets separated by somebody tidying. Content composes at load, so a
     * mod that stages something - by install or by session - and cannot follow
     * it with a reload leaves the player holding something this process will
     * never load. What must NOT happen is the reload arriving on its own grant,
     * or with no grant at all. */
    const install = CapabilitySet.fromManifest({
      id: "qol",
      name: "qol",
      version: "1.0.0",
      shape: "plugin",
      capabilities: ["mod:install"],
    });
    const session = CapabilitySet.fromManifest({
      id: "qol",
      name: "qol",
      version: "1.0.0",
      shape: "plugin",
      capabilities: ["mod:session"],
    });
    setModInstallDoor({
      env: {
        fetch: () => Promise.reject(new Error("no network in this test")),
        subtle: { digest: () => Promise.reject(new Error("unused")) } as unknown as SubtleCrypto,
        scope: {},
        now: () => "2026-08-22T00:00:00.000Z",
      },
      allowed: () => true,
      reload: () => undefined,
    });
    try {
      const granted = modPluginContext("qol", {}, undefined, {}, { capabilities: install });
      expect(granted.reloadGame).toBeDefined();
      expect(granted.installMod).toBeDefined();
      /* The session grant buys the session door AND the same reload. */
      const staged = modPluginContext("qol", {}, undefined, {}, { capabilities: session });
      expect(staged.loadModForSession).toBeDefined();
      expect(staged.reloadGame).toBeDefined();
      /* And no grant at all buys neither, even with the door latched. */
      expect(modPluginContext("qol", {}).reloadGame).toBeUndefined();
    } finally {
      setModInstallDoor(undefined);
    }
  });

  it("main.ts hands the install door the game's own mod-change reload", () => {
    /* THE DRIFT GUARD, and the one the tests above cannot stand in for: every one
     * of them passes against a boot path that latches a door with no reload in it,
     * and TypeScript only proves the field is present, not that it is the sequence
     * that saves the character. A bare location.reload() here would compile, pass,
     * and lose the player's progress since the last save. */
    expect(MAIN_TS_SOURCE).toMatch(/reload: \(\) => \{\s*reloadAfterModChange\(\);\s*\},/u);
  });

  it("ctx.readMod: present only with mod:read AND a latched door, absent otherwise (#172)", () => {
    /* THE SAME TWO-REASON GATE `ctx.installMod` uses: a manifest that never
     * asked, and a door the boot path never latched, are two independent ways
     * to get `undefined` rather than a facade that throws. */
    const granted = CapabilitySet.fromManifest({
      id: "qol",
      name: "qol",
      version: "1.0.0",
      shape: "plugin",
      capabilities: ["mod:read"],
    });
    /* No door latched: the capability alone buys nothing. */
    expect(
      modPluginContext("qol", {}, undefined, {}, { capabilities: granted }).readMod,
    ).toBeUndefined();

    setModReadDoor({
      env: () => ({
        engineVersion: "0.18.0",
        fetch: () => Promise.reject(new Error("no network in this test")),
      }),
    });
    try {
      const ctx = modPluginContext("qol", {}, undefined, {}, { capabilities: granted });
      expect(ctx.readMod).toBeDefined();
      /* And with no grant at all, the latched door buys nothing either. */
      expect(modPluginContext("qol", {}).readMod).toBeUndefined();
    } finally {
      setModReadDoor(undefined);
    }
  });

  it("main.ts actually latches the read door", () => {
    /* THE SAME CLASS OF DRIFT GUARD as the reload one above: every test in this
     * file passes against a boot path that never calls setModReadDoor, which is
     * indistinguishable from a capability the player was never actually able to
     * use. */
    expect(MAIN_TS_SOURCE).toMatch(/setModReadDoor\(\{/u);
  });

  it("mod:install does not hand over the session door, or the other way round", () => {
    /* THE SAME ESCALATION the SDK's grantCovers refuses, checked at the place a mod
     * actually reaches the door. Two capability strings that both produce a `mod`
     * kind is exactly the shape #261 had, so this asks the question at both layers
     * rather than trusting the one below. */
    const installer = modPluginContext(
      "qol",
      {},
      undefined,
      {},
      { loadModForSession: () => Promise.resolve({ ok: false, problem: "no" }) },
    );
    /* An explicit override is honoured - that is the test seam - but the CAPABILITY
     * route is what the escalation would travel down, so it is checked with a real
     * CapabilitySet below rather than with an override. */
    expect(installer.loadModForSession).toBeDefined();

    const set = CapabilitySet.fromManifest({
      id: "qol",
      name: "qol",
      version: "1.0.0",
      shape: "plugin",
      capabilities: ["mod:install"],
    });
    expect(set.has("mod:install")).toBe(true);
    expect(set.has("mod:session")).toBe(false);
    /* And with no latched door there is nothing to hand over either way, which is
     * the second half of the gate and the half a unit test would otherwise skip. */
    const ctx = modPluginContext("qol", {}, undefined, {}, { capabilities: set });
    expect(ctx.installMod).toBeUndefined();
    expect(ctx.loadModForSession).toBeUndefined();
  });

  it("main.ts actually loads the session tier at boot", () => {
    /* THE SAME CLASS OF CHECK as the registry latch below, and for the same reason:
     * every test in mod-session.test.ts calls loadSessionMods itself, so all of
     * them would pass against a boot path that never called it - and a staged mod
     * that silently never loads is the failure mode this whole feature is one
     * missing line away from. */
    expect(MAIN_TS_SOURCE).toMatch(/await loadSessionMods\(\);/u);
  });

  it("main.ts actually latches the bound registries", () => {
    /* THE ONE THAT MATTERS. Every test above passes against a seam no boot path
     * ever fills - which is precisely how the Borg shipped with four inert
     * resolvers and a green suite. This asserts the call exists, on the value the
     * surrounding code already documents as "whichever set this launch built". */
    expect(MAIN_TS_SOURCE).toMatch(/setModRegistries\(booted\.registries\);/u);
  });

  it("main.ts actually wires ctx.keyRepeat to the tracker its own keydown listener feeds (#35)", () => {
    /* THE SAME CLASS OF CHECK, and for the same reason: a `ctx.keyRepeat` this
     * repo's own tests can see but no boot path ever latches is indistinguishable
     * from one that always answers undefined. Two assertions, because the door
     * and the feed are two separate lines that could drift apart independently -
     * the latch could point at a tracker nothing ever classifies into, or the
     * classify() call could feed a tracker no door reads from. */
    expect(MAIN_TS_SOURCE).toMatch(/setModKeyRepeatControl\(\(\) => keyRepeatTracker\.last\(\)\);/u);
    expect(MAIN_TS_SOURCE).toMatch(/keyRepeatTracker\.classify\(ev\);/u);
  });

  it("main.ts actually latches ctx.tiles onto the live tile-mode state, not a static stand-in (#256)", () => {
    /* THE SAME CLASS OF CHECK again: a `ctx.tiles` this file's unit tests can
     * build by hand but no boot path ever installs is indistinguishable from a
     * seam that always answers undefined. `mainTileMode` is the same object
     * the main view's own render loop reads, so this also guards against a
     * frozen snapshot standing in for the live one. */
    expect(MAIN_TS_SOURCE).toMatch(/setModTilesControl\(modTilesControl\);/u);
    expect(MAIN_TS_SOURCE).toMatch(/mainTileMode\.grafID !== GRAPHICS_NONE/u);
    expect(MAIN_TS_SOURCE).toMatch(/tileForMonster\(tileMap, ridx\)/u);
  });

  it("main.ts actually latches ctx.characterStore onto the live StartedGame's own bags (#171)", () => {
    /* THE SAME CLASS OF CHECK again: a door this file's unit tests can build by
     * hand but no boot path ever installs is indistinguishable from a seam that
     * always answers undefined. `game.mods` is read AND written through the
     * latch, so both directions get their own assertion. */
    expect(MAIN_TS_SOURCE).toMatch(/setModCharacterStoreControl\(\{/u);
    expect(MAIN_TS_SOURCE).toMatch(/getBag: \(id\) => game\.mods\[id\],/u);
    expect(MAIN_TS_SOURCE).toMatch(/game\.mods = next;/u);
  });
});

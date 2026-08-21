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
import { describe, expect, it } from "vitest";
import { modPluginContext, setModRegistries } from "./mod-context";
import type { CoreRegistries } from "@rpgm-tools/neo-angband-core";
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
});

describe("main.ts actually passes the session facts (drift guard)", () => {
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
    expect(ctx.loadModForSession).toBeUndefined();
    expect(ctx.ui).toBeUndefined();
    expect(ctx.debug).toBeUndefined();
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
});

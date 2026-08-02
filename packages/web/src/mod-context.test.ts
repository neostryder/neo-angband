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
import { modPluginContext } from "./mod-context";
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
    /* Three call sites: migrateBag, register and controller. A field passed to
     * two of the three is a mod whose behaviour depends on which entry point it
     * used, which is not a distinction any mod author would expect to exist. */
    const contexts = MAIN_TS_SOURCE.match(/modPluginContext\(/gu) ?? [];
    const passed = MAIN_TS_SOURCE.match(/^\s*sessionFacts,$/gmu) ?? [];
    expect(contexts.length).toBeGreaterThan(0);
    expect(passed).toHaveLength(contexts.length);
  });
});

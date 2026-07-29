/**
 * Discovery of the bundled mods' BEHAVIOUR entry points (mod-hooks.ts).
 *
 * The seam this covers is the one nothing else can: a mod's hooks.ts can be
 * perfect and its manifest correct, and the game will still run faithfully if the
 * host never finds the file. That is exactly the failure the call-site census
 * exists to catch, so it is pinned here rather than assumed.
 */

import { describe, expect, it } from "vitest";
import { composeModHooks } from "@neo-angband/core";
import { discoverModHookEntries } from "./mod-hooks";

describe("discoverModHookEntries", () => {
  const entries = discoverModHookEntries();

  it("finds the two bundled mods that change behaviour", () => {
    expect([...entries.keys()].sort()).toEqual(["bug-fixes", "qol"]);
  });

  it("does NOT find the tiles mod, which contributes no behaviour", () => {
    /* linoleum is a tile engine plus a loose pack: it declares no rules and ships
     * no hooks.ts, so it must never appear here. An empty contribution would be
     * indistinguishable in effect but wrong in kind - "a disabled mod's patches do
     * not exist" applies just as much to a mod that has none. */
    expect(entries.has("linoleum")).toBe(false);
  });

  it("every entry point is a function of flags returning contributions", () => {
    for (const [id, entry] of entries) {
      expect(typeof entry, id).toBe("function");
      /* Enabled with every patch off contributes nothing... */
      expect(entry({}), id).toEqual({});
      /* ...and an unknown flag is not an excuse to contribute something. */
      expect(entry({ "not.a.real.flag": true }), id).toEqual({});
    }
  });

  it("with nothing enabled, the composed result is ABSENT, not empty", () => {
    /* What core sees on a fresh install: GameState.modHooks is undefined, so every
     * call site is one undefined check on its faithful path. */
    expect(composeModHooks([])).toBeUndefined();
    expect(composeModHooks([...entries.values()].map((e) => e({})))).toBeUndefined();
  });

  it("the discovered mods really do contribute once their patches are on", () => {
    const qol = entries.get("qol")!;
    const bugFixes = entries.get("bug-fixes")!;
    expect(Object.keys(qol({ "qol.autoDig": true }))).toEqual(["walkBlockedByDiggable"]);
    expect(Object.keys(bugFixes({ "bugfix.miscStrings": true }))).toEqual(["messageText"]);

    /* And the host's fold turns two mods' contributions into the one object core
     * holds, with both mods' hooks present. */
    const composed = composeModHooks([
      qol({ "qol.autoDig": true }),
      bugFixes({ "bugfix.miscStrings": true, "bugfix.noiseScentSave": true }),
    ]);
    expect(Object.keys(composed ?? {}).sort()).toEqual([
      "messageText",
      "saveNoiseScent",
      "walkBlockedByDiggable",
    ]);
  });
});

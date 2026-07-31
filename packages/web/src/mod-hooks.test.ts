/**
 * Discovery of the bundled mods' BEHAVIOUR entry points (mod-hooks.ts).
 *
 * The seam this covers is the one nothing else can: a mod's plugin.ts can be
 * perfect and its manifest correct, and the game will still run faithfully if the
 * host never finds the file. That is exactly the failure the call-site census
 * exists to catch, so it is pinned here rather than assumed.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeModHooks } from "@neo-angband/core";
import { discoverModHookEntries } from "./mod-hooks";
import { MOD_API_VERSION } from "./mod-plugin";

const MODS_DIR = join(import.meta.dirname, "..", "mods");

describe("discoverModHookEntries", () => {
  const entries = discoverModHookEntries();

  it("finds the two bundled mods that change behaviour", () => {
    expect([...entries.keys()].sort()).toEqual(["bug-fixes", "qol"]);
  });

  it("does NOT find the tiles mod, which contributes no behaviour", () => {
    /* neo-linoleum is a tile engine plus a loose pack: it declares no rules and
     * ships no plugin.ts, so it must never appear here. An empty contribution would
     * be indistinguishable in effect but wrong in kind - "a disabled mod's patches do
     * not exist" applies just as much to a mod that has none. */
    expect(entries.has("neo-linoleum")).toBe(false);
  });

  it("every entry point is a function of flags returning contributions", () => {
    for (const [id, entry] of entries) {
      expect(typeof entry, id).toBe("function");
      /* Enabled with every patch off contributes nothing... */
      expect(entry({}) ?? {}, id).toEqual({});
      /* ...and an unknown flag is not an excuse to contribute something. */
      expect(entry({ "not.a.real.flag": true }) ?? {}, id).toEqual({});
    }
  });

  it("with nothing enabled, the composed result is ABSENT, not empty", () => {
    /* What core sees on a fresh install: GameState.modHooks is undefined, so every
     * call site is one undefined check on its faithful path. */
    expect(composeModHooks([])).toBeUndefined();
    expect(
      composeModHooks([...entries.values()].flatMap((e) => e({}) ?? [])),
    ).toBeUndefined();
  });

  it("the discovered mods really do contribute once their patches are on", () => {
    const qol = entries.get("qol")!;
    const bugFixes = entries.get("bug-fixes")!;
    expect(Object.keys(qol({ "qol.autoDig": true }) ?? {})).toEqual([
      "walkBlockedByDiggable",
    ]);
    expect(Object.keys(bugFixes({ "bugfix.miscStrings": true }) ?? {})).toEqual([
      "messageText",
    ]);

    /* And the host's fold turns two mods' contributions into the one object core
     * holds, with both mods' hooks present. */
    const composed = composeModHooks([
      qol({ "qol.autoDig": true }) ?? {},
      bugFixes({ "bugfix.miscStrings": true, "bugfix.noiseScentSave": true }) ?? {},
    ]);
    expect(Object.keys(composed ?? {}).sort()).toEqual([
      "messageText",
      "saveNoiseScent",
      "walkBlockedByDiggable",
    ]);
  });
});

describe("the bundled mods use the SAME entry-point ABI a folder mod does", () => {
  /*
   * They did not, and that was the thing blocking a mod from being extracted to its
   * own repository at all. A bundled mod's hooks.ts took `flags` and imported
   * @neo-angband/core directly; a folder mod's plugin.js has `hooks(ctx)` and gets
   * the engine as ctx.core, because a module fetched from a folder cannot resolve a
   * bare specifier. Same job, two signatures, and only one of them could be built
   * into something distributable.
   *
   * These are source-level guards because the alternative - importing plugin.ts and
   * inspecting it - is what the suite above already does. What it cannot see is a
   * source that has drifted BACK to importing the engine, which would keep working
   * in the bundle and fail only once someone downloaded the mod.
   */
  const modsWithCode = readdirSync(MODS_DIR).filter((id) =>
    readdirSync(join(MODS_DIR, id)).includes("plugin.ts"),
  );

  it("there are bundled behaviour mods to check", () => {
    // Guards the guard: a glob that matches nothing passes every assertion below.
    expect(modsWithCode.sort()).toEqual(["bug-fixes", "qol"]);
  });

  it("declares the api version the host implements", async () => {
    for (const id of modsWithCode) {
      const mod = (await import(`../mods/${id}/plugin.ts`)) as { default: { api: number } };
      expect(mod.default.api, id).toBe(MOD_API_VERSION);
    }
  });

  it("takes the engine from its context, never by importing it", async () => {
    /* A VALUE import of core is the whole failure. A type-only one is fine and
     * expected - it is erased, and it is how the mod gets ModHooks. */
    const { readFileSync } = await import("node:fs");
    for (const id of modsWithCode) {
      for (const file of readdirSync(join(MODS_DIR, id))) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        const src = readFileSync(join(MODS_DIR, id, file), "utf8");
        const imports = src.match(/^import[\s\S]*?from "@neo-angband\/core";/gm) ?? [];
        for (const line of imports) {
          expect(line.startsWith("import type"), `${id}/${file}: ${line}`).toBe(true);
        }
      }
    }
  });

  it("keeps the sandbox-worker entry under a DIFFERENT name than the mod ABI", () => {
    /* The collision that actually happened: agents/sandbox/discover.ts globbed
     * mods/*&#8203;/plugin.ts as a ?worker, and mod-hooks.ts started globbing the same
     * path EAGERLY as a module - which imports a Worker entry into the main thread
     * and runs runWorkerRuntime there. One folder cannot have one filename meaning
     * two things. */
    for (const id of readdirSync(MODS_DIR)) {
      const files = readdirSync(join(MODS_DIR, id));
      expect(
        files.includes("plugin.ts") && files.includes("sandbox.ts"),
        `${id} ships both entry points`,
      ).toBe(false);
    }
  });
});

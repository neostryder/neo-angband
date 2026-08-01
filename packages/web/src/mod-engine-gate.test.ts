/**
 * The `engine` range, wired - and pinned to all THREE doors a mod comes in by.
 *
 * WHAT WAS WRONG. `PackManifest.engine` is a semver range over the game's version.
 * It has been on the manifest since the manifest existed; four separate discovery
 * paths in the host carry it carefully through normalisation; the SDK ships a
 * `satisfies()` that can evaluate it. Nothing ever did. `satisfies` had exactly one
 * caller - resolve.ts, for mod-to-mod `dependencies` - so `engine` was a field
 * authors filled in, believed, and that no code on any platform compared to
 * anything.
 *
 * WHAT THAT COST, measured rather than supposed: two of the three first-party mods
 * had drifted to `"engine": "4.2.x"`. That is PARITY_BASELINE, the upstream Angband
 * release the port tracks - not ENGINE_VERSION, the port's own version, which is
 * what the field ranges over. The core content pack next to them has it right
 * (`"engine": ">=0.1.0"`). Two meanings for one field, in one repository, and no
 * test, no build and no boot could notice, because reading a range is not the same
 * as evaluating one.
 *
 * WHY THREE DOORS. The host's only version gate before this was `modApi`, and it
 * lives inside the CODE loader - so it covered plugin.js and nothing else. A content
 * pack and a tiles pack had no gate at all to fail. These tests drive each path
 * separately, because "the gate is in mod-engine.ts" is a claim about a module and
 * "the tiles path refuses it" is a claim about behaviour, and only the second one
 * can be wrong in a way a player notices.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, PARITY_BASELINE } from "@rpgm-tools/neo-angband-core";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { NO_DISK_PACKS, resetDiskPacks, setDiskPacks, type DiskPack } from "./disk-packs";
import { loadModCode, PLUGIN_FILE, resetModCode } from "./mod-code";
import { engineAllows, engineBlocksCode, engineProblem } from "./mod-engine";
import { MOD_API_VERSION } from "./mod-plugin";
import { problemsFor, resetModFaults } from "./mod-problems";
import { enabledTileModes } from "./tile-mods";
import type { CodeUrlResolver } from "./disk-packs";

/* Same reasoning as mod-visibility.test.ts: no vi.resetModules(), because it would
 * hand `await import("./pack")` private copies of the latches this file writes to. */
afterEach(() => {
  resetDiskPacks();
  resetModCode();
  resetModFaults();
});

/** A range no build of this port can ever satisfy, without naming a number. */
const NEVER = ">=9000.0.0";

/** A content pack that patches a core monster, so its effect shows in the records. */
function patchingPack(id: string, engine?: string): DiskPack {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      shape: "content",
      dependencies: { core: "*" },
      ...(engine === undefined ? {} : { engine }),
    } as DiskPack["manifest"],
    files: {
      monster: { patches: { "core:grip-farmer-maggot-s-dog": { name: `Grip of ${id}` } } },
    },
    code: [],
    assets: [],
  };
}

function folderWith(...packs: DiskPack[]): Parameters<typeof setDiskPacks>[0] {
  return {
    packs,
    order: packs.map((p) => p.manifest.id),
    problems: [],
    dir: "my-mods",
    available: true,
    kind: "picked",
    codeUrl: null,
    assetUrl: null,
    origins: [{ kind: "picked", dir: "my-mods", count: packs.length }],
  };
}

function monsterNames(pack: typeof import("./pack")): (string | undefined)[] {
  return (pack.loadGamePack().mon.monsters as { name?: string }[]).map((m) => m.name);
}

/* --- the rule itself ------------------------------------------------------- */

describe("the gate measures against the PORT's version, not the parity baseline", () => {
  /* The exact confusion two shipped manifests were in. Both strings are in this
   * repository, both look like versions, and only one of them is what `engine`
   * ranges over - so the gate has to be pinned to which, or the next author to
   * copy a manifest reintroduces it silently. */
  it("accepts a range over ENGINE_VERSION", () => {
    expect(engineAllows({ id: "m", engine: `>=${ENGINE_VERSION}`, modApi: 1 })).toBe(true);
  });

  it("refuses a range over PARITY_BASELINE", () => {
    for (const engine of [PARITY_BASELINE, "4.2.x"]) {
      expect(engineAllows({ id: "m", engine, modApi: 1 })).toBe(false);
      /* Still WRONG for a data pack, and still said - it just no longer takes
       * the pack with it. `4.2.x` in that field is an author confusing the
       * upstream release with the port's version, and they need telling. */
      expect(engineProblem({ id: "m", engine })?.why).toContain(engine);
    }
  });

  it("says nothing about a mod that declares no range", () => {
    expect(engineProblem({ id: "m" })).toBeNull();
  });

  it("attributes the refusal to the mod, unprefixed", () => {
    const r = engineProblem({ id: "old-mod", engine: NEVER });
    expect(r?.id).toBe("old-mod");
    expect(r?.why.startsWith("old-mod")).toBe(false);
  });
});

/* --- the gate is a gate for code and a label for data ---------------------- */

/**
 * RATIFIED DECISION 18 IS "THE ENGINE LABELS, IT DOES NOT FORBID", and until
 * 2026-08-02 this gate applied it backwards: it refused to load a pack of JSON
 * because of a string in its manifest. The author's range says what they TESTED.
 * Treating it as a demand means every content mod goes dark on an engine release
 * its author never saw, which is the cost this whole pass exists to remove.
 *
 * Code is the genuine exception: it calls functions, and a renamed function is a
 * crash rather than a missing tile.
 */
describe("an out-of-range engine blocks code and labels data", () => {
  it("blocks a pack that declares modApi, because that pack ships code", () => {
    expect(engineAllows({ id: "coded", engine: NEVER, modApi: MOD_API_VERSION })).toBe(false);
  });

  it("loads a pack with no modApi, and still says why it might misbehave", () => {
    expect(engineAllows({ id: "data", engine: NEVER })).toBe(true);
    expect(engineProblem({ id: "data", engine: NEVER })?.why).toContain(NEVER);
  });

  /* The two audiences can do two different things, so they must not be sent the
   * same sentence: a code pack's player is being told why it is NOT loading, and
   * a data pack's player is being told what to suspect if something looks off. */
  it("does not tell a data pack's player that something needs updating", () => {
    const data = engineProblem({ id: "data", engine: NEVER })?.why ?? "";
    const code = engineProblem({ id: "coded", engine: NEVER, modApi: 1 })?.why ?? "";
    expect(data).not.toMatch(/needs an update/u);
    expect(data).toContain("its data is loaded");
    expect(code).toMatch(/needs an update/u);
  });

  /* The plugin loader is holding a plugin.js it can SEE, and it runs the engine
   * gate before it checks whether modApi was declared at all - so a code pack
   * that omitted the field must not buy the lenient path with the omission. */
  it("blocks a code pack that forgot to declare modApi", () => {
    expect(engineAllows({ id: "forgot", engine: NEVER })).toBe(true);
    expect(engineBlocksCode({ id: "forgot", engine: NEVER })).not.toBeNull();
  });

  it("has nothing to say about either kind when the range fits", () => {
    const fits = `>=${ENGINE_VERSION}`;
    expect(engineProblem({ id: "data", engine: fits })).toBeNull();
    expect(engineBlocksCode({ id: "coded", engine: fits, modApi: 1 })).toBeNull();
  });
});

/* --- door 1: content ------------------------------------------------------- */

describe("door 1 - a content mod written for another build", () => {
  /* REVERSED 2026-08-02. This used to assert `not.toContain("Grip of stale")`:
   * a pack of JSON was refused outright over a string in its manifest. The pack
   * composes fine - that is the point - so now it loads and gets a line. */
  it("still contributes its records, because data is not what breaks", async () => {
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("stale", NEVER)));
    expect(monsterNames(pack)).toContain("Grip of stale");
  });

  it("still contributes when its range covers this build", async () => {
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("current", `>=${ENGINE_VERSION}`)));
    expect(monsterNames(pack)).toContain("Grip of current");
  });

  it("is in the present set, because its records ARE in the game", async () => {
    /* The quarantine hazard runs both ways, and the answer is the same either
     * way: `presentNamespaces` must agree with what actually composed, or
     * loadGame rehydrates entities against content that is not there - or
     * refuses to rehydrate entities against content that is. */
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("stale", NEVER)));
    expect(pack.presentNamespaces().has("stale")).toBe(true);
  });

  it("says why, on that mod's row", async () => {
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("stale", NEVER)));
    const why = problemsFor(pack.diskPackStatus().problems, "stale");
    expect(why.length).toBeGreaterThan(0);
    expect(why.join(" ")).toContain(NEVER);
    expect(why.join(" ")).toContain(ENGINE_VERSION);
  });

  /* Both packs patch the SAME record, so the surviving name IS the answer to
   * "did the out-of-range pack take part": load order decides it, and an
   * out-of-range label must not quietly demote a pack out of that contest. */
  it("takes part in the load order like any other pack, in both directions", async () => {
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("stale", NEVER), patchingPack("fine")));
    expect(monsterNames(pack)).toContain("Grip of fine");

    resetDiskPacks();
    setDiskPacks(folderWith(patchingPack("fine"), patchingPack("stale", NEVER)));
    expect(monsterNames(pack)).toContain("Grip of stale");
  });

  /* An unreadable range is the AUTHOR's error and must not be dressed as a version
   * mismatch: a player told "one of them needs an update" about a typo goes looking
   * for a mod release that will never come. It is still only a LABEL on a data
   * pack, for the same reason the mismatch is - nothing an author can write in
   * that field makes their JSON unloadable. */
  it("tells an author their range is unreadable, in different words", async () => {
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("typo", ">=banana")));
    const why = problemsFor(pack.diskPackStatus().problems, "typo").join(" ");
    expect(why).toContain("manifest");
    expect(why).toContain(">=banana");
    expect(monsterNames(pack)).toContain("Grip of typo");
  });
});

/* --- door 2: code ---------------------------------------------------------- */

describe("door 2 - a plugin written for another build", () => {
  const resolver: CodeUrlResolver = ((id: string, file: string) =>
    Promise.resolve(`mem://${id}/${file}`)) as CodeUrlResolver;

  function codePack(id: string, engine?: string): DiskPack {
    return {
      manifest: {
        id,
        name: id,
        version: "1.0.0",
        shape: "plugin",
        modApi: MOD_API_VERSION,
        ...(engine === undefined ? {} : { engine }),
      } as PackManifest,
      files: {},
      code: [PLUGIN_FILE],
      assets: [],
    };
  }

  it("is never imported - the gate runs before the module can execute", async () => {
    const importer = vi.fn(() =>
      Promise.resolve({ default: { api: MOD_API_VERSION, hooks: () => undefined } }),
    );
    const report = await loadModCode({
      packs: [codePack("stale", NEVER)],
      codeUrl: resolver,
      enabled: () => true,
      consented: () => [],
      importer,
    });
    expect(importer).not.toHaveBeenCalled();
    expect(report.plugins).toEqual([]);
    expect(report.problems.map((p) => p.id)).toEqual(["stale"]);
  });

  it("is a separate question from modApi - a plugin can pass one and fail the other", async () => {
    /* Both gates exist on purpose (manifest.ts documents why: a range over the game's
     * version, and an exact integer for an ABI that is unstable before 1.0). This
     * pins that neither one subsumes the other. */
    const importer = vi.fn(() =>
      Promise.resolve({ default: { api: MOD_API_VERSION, hooks: () => undefined } }),
    );
    const goodApiBadEngine = codePack("a", NEVER);
    const badApi = codePack("b");
    (badApi.manifest as { modApi?: number }).modApi = MOD_API_VERSION + 7;
    const report = await loadModCode({
      packs: [goodApiBadEngine, badApi],
      codeUrl: resolver,
      enabled: () => true,
      consented: () => [],
      importer,
    });
    expect(importer).not.toHaveBeenCalled();
    const why = new Map(report.problems.map((p) => [p.id, p.why]));
    expect(why.get("a")).toContain(NEVER);
    expect(why.get("a")).not.toContain("mod API");
    expect(why.get("b")).toContain("mod API");
    expect(why.get("b")).not.toContain(NEVER);
  });

  it("still imports a plugin whose range covers this build", async () => {
    const importer = vi.fn(() =>
      Promise.resolve({ default: { api: MOD_API_VERSION, hooks: () => undefined } }),
    );
    const report = await loadModCode({
      packs: [codePack("current", `>=${ENGINE_VERSION}`)],
      codeUrl: resolver,
      enabled: () => true,
      consented: () => [],
      importer,
    });
    expect(report.problems).toEqual([]);
    expect(report.plugins.map((p) => p.id)).toEqual(["current"]);
  });
});

/* --- door 3: tiles --------------------------------------------------------- */

describe("door 3 - a tiles mod written for another build", () => {
  /* grafID 1 is a catalogued tilesheet mode, so this pack is one the tiles path
   * WOULD otherwise accept - which is what makes the refusal meaningful. */
  function tilesManifest(engine?: string): unknown {
    return {
      id: "tiles-mod",
      name: "tiles-mod",
      version: "1.0.0",
      shape: "tiles",
      ...(engine === undefined ? {} : { engine }),
      tilePacks: [{ grafID: 101, path: "pack", engine: "linoleum", menuname: "Loose" }],
    };
  }

  /* REVERSED 2026-08-02, with the argument that used to be here answered rather
   * than dropped: yes, a stale mapping can draw the wrong tile or none. That is
   * a failure the player can SEE, on individual tiles, and the alternative is a
   * whole tileset going dark on an engine patch its author never saw. Pictures
   * are the least version-sensitive thing a mod ships. */
  it("still contributes its graphics mode, and is labelled instead", () => {
    const modes = enabledTileModes({
      manifests: new Map([["tiles-mod", tilesManifest(NEVER)]]),
      enabledIds: ["tiles-mod"],
    });
    expect(modes.map((m) => m.grafID)).toEqual([101]);
  });

  it("still contributes when its range covers this build", () => {
    const modes = enabledTileModes({
      manifests: new Map([["tiles-mod", tilesManifest(`>=${ENGINE_VERSION}`)]]),
      enabledIds: ["tiles-mod"],
    });
    expect(modes.map((m) => m.grafID)).toEqual([101]);
  });

  /* The collision the gate had to be written around: a tiles manifest carries
   * `engine` twice - a version range at the root, and a RENDERER name inside each
   * tilePacks entry. Handing the version gate "linoleum" would refuse every loose
   * pack there is. */
  it("does not mistake a tilePack's renderer for a version range", () => {
    const modes = enabledTileModes({
      manifests: new Map([["tiles-mod", tilesManifest()]]),
      enabledIds: ["tiles-mod"],
    });
    expect(modes.map((m) => m.engine)).toEqual(["linoleum"]);
  });
});

/* --- one rule, one sentence ------------------------------------------------ */

describe("a mod refused on two doors is reported once", () => {
  it("does not stack the same sentence per loader that reached it", async () => {
    const pack = await import("./pack");
    const hybrid: DiskPack = {
      manifest: {
        id: "both",
        name: "both",
        version: "1.0.0",
        shape: "content",
        facets: ["content", "plugin"],
        modApi: MOD_API_VERSION,
        engine: NEVER,
        dependencies: { core: "*" },
      } as PackManifest,
      files: { monster: { patches: {} } },
      code: [PLUGIN_FILE],
      assets: [],
    };
    setDiskPacks(folderWith(hybrid));
    const code = await loadModCode({
      packs: [hybrid],
      codeUrl: ((id: string, f: string) =>
        Promise.resolve(`mem://${id}/${f}`)) as CodeUrlResolver,
      enabled: () => true,
      consented: () => [],
      importer: () => Promise.resolve({ default: { api: MOD_API_VERSION } }),
    });
    const { setModCode } = await import("./mod-code");
    setModCode(code);
    /* Both loaders refused it and both said so - that is the design, so that neither
     * depends on the other having run. The aggregator is what makes it one line. */
    expect(code.problems.map((p) => p.id)).toEqual(["both"]);
    expect(problemsFor(pack.diskPackStatus().problems, "both")).toHaveLength(1);
  });
});

/* --- the shipped manifests ------------------------------------------------- */

describe("nothing this build ships is refused by its own gate", () => {
  it("the core content pack's engine range covers this build", async () => {
    const pack = await import("./pack");
    setDiskPacks(NO_DISK_PACKS);
    /* Core flows through the compose pipeline as pack zero and carries an `engine`
     * range of its own. If the port's version ever walks out of it, this is the test
     * that says so rather than the game shipping with no content. */
    expect(pack.diskPackStatus().problems.filter((p) => p.id === "core")).toEqual([]);
    expect(pack.presentNamespaces().has("core")).toBe(true);
  });
});

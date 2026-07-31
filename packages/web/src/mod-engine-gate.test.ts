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
import { engineAllows, engineRefusal } from "./mod-engine";
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
    expect(engineAllows({ id: "m", engine: `>=${ENGINE_VERSION}` })).toBe(true);
  });

  it("refuses a range over PARITY_BASELINE", () => {
    expect(engineAllows({ id: "m", engine: PARITY_BASELINE })).toBe(false);
    expect(engineAllows({ id: "m", engine: "4.2.x" })).toBe(false);
  });

  it("says nothing about a mod that declares no range", () => {
    expect(engineRefusal({ id: "m" })).toBeNull();
  });

  it("attributes the refusal to the mod, unprefixed", () => {
    const r = engineRefusal({ id: "old-mod", engine: NEVER });
    expect(r?.id).toBe("old-mod");
    expect(r?.why.startsWith("old-mod")).toBe(false);
  });
});

/* --- door 1: content ------------------------------------------------------- */

describe("door 1 - a content mod written for another build", () => {
  it("contributes no records", async () => {
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("stale", NEVER)));
    expect(monsterNames(pack)).not.toContain("Grip of stale");
    expect(monsterNames(pack)).toContain("Grip, Farmer Maggot's Dog");
  });

  it("still contributes when its range covers this build", async () => {
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("current", `>=${ENGINE_VERSION}`)));
    expect(monsterNames(pack)).toContain("Grip of current");
  });

  it("is kept OUT of the present set, so loadGame does not rehydrate against absent content", async () => {
    /* The mirror of the quarantine hazard. A refused mod's namespace being
     * "present" would tell loadGame its orphaned entities can come back - to
     * records that are not in the game, because the gate held the pack out. */
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("stale", NEVER)));
    expect(pack.presentNamespaces().has("stale")).toBe(false);
  });

  it("says why, on that mod's row", async () => {
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("stale", NEVER)));
    const why = problemsFor(pack.diskPackStatus().problems, "stale");
    expect(why.length).toBeGreaterThan(0);
    expect(why.join(" ")).toContain(NEVER);
    expect(why.join(" ")).toContain(ENGINE_VERSION);
  });

  it("costs that mod and not the game - a healthy mod beside it still loads", async () => {
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("stale", NEVER), patchingPack("fine")));
    const names = monsterNames(pack);
    expect(names).toContain("Grip of fine");
    expect(names).not.toContain("Grip of stale");
  });

  /* An unreadable range is the AUTHOR's error and must not be dressed as a version
   * mismatch: a player told "one of them needs an update" about a typo goes looking
   * for a mod release that will never come. */
  it("tells an author their range is unreadable, in different words", async () => {
    const pack = await import("./pack");
    setDiskPacks(folderWith(patchingPack("typo", ">=banana")));
    const why = problemsFor(pack.diskPackStatus().problems, "typo").join(" ");
    expect(why).toContain("manifest");
    expect(why).toContain(">=banana");
    expect(monsterNames(pack)).not.toContain("Grip of typo");
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

  it("contributes no graphics mode", () => {
    const modes = enabledTileModes({
      manifests: new Map([["tiles-mod", tilesManifest(NEVER)]]),
      enabledIds: ["tiles-mod"],
    });
    expect(modes).toEqual([]);
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

/**
 * The `[Mods enabled]` list, over mods that are really on disk.
 *
 * WHAT WENT WRONG. The list resolved a version out of the two PLUGIN registries
 * only (`discoverPlugins` / `discoverTrustedPlugins`, which glob the BUNDLED
 * agent entries under packages/web/mods/). A mod with no `plugin.js` is in
 * neither map, so every content-only mod - most of them, and all of the tutorial
 * ones - fell through to "(not installed)". Measured in the running desktop
 * build on 2026-08-20: two tutorial content packs installed, enabled, and
 * demonstrably composed (the debug object list offered `Padded Jerkin`, created
 * with the mod's own description), and the dump called both of them
 * "(not installed)".
 *
 * WHY IT IS TESTED HERE AND WITH REAL FOLDERS. The old code lived in main.ts,
 * the entry module, which no test can import - so nothing could see what it
 * returned, and a list that was wrong for every content-only mod stayed green.
 * And a fixture pack would not have caught it either: the bug was in WHICH
 * REGISTRY was asked, so the mods have to arrive the way a player's mods do,
 * through the game's own folder reader (`readModDir`) into the latched disk-pack
 * report. `samples/tutorials/` is used because those folders are the same bytes
 * the tutorials tell a reader to write (tutorial-mods.node.test.ts).
 *
 * WHAT THIS CANNOT PROVE: that the dump renders the block correctly - that is
 * charsheet.test.ts, over a supplied list. This is the supplier.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readModDir, resetDiskPacks, setDiskPacks } from "./disk-packs";
import type { ModDirEntry, ModDirSource } from "./disk-packs";
import { enabledModSummary, NOT_INSTALLED } from "./mod-summary";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const TUTORIALS = join(REPO, "samples", "tutorials");

/** A content-only tutorial pack, and one that also ships a `plugin.js`. */
const CONTENT_ONLY = "tutorial-02-add-an-item";
const WITH_CODE = "tutorial-05-hook-behaviour";

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Every file under one pack folder, by pack-relative path with `/` separators. */
function walk(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(root, path));
    else out.push(path);
  }
  return out;
}

const isCode = (path: string): boolean => /\.m?js$/u.test(path);
const isRecordFile = (path: string): boolean =>
  !path.includes("/") && path.toLowerCase().endsWith(".json");

/** `samples/tutorials/` served as a mods directory, as the desktop shell serves its own. */
function fsModsSource(root: string): ModDirSource {
  return {
    kind: "app",
    dir: () => root,
    list: async (): Promise<readonly ModDirEntry[]> =>
      readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => {
          const all = walk(join(root, e.name));
          return {
            id: e.name,
            files: all.filter(isRecordFile),
            code: all.filter(isCode),
            assets: all.filter((p) => !isCode(p) && !isRecordFile(p)),
          };
        }),
    readJson: async (id, file) => readJson(join(root, id, file)),
    order: async () => [],
  };
}

/** The version in a tutorial's own manifest.json - the answer the dump must print. */
function manifestVersion(id: string): string {
  const v = (readJson(join(TUTORIALS, id, "manifest.json")) as { version?: string }).version;
  /* A pack with no declared version would make every assertion below pass
   * against modManifest's "0.0.0" default rather than against a real value. */
  expect(v, `${id}/manifest.json must declare a version`).toMatch(/^\d+\.\d+\.\d+/u);
  return v!;
}

/**
 * Run `fn` with the enabled-mods key set to `ids`. The web tests run in node
 * with no localStorage, so stubbing the global is how a test drives the enabled
 * set through the REAL reader `enabledModSummary` calls.
 */
function withEnabled<T>(ids: readonly string[], fn: () => T): T {
  const map = new Map<string, string>([["neo:enabledMods", JSON.stringify(ids)]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  try {
    return fn();
  } finally {
    vi.unstubAllGlobals();
  }
}

afterEach(() => {
  resetDiskPacks();
  vi.unstubAllGlobals();
});

describe("enabledModSummary - the dump's [Mods enabled] list", () => {
  /** The tutorials in the mods directory, through the game's own reader. */
  async function latchTutorials(): Promise<void> {
    const report = await readModDir(fsModsSource(TUTORIALS));
    // Guards every assertion below from passing against an empty registry.
    expect(report.packs.map((p) => p.manifest.id)).toEqual(
      expect.arrayContaining([CONTENT_ONLY, WITH_CODE]),
    );
    setDiskPacks(report);
  }

  it("reports a CONTENT-ONLY mod with its real manifest version", async () => {
    await latchTutorials();
    /* The regression. This mod has no plugin.js at all, so it is in neither
     * plugin registry - which used to be the only two places asked. */
    const summary = withEnabled([CONTENT_ONLY], enabledModSummary);
    expect(summary).toEqual([{ id: CONTENT_ONLY, version: manifestVersion(CONTENT_ONLY) }]);
    expect(summary[0]?.version).not.toBe(NOT_INSTALLED);
  });

  it("reports a mod that DOES ship code the same way, from the same registry", async () => {
    await latchTutorials();
    /* A disk pack with a plugin.js is not in the bundled-agent maps either: they
     * glob packages/web/mods/, not the player's folder. So this was equally
     * broken, and it is the same one fix - not a content-only special case. */
    const summary = withEnabled([WITH_CODE], enabledModSummary);
    expect(summary).toEqual([{ id: WITH_CODE, version: manifestVersion(WITH_CODE) }]);
  });

  it("keeps the enabled ORDER, and versions every one of a mixed set", async () => {
    await latchTutorials();
    const ids = [WITH_CODE, CONTENT_ONLY];
    expect(withEnabled(ids, enabledModSummary)).toEqual(
      ids.map((id) => ({ id, version: manifestVersion(id) })),
    );
  });

  it("still says (not installed) for an id nothing resolves", async () => {
    await latchTutorials();
    /* The state this default exists for, and the reason the fix is a fallback
     * rather than a replacement: a mod turned on and then deleted, or one an
     * external manager listed and never deployed, has to keep its line. */
    const summary = withEnabled([CONTENT_ONLY, "no-such-mod"], enabledModSummary);
    expect(summary).toEqual([
      { id: CONTENT_ONLY, version: manifestVersion(CONTENT_ONLY) },
      { id: "no-such-mod", version: NOT_INSTALLED },
    ]);
  });

  it("is empty with nothing enabled, so a vanilla dump writes no block", () => {
    expect(withEnabled([], enabledModSummary)).toEqual([]);
  });

  it("survives a storage that throws, because a report is often filed BECAUSE it does", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(enabledModSummary()).toEqual([]);
  });
});

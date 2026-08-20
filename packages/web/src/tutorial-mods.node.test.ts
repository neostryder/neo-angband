/**
 * The six tutorial mods in `samples/tutorials/`, exercised as mods.
 *
 * WHY THIS EXISTS. A tutorial is a promise that if the reader types what is on
 * the page, the thing on the page happens. Documentation cannot keep that
 * promise on its own: a ref that stops resolving, a manifest field that becomes
 * required, a hook that is renamed - each of those breaks every tutorial that
 * used it, silently, and the first person to find out is a beginner who
 * concludes modding does not work. This project has shipped seams whose tests
 * were green while the shipped path did nothing (#245, #246, #247); a tutorial
 * is the same hazard aimed at the least forgiving audience.
 *
 * So the mods are not illustrative snippets pasted into prose. They are real
 * folders on disk, they are the SAME BYTES the tutorials tell the reader to
 * write, and here they are loaded by their real path, validated by the real
 * manifest validator, composed by the real loader against the REAL core content
 * pack, and - for the two that ship code - imported for real and folded through
 * the real `composeModHooks`. Nothing is mocked and no fixture stands in for
 * core, which is the point: `core:sword--dagger` has to be a ref that resolves
 * against the shipped game, not one that resolved when the tutorial was written.
 *
 * WHAT THIS CANNOT PROVE: that the change is visible on screen in a running
 * game. That needs the desktop build over CDP and is a separate claim. What it
 * does prove is that the data reaches the composed game in the shape the
 * tutorial says it will.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest, composeContentPacks } from "@rpgm-tools/neo-angband-mod-sdk";
import type { LoadedPack, PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { composeModHooks } from "@rpgm-tools/neo-angband-core";
import type { ModHooks } from "@rpgm-tools/neo-angband-core";
import { readModDir, type ModDirEntry, type ModDirSource } from "./disk-packs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const TUTORIALS = join(REPO, "samples", "tutorials");
const CORE_PACK = join(REPO, "packages", "content", "pack");

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

/**
 * `samples/tutorials/` served as a mods directory, in the shape the desktop
 * shell's own folder serves it.
 *
 * A `ModDirSource` knows only how to enumerate folders and read a file; every
 * rule about what a usable mod IS lives in `readModDir`, which is exactly why
 * this is worth building. See disk-packs.ts.
 */
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
    codeUrl: async (id, file) => pathToFileURL(join(root, id, file)).href,
  };
}

/**
 * A tutorial mod, read off disk exactly as the game's own folder reader would
 * see it: the manifest, plus every content file beside it keyed by its basename
 * (`object.json` -> the `object` record file), which is the convention
 * composeContentPacks expects.
 */
function loadTutorial(dir: string, contentFiles: readonly string[]): LoadedPack {
  const manifest = validateManifest(readJson(join(TUTORIALS, dir, "manifest.json")));
  const files: Record<string, unknown> = {};
  for (const f of contentFiles) files[f] = readJson(join(TUTORIALS, dir, `${f}.json`));
  return { manifest, files } as LoadedPack;
}

/**
 * The REAL core pack, restricted to the record files a tutorial touches.
 *
 * Restricted because composing all 40-odd files costs seconds per test and buys
 * nothing here - the claim under test is "this ref resolves against core's own
 * shipped data", and that is a property of the file the record lives in. These
 * are the bytes `packages/content/pack` ships, not a fixture written to agree.
 */
function corePack(files: readonly string[]): LoadedPack {
  const manifest: PackManifest = {
    id: "core",
    name: "Angband",
    version: "1.0.0",
    shape: "content",
  };
  const out: Record<string, unknown> = {};
  for (const f of files) out[f] = readJson(join(CORE_PACK, `${f}.json`));
  return { manifest, files: out } as LoadedPack;
}

/** Find one composed record by its `name`, failing loudly rather than returning undefined. */
function record(composed: ReturnType<typeof composeContentPacks>, file: string, name: string) {
  const recs = composed.records[file] as { name?: string }[] | undefined;
  const found = recs?.find((r) => r.name === name);
  expect(found, `no ${file} record named ${JSON.stringify(name)} after composition`).toBeDefined();
  return found as Record<string, unknown>;
}

/**
 * Every tutorial composes cleanly. A `problems` entry is how the loader reports
 * a ref that did not resolve, a field it dropped, or a dependency it refused -
 * all of which are silent at runtime and fatal to a tutorial.
 */
function expectNoProblems(composed: ReturnType<typeof composeContentPacks>): void {
  expect(composed.problems).toEqual([]);
}

describe("samples/tutorials - the mods the tutorials tell you to write", () => {
  describe("01 - tweak a value", () => {
    it("retunes core's own dagger, and touches nothing else in the file", () => {
      const core = corePack(["object"]);
      const before = (core.files["object"] as { records: { name: string }[] }).records.length;
      const composed = composeContentPacks([core, loadTutorial("tutorial-01-tweak-a-value", ["object"])]);
      expectNoProblems(composed);

      const dagger = record(composed, "object", "& Dagger~");
      expect((dagger["attack"] as Record<string, unknown>)["hd"]).toBe("1d6");
      expect(dagger["cost"]).toBe(300);

      /* A patch is not an addition: the file still holds exactly core's records. */
      expect((composed.records["object"] as unknown[]).length).toBe(before);
      /* And the ops that were not written are core's, untouched. */
      expect(dagger["weight"]).toBe(12);
    });
  });

  describe("02 - add an item", () => {
    it("adds one object core has never seen, leaving core's own count intact", () => {
      const core = corePack(["object"]);
      const before = (core.files["object"] as { records: unknown[] }).records.length;
      const composed = composeContentPacks([core, loadTutorial("tutorial-02-add-an-item", ["object"])]);
      expectNoProblems(composed);

      expect((composed.records["object"] as unknown[]).length).toBe(before + 1);
      const jerkin = record(composed, "object", "Padded Jerkin~");
      expect(jerkin["type"]).toBe("soft armor");
      expect((jerkin["armor"] as Record<string, unknown>)["ac"]).toBe(5);
    });
  });

  describe("03 - add a monster", () => {
    it("adds one monster, on a `base` core actually ships", () => {
      const core = corePack(["monster", "monster_base"]);
      const composed = composeContentPacks([core, loadTutorial("tutorial-03-add-a-monster", ["monster"])]);
      expectNoProblems(composed);

      const ant = record(composed, "monster", "carpenter ant");
      expect(ant["depth"]).toBe(2);

      /* The one way this record can be wrong without any loader complaining: a
       * `base` that names nothing. A monster whose base does not exist is not a
       * broken ref, it is a monster with no template, so nothing above catches
       * it and the tutorial's reader gets a game that fails at generation. */
      const bases = (core.files["monster_base"] as { records: { name: string }[] }).records;
      expect(bases.map((b) => b.name)).toContain(ant["base"]);
    });
  });

  describe("04 - change a spell", () => {
    it("retunes the Priest's third first-book spell, and it is still Minor Healing", () => {
      const core = corePack(["class"]);
      const composed = composeContentPacks([core, loadTutorial("tutorial-04-change-a-spell", ["class"])]);
      expectNoProblems(composed);

      const priest = record(composed, "class", "Priest");
      const book = (priest["book"] as { spell: Record<string, unknown>[] }[])[0]!;
      const spell = book.spell[2]!;

      /* The INDEX is the fragile half of this tutorial and the reason the
       * assertion names the spell too: `book.0.spell.2` is a position, so if
       * core ever reorders that book the patch lands on a different spell and
       * every number below still passes. Naming it is what makes this test able
       * to fail for the reason the tutorial would be wrong. */
      expect(spell["name"]).toBe("Minor Healing");
      expect(spell["mana"]).toBe(1);
      expect(spell["fail"]).toBe(5);
    });
  });

  describe("05 - hook behaviour", () => {
    it("really imports plugin.js and its hook restates the level-up message", async () => {
      const dir = join(TUTORIALS, "tutorial-05-hook-behaviour");
      validateManifest(readJson(join(dir, "manifest.json")));

      const mod = (await import(pathToFileURL(join(dir, "plugin.js")).href)) as {
        default: { api: number; hooks(ctx: { flags: Record<string, boolean> }): ModHooks };
      };
      expect(mod.default.api).toBe(1);

      const hooks = composeModHooks([mod.default.hooks({ flags: {} })]);
      expect(hooks?.messageText).toBeTypeOf("function");
      expect(hooks!.messageText!("Welcome to level 7.")).toBe(
        "Congratulations! Welcome to level 7.",
      );

      /* The half a beginner gets wrong: a message hook sees EVERY message, so
       * one that forgets to return `raw` unchanged eats the rest of the game. */
      expect(hooks!.messageText!("You have 3 Flasks of oil (e).")).toBe(
        "You have 3 Flasks of oil (e).",
      );
    });
  });

  describe("06 - add an option", () => {
    it("supplies no hook at all while the player's toggle is off", async () => {
      const dir = join(TUTORIALS, "tutorial-06-add-an-option");
      const manifest = validateManifest(readJson(join(dir, "manifest.json")));

      /* The flag the code reads has to be a flag the manifest declares, or the
       * host resolves nothing and the option silently never turns on. */
      const flags = (manifest as unknown as { rules?: { flag: string; default?: boolean }[] })
        .rules;
      expect(flags?.map((r) => r.flag)).toEqual(["tutorial-06-add-an-option.congratulate"]);
      /* Every toggle ships off - the project's rule for restored or added
       * behaviour, and the tutorial teaches it by doing it. */
      expect(flags?.every((r) => r.default === false)).toBe(true);

      const mod = (await import(pathToFileURL(join(dir, "plugin.js")).href)) as {
        default: { api: number; hooks(ctx: { flags: Record<string, boolean> }): ModHooks };
      };

      /* Off: not "a hook that returns the input", but NO hook - so core's own
       * path runs untouched. composeModHooks returns undefined for an empty set,
       * which is the observable form of that claim. */
      expect(composeModHooks([mod.default.hooks({ flags: {} })])).toBeUndefined();
      expect(
        composeModHooks([
          mod.default.hooks({ flags: { "tutorial-06-add-an-option.congratulate": false } }),
        ]),
      ).toBeUndefined();

      const on = composeModHooks([
        mod.default.hooks({ flags: { "tutorial-06-add-an-option.congratulate": true } }),
      ]);
      expect(on!.messageText!("Welcome to level 7.")).toBe("Congratulations! Welcome to level 7.");
    });
  });

  describe("all six", () => {
    const ALL = [
      "tutorial-01-tweak-a-value",
      "tutorial-02-add-an-item",
      "tutorial-03-add-a-monster",
      "tutorial-04-change-a-spell",
      "tutorial-05-hook-behaviour",
      "tutorial-06-add-an-option",
    ] as const;

    it("pass the real manifest validator, and each has a tutorial page", () => {
      for (const dir of ALL) {
        expect(() => validateManifest(readJson(join(TUTORIALS, dir, "manifest.json")))).not.toThrow();
        /* A tutorial mod with no tutorial is the rot this file exists to catch,
         * running in the other direction. The page keeps the bare `NN-name`
         * form; the FOLDER cannot, because a mod id may not begin with a digit
         * and the folder name has to be the id (below). */
        const page = join(REPO, "docs", "modding", "tutorials", `${dir.slice("tutorial-".length)}.md`);
        expect(() => readFileSync(page, "utf8"), `missing tutorial page for ${dir}`).not.toThrow();
      }
    });

    /**
     * The check that the rest of this file cannot make, and the one a reader
     * actually depends on: that these folders can be DROPPED INTO A MODS FOLDER
     * AND INSTALLED.
     *
     * Everything above reads the manifests and record files directly and hands
     * them to the composer, which is a fair test of the CONTENT and a blind one
     * about the PACKAGING. `readModDir` is the whole definition of a usable mod
     * folder and it runs identically on the desktop shell and in a browser tab
     * (disk-packs.ts), so it enforces rules no composition test can see - most
     * sharply that the folder name and the manifest id must agree.
     *
     * That is not hypothetical. These six shipped as `01-tweak-a-value` holding
     * an id of `tutorial-tweak-a-value`, every composition test above was green,
     * and all six would have been refused by the game with "rename the folder to
     * match". A tutorial whose finished mod does not install is worse than no
     * tutorial, so the packaging gets a test of its own.
     */
    it("are accepted by the game's own mods-folder reader, packaging and all", async () => {
      const report = await readModDir(fsModsSource(TUTORIALS));

      expect(report.problems).toEqual([]);
      expect(report.packs.map((p) => p.manifest.id).sort()).toEqual([...ALL].sort());

      /* And the two code mods arrive WITH their code: a plugin the reader is
       * told to write, listed by the reader that has to find it. */
      for (const id of ["tutorial-05-hook-behaviour", "tutorial-06-add-an-option"]) {
        const pack = report.packs.find((p) => p.manifest.id === id);
        expect(pack?.code, `${id} lost its plugin.js`).toContain("plugin.js");
      }
    });
  });
});

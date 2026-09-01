/**
 * The eight tutorial mods in `samples/tutorials/`, exercised as mods.
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
 * pack, and - for code mods - imported for real and run through their real hook
 * or registry path. Nothing is mocked and no fixture stands in for
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
import {
  CapabilitySet,
  validateManifest,
  composeContentPacks,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { LoadedPack, PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  bindConstants,
  composeModHooks,
  createModRegistryHost,
  ObjRegistry,
  objectPrep,
  registerCoreStoreBehaviour,
  Rng,
  StoreBehaviourRegistry,
  StoreRegistry,
  TV,
} from "@rpgm-tools/neo-angband-core";
import type { ModHooks, StoreWillBuyContext } from "@rpgm-tools/neo-angband-core";
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

/**
 * Core's object-pack files OTHER than `object` itself, which the store test
 * replaces with the composed one. An ObjRegistry needs the whole set - egos,
 * curses, brands, properties - because binding a kind resolves against all of
 * them, so a store test cannot get away with the one file it cares about.
 */
function objPackFiles(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const files = {
    objectBase: "object_base",
    egoItem: "ego_item",
    artifact: "artifact",
    curse: "curse",
    brand: "brand",
    slay: "slay",
    activation: "activation",
    objectProperty: "object_property",
    flavor: "flavor",
  } as const;
  for (const [key, file] of Object.entries(files)) {
    out[key] = readJson(join(CORE_PACK, `${file}.json`));
  }
  return out;
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

    /**
     * And that the item can be BOUGHT, not only generated.
     *
     * An added item with an `alloc` block turns up in the dungeon for free, but
     * a store stocks only what its own table names, so "does my item exist" and
     * "can a player ever see it" are two different questions - and the second
     * one is the one that makes an item mod feel finished. The tutorial appends
     * the jerkin to the Armoury's `normal` table, which is the case the
     * `append` op was added for: two mods can each add a line to that list and
     * neither has to restate it.
     *
     * This binds for real rather than reading the composed JSON, because the
     * store binder is where an item name that does not resolve becomes an
     * error - `lookupSval` miss throws "unknown sval". Reading the JSON back
     * would assert only that the text I wrote is the text I wrote.
     */
    it("puts the item in the Armoury's stock table, resolved to a real kind", () => {
      const core = corePack(["object", "store"]);
      const composed = composeContentPacks([
        core,
        loadTutorial("tutorial-02-add-an-item", ["object", "store"]),
      ]);
      expectNoProblems(composed);

      const reg = new ObjRegistry({
        ...(objPackFiles() as object),
        object: { records: composed.records["object"] },
      } as never);
      const storeReg = new StoreRegistry(
        composed.records["store"] as never[],
        reg,
      );

      const armoury = storeReg.stores.find((s) => s.featName === "STORE_ARMOR");
      expect(armoury, "the composed pack lost the Armoury").toBeDefined();

      /* Resolved the way the store binder resolves it, and compared by
       * identity, so this cannot pass on a name that merely looks right. */
      const sval = reg.lookupSval(TV.SOFT_ARMOR, "Padded Jerkin");
      expect(sval, "the jerkin did not reach the object registry").toBeGreaterThan(-1);
      const kind = reg.lookupKind(TV.SOFT_ARMOR, sval);
      expect(
        armoury!.normalTable,
        "the Armoury's normal table does not stock the tutorial's item",
      ).toContain(kind);

      /*
       * And core's own stock survived: exactly one entry longer than the same
       * store bound with no mod at all. Derived from core's own data rather
       * than a written-in number, because the count that matters is "core's
       * list, plus mine" - a `set` that replaced the list would pass a
       * `toContain` check and fail this one.
       */
      const bare = new StoreRegistry(
        (corePack(["store"]).files["store"] as { records: never[] }).records,
        new ObjRegistry({
          ...(objPackFiles() as object),
          object: readJson(join(CORE_PACK, "object.json")),
        } as never),
      );
      const bareArmoury = bare.stores.find((s) => s.featName === "STORE_ARMOR");
      expect(armoury!.normalTable.length).toBe(bareArmoury!.normalTable.length + 1);
      /* And nothing was refused, which is the denominator for the test below. */
      expect(storeReg.refused).toEqual([]);
    });

    /**
     * And that the SHOP LINE OUTLIVING THE ITEM costs one line, not the game.
     *
     * This is the same tutorial's own store patch with its `object.json`
     * withheld, which is not a contrived pack - it is what the player assembles
     * by installing two mods and turning one off. Splitting an item mod's
     * records across two packs is the recommended shape (`dependencies`), the
     * `append` op exists precisely so mod A can stock mod B's item, and nothing
     * anywhere makes disabling B refuse while A is on.
     *
     * Before this was fixed, `bindStore` threw `store: unknown sval` from inside
     * `bindCore` -> `startGame`, which the host runs at module top level: the
     * player got the crash screen and no game at all, over one line of one
     * shop's stock table. The resilience contract's whole claim is that a mod's
     * mistake degrades, so what has to be true is BOTH halves - a fault the
     * manager can attribute, and a store that is otherwise exactly itself.
     */
    it("survives the store patch with the item's own pack absent", () => {
      /* The tutorial's `store` file only. Its `object` file is the one being
       * withheld, so the jerkin never reaches the object registry. */
      const composed = composeContentPacks([
        corePack(["object", "store"]),
        loadTutorial("tutorial-02-add-an-item", ["store"]),
      ]);
      /* The COMPOSER is not where this is caught, and that is the point: the
       * fieldPatch targets a store core really has, and a stock entry is not a
       * ref, so composition is clean and the binder is the first reader that
       * can possibly know. */
      expectNoProblems(composed);

      const reg = new ObjRegistry({
        ...(objPackFiles() as object),
        object: readJson(join(CORE_PACK, "object.json")),
      } as never);
      expect(
        reg.lookupSval(TV.SOFT_ARMOR, "Padded Jerkin"),
        "the item's pack was supposed to be absent",
      ).toBe(-1);

      /* Binds at all - this is the assertion the whole fix is about. */
      const storeReg = new StoreRegistry(composed.records["store"] as never[], reg);

      /* One fault, on the mod that appended the line, naming the line. */
      expect(storeReg.refused.length).toBe(1);
      const fault = storeReg.refused[0]!;
      expect(fault.id).toBe("tutorial-02-add-an-item");
      expect(fault.record).toBe("STORE_ARMOR");
      expect(fault.field).toBe("normal");
      expect(fault.why).toContain("Padded Jerkin");

      /* And the Armoury is otherwise EXACTLY itself. Derived from the same store
       * bound with no mod at all rather than from a written-in number, so a
       * binder that quietly emptied the table would fail here. */
      const bare = new StoreRegistry(
        (corePack(["store"]).files["store"] as { records: never[] }).records,
        reg,
      );
      const before = bare.stores.find((s) => s.featName === "STORE_ARMOR")!;
      const after = storeReg.stores.find((s) => s.featName === "STORE_ARMOR")!;
      expect(after.normalTable.map((k) => k.name)).toEqual(
        before.normalTable.map((k) => k.name),
      );
      expect(after.alwaysTable.map((k) => k.name)).toEqual(
        before.alwaysTable.map((k) => k.name),
      );
      expect(after.buy!.length).toBe(before.buy!.length);
      expect(after.owners.length).toBe(before.owners.length);

      /* And every other shop in town, which is the half of "degrade" that a
       * per-record assertion cannot see. */
      expect(storeReg.stores.length).toBe(bare.stores.length);
      for (const store of bare.stores) {
        if (store.featName === "STORE_ARMOR") continue;
        const same = storeReg.stores.find((s) => s.featName === store.featName)!;
        expect(same.normalTable.length).toBe(store.normalTable.length);
        expect(same.alwaysTable.length).toBe(store.alwaysTable.length);
      }
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

    /*
     * The mirror of tutorial 1, on a monster: the same file both ADDS a record
     * and patches an existing one, which is the half of "creature modification"
     * that adding an ant does not demonstrate. Asserted on relative values, so
     * this test says what the tutorial says - three MORE hit points, and a flag
     * ADDED to whatever core already had - rather than pinning core's numbers.
     */
    it("also patches a core monster, relative to core's own values", () => {
      const core = corePack(["monster", "monster_base"]);
      const before = (
        core.files["monster"] as { records: { name: string; "hit-points": number; flags?: string[] }[] }
      ).records.find((r) => r.name === "giant black ant")!;
      const composed = composeContentPacks([core, loadTutorial("tutorial-03-add-a-monster", ["monster"])]);
      expectNoProblems(composed);

      const patched = record(composed, "monster", "giant black ant");
      expect(patched["hit-points"]).toBe(before["hit-points"] + 3);
      /* Added, not replaced: core's own flags are all still there. */
      expect(patched["flags"]).toEqual([...(before.flags ?? []), "GROUP_AI"]);
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

  describe("07 - add an artifact", () => {
    /** The real object registry, with the composed artifact file swapped in. */
    function objReg(artifacts: unknown) {
      return new ObjRegistry({
        ...(objPackFiles() as object),
        object: readJson(join(CORE_PACK, "object.json")),
        artifact: artifacts,
      } as never);
    }

    /**
     * Bound, not read back. An artifact record is almost entirely NUMBERS
     * ADJUSTING A KIND THAT HAS TO EXIST, so the only reader that can say the
     * record is real is the binder: reading the composed JSON would assert that
     * the text I wrote is the text I wrote, and would pass just as happily on a
     * `base-object` naming a shield the game does not have.
     */
    it("adds one artifact, standing on a base kind core actually ships", () => {
      const core = corePack(["artifact"]);
      const before = (core.files["artifact"] as { records: unknown[] }).records.length;
      const composed = composeContentPacks([
        core,
        loadTutorial("tutorial-07-add-an-artifact", ["artifact"]),
      ]);
      expectNoProblems(composed);
      expect((composed.records["artifact"] as unknown[]).length).toBe(before + 1);

      const reg = objReg({ records: composed.records["artifact"] });
      /* Nothing refused: the denominator for the resilience test below. */
      expect(reg.refused).toEqual([]);

      const art = reg.artifacts.find((a) => a?.name === "of the Watchful Eye");
      expect(art, "the tutorial's artifact did not reach the registry").toBeDefined();

      /* Its base resolved to a REAL kind, compared by identity against the same
       * lookup the binder used, so an sval that merely looks right cannot pass.
       * A miss here would not have thrown: an unresolved sval gets a dummy kind
       * (write_dummy_object_record), which silently turns the artifact into a
       * special one standing on a base object that does not exist. */
      const sval = reg.lookupSval(TV.SHIELD, "Leather Shield");
      expect(sval).toBeGreaterThan(-1);
      expect(art!.sval).toBe(sval);
      expect(reg.lookupKind(TV.SHIELD, sval)).toBeDefined();

      expect(art!.toA).toBe(10);
      expect(art!.level).toBe(12);
    });

    /**
     * And it patches a core artifact relative to core's own value, the same way
     * tutorial 3 patches a core monster: three MORE points of armour than
     * whatever Angrist ships with, not a pinned number of its own.
     */
    it("also patches a core artifact, relative to core's own value", () => {
      const core = corePack(["artifact"]);
      const bare = objReg(core.files["artifact"]);
      const beforeToA = bare.artifacts.find((a) => a?.name === "'Angrist'")!.toA;

      const composed = composeContentPacks([
        core,
        loadTutorial("tutorial-07-add-an-artifact", ["artifact"]),
      ]);
      expectNoProblems(composed);
      const reg = objReg({ records: composed.records["artifact"] });
      expect(reg.artifacts.find((a) => a?.name === "'Angrist'")!.toA).toBe(beforeToA + 3);
    });

    /**
     * And the mistake this tutorial's reader is most likely to make - a
     * `base-object` naming an item type that is not there - costs the artifact
     * and not the game.
     *
     * This is the store binder's defect in a third file (mod/refusal.ts), and the
     * first where the right size of the drop is the WHOLE RECORD: an artifact
     * with no base kind is not a degraded artifact, it is not one at all. The
     * fixture is this tutorial's own record with one field spoiled, carrying the
     * provenance the composer stamped on it, because the whole question is
     * whether the binder can tell a mod's mistake from core's.
     */
    it("drops a mod's artifact whose base-object is not there, and keeps every other", () => {
      const core = corePack(["artifact"]);
      const coreCount = (core.files["artifact"] as { records: unknown[] }).records.length;
      const composed = composeContentPacks([
        core,
        loadTutorial("tutorial-07-add-an-artifact", ["artifact"]),
      ]);
      const records = (composed.records["artifact"] as Record<string, unknown>[]).map((r) =>
        r["name"] === "of the Watchful Eye"
          ? { ...r, "base-object": { tval: "xyzzy", sval: "Leather Shield" } }
          : r,
      );

      const reg = objReg({ records });

      /* One fault, on the mod that wrote the record, naming the record. */
      expect(reg.refused.length).toBe(1);
      const fault = reg.refused[0]!;
      expect(fault.file).toBe("artifact");
      expect(fault.record).toBe("of the Watchful Eye");
      expect(fault.field).toBe("base-object");
      expect(fault.id).toBe("tutorial-07-add-an-artifact");
      expect(fault.why).toContain("xyzzy");

      /* And every artifact core ships is still there, still numbered. Derived
       * from core's own data rather than a written-in number, and checked by
       * aidx as well as by presence, because a binder that dropped the record
       * but left its slot would pass a count check and hand out a null. */
      const bare = objReg(core.files["artifact"]);
      expect(reg.artifacts.length).toBe(coreCount + 1);
      for (const art of bare.artifacts) {
        if (!art) continue;
        const same = reg.artifacts[art.aidx];
        expect(same?.name, `core artifact ${art.name} moved or vanished`).toBe(art.name);
      }

      /* And no orphan kind was left behind by the dropped record. An unresolved
       * sval appends a dummy object kind before the tval is ever questioned, so
       * a drop that forgot to unwind would leave an INSTA_ART kind in the object
       * list with no artifact pointing at it. */
      expect(reg.kinds.length).toBe(bare.kinds.length);
    });

    /**
     * CORE'S OWN still fails loudly, which is the half that makes the above a
     * fix rather than a blanket suppression. Same spoiled field, no provenance,
     * and no provenance is exactly what an unmodded boot looks like.
     */
    it("still throws for core's own broken base-object", () => {
      const core = corePack(["artifact"]);
      const recs = (core.files["artifact"] as { records: Record<string, unknown>[] }).records.map(
        (r, i) => (i === 0 ? { ...r, "base-object": { tval: "xyzzy", sval: "Phial" } } : r),
      );
      expect(() => objReg({ records: recs })).toThrow(/unknown tval xyzzy/u);
    });
  });

  describe("08 - add a store", () => {
    it("renames and redescribes core's Black Market entrance, leaving every other field alone", () => {
      const core = corePack(["terrain"]);
      const before = (core.files["terrain"] as { records: Record<string, unknown>[] }).records.find(
        (r) => r["name"] === "Black Market",
      );
      expect(before, "core no longer has a Black Market entrance").toBeDefined();

      const composed = composeContentPacks([
        core,
        loadTutorial("tutorial-08-add-a-store", ["terrain"]),
      ]);
      expectNoProblems(composed);
      const exchange = (composed.records["terrain"] as Record<string, unknown>[]).find(
        (r) => r["name"] === "Adventurer's Exchange",
      );
      expect(exchange, "the tutorial did not rename the Black Market").toBeDefined();
      expect(exchange!["desc"]).toEqual([
        "A practical shop for people who expect to come back from the dungeon.",
      ]);

      /* This is a field patch, not a new terrain record: restoring its two
       * written fields yields the exact core entrance, glyph, flags and all. */
      const { $from: _provenance, ...fields } = exchange!;
      expect({ ...fields, name: before!["name"], desc: before!["desc"] }).toEqual(before);
    });

    it("replaces the Black Market's table with real, bound store data", () => {
      const core = corePack(["store"]);
      const composed = composeContentPacks([
        core,
        loadTutorial("tutorial-08-add-a-store", ["store"]),
      ]);
      expectNoProblems(composed);

      const reg = new ObjRegistry({
        ...(objPackFiles() as object),
        object: readJson(join(CORE_PACK, "object.json")),
      } as never);
      const stores = new StoreRegistry(composed.records["store"] as never[], reg);
      expect(stores.refused).toEqual([]);
      const exchange = stores.byName("STORE_BLACK");
      expect(exchange, "the composed pack lost the Black Market").toBeDefined();

      const kind = (tval: number, sval: string) => {
        const sidx = reg.lookupSval(tval, sval);
        expect(sidx, `core has no ${sval}`).toBeGreaterThan(-1);
        const result = reg.lookupKind(tval, sidx);
        expect(result, `core did not bind ${sval}`).toBeDefined();
        return result!;
      };

      /* This invokes StoreRegistry's real item binding: these are the actual
       * ObjectKind identities a running Exchange will stock, not JSON text. */
      expect(exchange!.owners).toEqual([
        { index: 0, maxCost: 12000, name: "Rilla the Well-Prepared (Dwarf)" },
        { index: 1, maxCost: 18000, name: "Nori the Far-Walker (Human)" },
      ]);
      expect(exchange!.normalStockMin).toBe(5);
      expect(exchange!.normalStockMax).toBe(10);
      expect(exchange!.turnover).toBe(6);
      expect(exchange!.normalTable).toEqual([
        kind(TV.DIGGING, "Shovel"),
        kind(TV.DIGGING, "Pick"),
        kind(TV.LIGHT, "Wooden Torch"),
        kind(TV.FLASK, "Flask of Oil"),
        kind(TV.CLOAK, "Cloak"),
      ]);
      expect(exchange!.alwaysTable).toEqual([
        kind(TV.FOOD, "Ration of Food"),
        kind(TV.DIGGING, "Shovel"),
      ]);
      expect(exchange!.buy).toEqual([
        { tval: TV.DIGGING, flag: 0 },
        { tval: TV.LIGHT, flag: 0 },
        { tval: TV.FLASK, flag: 0 },
        { tval: TV.CLOAK, flag: 0 },
      ]);
    });

    it("imports its plugin and buys enchanted swords while retaining core's ordinary rule", async () => {
      const composed = composeContentPacks([
        corePack(["store"]),
        loadTutorial("tutorial-08-add-a-store", ["store"]),
      ]);
      expectNoProblems(composed);
      const reg = new ObjRegistry({
        ...(objPackFiles() as object),
        object: readJson(join(CORE_PACK, "object.json")),
      } as never);
      const storeReg = new StoreRegistry(composed.records["store"] as never[], reg);
      expect(storeReg.refused).toEqual([]);
      const exchange = storeReg.byName("STORE_BLACK");
      expect(exchange).toBeDefined();

      const mod = (await import(
        pathToFileURL(join(TUTORIALS, "tutorial-08-add-a-store", "plugin.js")).href
      )) as {
        default: {
          api: number;
          register(
            host: ReturnType<typeof createModRegistryHost>,
            ctx: { registries: { stores: StoreRegistry }; core: { TV: typeof TV } },
          ): void;
        };
      };
      expect(mod.default.api).toBe(1);

      const behaviour = new StoreBehaviourRegistry();
      registerCoreStoreBehaviour(behaviour);
      const host = createModRegistryHost(
        { stores: behaviour },
        CapabilitySet.fromManifest(
          validateManifest(readJson(join(TUTORIALS, "tutorial-08-add-a-store", "manifest.json"))),
        ),
      );
      mod.default.register(host, { registries: { stores: storeReg }, core: { TV } });

      const daggerSval = reg.lookupSval(TV.SWORD, "Dagger");
      expect(daggerSval, "core has no Dagger").toBeGreaterThan(-1);
      const daggerKind = reg.lookupKind(TV.SWORD, daggerSval);
      expect(daggerKind).toBeDefined();
      const constants = bindConstants(readJson(join(CORE_PACK, "constants.json")) as never);
      const plainDagger = objectPrep(new Rng(7), reg, constants, daggerKind!, 0, "minimise");
      const enchantedDagger = objectPrep(new Rng(8), reg, constants, daggerKind!, 0, "minimise");
      enchantedDagger.toH = 1;
      const willBuyContext = (obj: typeof plainDagger): StoreWillBuyContext => ({
        reg,
        store: exchange!,
        obj,
        aware: true,
        noSelling: false,
        runesKnown: true,
        flagKnown: () => false,
      });

      const coreWillBuy = behaviour.willBuyFor("*");
      const exchangeWillBuy = behaviour.willBuyFor(exchange!.feat);
      expect(coreWillBuy).not.toBeNull();
      expect(exchangeWillBuy).not.toBeNull();
      expect(coreWillBuy!(willBuyContext(plainDagger))).toBe(false);
      expect(exchangeWillBuy!(willBuyContext(plainDagger))).toBe(
        coreWillBuy!(willBuyContext(plainDagger)),
      );
      expect(exchangeWillBuy!(willBuyContext(enchantedDagger))).toBe(true);
    });
  });

  describe("all eight", () => {
    const ALL = [
      "tutorial-01-tweak-a-value",
      "tutorial-02-add-an-item",
      "tutorial-03-add-a-monster",
      "tutorial-04-change-a-spell",
      "tutorial-05-hook-behaviour",
      "tutorial-06-add-an-option",
      "tutorial-07-add-an-artifact",
      "tutorial-08-add-a-store",
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

      /* And the three code mods arrive WITH their code: a plugin the reader is
       * told to write, listed by the reader that has to find it. */
      for (const id of [
        "tutorial-05-hook-behaviour",
        "tutorial-06-add-an-option",
        "tutorial-08-add-a-store",
      ]) {
        const pack = report.packs.find((p) => p.manifest.id === id);
        expect(pack?.code, `${id} lost its plugin.js`).toContain("plugin.js");
      }
    });
  });
});

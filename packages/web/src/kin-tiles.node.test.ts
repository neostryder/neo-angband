/**
 * `fillTilesFromKin` against REAL tile packs and REAL game data.
 *
 * WHY THIS EXISTS. The kin fill is a write into the tile map that nobody asked
 * for, which makes it exactly the kind of helpful behaviour that quietly
 * changes what a player sees. Two claims have to hold, and only one of them can
 * be reasoned about from the code:
 *
 *   1. It gives an ADDED monster or item a tile that belongs to its family, so
 *      a mod's content is not a coloured glyph standing in a tiled dungeon.
 *   2. It changes NOTHING about how core's own content draws.
 *
 * The second is the dangerous one, and writing this file is what established
 * how it has to be earned. The first version of the fill supplied a tile to
 * ANY entity the pack had left blank, on the assumption that a shipped pack
 * draws everything core ships. Run against the real packs, it filled 49 object
 * kinds and 14 monsters of core's own content - because rings, amulets,
 * mushrooms and food are drawn by FLAVOUR and their kind slots are empty on
 * purpose, and because adam-bolt predates 19 of the monsters and several of the
 * items the game now ships. Both of those are cases where a glyph is the honest
 * answer and a sibling's tile is a lie.
 *
 * So the fill is restricted to records a mod ADDED, by provenance, and claim 2
 * holds by construction rather than by hoping. These tests still run every pack
 * and still assert zero core fills - now as a check on the restriction rather
 * than on the packs - and they assert the pack really loaded first, because an
 * empty map fills nothing and would pass the same assertion for the opposite
 * reason. That is not hypothetical either: `traps: null` in this file's own deps
 * stopped the parser 200 lines above the monster block and made every
 * measurement here vacuous until it was found.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bindTraps,
  FeatureRegistry,
  fillTilesFromKin,
  MonsterRegistry,
  ObjRegistry,
  parseTilePrefsInto,
  TileMap,
} from "@rpgm-tools/neo-angband-core";
import type { TilePrefsDeps } from "@rpgm-tools/neo-angband-core";
import { composeContentPacks, validateManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { LoadedPack, PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  deriveKinSlots,
  LINOLEUM_DERIVED_HUES,
  slotFromAtlas,
  slotToAtlas,
  type LinoleumSlot,
} from "./linoleum-pack";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CORE_PACK = join(REPO, "packages", "content", "pack");
const TILES = join(REPO, "packages", "web", "public", "tiles");
const TUTORIALS = join(REPO, "samples", "tutorials");

const readJson = (path: string): never => JSON.parse(readFileSync(path, "utf8")) as never;
const packFile = (name: string): never => readJson(join(CORE_PACK, `${name}.json`));
/** The monster binder takes bare record ARRAYS where the object binder takes files. */
const packRecords = (name: string): never =>
  (packFile(name) as unknown as { records: never }).records;

/** Core's monster registry, optionally over composed (modded) monster records. */
function monsterRegistry(monsters?: unknown): MonsterRegistry {
  return new MonsterRegistry({
    pain: packRecords("pain"),
    blowMethods: packRecords("blow_methods"),
    blowEffects: packRecords("blow_effects"),
    monsterSpells: packRecords("monster_spell"),
    monsterBases: packRecords("monster_base"),
    monsters: (monsters ?? packRecords("monster")) as never,
    summons: packRecords("summon"),
    pits: packRecords("pit"),
  } as never);
}

/** Core's object registry, optionally over composed (modded) object records. */
function objRegistry(objects?: unknown): ObjRegistry {
  return new ObjRegistry({
    objectBase: packFile("object_base"),
    object: (objects ?? packFile("object")) as never,
    egoItem: packFile("ego_item"),
    artifact: packFile("artifact"),
    curse: packFile("curse"),
    brand: packFile("brand"),
    slay: packFile("slay"),
    activation: packFile("activation"),
    objectProperty: packFile("object_property"),
    flavor: packFile("flavor"),
  } as never);
}

function deps(mon: MonsterRegistry, obj: ObjRegistry): TilePrefsDeps {
  return {
    /* A real feature registry rather than a stub: the packs' graf files are
     * mostly `feat:` lines, and a stub that answers "no such feature" would
     * make this a test of a half-parsed pack. */
    features: new FeatureRegistry(packRecords("terrain")),
    objects: obj,
    monsters: mon,
    /*
     * REAL traps, and this is the trap in writing the test. The parse loop
     * stops at the first line it cannot resolve and silently drops everything
     * below - so `traps: null` failed on the first `trap:` line, two hundred
     * lines above the monster block, and produced a completely EMPTY map. Every
     * assertion about "the fill supplied nothing" then passed for the worst
     * possible reason: there was nothing to fill from. A count of what the pack
     * actually loaded is asserted below for that reason.
     */
    traps: bindTraps(packRecords("trap")),
  } as unknown as TilePrefsDeps;
}

/** Every pack under public/tiles that ships a graf-*.prf, by directory name. */
function packs(): { dir: string; prefs: string[] }[] {
  if (!existsSync(TILES)) return [];
  const out: { dir: string; prefs: string[] }[] = [];
  for (const e of readdirSync(TILES, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const prefs = readdirSync(join(TILES, e.name)).filter((f) => f.endsWith(".prf"));
    if (prefs.some((f) => f.startsWith("graf-"))) out.push({ dir: e.name, prefs });
  }
  return out;
}

/**
 * One pack's whole pref set parsed into a map, includes resolved from the same
 * directory - the layout `loadTilePrefs` reads at runtime.
 */
function mapFor(pack: { dir: string; prefs: string[] }, d: TilePrefsDeps): TileMap {
  const dir = join(TILES, pack.dir);
  const text = (name: string): string | null => {
    const at = join(dir, name);
    return existsSync(at) ? readFileSync(at, "utf8") : null;
  };
  const map = new TileMap();
  /* graf first, then the siblings it includes, matching load order. */
  for (const f of [...pack.prefs].sort((a, b) => (a.startsWith("graf-") ? -1 : b.startsWith("graf-") ? 1 : a.localeCompare(b)))) {
    const body = text(f);
    if (body !== null) parseTilePrefsInto(map, body, { ...d, loadFile: text });
  }
  return map;
}

const ALL = packs();

describe("fillTilesFromKin against the shipped tile packs", () => {
  it("has packs to measure", () => {
    /* public/tiles is generated (vitest globalSetup); an empty tree would make
     * every assertion below vacuously true, which is the trap this avoids. */
    expect(ALL.map((p) => p.dir).sort()).not.toEqual([]);
  });

  for (const pack of ALL) {
    it(`supplies nothing for unmodded data in ${pack.dir}`, () => {
      const mon = monsterRegistry();
      const obj = objRegistry();
      const d = deps(mon, obj);
      const map = mapFor(pack, d);

      /*
       * FIRST, that the pack loaded at all. Without this the assertion below
       * passes hardest when the parse failed outright, because an empty map has
       * no donors and can fill nothing - which is exactly what happened while
       * this file was being written. The numbers are lower bounds, not the
       * pack's real counts, so a pack legitimately drawing more still passes.
       */
      expect(map.monster.filter((t) => t !== undefined).length).toBeGreaterThan(500);
      expect(map.object.filter((t) => t !== undefined).length).toBeGreaterThan(100);

      /* The gaps are real and they are supposed to stay gaps: with no mod
       * loaded, every blank slot in this pack belongs to core and must be left
       * blank, whatever the reason it is blank. */
      const blanksBefore = {
        monsters: mon.races.filter((r) => !map.monster[r.ridx]).length,
        objects: obj.kinds.filter((k) => !map.object[k.kidx]).length,
      };
      expect(blanksBefore.objects, `${pack.dir} has no blank object slots to protect`)
        .toBeGreaterThan(0);

      const filled = fillTilesFromKin(map, d);
      expect(
        filled,
        `${pack.dir}: the kin fill wrote over core's own drawing - flavoured ` +
          `kinds and content the pack predates must keep their glyph`,
      ).toEqual({ monsters: 0, objects: 0 });
      expect({
        monsters: mon.races.filter((r) => !map.monster[r.ridx]).length,
        objects: obj.kinds.filter((k) => !map.object[k.kidx]).length,
      }).toEqual(blanksBefore);
    });
  }

  it("gives a mod's added monster and item their family's tile", () => {
    expect(ALL.length).toBeGreaterThan(0);
    const pack = ALL[0]!;

    const tutorial = (dir: string, files: readonly string[]): LoadedPack => {
      const manifest = validateManifest(readJson(join(TUTORIALS, dir, "manifest.json")));
      const out: Record<string, unknown> = {};
      for (const f of files) out[f] = readJson(join(TUTORIALS, dir, `${f}.json`));
      return { manifest, files: out } as LoadedPack;
    };
    const core = (files: readonly string[]): LoadedPack => {
      const out: Record<string, unknown> = {};
      for (const f of files) out[f] = packFile(f);
      return {
        manifest: { id: "core", name: "Angband", version: "1.0.0", shape: "content" } as PackManifest,
        files: out,
      } as LoadedPack;
    };

    const composed = composeContentPacks([
      core(["monster", "monster_base", "object"]),
      tutorial("tutorial-03-add-a-monster", ["monster"]),
      tutorial("tutorial-02-add-an-item", ["object"]),
    ]);
    expect(composed.problems).toEqual([]);

    const mon = monsterRegistry(composed.records["monster"]);
    const obj = objRegistry({ records: composed.records["object"] });
    const d = deps(mon, obj);
    const map = mapFor(pack, d);

    const ant = mon.races.find((r) => r.name === "carpenter ant");
    const jerkin = obj.kinds.find((k) => k.name === "Padded Jerkin~");
    expect(ant, "the tutorial monster did not reach the registry").toBeDefined();
    expect(jerkin, "the tutorial item did not reach the registry").toBeDefined();

    /* Before: the pack has never heard of either, so both draw as glyphs. */
    expect(map.monster[ant!.ridx]).toBeUndefined();
    expect(map.object[jerkin!.kidx]).toBeUndefined();

    const filled = fillTilesFromKin(map, d);
    expect(filled.monsters).toBe(1);
    expect(filled.objects).toBe(1);

    /* After: an ant's tile, taken from a race that shares the `ant` base -
     * whatever cell THIS pack drew for the family, so the same mod is provided
     * for in every pack without naming a coordinate. */
    const kinAnt = mon.races.find(
      (r) => r.base.name === ant!.base.name && r.ridx !== ant!.ridx && map.monster[r.ridx],
    );
    expect(kinAnt, "no other ant carries a tile in this pack").toBeDefined();
    expect(map.monster[ant!.ridx]).toEqual(map.monster[kinAnt!.ridx]);

    const kinArmour = obj.kinds.find(
      (k) => k.tval === jerkin!.tval && k.kidx !== jerkin!.kidx && map.object[k.kidx],
    );
    expect(kinArmour, "no other soft armour carries a tile in this pack").toBeDefined();
    expect(map.object[jerkin!.kidx]).toEqual(map.object[kinArmour!.kidx]);
  });

  it("leaves a tile the author named alone", () => {
    const pack = ALL[0]!;
    const mon = monsterRegistry();
    const obj = objRegistry();
    const d = deps(mon, obj);
    const map = mapFor(pack, d);

    /* A pref line assigning a deliberately odd cell, layered as a mod's would
     * be, then the fill runs: the author's choice has to survive it. */
    const kobold = mon.races.find((r) => r.name === "kobold")!;
    parseTilePrefsInto(map, `monster:kobold:0x8F:0x8F\n`, { ...d, loadFile: () => null });
    const chosen = { ...map.monster[kobold.ridx]! };
    fillTilesFromKin(map, d);
    expect(map.monster[kobold.ridx]).toEqual(chosen);
  });
});
/**
 * `deriveKinSlots` - the loose-pack engine's own half of provisioning a mod.
 *
 * WHAT THE CORE FILL LEAVES UNDONE. Everything above proves a mod's ant gets an
 * ant's tile in every pack. It is also, necessarily, the SAME ant: the fill
 * copies a kin's tile code, so the added creature and its donor are one picture.
 * The tilesheet engine cannot do better - its tiles are cells of a fixed atlas
 * and there is no spare cell for a variant. A loose pack's tiles are individual
 * images, so this engine allocates a slot of its own that draws the donor's
 * image with its hue turned.
 *
 * These tests are built on a HAND-MADE slot table rather than a real loose pack,
 * and that is the honest way round here: the packs are this mod's art, they are
 * gitignored, and they are built by the linoleum repository. What is under test
 * is the derivation, whose whole input is "a slot table and a map", so a
 * two-entry table exercises it exactly. The REGISTRIES are real, composed from
 * the real core pack and real tutorial mods, because who gets filled is the part
 * that must not drift.
 */
describe("deriveKinSlots - distinctive tiles for a mod's content", () => {
  const core = (files: readonly string[]): LoadedPack => {
    const out: Record<string, unknown> = {};
    for (const f of files) out[f] = packFile(f);
    return {
      manifest: { id: "core", name: "Angband", version: "1.0.0", shape: "content" } as PackManifest,
      files: out,
    } as LoadedPack;
  };
  const tutorial = (dir: string, files: readonly string[]): LoadedPack => {
    const manifest = validateManifest(readJson(join(TUTORIALS, dir, "manifest.json")));
    const out: Record<string, unknown> = {};
    for (const f of files) out[f] = readJson(join(TUTORIALS, dir, `${f}.json`));
    return { manifest, files: out } as LoadedPack;
  };

  /** Core plus the two tutorial mods, composed for real. */
  function modded(): { mon: MonsterRegistry; obj: ObjRegistry } {
    const composed = composeContentPacks([
      core(["monster", "monster_base", "object"]),
      tutorial("tutorial-03-add-a-monster", ["monster"]),
      tutorial("tutorial-02-add-an-item", ["object"]),
    ]);
    expect(composed.problems).toEqual([]);
    return {
      mon: monsterRegistry(composed.records["monster"]),
      obj: objRegistry({ records: composed.records["object"] }),
    };
  }

  /**
   * A two-slot pack, with slot 0 on one ant and slot 1 on one soft armour.
   *
   * The donors are FOUND in the real registries rather than named, so this does
   * not break when core's data moves, and it is the same donor the fill would
   * pick: the fill takes the first kin carrying a tile, and exactly one does.
   */
  function twoSlotPack(mon: MonsterRegistry, obj: ObjRegistry, addedTval: number) {
    const slots: LinoleumSlot[] = [
      { kind: "asset", asset: "mon-donor" },
      { kind: "asset", asset: "obj-donor" },
    ];
    const map = new TileMap();
    const antDonor = mon.races.find((r) => r.base.name === "ant")!;
    const armourDonor = obj.kinds.find((k) => k.tval === addedTval)!;
    map.monster[antDonor.ridx] = slotToAtlas(0);
    map.object[armourDonor.kidx] = slotToAtlas(1);
    return { slots, map, antDonor, armourDonor };
  }

  it("gives an added monster and item a slot of their own, drawing the donor's asset", () => {
    const { mon, obj } = modded();
    const d = deps(mon, obj);
    const ant = mon.races.find((r) => r.name === "carpenter ant")!;
    const jerkin = obj.kinds.find((k) => k.name === "Padded Jerkin~")!;
    const { slots, map, antDonor, armourDonor } = twoSlotPack(mon, obj, jerkin.tval);

    const out = deriveKinSlots({ map, slots, deps: d });

    /* Filled, which is the core claim this builds on. */
    expect(out.fill).toEqual({ monsters: 1, objects: 1 });
    expect(out.overflow).toBe(0);
    /* Two new slots, and the pack's own two are untouched - a derived slot must
     * not be able to change what an existing rule draws. */
    expect(out.derived).toBe(2);
    expect(out.slots.length).toBe(4);
    expect(out.slots.slice(0, 2)).toEqual(slots.slice(0, 2));

    /* NOT the donor's tile, which is the whole point and the one assertion the
     * core fill's own tests cannot make. */
    expect(map.monster[ant.ridx]).not.toEqual(map.monster[antDonor.ridx]);
    expect(map.object[jerkin.kidx]).not.toEqual(map.object[armourDonor.kidx]);

    const antSlot = out.slots[slotFromAtlas(map.monster[ant.ridx]!)]!;
    expect(antSlot).toEqual({
      kind: "derived",
      from: 0,
      hue: LINOLEUM_DERIVED_HUES[0],
      of: `monster:${ant.ridx}`,
    });
    const jerkinSlot = out.slots[slotFromAtlas(map.object[jerkin.kidx]!)]!;
    expect(jerkinSlot).toEqual({
      kind: "derived",
      from: 1,
      hue: LINOLEUM_DERIVED_HUES[0],
      of: `object:${jerkin.kidx}`,
    });
  });

  it("derives nothing at all with no mod installed", () => {
    const mon = monsterRegistry();
    const obj = objRegistry();
    const d = deps(mon, obj);
    /* Any tval with a kin to donate; soft armor is the one the modded case uses. */
    const tval = obj.kinds.find((k) => k.name === "Padded Jerkin~")?.tval
      ?? obj.kinds.find((k) => k.tval > 0)!.tval;
    const { slots, map } = twoSlotPack(mon, obj, tval);

    const out = deriveKinSlots({ map, slots, deps: d });

    /* The same restriction the core fill earns, seen from this side: with
     * nothing added, there is nothing to derive, so an unmodded game's drawing
     * cannot be changed by this code existing. */
    expect(out.fill).toEqual({ monsters: 0, objects: 0 });
    expect(out.derived).toBe(0);
    expect(out.slots).toEqual(slots);
  });

  it("gives two added creatures on one donor different colours", () => {
    /*
     * The case a per-entity hash would get wrong one time in eight, and the
     * reason hues are handed out per DONOR: two mod ants that look like each
     * other are only marginally better than two that look like the base game's.
     *
     * The second ant is the tutorial's own record renamed, which is the shape
     * the composer produces for an added monster - `$from` and all - rather than
     * a fixture written to agree with the binder.
     */
    const composed = composeContentPacks([
      core(["monster", "monster_base", "object"]),
      tutorial("tutorial-03-add-a-monster", ["monster"]),
    ]);
    expect(composed.problems).toEqual([]);
    const records = composed.records["monster"] as Record<string, unknown>[];
    const added = records.find((r) => r["name"] === "carpenter ant")!;
    expect(added["$from"], "the composer did not stamp the added monster").toBeDefined();
    const mon = monsterRegistry([...records, { ...added, name: "joiner ant" }]);
    const obj = objRegistry();
    const d = deps(mon, obj);

    const first = mon.races.find((r) => r.name === "carpenter ant")!;
    const second = mon.races.find((r) => r.name === "joiner ant")!;
    const { slots, map } = twoSlotPack(mon, obj, obj.kinds[0]!.tval);

    const out = deriveKinSlots({ map, slots, deps: d });
    expect(out.fill.monsters).toBe(2);

    const a = out.slots[slotFromAtlas(map.monster[first.ridx]!)]!;
    const b = out.slots[slotFromAtlas(map.monster[second.ridx]!)]!;
    expect(a.kind).toBe("derived");
    expect(b.kind).toBe("derived");
    /* Same picture, different colour, different slot. */
    expect((a as { from: number }).from).toBe((b as { from: number }).from);
    expect((a as { hue: number }).hue).not.toBe((b as { hue: number }).hue);
    expect(map.monster[first.ridx]).not.toEqual(map.monster[second.ridx]);
  });

  it("is deterministic across runs", () => {
    /* A tile that changed colour between launches would be worse than a
     * duplicate one, so this is not a nicety. Nothing in the derivation reads
     * the RNG, the clock or the save; this is the check that keeps that true. */
    const run = () => {
      const { mon, obj } = modded();
      const jerkin = obj.kinds.find((k) => k.name === "Padded Jerkin~")!;
      const { slots, map } = twoSlotPack(mon, obj, jerkin.tval);
      const out = deriveKinSlots({ map, slots, deps: deps(mon, obj) });
      return { slots: out.slots, ant: map.monster[mon.races.find((r) => r.name === "carpenter ant")!.ridx] };
    };
    expect(run()).toEqual(run());
  });

  it("copies the tile plainly when the donor's slot is not the pack's", () => {
    /*
     * A donor tile that came from somewhere other than this pack's own table - a
     * mod pref naming a raw atlas cell, which layers in before the fill - has no
     * asset behind it to recolour. Copying it unchanged is the honest answer, and
     * it is what happened before this code existed.
     */
    const { mon, obj } = modded();
    const d = deps(mon, obj);
    const ant = mon.races.find((r) => r.name === "carpenter ant")!;
    const antDonor = mon.races.find((r) => r.base.name === "ant")!;
    const slots: LinoleumSlot[] = [{ kind: "asset", asset: "mon-donor" }];
    const map = new TileMap();
    /* Slot 900: past the end of a one-entry table, so nothing defines it. */
    map.monster[antDonor.ridx] = slotToAtlas(900);

    const out = deriveKinSlots({ map, slots, deps: d });

    expect(out.fill.monsters).toBe(1);
    expect(out.derived).toBe(0);
    expect(map.monster[ant.ridx]).toEqual(map.monster[antDonor.ridx]);
  });
});

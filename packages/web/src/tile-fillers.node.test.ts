/**
 * The tile-filling seam (registry:tiles) against REAL tile packs and REAL game
 * data, plus the loose-pack engine's derive capability.
 *
 * WHAT MOVED, AND WHAT THIS FILE NOW PROVES. Until 0.23.0 the GAME decided that
 * a mod-added monster should be drawn with the tile of a race sharing its
 * `base`. That rule is gone: it was the port inventing a behaviour 4.2.6 has no
 * opinion about, and it made a call on behalf of tile sets the game does not own
 * (see docs/modding/MOD_COMPATIBILITY.md). A tileset mod holds the policy now.
 *
 * So the game's guarantee is DELIBERATELY SMALLER than the one this file used to
 * assert, and saying so plainly matters more than the old wording did:
 *
 *   - THE GAME GUARANTEES that no filler can change a tile anything else
 *     assigned. Every pref layer runs first, and the fill door refuses an index
 *     that is not blank. Tested below against every shipped pack with a filler
 *     that tries its hardest to repaint them.
 *   - THE GAME NO LONGER GUARANTEES that core's own blanks stay blank. A blank
 *     is a pack's silence, and whether to break it is the tileset mod's call -
 *     rings and mushrooms are drawn by flavour, and adam-bolt predates content
 *     the game now ships, so a mod that fills those is wrong and it is wrong in
 *     its own repository. neo-linoleum keeps the provenance restriction (only
 *     records a mod ADDED) and its own tests hold it to that.
 *
 * The seam-adequacy test is the one that would have caught a door too narrow to
 * be useful: a test-local filler shaped like the rule that left core, run
 * against real packs and the real tutorial mods, has to be able to reproduce
 * exactly what core used to do. It is not the mod's code and does not pretend to
 * be; what it measures is whether the door is sufficient.
 *
 * The pack-load assertions stay, because an empty map fills nothing and would
 * pass most of these for the opposite reason. That is not hypothetical: `traps:
 * null` in this file's own deps once stopped the parser 200 lines above the
 * monster block and made every measurement here vacuous until it was found. */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bindTraps,
  FeatureRegistry,
  MonsterRegistry,
  ObjRegistry,
  parseTilePrefsInto,
  TileMap,
} from "@rpgm-tools/neo-angband-core";
import type {
  TileAtlas,
  TileFillPack,
  TileFiller,
  TilePrefsDeps,
} from "@rpgm-tools/neo-angband-core";
import { composeContentPacks, validateManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { LoadedPack, PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  derivedSlots,
  rampIndex,
  remapToRamp,
  slotFromAtlas,
  slotToAtlas,
  type LinoleumSlot,
} from "./linoleum-pack";
import { TILE_RAMP_MAX, TileFillerRegistry } from "./tile-registry";

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

/** A registry with one filler installed, plus whatever it reported. */
function withFiller(filler: TileFiller): {
  registry: TileFillerRegistry;
  problems: string[];
} {
  const problems: string[] = [];
  const registry = new TileFillerRegistry((owner, why) => problems.push(`${owner}: ${why}`));
  registry.register(filler, "test-mod");
  return { registry, problems };
}

const PACK: TileFillPack = { engine: "tilesheet", id: "test", menuname: "Test" };

describe("the fill door cannot repaint a pack", () => {
  it("has packs to measure", () => {
    /* public/tiles is generated (vitest globalSetup); an empty tree would make
     * every assertion below vacuously true, which is the trap this avoids. */
    expect(ALL.map((p) => p.dir).sort()).not.toEqual([]);
  });

  for (const pack of ALL) {
    it(`refuses every assigned tile in ${pack.dir}, and fills only blanks`, () => {
      const mon = monsterRegistry();
      const obj = objRegistry();
      const d = deps(mon, obj);
      const map = mapFor(pack, d);

      /* FIRST, that the pack loaded at all - see the header. Lower bounds, not
       * the pack's real counts, so a pack drawing more still passes. */
      expect(map.monster.filter((t) => t !== undefined).length).toBeGreaterThan(500);
      expect(map.object.filter((t) => t !== undefined).length).toBeGreaterThan(100);

      const before = {
        monster: map.monster.map((t) => (t ? { ...t } : undefined)),
        object: map.object.map((t) => (t ? { ...t } : undefined)),
      };
      const assigned = {
        monsters: before.monster.filter((t) => t !== undefined).length,
        objects: before.object.filter((t) => t !== undefined).length,
      };

      /* A filler with no manners: it asks for EVERY index, core's own included,
       * with a tile nothing in the pack uses. The pack's art has to survive it
       * without the filler having been polite. */
      const marker = { attr: 0xff, char: 0xff };
      const { registry } = withFiller((fill) => {
        for (const race of mon.races) fill.fillMonster(race.ridx, marker);
        for (const kind of obj.kinds) fill.fillObject(kind.kidx, marker);
      });
      const out = registry.run(map, PACK, null);

      /* Every tile the pack drew is the tile the pack drew. */
      for (const race of mon.races) {
        const was = before.monster[race.ridx];
        if (was) expect({ ridx: race.ridx, now: map.monster[race.ridx] }).toEqual({ ridx: race.ridx, now: was });
      }
      for (const kind of obj.kinds) {
        const was = before.object[kind.kidx];
        if (was) expect({ kidx: kind.kidx, now: map.object[kind.kidx] }).toEqual({ kidx: kind.kidx, now: was });
      }

      /* And the refusals were real refusals rather than a filler that never ran:
       * one per index the pack had already drawn, and the fills it DID get are
       * exactly the blanks. */
      expect(out.refused).toBe(assigned.monsters + assigned.objects);
      expect(out.monsters + out.objects).toBeGreaterThan(0);
      expect({
        monsters: mon.races.filter((r) => !map.monster[r.ridx]).length,
        objects: obj.kinds.filter((k) => !map.object[k.kidx]).length,
      }).toEqual({ monsters: 0, objects: 0 });
    });
  }

  it("leaves a tile the author named alone, and never offers it", () => {
    const pack = ALL[0]!;
    const mon = monsterRegistry();
    const obj = objRegistry();
    const d = deps(mon, obj);
    const map = mapFor(pack, d);

    /* A pref line assigning a deliberately odd cell, layered as a mod's would
     * be, then the fillers run: the author's choice has to survive. */
    const kobold = mon.races.find((r) => r.name === "kobold")!;
    parseTilePrefsInto(map, `monster:kobold:0x8F:0x8F\n`, { ...d, loadFile: () => null });
    const chosen = { ...map.monster[kobold.ridx]! };

    let offered: boolean | null = null;
    const { registry } = withFiller((fill) => {
      offered = fill.fillMonster(kobold.ridx, { attr: 0x81, char: 0x81 });
    });
    registry.run(map, PACK, null);

    expect(map.monster[kobold.ridx]).toEqual(chosen);
    /* The refusal is VISIBLE to the filler, which is what lets a mod hold the
     * "only what nothing drew" rule itself rather than guessing. */
    expect(offered).toBe(false);
  });

  it("reports a filler that throws, and keeps what it had already supplied", () => {
    const mon = monsterRegistry();
    const obj = objRegistry();
    const map = mapFor(ALL[0]!, deps(mon, obj));
    const blank = mon.races.find((r) => !map.monster[r.ridx]);
    expect(blank, "this pack draws every race, so there is no blank to fill").toBeDefined();

    const { registry, problems } = withFiller((fill) => {
      fill.fillMonster(blank!.ridx, { attr: 0x82, char: 0x83 });
      throw new Error("halfway");
    });
    const out = registry.run(map, PACK, null);

    expect(out.monsters).toBe(1);
    expect(map.monster[blank!.ridx]).toEqual({ attr: 0x82, char: 0x83 });
    expect(problems.join()).toMatch(/test-mod: its tile filler threw.*halfway/u);
  });

  it("refuses a tile that is not a tile", () => {
    const mon = monsterRegistry();
    const obj = objRegistry();
    const map = mapFor(ALL[0]!, deps(mon, obj));
    const blank = mon.races.find((r) => !map.monster[r.ridx])!;
    const { registry, problems } = withFiller((fill) => {
      fill.fillMonster(blank.ridx, { attr: "red", char: null } as unknown as TileAtlas);
    });
    const out = registry.run(map, PACK, null);
    expect(out.monsters).toBe(0);
    expect(map.monster[blank.ridx]).toBeUndefined();
    expect(problems.join()).toMatch(/not a tile/u);
  });

  it("runs one filler per mod, and a mod re-registering replaces only its own", () => {
    const map = new TileMap();
    const seen: string[] = [];
    const registry = new TileFillerRegistry(() => undefined);
    registry.register(() => seen.push("a1"), "mod-a");
    registry.register(() => seen.push("b"), "mod-b");
    registry.register(() => seen.push("a2"), "mod-a");
    expect(registry.size).toBe(2);
    registry.run(map, PACK, null);
    /* Registration order is load order, and mod-a keeps its place. */
    expect(seen).toEqual(["a2", "b"]);
  });

  it("is wired into BOTH engines, checked in the source", () => {
    /*
     * A seam nothing calls is this repository's most-repeated bug, and the two
     * engines are exactly where the call can go missing one at a time - a mod's
     * content drawn under one engine and lettered under the other would make
     * "does my mod look right" depend on a graphics setting. Neither call is
     * reachable from a node test (one needs fetch, the other a real pack), so
     * the check is a source scan, like the one on main.ts's registry latch.
     */
    const read = (name: string): string =>
      readFileSync(join(REPO, "packages", "web", "src", name), "utf8");
    expect(read("tiles.ts"), "the tilesheet engine does not run fillers").toMatch(
      /tileRegistry\.run\(/u,
    );
    expect(read("linoleum-pack.ts"), "the loose-pack engine does not run fillers").toMatch(
      /tileRegistry\.run\(/u,
    );
    /* And that the difference between them is the DERIVE argument rather than
     * whether fillers run: null there, the allocator here. */
    expect(read("tiles.ts")).toMatch(/tileRegistry\.run\([\s\S]{0,200}?null,\n\s*\);/u);
    expect(read("linoleum-pack.ts")).toMatch(/derivedSlots\(index\.slots\)/u);
  });
});

/**
 * IS THE DOOR WIDE ENOUGH? The rule that left core is the one real consumer, so
 * the seam is only worth anything if a mod can still express it. This is that
 * rule, written against the door and nothing else, over real packs and the real
 * tutorial mods.
 *
 * It is NOT neo-linoleum's code and must not be mistaken for a test of it. The
 * mod's own repository tests the mod. What fails here is a door too narrow to
 * hold the policy it was built to hand over.
 */
function kinFiller(mon: MonsterRegistry, obj: ObjRegistry, hues: readonly number[] = []): TileFiller {
  const addedByMod = (rec: { from?: { owner: string } }): boolean =>
    rec.from !== undefined && rec.from.owner !== "core";
  return (fill) => {
    const handedOut = new Map<number, number>();
    const donorFor = (donors: Map<string, { attr: number; char: number }>, key: string) =>
      donors.get(key);

    const monDonors = new Map<string, { attr: number; char: number }>();
    for (const race of mon.races) {
      const tile = fill.monsterTile(race.ridx);
      if (tile && !monDonors.has(race.base.name)) monDonors.set(race.base.name, tile);
    }
    for (const race of mon.races) {
      if (!addedByMod(race)) continue;
      const donor = donorFor(monDonors, race.base.name);
      if (!donor) continue;
      const seen = handedOut.get(slotOf(donor)) ?? 0;
      handedOut.set(slotOf(donor), seen + 1);
      const hue = hues.length > 0 ? (hues[seen % hues.length] as number) : 0;
      fill.fillMonster(race.ridx, fill.derive(donor, hue) ?? { ...donor });
    }

    const objDonors = new Map<number, { attr: number; char: number }>();
    for (const kind of obj.kinds) {
      const tile = fill.objectTile(kind.kidx);
      if (tile && !objDonors.has(kind.tval)) objDonors.set(kind.tval, tile);
    }
    for (const kind of obj.kinds) {
      if (!addedByMod(kind)) continue;
      const donor = objDonors.get(kind.tval);
      if (!donor) continue;
      fill.fillObject(kind.kidx, fill.derive(donor, hues[0] ?? 0) ?? { ...donor });
    }
  };
}

const slotOf = (tile: { attr: number; char: number }): number => slotFromAtlas(tile);

/** Core plus the two tutorial mods, composed for real. */
function moddedRegistries(extraMonster?: string): { mon: MonsterRegistry; obj: ObjRegistry } {
  const corePack = (files: readonly string[]): LoadedPack => {
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
  const composed = composeContentPacks([
    corePack(["monster", "monster_base", "object"]),
    tutorial("tutorial-03-add-a-monster", ["monster"]),
    tutorial("tutorial-02-add-an-item", ["object"]),
  ]);
  expect(composed.problems).toEqual([]);
  const records = composed.records["monster"] as Record<string, unknown>[];
  const added = records.find((r) => r["name"] === "carpenter ant")!;
  expect(added["$from"], "the composer did not stamp the added monster").toBeDefined();
  return {
    mon: monsterRegistry(
      extraMonster === undefined ? records : [...records, { ...added, name: extraMonster }],
    ),
    obj: objRegistry({ records: composed.records["object"] }),
  };
}

describe("the door is wide enough for the rule that left core", () => {
  it("gives a mod's added monster and item their family's tile, in every shipped pack", () => {
    expect(ALL.length).toBeGreaterThan(0);
    for (const pack of ALL) {
      const { mon, obj } = moddedRegistries();
      const d = deps(mon, obj);
      const map = mapFor(pack, d);
      const ant = mon.races.find((r) => r.name === "carpenter ant")!;
      const jerkin = obj.kinds.find((k) => k.name === "Padded Jerkin~")!;

      /* Before: the pack has never heard of either, so both draw as glyphs. */
      expect(map.monster[ant.ridx]).toBeUndefined();
      expect(map.object[jerkin.kidx]).toBeUndefined();

      const { registry } = withFiller(kinFiller(mon, obj));
      const out = registry.run(map, { engine: "tilesheet", id: pack.dir, menuname: pack.dir }, null);
      expect({ pack: pack.dir, monsters: out.monsters, objects: out.objects }).toEqual({
        pack: pack.dir,
        monsters: 1,
        objects: 1,
      });

      /* An ant's tile, taken from a race that shares the `ant` base - whatever
       * cell THIS pack drew for the family, so the same mod is provided for in
       * every pack without naming a coordinate anywhere. */
      const kinAnt = mon.races.find(
        (r) => r.base.name === ant.base.name && r.ridx !== ant.ridx && map.monster[r.ridx],
      );
      expect(kinAnt, `no other ant carries a tile in ${pack.dir}`).toBeDefined();
      expect(map.monster[ant.ridx]).toEqual(map.monster[kinAnt!.ridx]);

      const kinArmour = obj.kinds.find(
        (k) => k.tval === jerkin.tval && k.kidx !== jerkin.kidx && map.object[k.kidx],
      );
      expect(kinArmour, `no other soft armour carries a tile in ${pack.dir}`).toBeDefined();
      expect(map.object[jerkin.kidx]).toEqual(map.object[kinArmour!.kidx]);
    }
  });

  it("touches nothing when no mod added anything", () => {
    /* The provenance restriction is the MOD's, not the game's, so this asserts
     * that the door lets a mod hold it - `fill.monsterTile` plus the registry's
     * own `from` is all the information it needs. */
    const mon = monsterRegistry();
    const obj = objRegistry();
    const map = mapFor(ALL[0]!, deps(mon, obj));
    const { registry } = withFiller(kinFiller(mon, obj));
    const out = registry.run(map, PACK, null);
    expect({ monsters: out.monsters, objects: out.objects, refused: out.refused }).toEqual({
      monsters: 0,
      objects: 0,
      refused: 0,
    });
  });
});

/**
 * `derivedSlots` - the loose-pack engine's derive capability.
 *
 * A hand-made slot table rather than a real pack, and that is the honest way
 * round: the packs are neo-linoleum's art, they are gitignored here, and they are
 * built by that repository. The whole input to a derivation is a slot table and a
 * request, so a two-entry table exercises it exactly.
 */
describe("derivedSlots - a tile of one's own", () => {
  const base: readonly LinoleumSlot[] = [
    { kind: "asset", asset: "mon-donor" },
    { kind: "asset", asset: "obj-donor" },
  ];

  it("allocates one slot per donor and hue, and never rewrites the pack's own", () => {
    const hues = derivedSlots(base);
    const first = hues.derive(slotToAtlas(0), 30)!;
    const second = hues.derive(slotToAtlas(0), 60)!;
    const again = hues.derive(slotToAtlas(0), 30)!;

    expect(first).not.toEqual(slotToAtlas(0));
    expect(first).not.toEqual(second);
    /* Asking twice for the same picture and colour returns the same slot rather
     * than growing the table. */
    expect(again).toEqual(first);
    expect(hues.stats()).toEqual({ derived: 2, transformed: 0, overflow: 0 });

    const slots = hues.slots();
    expect(slots.slice(0, 2)).toEqual(base);
    expect(slots[slotFromAtlas(first)]).toEqual({ kind: "derived", from: 0, hue: 30 });
    expect(slots[slotFromAtlas(second)]).toEqual({ kind: "derived", from: 0, hue: 60 });
  });

  it("refuses a donor this pack does not own", () => {
    /* A mod pref naming a raw atlas cell layers in before fillers run, so a
     * donor can be a tile with no asset behind it. There is nothing to recolour,
     * and the filler is told so rather than being handed a slot that draws
     * nothing. */
    const hues = derivedSlots(base);
    expect(hues.derive(slotToAtlas(900), 30)).toBeNull();
    expect(hues.stats()).toEqual({ derived: 0, transformed: 0, overflow: 0 });
  });

  it("refuses a derived donor and a rotation of nothing", () => {
    const hues = derivedSlots([...base, { kind: "derived", from: 0, hue: 30 }]);
    /* The renderer will not chain recolours, and a copy of a copy is not more
     * distinctive than the copy. */
    expect(hues.derive(slotToAtlas(2), 60)).toBeNull();
    /* A zero rotation would allocate a slot indistinguishable from its donor. */
    expect(hues.derive(slotToAtlas(0), 0)).toBeNull();
    expect(hues.derive(slotToAtlas(0), 720)).toBeNull();
  });

  it("normalises a hue so the same colour is the same slot", () => {
    const hues = derivedSlots(base);
    expect(hues.derive(slotToAtlas(1), 45)).toEqual(hues.derive(slotToAtlas(1), 405));
    expect(hues.derive(slotToAtlas(1), -315)).toEqual(hues.derive(slotToAtlas(1), 45));
    expect(hues.stats().derived).toBe(1);
  });

  it("is deterministic, and reads nothing outside its arguments", () => {
    /* A tile that changed colour between launches would be worse than a
     * duplicate one, so this is not a nicety. */
    const run = (): unknown => {
      const hues = derivedSlots(base);
      const tiles = [30, 60, 30, 90].map((hue) => hues.derive(slotToAtlas(0), hue));
      return { tiles, slots: hues.slots(), stats: hues.stats() };
    };
    expect(run()).toEqual(run());
  });

  it("gives two creatures on one donor different colours, through the mod's own cycle", () => {
    /*
     * The case a per-entity hash would get wrong one time in eight, and the
     * reason a hue cycle is handed out per DONOR: two mod ants that look like
     * each other are only marginally better than two that look like the base
     * game's. The cycle is the MOD's now - the numbers below come from the test
     * filler, not from the game - and this asserts the door can express it.
     */
    const { mon, obj } = moddedRegistries("joiner ant");
    const d = deps(mon, obj);
    const map = mapFor(ALL[0]!, d);
    const first = mon.races.find((r) => r.name === "carpenter ant")!;
    const second = mon.races.find((r) => r.name === "joiner ant")!;

    /* A slot table that owns the donor's tile, so derive has an asset to turn.
     * The donor is FOUND rather than named, so this does not break when core's
     * data moves. */
    const antDonor = mon.races.find((r) => r.base.name === first.base.name && map.monster[r.ridx])!;
    const slots: LinoleumSlot[] = [{ kind: "asset", asset: "ant" }];
    map.monster[antDonor.ridx] = slotToAtlas(0);
    map.monster[first.ridx] = undefined;
    map.monster[second.ridx] = undefined;

    const hues = derivedSlots(slots);
    const { registry } = withFiller(kinFiller(mon, obj, [30, 60]));
    const out = registry.run(map, { engine: "linoleum", id: "test", menuname: "Test" }, hues.derive);

    expect(out.monsters).toBe(2);
    const table = hues.slots();
    const a = table[slotFromAtlas(map.monster[first.ridx]!)]!;
    const b = table[slotFromAtlas(map.monster[second.ridx]!)]!;
    expect(a).toEqual({ kind: "derived", from: 0, hue: 30 });
    expect(b).toEqual({ kind: "derived", from: 0, hue: 60 });
    /* Same picture, different colour, and neither is the donor's own tile. */
    expect(map.monster[first.ridx]).not.toEqual(map.monster[second.ridx]);
    expect(map.monster[first.ridx]).not.toEqual(map.monster[antDonor.ridx]);
  });
});

/**
 * `remapToRamp` - the palette swap itself, decided in bytes.
 *
 * WHY THIS TEST IS IN BYTES AND NOT IN PIXELS ON A CANVAS. The colour decision
 * is the whole feature: which ramp entry a pixel lands in, what it comes out as,
 * and what is left alone. A canvas would add an image decode, a `getImageData`
 * round trip and a browser to the measurement of arithmetic, and there is no
 * canvas in a node run at all - so the arithmetic is a pure exported function
 * and this asserts its exact output bytes. The arrangement around it (mirror,
 * read back, write back) is what the joint test and the real game exercise.
 */
describe("remapToRamp - a palette, not a rotation", () => {
  /** Four bands, chosen so every channel of every entry is distinguishable. */
  const RAMP: readonly (readonly [number, number, number])[] = [
    [10, 20, 30],
    [40, 50, 60],
    [70, 80, 90],
    [100, 110, 120],
  ];

  it("puts each brightness in its band and writes that band's colour exactly", () => {
    /* Rec. 601 luma, then 0-255 in four equal parts: 0-63, 64-127, 128-191,
     * 192-255. Grey pixels, so luma is the channel value and the expected band
     * can be read off the number rather than recomputed by the same code the
     * test is measuring. */
    const greys = [0, 63, 64, 127, 128, 191, 192, 255];
    const pixels = new Uint8ClampedArray(greys.length * 4);
    greys.forEach((v, i) => {
      pixels[i * 4] = v;
      pixels[i * 4 + 1] = v;
      pixels[i * 4 + 2] = v;
      pixels[i * 4 + 3] = 255;
    });

    remapToRamp(pixels, RAMP);

    expect(Array.from(pixels)).toEqual([
      10, 20, 30, 255,
      10, 20, 30, 255,
      40, 50, 60, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
      100, 110, 120, 255,
    ]);
  });

  it("weights the channels the way 601 luma does, so a green is not a blue", () => {
    /* Pure red (luma 76), pure green (150) and pure blue (29) land in three
     * different bands, which is the whole reason a luma is used rather than an
     * average: an average would put all three in the same one. */
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
    ]);
    remapToRamp(pixels, RAMP);
    expect(Array.from(pixels.slice(0, 3))).toEqual([40, 50, 60]);
    expect(Array.from(pixels.slice(4, 7))).toEqual([70, 80, 90]);
    expect(Array.from(pixels.slice(8, 11))).toEqual([10, 20, 30]);
  });

  it("carries alpha through and leaves a transparent pixel entirely alone", () => {
    /* The silhouette is the donor's, to the pixel: this cannot change what shape
     * the creature is. And a fully transparent pixel keeps its colour bytes,
     * because ramping them would give every one index 0 and grow a dark fringe
     * around badly-authored art. */
    const pixels = new Uint8ClampedArray([
      200, 200, 200, 0,
      200, 200, 200, 128,
    ]);
    remapToRamp(pixels, RAMP);
    expect(Array.from(pixels)).toEqual([200, 200, 200, 0, 100, 110, 120, 128]);
  });

  it("returns the buffer untouched for a ramp that is not a palette", () => {
    /* The caller that wants only a mirror passes exactly this, so it is an
     * ordinary case rather than a guard against a mistake. */
    const original = [200, 100, 50, 255];
    for (const ramp of [[], [[1, 2, 3]]]) {
      const pixels = new Uint8ClampedArray(original);
      expect(Array.from(remapToRamp(pixels, ramp as never))).toEqual(original);
    }
  });

  it("is NOT idempotent in general, which is why a chain is refused", () => {
    /* Measured, not assumed. A second pass over an already-remapped tile moves
     * its pixels again, because a ramp entry's own brightness need not fall in
     * the band that produced it: RAMP above is dark, its entry for band 1 has
     * luma 48, and 48 is band 0 - so applying it twice darkens what one pass
     * produced. That is the concrete reason the slot allocator refuses a
     * transformed donor rather than treating a chain as merely redundant. */
    const pixels = new Uint8ClampedArray([200, 30, 90, 255, 12, 240, 7, 255]);
    const once = Array.from(remapToRamp(new Uint8ClampedArray(pixels), RAMP));
    const twice = Array.from(
      remapToRamp(remapToRamp(new Uint8ClampedArray(pixels), RAMP), RAMP),
    );
    expect(twice).not.toEqual(once);

    /* A ramp whose entries each sit in their own band IS idempotent, so this is
     * a property of the palette a caller chose and not of the remap. */
    const aligned: readonly (readonly [number, number, number])[] = [
      [32, 32, 32],
      [96, 96, 96],
      [160, 160, 160],
      [224, 224, 224],
    ];
    const alignedOnce = Array.from(remapToRamp(new Uint8ClampedArray(pixels), aligned));
    const alignedTwice = Array.from(
      remapToRamp(remapToRamp(new Uint8ClampedArray(pixels), aligned), aligned),
    );
    expect(alignedTwice).toEqual(alignedOnce);
  });

  it("indexes into a ramp of any length up to the cap", () => {
    for (const bands of [2, 3, 5, 8, TILE_RAMP_MAX]) {
      expect(rampIndex(0, 0, 0, bands)).toBe(0);
      expect(rampIndex(255, 255, 255, bands)).toBe(bands - 1);
      /* Never out of range, whatever the brightness - the clamp is what stops a
       * ramp lookup returning undefined and a pixel keeping the donor's colour
       * for no visible reason. */
      for (const v of [0, 1, 127, 128, 254, 255]) {
        const i = rampIndex(v, v, v, bands);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(bands);
      }
    }
  });
});

/** `derivedSlots.transform` - the OTHER variant a loose pack can allocate. */
describe("derivedSlots - mirrored and repainted", () => {
  const base: readonly LinoleumSlot[] = [
    { kind: "asset", asset: "mon-donor" },
    { kind: "asset", asset: "obj-donor" },
  ];
  const RAMP: readonly (readonly [number, number, number])[] = [
    [0, 0, 0],
    [255, 255, 255],
  ];

  it("shares ONE slot table with derive, so the two never collide", () => {
    /* The failure this exists to catch is two allocators over one base handing
     * out the same slot number for different pictures, which shows up much later
     * as one creature wearing another's tile. */
    const alloc = derivedSlots(base);
    const hue = alloc.derive(slotToAtlas(0), 30)!;
    const flip = alloc.transform(slotToAtlas(0), { mirror: true, ramp: [] })!;
    expect(hue).not.toEqual(flip);
    expect(alloc.stats()).toEqual({ derived: 1, transformed: 1, overflow: 0 });
    const slots = alloc.slots();
    expect(slots.slice(0, 2)).toEqual(base);
    expect(slots[slotFromAtlas(hue)]).toEqual({ kind: "derived", from: 0, hue: 30 });
    expect(slots[slotFromAtlas(flip)]).toEqual({
      kind: "transformed",
      from: 0,
      spec: { mirror: true, ramp: [] },
    });
  });

  it("allocates one slot per (donor, spec) and reuses it", () => {
    const alloc = derivedSlots(base);
    const spec = { mirror: true, ramp: RAMP };
    const first = alloc.transform(slotToAtlas(0), spec)!;
    const again = alloc.transform(slotToAtlas(0), { mirror: true, ramp: [...RAMP] })!;
    const other = alloc.transform(slotToAtlas(1), spec)!;
    const unmirrored = alloc.transform(slotToAtlas(0), { mirror: false, ramp: RAMP })!;

    /* A spec rebuilt from equal values is the same picture, so it is the same
     * slot: the signature is the values, not the object. */
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
    expect(unmirrored).not.toEqual(first);
    expect(alloc.stats().transformed).toBe(3);
  });

  it("refuses a donor the pack does not own, and a chained one", () => {
    const alloc = derivedSlots([
      ...base,
      { kind: "derived", from: 0, hue: 30 },
      { kind: "transformed", from: 0, spec: { mirror: true, ramp: [] } },
    ]);
    expect(alloc.transform(slotToAtlas(900), { mirror: true, ramp: [] })).toBeNull();
    expect(alloc.transform(slotToAtlas(2), { mirror: true, ramp: [] })).toBeNull();
    expect(alloc.transform(slotToAtlas(3), { mirror: true, ramp: [] })).toBeNull();
    expect(alloc.stats().transformed).toBe(0);
  });

  it("refuses a transform that changes nothing", () => {
    /* No mirror and no usable palette is a request for the donor's own picture,
     * and allocating a slot for that is how a table fills up with tiles nobody
     * can tell apart. A one-colour ramp is not a palette: the renderer ignores
     * it, so the refusal and the render agree. */
    const alloc = derivedSlots(base);
    expect(alloc.transform(slotToAtlas(0), { mirror: false, ramp: [] })).toBeNull();
    expect(
      alloc.transform(slotToAtlas(0), { mirror: false, ramp: [[9, 9, 9]] }),
    ).toBeNull();
    expect(alloc.stats().transformed).toBe(0);
  });

  it("normalises an unusable ramp away, so a mirror is one slot either way", () => {
    const alloc = derivedSlots(base);
    const bare = alloc.transform(slotToAtlas(0), { mirror: true, ramp: [] })!;
    const single = alloc.transform(slotToAtlas(0), { mirror: true, ramp: [[9, 9, 9]] })!;
    expect(single).toEqual(bare);
    expect(alloc.stats().transformed).toBe(1);
    expect(alloc.slots()[slotFromAtlas(bare)]).toEqual({
      kind: "transformed",
      from: 0,
      spec: { mirror: true, ramp: [] },
    });
  });

  it("is deterministic across runs", () => {
    const run = (): unknown => {
      const alloc = derivedSlots(base);
      const tiles = [
        alloc.transform(slotToAtlas(0), { mirror: true, ramp: RAMP }),
        alloc.transform(slotToAtlas(1), { mirror: false, ramp: RAMP }),
        alloc.transform(slotToAtlas(0), { mirror: true, ramp: RAMP }),
      ];
      return { tiles, slots: alloc.slots(), stats: alloc.stats() };
    };
    expect(run()).toEqual(run());
  });
});

/**
 * The door's own validation of a transform spec, which is the layer that keeps a
 * mod's mistake from becoming an unbounded cache in the engine.
 */
describe("the fill door's transform", () => {
  const linoPack: TileFillPack = { engine: "linoleum", id: "test", menuname: "Test" };

  /** Run one filler and hand back whatever it asked the door for. */
  function asked(spec: unknown): {
    answer: TileAtlas | null;
    requests: unknown[];
  } {
    const requests: unknown[] = [];
    const registry = new TileFillerRegistry(() => undefined);
    let answer: TileAtlas | null = null;
    registry.register((fill) => {
      answer = fill.transform({ attr: 0x80, char: 0x80 }, spec as never);
    }, "mod");
    registry.run(new TileMap(), linoPack, null, (donor, s) => {
      requests.push(s);
      return { attr: donor.attr, char: donor.char + 1 };
    });
    return { answer, requests };
  }

  it("passes a well-formed spec through and returns the engine's tile", () => {
    const out = asked({ mirror: true, ramp: [[0, 0, 0], [255, 255, 255]] });
    expect(out.answer).toEqual({ attr: 0x80, char: 0x81 });
    expect(out.requests).toHaveLength(1);
  });

  it("answers null on an engine with no transform, without asking", () => {
    /* A tilesheet is a fixed atlas: every cell is somebody's tile and there is
     * no spare one, so the door is honest about it rather than allocating
     * something that cannot be drawn. */
    const registry = new TileFillerRegistry(() => undefined);
    let answer: TileAtlas | null = { attr: 1, char: 1 };
    registry.register((fill) => {
      answer = fill.transform({ attr: 0x80, char: 0x80 }, { mirror: true, ramp: [] });
    }, "mod");
    registry.run(new TileMap(), { engine: "tilesheet", id: "x", menuname: "X" }, null);
    expect(answer).toBeNull();
  });

  it("refuses a spec the engine would cache badly, and never asks the engine", () => {
    /* Each of these would key a cache entry that can never be hit again, or a
     * very large one. The engine caches one canvas per spec, so the bound on
     * that cache is this check. */
    const specs: unknown[] = [
      null,
      "mirror",
      { ramp: [] },
      { mirror: "yes", ramp: [] },
      { mirror: true },
      { mirror: true, ramp: [[0, 0]] },
      { mirror: true, ramp: [[0, 0, 256]] },
      { mirror: true, ramp: [[0, 0, -1]] },
      { mirror: true, ramp: [[0, 0, Number.NaN]] },
      { mirror: true, ramp: [[0, 0, 1.5]] },
      { mirror: true, ramp: Array.from({ length: TILE_RAMP_MAX + 1 }, () => [0, 0, 0]) },
    ];
    for (const spec of specs) {
      const out = asked(spec);
      expect(out.answer, JSON.stringify(spec)).toBeNull();
      expect(out.requests, JSON.stringify(spec)).toEqual([]);
    }
  });

  it("refuses an engine answer that is not a tile", () => {
    const registry = new TileFillerRegistry(() => undefined);
    let answer: TileAtlas | null = { attr: 1, char: 1 };
    registry.register((fill) => {
      answer = fill.transform({ attr: 0x80, char: 0x80 }, { mirror: true, ramp: [] });
    }, "mod");
    registry.run(new TileMap(), linoPack, null, () => ({ attr: "red" }) as never);
    expect(answer).toBeNull();
  });
});

/**
 * The player door: the one tile seam that REPLACES an assigned tile.
 *
 * Everything else in this file is about a fill, which can only write a blank.
 * This cannot be a fill - the player is race 0 and every shipped pack assigns
 * it - so the guarantees are different ones, and these are them.
 */
describe("the player-tile door", () => {
  const view = { shape: "werewolf", level: 30, cls: "Druid", race: "Elf" } as const;

  it("answers null with nothing installed, and says so cheaply", () => {
    const registry = new TileFillerRegistry(() => undefined);
    expect(registry.playerProviders).toBe(0);
    expect(registry.playerTile(view)).toBeNull();
  });

  it("takes the FIRST non-null answer in load order", () => {
    /* Which is what lets two such mods coexist: a provider with no opinion
     * returns null and the next one is asked. */
    const seen: string[] = [];
    const registry = new TileFillerRegistry(() => undefined);
    registry.player((v) => {
      seen.push(`a:${String(v.shape)}`);
      return null;
    }, "a");
    registry.player(() => {
      seen.push("b");
      return { attr: 0x81, char: 0x82 };
    }, "b");
    registry.player(() => {
      seen.push("c");
      return { attr: 0x8f, char: 0x8f };
    }, "c");

    expect(registry.playerTile(view)).toEqual({ attr: 0x81, char: 0x82 });
    /* c was never asked, so a provider costs nothing once an earlier one has
     * answered. */
    expect(seen).toEqual(["a:werewolf", "b"]);
  });

  it("hands over the character's shape, level, class and race and nothing else", () => {
    let got: unknown;
    const registry = new TileFillerRegistry(() => undefined);
    registry.player((v) => {
      got = v;
      return null;
    }, "a");
    registry.playerTile({ shape: null, level: 1, cls: "Warrior", race: "Half-Troll" });
    expect(got).toEqual({ shape: null, level: 1, cls: "Warrior", race: "Half-Troll" });
  });

  it("replaces a mod's OWN provider and never another mod's", () => {
    const registry = new TileFillerRegistry(() => undefined);
    registry.player(() => null, "a");
    registry.player(() => ({ attr: 0x83, char: 0x84 }), "a");
    registry.player(() => ({ attr: 0x85, char: 0x86 }), "b");
    expect(registry.playerProviders).toBe(2);
    expect(registry.playerTile(view)).toEqual({ attr: 0x83, char: 0x84 });
  });

  it("survives a provider that throws, and reports it against its mod", () => {
    /* It runs inside the render loop. A provider's bug costs its own answer and
     * the pack's own player tile is drawn - not a dropped frame, and not a
     * black screen. */
    const problems: string[] = [];
    const registry = new TileFillerRegistry((owner, why) => problems.push(`${String(owner)}|${why}`));
    registry.player(() => {
      throw new Error("boom");
    }, "bad");
    registry.player(() => ({ attr: 0x87, char: 0x88 }), "good");
    expect(registry.playerTile(view)).toEqual({ attr: 0x87, char: 0x88 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^bad\|.*boom/u);
  });

  it("refuses an answer that is not a tile, and asks the next provider", () => {
    const problems: string[] = [];
    const registry = new TileFillerRegistry((owner, why) => problems.push(`${String(owner)}|${why}`));
    registry.player(() => ({ attr: "red", char: null }) as never, "bad");
    registry.player(() => ({ attr: 0x89, char: 0x8a }), "good");
    expect(registry.playerTile(view)).toEqual({ attr: 0x89, char: 0x8a });
    expect(problems[0]).toMatch(/not a tile/u);
  });

  it("copies the answer, so a provider cannot hand out a live object", () => {
    const mutable = { attr: 0x8b, char: 0x8c };
    const registry = new TileFillerRegistry(() => undefined);
    registry.player(() => mutable, "a");
    const first = registry.playerTile(view);
    mutable.attr = 0x8e;
    expect(first).toEqual({ attr: 0x8b, char: 0x8c });
  });

  it("refuses a provider that is not a function", () => {
    const registry = new TileFillerRegistry(() => undefined);
    expect(() => registry.player({} as never, "a")).toThrow(/must be a function/);
    expect(registry.playerProviders).toBe(0);
  });

  it("clear() drops providers as well as fillers", () => {
    /* Session teardown: no installed mod means no provider survives, or the
     * next character is drawn by the last one's rules. */
    const registry = new TileFillerRegistry(() => undefined);
    registry.register(() => undefined, "a");
    registry.player(() => ({ attr: 0x81, char: 0x81 }), "a");
    registry.clear();
    expect(registry.playerProviders).toBe(0);
    expect(registry.size).toBe(0);
    expect(registry.playerTile(view)).toBeNull();
  });

  it("is wired into the player's own draw site", () => {
    /* A door with no caller is the failure mode this repository has shipped
     * often enough to test for by name. playerMapGlyph is the is_player branch
     * of grid_data_as_text; if the override is not consulted there, every test
     * above passes and no shapechanged player ever looks different. */
    const main = readFileSync(join(REPO, "packages", "web", "src", "main.ts"), "utf8");
    expect(main).toMatch(/playerTileOverride\(\) \?\? tileForMonster\(tileMap, 0\)/u);
    expect(main).toMatch(/tileRegistry\.playerTile\(/u);
    expect(main).toMatch(/tileRegistry\.playerProviders === 0/u);
  });
});

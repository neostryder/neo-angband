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
  hueDerivedSlots,
  slotFromAtlas,
  slotToAtlas,
  type LinoleumSlot,
} from "./linoleum-pack";
import { TileFillerRegistry } from "./tile-registry";

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
    expect(read("linoleum-pack.ts")).toMatch(/hueDerivedSlots\(index\.slots\)/u);
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
 * `hueDerivedSlots` - the loose-pack engine's derive capability.
 *
 * A hand-made slot table rather than a real pack, and that is the honest way
 * round: the packs are neo-linoleum's art, they are gitignored here, and they are
 * built by that repository. The whole input to a derivation is a slot table and a
 * request, so a two-entry table exercises it exactly.
 */
describe("hueDerivedSlots - a tile of one's own", () => {
  const base: readonly LinoleumSlot[] = [
    { kind: "asset", asset: "mon-donor" },
    { kind: "asset", asset: "obj-donor" },
  ];

  it("allocates one slot per donor and hue, and never rewrites the pack's own", () => {
    const hues = hueDerivedSlots(base);
    const first = hues.derive(slotToAtlas(0), 30)!;
    const second = hues.derive(slotToAtlas(0), 60)!;
    const again = hues.derive(slotToAtlas(0), 30)!;

    expect(first).not.toEqual(slotToAtlas(0));
    expect(first).not.toEqual(second);
    /* Asking twice for the same picture and colour returns the same slot rather
     * than growing the table. */
    expect(again).toEqual(first);
    expect(hues.stats()).toEqual({ derived: 2, overflow: 0 });

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
    const hues = hueDerivedSlots(base);
    expect(hues.derive(slotToAtlas(900), 30)).toBeNull();
    expect(hues.stats()).toEqual({ derived: 0, overflow: 0 });
  });

  it("refuses a derived donor and a rotation of nothing", () => {
    const hues = hueDerivedSlots([...base, { kind: "derived", from: 0, hue: 30 }]);
    /* The renderer will not chain recolours, and a copy of a copy is not more
     * distinctive than the copy. */
    expect(hues.derive(slotToAtlas(2), 60)).toBeNull();
    /* A zero rotation would allocate a slot indistinguishable from its donor. */
    expect(hues.derive(slotToAtlas(0), 0)).toBeNull();
    expect(hues.derive(slotToAtlas(0), 720)).toBeNull();
  });

  it("normalises a hue so the same colour is the same slot", () => {
    const hues = hueDerivedSlots(base);
    expect(hues.derive(slotToAtlas(1), 45)).toEqual(hues.derive(slotToAtlas(1), 405));
    expect(hues.derive(slotToAtlas(1), -315)).toEqual(hues.derive(slotToAtlas(1), 45));
    expect(hues.stats().derived).toBe(1);
  });

  it("is deterministic, and reads nothing outside its arguments", () => {
    /* A tile that changed colour between launches would be worse than a
     * duplicate one, so this is not a nicety. */
    const run = (): unknown => {
      const hues = hueDerivedSlots(base);
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

    const hues = hueDerivedSlots(slots);
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

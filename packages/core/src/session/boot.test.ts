import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import { bindCore, bootLevel } from "./boot";
import type { CorePack } from "./boot";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

// Assemble pack zero exactly as a host would hand it to bindCore.
const pack: CorePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  obj: {
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"),
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as CorePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
};

describe("bindCore", () => {
  it("binds every registry from pack zero", () => {
    const r = bindCore(pack);
    expect(r.constants.maxDepth).toBeGreaterThan(0);
    expect(r.features.byCodeName("FLOOR")).toBeDefined();
    expect(r.objects.ordinaryKindCount).toBe(375);
    expect(r.monsters.races.length).toBeGreaterThan(600);
    expect(r.rooms).toBeDefined();
    expect(r.profiles).toBeDefined();
  });
});

describe("bootLevel", () => {
  it("generates a populated level with a valid player spot", () => {
    const level = bootLevel(pack, { seed: 20260708, depth: 5 });
    expect(level.chunk.width).toBeGreaterThan(0);
    expect(level.chunk.height).toBeGreaterThan(0);

    // Player spot exists and stands on passable floor.
    expect(level.playerSpot).not.toBeNull();
    const spot = level.playerSpot;
    if (spot) expect(level.chunk.isPassable(spot)).toBe(true);

    // At least one down staircase was placed.
    let downStairs = 0;
    for (let y = 0; y < level.chunk.height; y++) {
      for (let x = 0; x < level.chunk.width; x++) {
        if (level.chunk.isDownstairs(loc(x, y))) downStairs++;
      }
    }
    expect(downStairs).toBeGreaterThanOrEqual(1);

    // Content was placed at depth 5.
    expect(level.monsters.length).toBeGreaterThan(0);
    expect(level.objects.length).toBeGreaterThan(0);
  });

  it("is deterministic for a fixed seed", () => {
    const a = bootLevel(pack, { seed: 42, depth: 7 });
    const b = bootLevel(pack, { seed: 42, depth: 7 });
    expect(a.chunk.width).toBe(b.chunk.width);
    expect(a.chunk.height).toBe(b.chunk.height);
    expect(a.playerSpot).toEqual(b.playerSpot);
    expect(a.monsters.length).toBe(b.monsters.length);
    expect(a.objects.length).toBe(b.objects.length);
  });

  it("skips content placement when asked", () => {
    const level = bootLevel(pack, { seed: 1, depth: 5, placeContent: false });
    expect(level.monsters.length).toBe(0);
    expect(level.objects.length).toBe(0);
    // A level is still generated with a player spot.
    expect(level.playerSpot).not.toBeNull();
  });

  it("reuses provided registries without rebinding", () => {
    const registries = bindCore(pack);
    const level = bootLevel(pack, { seed: 3, depth: 2, registries });
    expect(level.registries).toBe(registries);
  });
});

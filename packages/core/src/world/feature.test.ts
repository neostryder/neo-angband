import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, TF } from "../generated/index.js";
import { FeatureRegistry } from "./feature.js";
import type { TerrainRecordJson } from "./feature.js";

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };

describe("FeatureRegistry", () => {
  const reg = new FeatureRegistry(terrain.records);

  it("binds all 25 terrain records at their FEAT indices", () => {
    expect(reg.count()).toBe(25);
    const floor = reg.byCodeName("FLOOR");
    expect(floor.fidx).toBe(FEAT["FLOOR"]);
    expect(reg.get(floor.fidx)).toBe(floor);
  });

  it("binds FLOOR exactly as terrain.txt declares it", () => {
    const floor = reg.byCodeName("FLOOR");
    expect(floor.name).toBe("open floor");
    expect(floor.dChar).toBe(".");
    expect(floor.dAttr).toBe("w");
    expect(floor.priority).toBe(5);
    for (const f of [
      "LOS",
      "PROJECT",
      "PASSABLE",
      "FLOOR",
      "OBJECT",
      "EASY",
      "TRAP",
      "TORCH",
    ]) {
      expect(floor.flags.has((TF as Record<string, number>)[f] as number)).toBe(
        true,
      );
    }
    expect(floor.flags.has(TF["WALL"])).toBe(false);
  });

  it("binds granite as an impassable rock wall", () => {
    const granite = reg.byCodeName("GRANITE");
    expect(granite.flags.has(TF["WALL"])).toBe(true);
    expect(granite.flags.has(TF["GRANITE"])).toBe(true);
    expect(granite.flags.has(TF["ROCK"])).toBe(true);
    expect(granite.flags.has(TF["LOS"])).toBe(false);
    expect(granite.flags.has(TF["PASSABLE"])).toBe(false);
    expect(granite.dig).toBeGreaterThan(0);
  });

  it("permanent walls carry PERMANENT; stairs are stairs", () => {
    expect(reg.byCodeName("PERM").flags.has(TF["PERMANENT"])).toBe(true);
    const up = reg.byCodeName("LESS");
    const down = reg.byCodeName("MORE");
    expect(up.flags.has(TF["STAIR"])).toBe(true);
    expect(up.flags.has(TF["UPSTAIR"])).toBe(true);
    expect(down.flags.has(TF["DOWNSTAIR"])).toBe(true);
  });

  it("shops are PASSABLE doors that never hold objects", () => {
    // terrain.txt: every SHOP entrance carries PASSABLE (so move_player steps the
    // player onto the door, triggering EVENT_ENTER_STORE in player_handle_post_move)
    // but NOT OBJECT - shop tiles never carry a floor pile. That invariant is why
    // store_sell's USE_FLOOR source is always empty (there is no selling of floor
    // items): the seller is always standing on an object-less shop door.
    const shops = terrain.records
      .map((r) => reg.byCodeName(r.code))
      .filter((f) => f.flags.has(TF["SHOP"]));
    expect(shops.length).toBeGreaterThan(0);
    for (const f of shops) {
      expect(f.flags.has(TF["PASSABLE"])).toBe(true);
      expect(f.flags.has(TF["OBJECT"])).toBe(false);
    }
  });

  /*
   * finish_parse_feat's OTHER half (init.c L2249-2257, L2275): shopnum and
   * z_info->store_max. The trailing-space half landed in 872006e4; this is
   * the derivation that went with it.
   */
  describe("finish_parse_feat: shopnum and store_max", () => {
    it("numbers the shops 1..store_max in FEAT order", () => {
      const shops = terrain.records
        .map((r) => reg.byCodeName(r.code))
        .filter((f) => f.flags.has(TF["SHOP"]))
        .sort((a, b) => a.fidx - b.fidx);
      expect(shops.map((f) => f.shopnum)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(reg.storeMax).toBe(8);
      expect(reg.shopFeats()).toEqual(shops.map((f) => f.fidx));
    });

    it("leaves shopnum 0 on everything that is not a shop", () => {
      expect(reg.byCodeName("FLOOR").shopnum).toBe(0);
      expect(reg.byCodeName("LAVA").shopnum).toBe(0);
      expect(reg.byCodeName("SECRET").shopnum).toBe(0);
    });

    it("shopFeats() is the shopnum - 1 lookup square_shopnum does", () => {
      /* cave-square.c L1512 returns f_info[feat].shopnum - 1. */
      const feats = reg.shopFeats();
      for (let n = 0; n < feats.length; n++) {
        expect(reg.get(feats[n] as number).shopnum).toBe(n + 1);
      }
      expect(reg.get(FEAT["STORE_GENERAL"]).shopnum).toBe(1);
      expect(reg.get(FEAT["HOME"]).shopnum).toBe(8);
    });

    it("gains a store when a mod flags another terrain SHOP", () => {
      /* The consequence a hard-coded eight-feature list cannot have.
       * Composition replaces a record's `flags:` array wholesale, so this is
       * exactly the shape a mod's terrain patch arrives in. SECRET sorts
       * (FEAT_SECRET = 15) after HOME, so it becomes store 9. */
      const patched = terrain.records.map((r) =>
        r.code === "SECRET"
          ? { ...r, flags: [...(r.flags ?? []), "SHOP"] }
          : r,
      );
      const modded = new FeatureRegistry(patched);
      expect(modded.storeMax).toBe(9);
      expect(modded.byCodeName("SECRET").shopnum).toBe(9);
      expect(modded.shopFeats()[8]).toBe(FEAT["SECRET"]);
      /* The eight shipped entrances keep their numbers. */
      expect(modded.get(FEAT["HOME"]).shopnum).toBe(8);
    });

    it("renumbers from 1 when a mod clears a SHOP flag", () => {
      /* Upstream's ++shop_idx is positional, so dropping the General Store
       * shifts every later shop down one - the same renumbering a data-driven
       * store_max has to accept. */
      const patched = terrain.records.map((r) =>
        r.code === "STORE_GENERAL"
          ? {
              ...r,
              flags: (r.flags ?? []).map((line) =>
                line
                  .split("|")
                  .map((t) => t.trim())
                  .filter((t) => t !== "SHOP")
                  .join(" | "),
              ),
            }
          : r,
      );
      const modded = new FeatureRegistry(patched);
      expect(modded.storeMax).toBe(7);
      expect(modded.byCodeName("STORE_GENERAL").shopnum).toBe(0);
      expect(modded.get(FEAT["STORE_ARMOR"]).shopnum).toBe(1);
      expect(modded.get(FEAT["HOME"]).shopnum).toBe(7);
    });
  });

  it("resolves mimic references to feature indices", () => {
    const mimicking = terrain.records.filter((r) => r.mimic !== undefined);
    expect(mimicking.length).toBe(1);
    const rec = mimicking[0] as TerrainRecordJson;
    const f = reg.byCodeName(rec.code);
    expect(f.mimic).toBe(reg.byCodeName(rec.mimic as string).fidx);
  });

  it("looks up by name for gamedata cross-references", () => {
    expect(reg.lookupByName("open floor")?.code).toBe("FLOOR");
    expect(reg.lookupByName("nonesuch")).toBeNull();
  });

  it("rejects unknown flags and codes", () => {
    expect(
      () =>
        new FeatureRegistry([
          { code: "FLOOR", name: "x", flags: ["NOT_A_FLAG"] },
        ]),
    ).toThrow(/unknown flag/);
    expect(
      () => new FeatureRegistry([{ code: "NOT_A_CODE", name: "x" }]),
    ).toThrow(/not in list-terrain/);
  });
});

/**
 * `mimic:` NAMES ANOTHER TERRAIN RECORD, the same mod-appendable list `code:`
 * cannot be (FEAT codes are the fixed table list-terrain.h compiles). A mod
 * can still patch an existing feature's `mimic:` to point at a feature a
 * sibling mod supplies, and the miss used to throw `terrain: mimic not found`
 * out of `bindCore` for the whole game over one feature's display alias.
 */
describe("a terrain mimic reference a mod got wrong", () => {
  const BROKEN: TerrainRecordJson = {
    code: "FLOOR",
    name: "open floor",
    mimic: "NOT_A_CODE",
  };

  it("throws when nothing touched the record", () => {
    expect(() => new FeatureRegistry([BROKEN])).toThrow(
      /terrain: mimic not found: NOT_A_CODE/,
    );
  });

  it("drops the mimic and names the mod when a mod wrote it", () => {
    const rec = { ...BROKEN, $from: { owner: "mod-a" } };
    const modded = new FeatureRegistry([rec]);

    expect(modded.refused).toEqual([
      expect.objectContaining({
        file: "terrain",
        record: "FLOOR",
        field: "mimic",
        id: "mod-a",
        why: expect.stringContaining("mimic not found: NOT_A_CODE"),
      }),
    ]);
    /* THE FEATURE SURVIVES, drawn with its own glyph instead of the target's. */
    expect(modded.byCodeName("FLOOR").mimic).toBeNull();
  });

  it("refuses nothing at all for the shipped pack", () => {
    expect(new FeatureRegistry(terrain.records).refused).toEqual([]);
  });
});

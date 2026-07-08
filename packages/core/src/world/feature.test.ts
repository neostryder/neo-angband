import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, TF } from "../generated";
import { FeatureRegistry } from "./feature";
import type { TerrainRecordJson } from "./feature";

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

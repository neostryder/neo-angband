import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import { Chunk } from "./chunk";
import { FeatureRegistry } from "./feature";
import type { TerrainRecordJson } from "./feature";
import { makeNoise, updateScent } from "./flow";
import type { FlowSource } from "./flow";

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };

const reg = new FeatureRegistry(terrain.records);
const FLOOR = reg.byCodeName("FLOOR").fidx;
const GRANITE = reg.byCodeName("GRANITE").fidx;

function openField(w: number, h: number): Chunk {
  const c = new Chunk(reg, h, w);
  c.fill(GRANITE);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      c.setFeat(loc(x, y), FLOOR);
    }
  }
  return c;
}

function src(x: number, y: number, covert = false): FlowSource {
  return { grid: loc(x, y), covertTracks: covert };
}

function noiseAt(c: Chunk, x: number, y: number): number {
  return c.noise[y * c.width + x] as number;
}

function scentAt(c: Chunk, x: number, y: number): number {
  return c.scent[y * c.width + x] as number;
}

describe("makeNoise", () => {
  it("floods outward: 0 at the player, distance elsewhere", () => {
    const c = openField(30, 20);
    makeNoise(c, src(10, 10));
    expect(noiseAt(c, 10, 10)).toBe(0);
    expect(noiseAt(c, 11, 10)).toBe(1);
    expect(noiseAt(c, 11, 11)).toBe(1);
    expect(noiseAt(c, 12, 10)).toBe(2);
    expect(noiseAt(c, 13, 13)).toBe(3);
  });

  it("does not flow through walls; sound routes around them", () => {
    const c = openField(30, 20);
    // Wall column at x = 10, one gap at the top.
    for (let y = 1; y < 19; y++) c.setFeat(loc(10, y), GRANITE);
    c.setFeat(loc(10, 2), FLOOR);
    makeNoise(c, src(8, 10));
    // The wall itself stays silent.
    expect(noiseAt(c, 10, 10)).toBe(0);
    // Straight across the wall is close as the crow flies (distance 4)
    // but the sound had to travel up through the gap and back down.
    expect(noiseAt(c, 12, 10)).toBeGreaterThan(10);
  });

  it("covered tracks step the noise level by 4 instead of 1", () => {
    const c = openField(30, 20);
    makeNoise(c, src(10, 10, true));
    expect(noiseAt(c, 10, 10)).toBe(0);
    expect(noiseAt(c, 11, 10)).toBe(4);
    expect(noiseAt(c, 12, 10)).toBe(8);
  });
});

describe("updateScent", () => {
  it("stamps the 5x5 pattern with upstream's exact row-order quirk", () => {
    const c = openField(30, 20);
    updateScent(c, src(10, 10));
    // Player grid carries 0 (never smelled), inner ring 1, and the
    // BOTTOM outer ring 2. The TOP outer row is processed before any
    // ring-1 scent exists to connect to, so on a fresh map it stays 0 -
    // exactly as upstream's row-major stamp behaves.
    expect(scentAt(c, 10, 10)).toBe(0);
    expect(scentAt(c, 9, 10)).toBe(1);
    expect(scentAt(c, 11, 11)).toBe(1);
    expect(scentAt(c, 10, 12)).toBe(2);
    expect(scentAt(c, 8, 10)).toBe(2);
    expect(scentAt(c, 10, 8)).toBe(0);
  });

  it("ages the trail as the player moves on", () => {
    const c = openField(30, 20);
    updateScent(c, src(10, 10));
    updateScent(c, src(15, 10));
    // The old inner ring aged from 1 to 2 and lies outside the new stamp.
    expect(scentAt(c, 9, 10)).toBe(2);
    // Fresh scent at the new position.
    expect(scentAt(c, 14, 10)).toBe(1);
  });

  it("covered tracks age old scent but lay none", () => {
    const c = openField(30, 20);
    updateScent(c, src(10, 10));
    updateScent(c, src(15, 10, true));
    expect(scentAt(c, 9, 10)).toBe(2);
    expect(scentAt(c, 14, 10)).toBe(0);
  });

  it("walls never take scent", () => {
    const c = openField(30, 20);
    c.setFeat(loc(9, 10), GRANITE);
    updateScent(c, src(10, 10));
    expect(scentAt(c, 9, 10)).toBe(0);
  });
});

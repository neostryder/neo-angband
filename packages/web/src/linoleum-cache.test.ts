import { describe, expect, it } from "vitest";
import { linoleumPackFormat, linoleumTileMapFormat, parseDocument, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
import { readLegacySelectors } from "@rpgm-tools/neo-angband-linoleum";
import {
  ensureLinoleumTilesheetPack,
  tileMapPrefSources,
  type LinoleumCacheStore,
  type LinoleumConverter,
} from "./linoleum-cache";

function packBytes(packId = "x", displayName = "X"): Uint8Array {
  return new TextEncoder().encode(serializeDocument(linoleumPackFormat, {
    packId,
    displayName,
    imageFormat: "png",
    resolution: 8,
    targets: [{ type: "feat", selector: "FLOOR", kind: "asset", value: "floor" }],
  }, { compact: true }));
}

const source = {
  key: "gervais",
  packId: "linoleum-gervais",
  displayName: "David Gervais' tiles (Linoleum)",
  cacheKey: "source-v1",
  image: "source/32x32.png",
  prefFiles: ["source/graf-dvg.prf"],
  resolution: 32,
};

function memoryStore(): LinoleumCacheStore & { writes: number; keys: () => string[] } {
  const files = new Map<string, Uint8Array>();
  let writes = 0;
  return {
    get: async (key) => files.get(key) ?? null,
    put: async (entries) => {
      writes += 1;
      for (const [key, value] of entries) files.set(key, value);
      return true;
    },
    remove: async (keys) => {
      for (const key of keys) files.delete(key);
      return true;
    },
    get writes() {
      return writes;
    },
    keys: () => [...files.keys()].sort(),
  };
}

describe("ensureLinoleumTilesheetPack", () => {
  it("reads JSON source selectors with variants and conditions", () => {
    const text = serializeDocument(linoleumTileMapFormat, {
      files: [{ name: "graf-dvg.prf", selectors: [
        { type: "feat", selector: "FLOOR:lit", row: 0, column: 33 },
        { type: "monster", selector: "kobold:when:[EQU $CLASS Warrior]", row: 1, column: 4, condition: "[EQU $CLASS Warrior]" },
      ] }],
    });
    const parsed = parseDocument(text, linoleumTileMapFormat);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const entries = readLegacySelectors(tileMapPrefSources(parsed.data)!);
    expect(entries.map((entry) => entry.exactSelectorValue)).toEqual([
      "FLOOR:lit",
      "kobold:when:[EQU $CLASS Warrior]",
    ]);
    expect(entries.map((entry) => [entry.row, entry.column])).toEqual([[0, 33], [1, 4]]);
    expect(serializeDocument(linoleumTileMapFormat, parsed.data)).toBe(text);
  });
  it("converts Gervais once and resolves the persisted loose pack on the next enable", async () => {
    const cache = memoryStore();
    let conversions = 0;
    const converter: LinoleumConverter = async () => {
      conversions += 1;
      return [
        ["pack.json", packBytes("linoleum-gervais", "Gervais")],
        ["images/32/floor.png", new Uint8Array([137, 80, 78, 71])],
      ];
    };
    const original = async (): Promise<string | null> => null;

    await ensureLinoleumTilesheetPack({
      modId: "linoleum",
      source,
      resolve: original,
      cache,
      converter,
    });
    await ensureLinoleumTilesheetPack({
      modId: "linoleum",
      source,
      resolve: original,
      cache,
      converter,
    });

    expect(conversions).toBe(1);
    expect(cache.writes).toBe(1);
    expect(cache.keys()).toEqual([
      "linoleum/gervais/source-v1/images/32/floor.png",
      "linoleum/gervais/source-v1/pack.json",
    ]);
  });

  it("reports conversion activity only for the cache-miss conversion", async () => {
    const cache = memoryStore();
    const activity: string[] = [];
    const converter: LinoleumConverter = async () => [["pack.json", packBytes()]];
    const input = {
      modId: "m",
      source,
      resolve: async () => null,
      cache,
      converter,
      onConversionStart: () => activity.push("start"),
      onConversionFinish: () => activity.push("finish"),
    };

    await ensureLinoleumTilesheetPack(input);
    await ensureLinoleumTilesheetPack(input);

    expect(activity).toEqual(["start", "finish"]);
  });

  it("uses a new cache namespace when a mod changes its source revision", async () => {
    const cache = memoryStore();
    let conversions = 0;
    const converter: LinoleumConverter = async () => {
      conversions += 1;
      return [["pack.json", packBytes()]];
    };
    const original = async (): Promise<string | null> => null;
    await ensureLinoleumTilesheetPack({ modId: "m", source, resolve: original, cache, converter });
    await ensureLinoleumTilesheetPack({
      modId: "m",
      source: { ...source, cacheKey: "source-v2" },
      resolve: original,
      cache,
      converter,
    });
    expect(conversions).toBe(2);
  });

  it("keeps a generated pack usable for this enable when persistent storage is unavailable", async () => {
    const converter: LinoleumConverter = async () => [["pack.json", packBytes()]];
    const resolve = await ensureLinoleumTilesheetPack({
      modId: "m",
      source,
      resolve: async () => null,
      cache: null,
      converter,
    });
    const url = await resolve("pack.json");
    expect(url).not.toBeNull();
    const parsed = parseDocument(await (await fetch(url!)).text(), linoleumPackFormat);
    expect(parsed.ok && parsed.data.packId).toBe("x");
  });

  it("converts a cached text pack once and drops the old keys", async () => {
    const cache = memoryStore();
    const prefix = "linoleum/gervais/source-v1/";
    await cache.put([
      [`${prefix}manifest.txt`, new TextEncoder().encode("pack:linoleum-gervais:Gervais\nformat:png\nresolution:32\nmap:targets:maps/targets.txt\n")],
      [`${prefix}maps/targets.txt`, new TextEncoder().encode("target:feat:FLOOR:asset:floor\n")],
      [`${prefix}graf-dvg.prf`, new TextEncoder().encode("feat:FLOOR:0x80:0x81\n")],
      [`${prefix}images/32/floor.png`, new Uint8Array([1])],
    ]);
    let conversions = 0;
    const resolve = await ensureLinoleumTilesheetPack({
      modId: "linoleum",
      source,
      resolve: async () => null,
      cache,
      converter: async () => {
        conversions += 1;
        return null;
      },
    });
    expect(conversions).toBe(0);
    expect(cache.keys().some((key) => key.endsWith("manifest.txt"))).toBe(false);
    expect(cache.keys().some((key) => key.endsWith(".prf"))).toBe(false);
    expect(cache.keys()).toContain(`${prefix}pack.json`);
    expect(cache.keys()).toContain(`${prefix}tile-map.json`);
    expect(cache.keys()).toContain(`${prefix}images/32/floor.png`);
    const parsed = parseDocument(await (await fetch((await resolve("pack.json"))!)).text(), linoleumPackFormat);
    expect(parsed.ok && parsed.data.targets[0]?.value).toBe("floor");
  });

  it("leaves corrupt and future cached documents untouched", async () => {
    for (const body of ["{broken", '{"format":"neo-angband/linoleum/pack","schemaVersion":99,"data":{}}']) {
      const cache = memoryStore();
      const key = "linoleum/gervais/source-v1/pack.json";
      await cache.put([[key, new TextEncoder().encode(body)]]);
      const before = cache.writes;
      let conversions = 0;
      const resolve = await ensureLinoleumTilesheetPack({
        modId: "linoleum", source, resolve: async () => null, cache,
        converter: async () => { conversions++; return null; },
      });
      expect(conversions).toBe(0);
      expect(cache.writes).toBe(before);
      expect(await (await fetch((await resolve("pack.json"))!)).text()).toBe(body);
    }
  });
});

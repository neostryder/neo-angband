import { describe, expect, it } from "vitest";
import {
  ensureLinoleumTilesheetPack,
  type LinoleumCacheStore,
  type LinoleumConverter,
} from "./linoleum-cache";

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
    get writes() {
      return writes;
    },
    keys: () => [...files.keys()].sort(),
  };
}

describe("ensureLinoleumTilesheetPack", () => {
  it("converts Gervais once and resolves the persisted loose pack on the next enable", async () => {
    const cache = memoryStore();
    let conversions = 0;
    const converter: LinoleumConverter = async () => {
      conversions += 1;
      return [
        ["manifest.txt", new TextEncoder().encode("pack:linoleum-gervais:Gervais\nresolution:32\n")],
        ["maps/targets.txt", new TextEncoder().encode("target:feat:FLOOR:asset:floor\n")],
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
      "linoleum/gervais/source-v1/manifest.txt",
      "linoleum/gervais/source-v1/maps/targets.txt",
    ]);
  });

  it("uses a new cache namespace when a mod changes its source revision", async () => {
    const cache = memoryStore();
    let conversions = 0;
    const converter: LinoleumConverter = async () => {
      conversions += 1;
      return [["manifest.txt", new TextEncoder().encode("pack:x:X\nresolution:8\n")]];
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
    const converter: LinoleumConverter = async () => [
      ["manifest.txt", new TextEncoder().encode("pack:x:X\nresolution:8\n")],
    ];
    const resolve = await ensureLinoleumTilesheetPack({
      modId: "m",
      source,
      resolve: async () => null,
      cache: null,
      converter,
    });
    const url = await resolve("manifest.txt");
    expect(url).not.toBeNull();
    expect(await (await fetch(url!)).text()).toContain("pack:x:X");
  });
});

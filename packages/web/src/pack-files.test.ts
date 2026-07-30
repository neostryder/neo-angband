/**
 * How a pack-relative path becomes a URL, for all three places a mod can come
 * from.
 *
 * These used to live beside the loose-pack engine, when only that engine took a
 * resolver. Both engines take one now (a tilesheet mod is as likely to be
 * installed from a repository as a loose pack is), so the rules live with the
 * other shared pack-file rules and are tested once.
 */

import { describe, expect, it } from "vitest";
import {
  assetMime,
  encodePackPath,
  sortPackFiles,
  subPackResolver,
  urlBaseResolver,
  type PackFileResolver,
} from "./pack-files";

describe("encodePackPath", () => {
  it("encodes per segment, so a / stays a separator and a space does not", () => {
    expect(encodePackPath("maps/targets.txt")).toBe("maps/targets.txt");
    expect(encodePackPath("images/8/my tile.png")).toBe("images/8/my%20tile.png");
  });

  it("escapes the characters that would truncate a URL", () => {
    // A pack that names a tile with a # or ? must not have the rest of the URL
    // read as a fragment or a query.
    expect(encodePackPath("images/8/a#b?c.png")).toBe("images/8/a%23b%3Fc.png");
  });
});

describe("urlBaseResolver", () => {
  it("joins onto the base, adding the separator only when it is missing", async () => {
    expect(await urlBaseResolver("mods/p")("manifest.txt")).toBe("mods/p/manifest.txt");
    expect(await urlBaseResolver("mods/p/")("manifest.txt")).toBe("mods/p/manifest.txt");
  });

  it("encodes what it appends", async () => {
    expect(await urlBaseResolver("mods/p")("images/8/my tile.png")).toBe(
      "mods/p/images/8/my%20tile.png",
    );
  });

  it("leaves the base alone, so an absolute or cross-origin base survives", async () => {
    expect(await urlBaseResolver("https://cdn.example/a b")("t.png")).toBe(
      "https://cdn.example/a b/t.png",
    );
  });
});

describe("subPackResolver", () => {
  /** Every path the inner resolver was asked for, in order. */
  function recorder(): { asked: string[]; resolve: PackFileResolver } {
    const asked: string[] = [];
    return {
      asked,
      resolve: (rel) => {
        asked.push(rel);
        return Promise.resolve(`url:${rel}`);
      },
    };
  }

  it("prefixes the directory onto every request", async () => {
    const inner = recorder();
    const sub = subPackResolver(inner.resolve, "original-tiles");
    expect(await sub("manifest.txt")).toBe("url:original-tiles/manifest.txt");
    expect(await sub("images/8/floor.png")).toBe("url:original-tiles/images/8/floor.png");
    expect(inner.asked).toEqual([
      "original-tiles/manifest.txt",
      "original-tiles/images/8/floor.png",
    ]);
  });

  it("nests, so a pack several directories deep needs no special case", async () => {
    const inner = recorder();
    const sub = subPackResolver(inner.resolve, "tiles/my-set");
    expect(await sub("manifest.txt")).toBe("url:tiles/my-set/manifest.txt");
  });

  /*
   * The point of composing rather than string-joining: the inner resolver may be an
   * IndexedDB read or a blob mint, so there is no base to concatenate onto. A
   * subdirectory has to be expressed as a path the SOURCE is asked for.
   */
  it("passes a pack path through a source that has no URL of its own", async () => {
    const bytes = new Map<string, string>([
      ["original-tiles/manifest.txt", "blob:neo/1"],
    ]);
    const sub = subPackResolver((rel) => Promise.resolve(bytes.get(rel) ?? null), "original-tiles");
    expect(await sub("manifest.txt")).toBe("blob:neo/1");
    expect(await sub("maps/targets.txt")).toBeNull();
  });

  it("tolerates a leading or trailing slash in the declared directory", async () => {
    const inner = recorder();
    for (const dir of ["pack/", "/pack", "./pack", "pack//"]) {
      expect(await subPackResolver(inner.resolve, dir)("m.txt")).toBe("url:pack/m.txt");
    }
  });

  /*
   * An empty directory means the pack IS the mod folder, and returning the resolver
   * unchanged is what keeps `//` out of the path a source is asked for - a source
   * that looks its files up in a Map would miss every one of them.
   */
  it("is the identity for an empty or dot directory", () => {
    const inner = recorder();
    expect(subPackResolver(inner.resolve, "")).toBe(inner.resolve);
    expect(subPackResolver(inner.resolve, ".")).toBe(inner.resolve);
    expect(subPackResolver(inner.resolve, "/")).toBe(inner.resolve);
  });
});

/*
 * sortPackFiles and assetMime are the other half of this module and are pinned by
 * the readers that consume them (mod-folder, mod-install, disk-packs). One case
 * each here so the module's own contract is stated in one place.
 */
describe("the file-sorting rule", () => {
  it("takes only TOP-LEVEL json as record contributions", () => {
    const sorted = sortPackFiles([
      "manifest.json",
      "monster.json",
      "data/spawn.json",
      "plugin.js",
      "lib/dice.mjs",
      "tiles/orc.png",
    ]);
    expect(sorted.files).toEqual(["manifest.json", "monster.json"]);
    expect(sorted.code).toEqual(["plugin.js", "lib/dice.mjs"]);
    expect(sorted.assets).toEqual(["data/spawn.json", "tiles/orc.png"]);
  });

  it("types an asset by extension, and says nothing about one it does not know", () => {
    expect(assetMime("tiles/orc.PNG")).toBe("image/png");
    expect(assetMime("data/thing.xyz")).toBe("");
  });
});

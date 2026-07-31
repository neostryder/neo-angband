/**
 * The Graphics menu's mode list: core's own tile sets, then mods on top.
 *
 * The load-bearing test here is the first one. Upstream, tile sets are core
 * game data - lib/tiles/list.txt parsed by grafmode.c, walked straight into each
 * frontend's Graphics menu (main-win.c:2897-2905) - and 4.2.6 has no mod system,
 * so a stock install MUST offer them. The port once made the bundled
 * neo-linoleum mod the "registry of record" for the four bundled packs, which
 * left a faithful (all mods off) install with ASCII and nothing else. That was a
 * port-vs-C disparity; these tests pin the fix.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { GRAPHICS_MODE_CATALOG, GRAPHICS_NONE } from "@neo-angband/core";
import { ALL_PACKS } from "@neo-angband/linoleum";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_TILE_DIRECTORIES,
  composeTileModes,
  coreTileModes,
} from "./tile-catalog";
import { BUNDLED_MODS_BASE, tilePackResolver } from "./tile-mods";
import type { TileModePack } from "./tile-mods";

const TILES_DIR = join(import.meta.dirname, "..", "public", "tiles");
const SRC_DIR = import.meta.dirname;
const MODS_DIR = join(import.meta.dirname, "..", "mods");
const read = (name: string): string => readFileSync(join(SRC_DIR, name), "utf8");

describe("coreTileModes", () => {
  it("offers ALL SIX upstream tile sets with NO mod involved", () => {
    // grafmode.c is core: the catalog exists whether or not anything is modded.
    //
    // This asserted four modes while Shockbolt's art was withheld on licence
    // grounds - the port's one deliberate deviation from the C's menu. Raymond
    // Gaustadnes granted this project free non-commercial use, the art ships, and
    // the deviation is gone: a stock install offers exactly what list.txt lists.
    const modes = coreTileModes({});
    expect(modes.map((m) => m.grafID)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(modes.map((m) => m.menuname)).toEqual([
      "Original Tiles",
      "Adam Bolt's tiles",
      "David Gervais' tiles",
      "Nomad's tiles",
      "Shockbolt Dark",
      "Shockbolt Light",
    ]);
    // No mod attribution: these rows are the game's own content, and the menu
    // tags a row ONLY when a mod supplied it.
    expect(modes.some((m) => m.modName !== undefined || m.modId !== undefined)).toBe(
      false,
    );
    // Core rows carry no pack path and no resolver - they load from the shell's
    // own tile base.
    expect(modes.every((m) => m.path === undefined)).toBe(true);
    expect(modes.every((m) => m.resolve === undefined)).toBe(true);
  });

  it("still omits a catalogued mode whose art is genuinely absent", () => {
    // The filter is what the Shockbolt case used to exercise, and it still has a
    // job: a row with no atlas on disk would render nothing. Pinned with an
    // injected catalog now that every real mode ships.
    const modes = coreTileModes({
      catalog: [
        ...GRAPHICS_MODE_CATALOG,
        {
          grafID: 99,
          menuname: "Nonexistent",
          directory: "not-on-disk",
          file: "99x99.png",
          pref: "graf-non.prf",
          cellWidth: 99,
          cellHeight: 99,
          alphablend: 0,
          overdrawRow: 0,
          overdrawMax: 0,
        },
      ],
    });
    expect(modes.some((m) => m.grafID === 99)).toBe(false);
  });

  it("offers the WHOLE catalog once the player supplies their own pack", () => {
    // With ?tiles=<url> we cannot know what the pack holds, and neither does
    // upstream - it lists what list.txt says and degrades if an image is
    // missing, so the bundled-art restriction lifts entirely.
    const modes = coreTileModes({ customBaseUrl: true });
    expect(modes.map((m) => m.grafID)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("never offers ASCII as a catalog row (the caller adds it)", () => {
    const modes = coreTileModes({ customBaseUrl: true });
    expect(modes.some((m) => m.grafID === GRAPHICS_NONE)).toBe(false);
  });

  it("skips a catalog entry with no atlas file, which nothing could render", () => {
    const modes = coreTileModes({
      catalog: [
        { ...GRAPHICS_MODE_CATALOG[0]!, grafID: 1, file: "" },
        { ...GRAPHICS_MODE_CATALOG[1]!, grafID: 2 },
      ],
      bundled: ["old", "adam-bolt"],
    });
    expect(modes.map((m) => m.grafID)).toEqual([2]);
  });

  it("keeps catalog (grafID) order, matching the C's menu walk", () => {
    const modes = coreTileModes({ customBaseUrl: true });
    expect(modes.map((m) => m.grafID)).toEqual(
      [...modes].map((m) => m.grafID).sort((a, b) => a - b),
    );
  });
});

describe("BUNDLED_TILE_DIRECTORIES", () => {
  // The list decides which core modes are offerable, so it has to match reality
  // in BOTH directions or the menu offers art that 404s (or hides art that ships).
  const onDisk = readdirSync(TILES_DIR).filter((n) =>
    statSync(join(TILES_DIR, n)).isDirectory(),
  );

  it("lists exactly the tile pack directories that ship", () => {
    expect([...BUNDLED_TILE_DIRECTORIES].sort()).toEqual([...onDisk].sort());
  });

  it("has the atlas + pref files each catalogued mode needs", () => {
    for (const mode of GRAPHICS_MODE_CATALOG) {
      if (!BUNDLED_TILE_DIRECTORIES.includes(mode.directory)) continue;
      const files = readdirSync(join(TILES_DIR, mode.directory));
      expect(files, `${mode.menuname} atlas`).toContain(mode.file);
      expect(files, `${mode.menuname} prefs`).toContain(mode.pref);
    }
  });

  it("ships Shockbolt's art, under the permission its author granted", () => {
    // The inverse of this assertion stood here while the art was withheld. This
    // is now the place that fails loudly if someone removes the art again, and
    // the CREDITS.md checks below are what keep the shipped art from losing the
    // three things the licence actually requires: the author's copyright, the
    // non-commercial condition, and the "ask him yourself" pointer.
    expect(onDisk).toContain("shockbolt");
    expect(BUNDLED_TILE_DIRECTORIES).toContain("shockbolt");
    const credits = readFileSync(join(TILES_DIR, "CREDITS.md"), "utf8").toLowerCase();
    expect(credits).toContain("gaustadnes");
    expect(credits).toContain("with the author's permission");
    expect(credits).toContain("non-commercial");
    expect(credits).toContain("contact");
    // And no contact ADDRESS: he consented to being asked, not to being listed.
    expect(credits).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

describe("composeTileModes", () => {
  const core = coreTileModes({});
  const pack = (over: Partial<TileModePack>): TileModePack => ({
    grafID: 1,
    menuname: "Original Tiles",
    modId: "m",
    modName: "A Mod",
    ...over,
  });

  it("leaves core's list alone when no mod contributes", () => {
    expect(composeTileModes({ core, mods: [] })).toEqual(core);
  });

  it("lets a mod re-skin a core set IN PLACE, tagged with the mod", () => {
    const out = composeTileModes({
      core,
      mods: [pack({ grafID: 2, menuname: "Adam Bolt's tiles", path: "tiles" })],
    });
    // Same rows, same order - the mod replaced one, it did not append a duplicate.
    expect(out.map((m) => m.grafID)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out[1]?.modName).toBe("A Mod");
    expect(out[1]?.path).toBe("tiles");
    // Untouched rows stay untagged, so the menu still distinguishes them.
    expect(out.filter((m) => m.modName !== undefined)).toHaveLength(1);
  });

  it("appends a mode core does not offer - a grafID outside upstream's catalog", () => {
    /* This used to use Shockbolt's mode 5 as the example of "a mode core does not
     * offer". Core offers all six catalog modes now, so the only way a mod can
     * APPEND rather than replace is with a grafID upstream never assigned - which
     * is what neo-linoleum actually does (101). Using a real out-of-catalog id
     * keeps the test about the append path instead of about a licence. */
    const out = composeTileModes({
      core,
      mods: [
        pack({
          grafID: 101,
          menuname: "Original Tiles (Linoleum)",
          modName: "neo-linoleum",
          path: "original-tiles",
        }),
      ],
    });
    expect(out.map((m) => m.grafID)).toEqual([1, 2, 3, 4, 5, 6, 101]);
    expect(out[6]?.modName).toBe("neo-linoleum");
  });

  it("does not mutate the core list it was given", () => {
    const original = coreTileModes({});
    composeTileModes({ core: original, mods: [pack({ grafID: 1 })] });
    expect(original[0]?.modName).toBeUndefined();
  });

  it("carries a mod pack's path AND resolver through, so the mod's art is fetched", () => {
    // The resolver is what actually fetches - dropping it here would leave the
    // mod's row drawing core's atlas out of the shell's own tile base, which is
    // exactly the silent wrong-art failure this field exists to prevent.
    const resolve = (rel: string): Promise<string> => Promise.resolve(`blob:${rel}`);
    const out = composeTileModes({
      core,
      mods: [pack({ grafID: 4, path: "tiles", resolve })],
    });
    expect(out.find((m) => m.grafID === 4)?.path).toBe("tiles");
    expect(out.find((m) => m.grafID === 4)?.resolve).toBe(resolve);
    // Core rows keep neither: they load from the shell's own tile base.
    expect(out.find((m) => m.grafID === 1)?.path).toBeUndefined();
    expect(out.find((m) => m.grafID === 1)?.resolve).toBeUndefined();
  });

  it("carries a pack's engine through, so a loose pack is drawn as one", () => {
    const out = composeTileModes({
      core,
      mods: [pack({ grafID: 101, engine: "linoleum", path: "pack" })],
    });
    expect(out.find((m) => m.grafID === 101)?.engine).toBe("linoleum");
    // Core rows say nothing: they are tilesheets, upstream's own scheme.
    expect(out.find((m) => m.grafID === 1)?.engine).toBeUndefined();
  });

  it("keeps the first contributor when two mods claim one grafID", () => {
    // enabledTileModes already dedupes by grafID; this holds the composition
    // side to the same rule rather than letting a later mod silently win a row
    // an earlier one had taken. A mod may override CORE, never another mod.
    const out = composeTileModes({
      core,
      mods: [
        pack({ grafID: 3, modId: "first", modName: "First" }),
        pack({ grafID: 3, modId: "second", modName: "Second" }),
      ],
    });
    expect(out.map((m) => m.grafID)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out[2]?.modName).toBe("First");
  });
});

describe("the game does not know or expect any particular mod", () => {
  // neostryder's rule, and 4.2.6's reality: a mod adds itself to the game when loaded;
  // the game never reaches for one. These guards are cheap and catch the exact
  // regression that happened - a bundled mod quietly becoming load-bearing for a
  // core feature. Test files are exempt: naming a mod in a fixture is fine.
  const GRAPHICS_SOURCES = [
    "tile-catalog.ts",
    "tile-mods.ts",
    "tiles.ts",
    "options.ts",
  ];

  /**
   * `linoleum` is the one bundled mod id these sources may contain, because the
   * token there names a tile FORMAT and its engine (@neo-angband/linoleum, the
   * workspace package, and docs/LINOLEUM.md), not the mod. The shell can read
   * that format the way it can read a PNG; what it must not do is depend on a
   * mod to have tile sets at all, which the other tests here pin.
   */
  const FORMAT_NAMES = ["linoleum"];

  it("names no specific mod anywhere in the graphics subsystem", () => {
    for (const file of GRAPHICS_SOURCES) {
      const src = read(file);
      for (const id of readdirSync(MODS_DIR)) {
        if (FORMAT_NAMES.includes(id)) continue;
        expect(src.toLowerCase(), `${file} names the ${id} mod`).not.toContain(id);
      }
    }
  });

  it("keeps every CORE tile set on the tilesheet engine upstream describes", () => {
    // The loose-pack engine can only ever arrive with a mod: list.txt data
    // describes an atlas plus a pref file, so that is what core modes are.
    for (const mode of coreTileModes({ customBaseUrl: true })) {
      expect(mode.engine, `${mode.menuname} must be a tilesheet`).toBeUndefined();
    }
  });

  it("builds the Graphics menu from the CORE catalog, not from a mod list", () => {
    const main = read("main.ts");
    // Core first, mods layered on: if this ever becomes mods-only again, the
    // stock install goes back to ASCII-only.
    expect(main).toMatch(/composeTileModes\(\{\s*core: coreTileModes\(/);
    expect(main).toMatch(/mods: discoverEnabledTileModes\(\)/);
    // And the dead-end scaffolding that the mods-only menu needed is gone.
    expect(main).not.toContain("disabledProviders");
  });

  it("loads each mode's art through ITS OWN resolver, core's base or the mod's", () => {
    const main = read("main.ts");
    // ONE resolver per mode, handed to both halves of the tilesheet load. When
    // these were two separate `base` arguments a mod could - and briefly did -
    // fetch its atlas from one place and its pref files from another.
    expect(main).toMatch(/const resolve = tileResolverFor\(entry\)/);
    expect(main).toMatch(/createTileRenderer\(\{ resolve, grafID \}\)/);
    expect(main).toMatch(/loadTilePrefs\(resolve, mode, \{\s*\.\.\.tileDeps,/);
    // And the loose engine takes the same resolver, so `path` cannot come to
    // mean one thing per engine.
    expect(main).toMatch(/resolve: tileResolverFor\(entry\)/);
  });

  // main.ts boots a real game at module scope, so it cannot be imported here;
  // these two pin its wiring at the source level instead. Both are things no
  // unit test can see and the equivalence test assumes.
  it("routes a loose-pack mode to the loose engine", () => {
    const main = read("main.ts");
    expect(main).toMatch(/entry\?\.engine === "linoleum"/);
    expect(main).toMatch(/await loadLinoleumPack\(\{/);
    // The pack supplies BOTH halves: the blitter and the entity->tile map.
    expect(main).toMatch(/tileMap = pack\.index\.map/);
  });

  it("passes the map cell to the blit, so a variant pool can resolve", () => {
    const main = read("main.ts");
    expect(main).toMatch(/drawTile\(ctx, px, py, w, h, code, \{ x, y \}\)/);
    // Every call site feeds the grid it is drawing, not a placeholder.
    expect(main).toMatch(/tileForTrap\(tileMap, t\.kind\.tidx, LIGHTING\.LOS\), t\.grid\.x, t\.grid\.y\)/);
    expect(main).toMatch(/tileForMonster\(tileMap, mon\.race\.ridx\), mon\.grid\.x, mon\.grid\.y\)/);
    expect(main).toMatch(/tileForObject\(tileMap, o\.kind\), o\.grid\.x, o\.grid\.y\)/);
  });
});

describe("bundled mods", () => {
  const manifestOf = (id: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(MODS_DIR, id, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;

  it("never declares a tile pack for art we may not redistribute", () => {
    // The runtime no longer filters Shockbolt - a player who owns it may wrap it
    // in a mod of their own, and that must work. So the licence line is held
    // HERE instead: nothing WE ship may declare it.
    const banned = new Set(
      GRAPHICS_MODE_CATALOG.filter((m) => m.directory === "shockbolt").map(
        (m) => m.grafID,
      ),
    );
    expect(banned.size).toBe(2); // 5 and 6; fails loudly if the catalog changes
    for (const id of readdirSync(MODS_DIR)) {
      const packs = manifestOf(id).tilePacks;
      if (!Array.isArray(packs)) continue;
      for (const p of packs as { grafID?: number }[]) {
        expect(banned.has(p.grafID ?? -1), `${id} declares grafID ${p.grafID}`).toBe(
          false,
        );
      }
    }
  });

  it("declares any loose pack with the path and name it needs to load", () => {
    // A loose pack brings its own metadata, so what the manifest must supply is
    // where the pack lives and what the Graphics row is called.
    for (const id of readdirSync(MODS_DIR)) {
      const packs = manifestOf(id).tilePacks;
      if (!Array.isArray(packs)) continue;
      for (const p of packs as { engine?: string; path?: string; menuname?: string }[]) {
        if (p.engine !== "linoleum") continue;
        expect(typeof p.path, `${id} loose pack needs a path`).toBe("string");
        expect(typeof p.menuname, `${id} loose pack needs a menuname`).toBe("string");
      }
    }
  });

  it("declares every pack path MOD-relative, never as a site path", () => {
    // `path` used to be site-root-relative ("mods/linoleum/original-tiles"), which
    // only a bundled mod can know: a mod in a picked folder has no URL for its
    // files until their bytes are wrapped in a blob:, and one installed from
    // GitHub lives in IndexedDB. A path that still leads with the mods base is one
    // that survived the change unconverted, and it would resolve to
    // mods/<id>/mods/<id>/... - a 404, and ASCII with no message.
    for (const id of readdirSync(MODS_DIR)) {
      const packs = manifestOf(id).tilePacks;
      if (!Array.isArray(packs)) continue;
      for (const p of packs as { path?: string }[]) {
        if (typeof p.path !== "string") continue;
        expect(p.path, `${id}: path must be inside the mod`).not.toMatch(
          new RegExp(`^/?${BUNDLED_MODS_BASE}/`, "u"),
        );
        expect(p.path, `${id}: path must be relative`).not.toMatch(/^([a-z]+:)?\//iu);
      }
    }
  });

  /*
   * The one place the two halves of the bundled case have to agree. The generator
   * writes the demo pack to public/mods/<modId>/<PACK_KEY>, and the resolver reaches
   * it at <BUNDLED_MODS_BASE>/<modId>/<path>. Those are two files that never
   * reference each other, so nothing but this notices when one moves - and the
   * failure is a Graphics row that loads nothing.
   */
  it("puts every declared pack exactly where the bundled resolver looks", async () => {
    /* This used to grep the generator for `const PACK_KEY = "..."` and compare it
     * to the manifest's single tilePack. Both halves aged out at once - the mod
     * declares six packs now and the generator builds a configurable subset - and
     * the grep is the weaker check anyway: it pins how the script is WRITTEN.
     *
     * What actually has to hold is a chain of three links, none of which is in a
     * position to notice the others breaking:
     *   1. every path the manifest declares is a real converter pack key, or the
     *      row can never be built at all;
     *   2. the generator writes under public/mods/<modId>/<key>;
     *   3. the runtime resolver asks for <BUNDLED_MODS_BASE>/<modId>/<path>.
     * The generated PNGs are gitignored, so links 2 and 3 are checked against the
     * filesystem only when a build has actually run here (see below); link 1 needs
     * no artefacts and is the one that catches a typo'd path in the manifest. */
    const declared = manifestOf("neo-linoleum").tilePacks as { path: string }[];
    expect(declared.length).toBeGreaterThan(0);

    const keys = new Set(ALL_PACKS.map((p) => p.key));
    for (const { path } of declared) {
      expect(keys, `manifest declares '${path}', not a converter pack key`).toContain(
        path,
      );
    }

    const gen = readFileSync(
      join(MODS_DIR, "..", "scripts", "gen-linoleum-demo.mjs"),
      "utf8",
    );
    expect(gen).toMatch(/join\(webRoot, "public", "mods", "neo-linoleum"\)/);

    for (const { path } of declared) {
      const resolve = tilePackResolver({
        source: { kind: "bundle", base: BUNDLED_MODS_BASE },
        modId: "neo-linoleum",
        path,
      });
      const url = await resolve?.("manifest.txt");
      expect(url).toBe(`mods/neo-linoleum/${path}/manifest.txt`);
      /* When this checkout HAS built the pack, the resolved URL must name a file
       * that exists - the strongest form of the check, and the one that would have
       * caught a resolver/generator disagreement directly. Skipped rather than
       * failed on a clean checkout, where no pack is built and there is nothing to
       * disagree about. */
      const onDisk = join(MODS_DIR, "..", "public", url!);
      if (existsSync(dirname(onDisk))) {
        expect(existsSync(onDisk), `${path}: built but ${url} is not there`).toBe(true);
      }
    }
  });

  it("no longer claims the game's own tile sets as a mod's contribution", () => {
    // The bundled tiles mod used to register grafIDs 1-4 - the upstream packs -
    // which is what hid them behind a mod. Core owns them now.
    const coreIDs = new Set(coreTileModes({}).map((m) => m.grafID));
    for (const id of readdirSync(MODS_DIR)) {
      const packs = manifestOf(id).tilePacks;
      if (!Array.isArray(packs)) continue;
      for (const p of packs as { grafID?: number }[]) {
        expect(coreIDs.has(p.grafID ?? -1), `${id} re-registers core grafID`).toBe(
          false,
        );
      }
    }
  });
});

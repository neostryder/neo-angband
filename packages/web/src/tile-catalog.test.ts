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

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GRAPHICS_MODE_CATALOG, GRAPHICS_NONE } from "@rpgm-tools/neo-angband-core";
import { ALL_PACKS } from "@rpgm-tools/neo-angband-linoleum";
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

/** Lower-cased with all whitespace runs collapsed, so a prose assertion is about
 * what a document says and not about where its lines happen to wrap. */
const flat = (text: string): string => text.toLowerCase().replace(/\s+/g, " ");

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
    expect(credits).toContain("non-commercial");
    expect(credits).toContain("contact");
    // And no contact ADDRESS: he consented to being asked, not to being listed.
    expect(credits).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it("credits the TILESHEET here, and says where the converted tiles are credited", () => {
    /* This file's scope is public/tiles/, which is tilesheets - the form the game
     * itself draws. Cutting a sheet into one PNG per tile is a second, different
     * use of the same art and it belongs to the neo-linoleum mod, so it is
     * credited beside those files (see the generator's own test below).
     *
     * Both halves are asserted, because a split credit fails in two directions: a
     * file that still claims the conversion over-states what public/tiles/ holds,
     * and a file that drops the conversion without a pointer reads as a credit
     * someone quietly deleted. */
    // Whitespace-collapsed: these are claims about what the file SAYS, and every
    // one of them is long enough that the 80-column wrap falls inside it.
    const credits = flat(readFileSync(join(TILES_DIR, "CREDITS.md"), "utf8"));
    expect(credits).toContain("the tilesheet is bundled here with the author's permission");
    expect(credits).not.toContain("both as the tilesheet and as converted");
    expect(credits).toContain("neo-angband-mod-linoleum");
  });
});

describe("this repository holds no converted tile art, and no way to make any", () => {
  /*
   * The mod owns its art. This used to be the other way round: gen-linoleum-demo.mjs
   * lived in packages/web/scripts, the web package's `dev` and `bundle` scripts ran
   * it, and it wrote 9161 PNGs into public/mods/neo-linoleum/ - so a MOD's resources
   * sat inside the game's build and were served from the game's origin. The packs are
   * neo-angband-mod-linoleum's now, pre-converted and committed there as seven
   * archives, and the installer unpacks them into the mod's own folder, which is
   * where the tile resolver already looks (tilePackResolver).
   *
   * Asserted as ABSENCE, which is the only form that holds: a test that read the
   * generator would pass whether or not the generator was still wired into a build,
   * and reading code cannot find code that is not written. So these check what is on
   * disk and what the scripts say, and the honest limit is that they cannot prove a
   * deploy has no pack bytes - only that nothing here produces any.
   */
  const WEB_ROOT = join(MODS_DIR, "..");

  it("has no bundled neo-linoleum mod folder, under either id", () => {
    expect(existsSync(join(MODS_DIR, "neo-linoleum"))).toBe(false);
    expect(existsSync(join(MODS_DIR, "linoleum"))).toBe(false);
    /* Guards the guard: MODS_DIR must be a real directory with the mods that ARE in the
     * build, or the two assertions above are true of a typo. Those are all demos now -
     * the game bundles no shipping mod at all - so the guard names one of them rather
     * than a mod that has moved out. */
    expect(readdirSync(MODS_DIR)).toContain("demo-hooks");
  });

  it("has no pack generator, and no build step that would run one", () => {
    expect(existsSync(join(WEB_ROOT, "scripts", "gen-linoleum-demo.mjs"))).toBe(false);
    const pkg = JSON.parse(readFileSync(join(WEB_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const [name, command] of Object.entries(pkg.scripts)) {
      expect(command, `web script "${name}" still generates packs`).not.toMatch(
        /gen-linoleum/u,
      );
    }
    /* The scripts that would have carried it, named so a rename cannot make this
     * vacuous by removing the entry the loop was watching. */
    expect(Object.keys(pkg.scripts)).toContain("dev");
    expect(Object.keys(pkg.scripts)).toContain("bundle");
  });

  it("ships no loose pack bytes in public/", () => {
    /* public/mods/ is gitignored so a developer can drop a locally built pack in for
     * testing; what must not happen is this repository COMMITTING one. Checked
     * against git rather than the filesystem, for exactly that reason. */
    const tracked = execFileSync("git", ["ls-files", "packages/web/public/mods"], {
      cwd: join(WEB_ROOT, "..", ".."),
      encoding: "utf8",
    }).trim();
    expect(tracked).toBe("");
  });

  it("sends anyone looking for the conversion's credit to the mod", () => {
    /* The credit did not vanish with the files - it moved with them, and this is the
     * pointer that says so. A file that dropped the conversion without a pointer
     * reads as a credit someone quietly deleted. */
    const credits = flat(readFileSync(join(TILES_DIR, "CREDITS.md"), "utf8"));
    expect(credits).toContain("neo-angband-mod-linoleum");
    expect(credits).toContain("a separate use of the same art");
    expect(credits).toContain("the author's permission covers both forms");
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

  it("gives a contested grafID to the LAST contributor, at the first one's row", () => {
    // This was first-wins until 2026-08-01, which made the mod manager's own
    // "Move later (loads last, wins conflicts)" false for tiles alone: moving a
    // tiles mod later made it lose. Every other layer - content field patches,
    // coarse patches, rule flags - is decided by the last writer in load order,
    // so this one is too. The ROW stays where the first claimant put it, so the
    // Graphics menu does not reshuffle when the player reorders mods.
    const out = composeTileModes({
      core,
      mods: [
        pack({ grafID: 3, modId: "first", modName: "First" }),
        pack({ grafID: 3, modId: "second", modName: "Second" }),
      ],
    });
    expect(out.map((m) => m.grafID)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out[2]?.modName).toBe("Second");
  });

  it("adds a contested NEW grafID once, not twice", () => {
    const out = composeTileModes({
      core,
      mods: [
        pack({ grafID: 101, modId: "first", modName: "First", engine: "linoleum", path: "a" }),
        pack({ grafID: 101, modId: "second", modName: "Second", engine: "linoleum", path: "b" }),
      ],
    });
    expect(out.filter((m) => m.grafID === 101)).toHaveLength(1);
    expect(out.find((m) => m.grafID === 101)?.modName).toBe("Second");
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
   * token there names a tile FORMAT and its engine (@rpgm-tools/neo-angband-linoleum, the
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
    expect(main).toMatch(/data: \{ blitter: ts, code, grid: \{ x, y \}, dimScale: dimmed \? DIM_SCALE : 1 \}/);
    // Every call site feeds the grid it is drawing, not a placeholder.
    expect(main).toMatch(/tileForTrap\(tileMap, t\.kind\.tidx, LIGHTING\.LOS\), t\.grid\.x, t\.grid\.y\)/);
    expect(main).toMatch(/tileForMonster\(tileMap, mon\.race\.ridx\), mon\.grid\.x, mon\.grid\.y\)/);
    /* Every object arm - live pile, remembered pile, sensed marker - goes
     * through the one objectKindCell, which is handed the grid it is drawing. */
    expect(main).toMatch(
      /tileForShownObject\(tileMap, kind,[\s\S]*?\),\s*gx,\s*gy,/,
    );
    expect(main).toMatch(/objectKindCell\(o\.kind, o\.grid\.x, o\.grid\.y\)/);
  });

  /**
   * A flavoured object draws its FLAVOUR's tile, not its kind's.
   *
   * Pinned at the source because main.ts cannot be imported, and because the
   * two halves of this decision sat four lines apart and disagreed: the glyph
   * used the flavour and the tile asked for the kind. Every potion, scroll,
   * ring and wand therefore fell back to an ASCII glyph on a tile map.
   */
  it("asks for the flavour's tile while the player is unaware", () => {
    const main = read("main.ts");
    /* The same useFlavor that decides the glyph decides the tile - not a
     * second, separately-derived condition that can drift from it. */
    expect(main).toMatch(
      /tileForShownObject\(tileMap, kind, useFlavor && flavor \? flavor\.fidx : null\)/,
    );
    expect(main).not.toMatch(/tileForObject\(tileMap, [a-zA-Z.]*kind\)/);
  });

  /**
   * A REMEMBERED object draws its tile too.
   *
   * The memory used to be a resolved glyph (`{ ch, attr }`), so the remembered
   * draw had no kind to look a tile up with and emitted ASCII with only the
   * terrain memory tile behind it. Every item on the floor turned into a glyph
   * the moment it left view, in every tile set. The fix is a KnownObjectMemory
   * that carries the kind - so the assertion that matters is that the remembered
   * draw goes through the SAME objectKindCell the live pile does, and passes the
   * object tile it gets back to the terminal.
   */
  it("draws a remembered object through the same kind->cell path as a visible one", () => {
    const main = read("main.ts");
    expect(main).toMatch(/function rememberedObjectCell\(/);
    /* An exact memory resolves its kind; a sensed marker resolves to the real
     * <unknown item> / <unknown treasure> kinds, so those get tiles as well. */
    expect(main).toMatch(/kinds\.kindByIdx\(mem\.kidx\)/);
    expect(main).toMatch(/kinds\.unknownGoldKind/);
    expect(main).toMatch(/kinds\.unknownItemKind/);
    /* `true` = remembered. An object has no lighting variant in any pref file,
     * so nothing but the renderer can make a remembered one look remembered. */
    expect(main).toMatch(/return objectKindCell\(kind, gx, gy, true\)/);
    /* And the dimming reaches BOTH halves of the cell from one constant, so the
     * glyph and the tile cannot disagree about how dark "remembered" is. */
    expect(main).toMatch(/const DIM_SCALE = 0\.38;/);
    expect(main).toMatch(/parseInt\(h, 16\) \* DIM_SCALE/);
    const term = read("term.ts");
    expect(term).toMatch(/ctx\.globalAlpha = alpha \* \(data\.dimScale \?\? 1\)/);
    /* The frame diff has to be able to tell the two apart, or it leaves the lit
     * tile on screen - which is exactly how this was reported. */
    expect(main).toMatch(/\$\{dimmed \? "~" : ""\}/);
    /* The extracted production resolver builds that foreground visual, then
     * the live shell sends its completed frame to the glyph sink. The producer
     * tests execute this path; these checks keep main routed to it. */
    const producer = read("world-render-data.ts");
    expect(producer).toMatch(/visual = read\.rememberedObjectGlyph\(object, grid\);/);
    expect(main).toMatch(/projectLiveWorld\(\{[\s\S]*?\}, frontendWorldFrameSink\(\s*glyphWorldFrameSink\(term\),/);
  });

  /**
   * A camouflaged monster is not drawn as a monster.
   *
   * grid_data_as_text's monster arm is gated on `!monster_is_camouflaged(...)`
   * (ui-map.c:56); the port had no camouflage test at all, so an undiscovered
   * creeping copper coin drew its true monster tile over the fake item it had
   * placed. Every other consumer of camouflage in the engine already honoured
   * it - the renderer was the only one that did not.
   */
  it("leaves a camouflaged monster showing the item it is mimicking", () => {
    const main = read("main.ts");
    expect(main).toMatch(/if \(monsterIsCamouflaged\(mon\)\) continue;/);
  });
});

describe("bundled mods", () => {
  const manifestOf = (id: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(MODS_DIR, id, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;

  /**
   * How many bundled manifests declare tilePacks. **Zero today**, and saying so out
   * loud is the point: neo-linoleum was the only one, and its departure turned every
   * `for (const id of readdirSync(MODS_DIR))` loop below into a loop over nothing.
   * They still pass. They prove nothing about the mod that used to be here.
   *
   * They are kept because they are the rules ANY future bundled tiles mod must obey,
   * and the assertion below is what stops that from being a silent claim: if this
   * ever stops being 0, the loops are live again and this line is the one that says
   * they were not. What the equivalent rules for the INSTALLED mod are checked
   * against instead is the catalogue - see the mod-registry tests - and its manifest
   * is verified in its own repository, because reaching into a sibling checkout is
   * how the last three linoleum path breakages went unnoticed.
   */
  const bundledTilesModCount = readdirSync(MODS_DIR).filter((id) =>
    Array.isArray(manifestOf(id).tilePacks),
  ).length;

  it("has no bundled tiles mod, so the per-manifest rules below guard nothing yet", () => {
    expect(bundledTilesModCount).toBe(0);
  });

  it("never re-skins a row upstream's own catalog assigns", () => {
    /* This began as a licence guard - "nothing WE ship may declare Shockbolt" -
     * while the art was withheld. That reason is gone: the art ships with the
     * author's permission and neo-linoleum declares converted Shockbolt packs at
     * 101-106, its own ids. What remains is the real rule, and it is broader: a
     * bundled mod claims grafIDs of its own and leaves upstream's numbering alone.
     *
     * Held against the CATALOG rather than against coreTileModes(), which is what
     * distinguishes it from the last test in this file. coreTileModes filters to art
     * that is on disk, so removing a tile set would quietly shrink the set of ids
     * that test protects; this one does not move. */
    const banned = new Set(GRAPHICS_MODE_CATALOG.map((m) => m.grafID));
    expect([...banned].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
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
    /* The pack keys the CONVERTER produces. Held against those rather than against a
     * manifest, because there is no longer a manifest here to hold them against - the
     * mod's own repository verifies that its manifest declares these, and its packer
     * refuses to build if a declared pack has no converted directory. The link this
     * side still owns is that the converter's key is what the resolver composes. */
    const keys = ALL_PACKS.map((p) => p.key);
    expect(keys).toEqual([
      "original-tiles",
      "adam-bolt",
      "gervais",
      "nomad",
      "shockbolt-dark",
      "shockbolt-light",
    ]);

    for (const path of keys) {
      const resolve = tilePackResolver({
        source: { kind: "bundle", base: BUNDLED_MODS_BASE },
        modId: "neo-linoleum",
        path,
      });
      const url = await resolve?.("manifest.txt");
      expect(url).toBe(`mods/neo-linoleum/${path}/manifest.txt`);
    }
  });

  it("the curated list still points at neo-linoleum, since it is not in the bundle", () => {
    /* The half of the chain that replaced the generator: the game reaches these packs
     * by installing them, so the curated entry IS the wiring, and a broken one is a
     * Graphics screen with no Linoleum rows and nothing to say why.
     *
     * THE PER-PACK CHECK MOVED, and it is worth saying where. This used to assert one
     * archive per ALL_PACKS key against the shipped catalogue's file list, which
     * caught "a pack was added to the converter and never shipped". The catalogue is
     * gone: a mod's payload now comes from its own manifest at a tag, so that
     * question cannot be answered without the network and it is asked in
     * mod-discover-canary.test.ts instead. What stays here is the half that is still
     * local - that the list points at the repository at all. */
    const registry = JSON.parse(
      readFileSync(new URL("../../../mods/registry.json", import.meta.url), "utf8"),
    ) as { mods: { repo: string }[] };
    expect(registry.mods.map((m) => m.repo)).toContain(
      "neostryder/neo-angband-mod-linoleum",
    );
    /* Not vacuous on an empty converter: if ALL_PACKS ever emptied, the canary that
     * inherited the per-pack check would pass by finding nothing, so the count is
     * pinned where the packs are defined. */
    expect(ALL_PACKS.length).toBeGreaterThan(0);
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

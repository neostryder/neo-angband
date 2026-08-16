/**
 * Golden vectors for room-template and vault GLYPH decoding.
 *
 * WHY THIS EXISTS. `build_room_template` and `build_vault` (gen-room.c) each
 * decode their template text twice - once for terrain, once for the monsters
 * and objects - and the port carried all three of the large loops as closed
 * `switch` statements. Converting them into a keyed registry so a mod can teach
 * the game a NEW glyph is a refactor of level generation, and the thing that
 * has to be proven is not "the gen tests still pass" but "every template and
 * every vault of the shipped pack lays down exactly the same level, and leaves
 * the RNG in exactly the same place".
 *
 * So the ground truth is DERIVED, not declared: this module lays every real
 * room template and every real vault of the shipped pack onto a blank chunk at
 * fixed seeds and records everything observable - the chunk itself, hashed
 * grid by grid, the objects, monsters and traps that were placed, and a probe
 * draw taken from the RNG afterwards. `glyph-vectors.json` beside it was
 * recorded from the code as it stood BEFORE the registry existed, so a vector
 * that still matches is evidence the refactor changed nothing, and one that
 * does not names the template, the seed and the count that moved.
 *
 * THE PROBE IS THE POINT. A level can come out identical while the build drew
 * a different NUMBER of random values, and that difference is invisible in the
 * finished room - it diverges the rest of the dungeon instead. `rngProbe` is
 * one draw taken after the build: it can only match if the stream is at the
 * same position.
 *
 * The real pack does not use every glyph upstream defines, so SYNTHETIC_ROOMS
 * and SYNTHETIC_VAULTS below spell out the alphabet directly - `x`, `(`, `)`
 * and the `1`-`6` door positions in a template, `/` and `;` in a vault - each
 * run over enough seeds to land on both sides of the `rndwalls` and `rnddoors`
 * coin flips. Those are declared here rather than loaded, because a glyph the
 * pack never uses is exactly the one a refactor can drop unnoticed.
 *
 * Fixtures are INJECTED rather than loaded here, so this module pulls in no
 * node:fs and no content pack, and can be imported from anywhere.
 *
 * Regenerate with `node packages/core/scripts/gen-glyph-vectors.mjs` - which
 * OVERWRITES the evidence, so only do it when the change is intended and say so
 * in the commit.
 */

import type { Gen } from "./util.js";
import { loc } from "../loc.js";
import { buildRoomTemplate, buildVault } from "./room.js";
import type { RoomTemplate, Vault } from "./room.js";

/** How a vector's scenario is built, supplied by the caller (test or script). */
export interface GlyphVectorFixtures {
  /**
   * A Gen over a blank granite chunk of the given size at the given depth,
   * seeded, with the REAL object and monster placement deps - a vault's `8`
   * places a monster and an object, so a deps-less Gen would record nothing
   * where the interesting draws are.
   */
  makeGen(width: number, height: number, depth: number, seed: number): Gen;
  /** Every room template of the shipped pack, in file order. */
  templates(): readonly RoomTemplate[];
  /** Every vault of the shipped pack, in file order. */
  vaults(): readonly Vault[];
}

/** One recorded build of one template or vault at one seed. */
export interface GlyphVector {
  kind: "template" | "vault";
  name: string;
  seed: number;
  depth: number;
  /** What the builder returned (false = could not find space). */
  ok: boolean;
  /** FNV-1a over every square's feature, info flags and light. */
  grid: string;
  /** Placed objects, as "x,y:kind". */
  objects: string[];
  /** Placed monsters, as "x,y:race". */
  monsters: string[];
  /** Generated traps, as "x,y:tidx:power" (or "x,y" when only marked). */
  traps: string[];
  /** One draw taken after the build: catches a changed DRAW COUNT. */
  rngProbe: number;
}

/* ------------------------------------------------------------------ *
 * Synthetic templates and vaults: the glyphs the shipped pack may not use.
 * ------------------------------------------------------------------ */

/**
 * A room template using every glyph `build_room_template` decodes. `dor` is 6
 * so all six door positions are reachable, and the seeds below cover both
 * values of `rndwalls`.
 */
export const SYNTHETIC_ROOMS: readonly RoomTemplate[] = [
  {
    name: "SYNTHETIC every glyph",
    typ: 1,
    rat: 0,
    hgt: 9,
    wid: 13,
    dor: 6,
    tval: 0,
    fewEntrances: false,
    rows: [
      "%%%%%%%%%%%%%",
      "%...x(x)x...%",
      "%.#########.%",
      "%.#8.....9#.%",
      "%1#.......#2%",
      "%3#..[.^..#4%",
      "%5#########6%",
      "%...+...+...%",
      "%%%%%%%%%%%%%",
    ],
  },
  {
    /* FEW_ENTRANCES changes what '%' does (append_entrance), and it is a flag
     * the pack sets on few enough templates to be worth pinning separately. */
    name: "SYNTHETIC few entrances",
    typ: 1,
    rat: 0,
    hgt: 5,
    wid: 7,
    dor: 2,
    tval: 0,
    fewEntrances: true,
    rows: ["%%%%%%%", "%..1..%", "%.[.^.%", "%..2..%", "%%%%%%%"],
  },
];

/**
 * A vault using every glyph `build_vault` decodes, including `/` and `;` (which
 * upstream accepts and does nothing with) and the `<`/`>` stair glyphs. Alpha
 * characters are the racial-monster mechanism rather than glyph handlers, so
 * one is present to pin that the boundary between the two did not move.
 */
export const SYNTHETIC_VAULTS: readonly Vault[] = [
  {
    name: "SYNTHETIC every glyph",
    typ: "Lesser vault",
    rat: 0,
    hgt: 11,
    wid: 15,
    minLev: 1,
    maxLev: 127,
    fewEntrances: false,
    rows: [
      "%%%%%%%%%%%%%%%",
      "%.....@@@.....%",
      "%.***.:::.&&&.%",
      "%.+++.^^^.///.%",
      "%.;;;.<.>.```.%",
      "%.1234567890.%%",
      "%.~$..#####..%%",
      "%.....#...#...%",
      "%..p..#.8.#...%",
      "%.....#####...%",
      "%%%%%%%%%%%%%%%",
    ],
  },
  {
    name: "SYNTHETIC few entrances",
    typ: "Lesser vault",
    rat: 0,
    hgt: 5,
    wid: 7,
    minLev: 1,
    maxLev: 127,
    fewEntrances: true,
    rows: ["%%%%%%%", "%.&.^.%", "%.1.3.%", "%.~.$.%", "%%%%%%%"],
  },
];

/** The seeds each scenario is run at. Two are enough to flip `rndwalls`. */
export const GLYPH_VECTOR_SEEDS: readonly number[] = [1, 2, 3];

/**
 * The depths each scenario is run at.
 *
 * 127 is not decoration. A vault's `>` places a DOWN staircase everywhere
 * except within one level of the dungeon bottom, where it places an up
 * staircase instead - and with only 5 and 60 in this list that arm was never
 * reached, so a control that broke it passed. `constants.max-depth` is 128,
 * so 127 is the one depth that flips it. A grid dimension that does not vary
 * the branch is not coverage.
 */
export const GLYPH_VECTOR_DEPTHS: readonly number[] = [5, 60, 127];

/* ------------------------------------------------------------------ *
 * Recording.
 * ------------------------------------------------------------------ */

/** FNV-1a, 32-bit, hex. Stable across platforms and short enough to diff. */
function hash(parts: readonly number[]): string {
  let h = 0x811c9dc5;
  for (const n of parts) {
    /* Mix all four bytes so a feature change in a high grid index cannot
     * cancel a flag change in a low one. */
    for (let s = 0; s < 32; s += 8) {
      h ^= (n >>> s) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}

function gridHash(g: Gen): string {
  const snap = g.c.snapshotSquares();
  const parts: number[] = [];
  for (const f of snap.feats) parts.push(f);
  for (const bits of snap.infos) for (const b of bits) parts.push(b);
  for (const l of snap.lights) parts.push(l);
  return hash(parts);
}

function record(
  g: Gen,
  kind: GlyphVector["kind"],
  name: string,
  seed: number,
  depth: number,
  ok: boolean,
): GlyphVector {
  const objects = g.objects.map((o) => `${o.grid.x},${o.grid.y}:${o.obj.kind?.name ?? "?"}`);
  const monsters = g.monsters.map((m) => `${m.grid.x},${m.grid.y}:${m.mon.race?.name ?? "?"}`);
  const traps = g.traps.map((t) => `${t.grid.x},${t.grid.y}:${t.tidx}:${t.power}`);
  return {
    kind,
    name,
    seed,
    depth,
    ok,
    grid: gridHash(g),
    objects,
    monsters,
    traps,
    /* AFTER everything else is read: the probe must be the last draw. */
    rngProbe: g.rng.randint0(1 << 24),
  };
}

/**
 * Lay every template and vault - the pack's and the synthetic ones - at every
 * seed and depth, and record what came out. Deterministic and order-stable:
 * the returned array is the fixture.
 */
export function computeGlyphVectors(fx: GlyphVectorFixtures): GlyphVector[] {
  const out: GlyphVector[] = [];

  const templates = [...fx.templates(), ...SYNTHETIC_ROOMS];
  const vaults = [...fx.vaults(), ...SYNTHETIC_VAULTS];

  for (const depth of GLYPH_VECTOR_DEPTHS) {
    for (const t of templates) {
      for (const seed of GLYPH_VECTOR_SEEDS) {
        /* Oversized chunk and a real centre, so find_space never runs and the
         * vector measures the DECODE rather than the placement search. */
        const g = fx.makeGen(160, 70, depth, seed);
        const ok = buildRoomTemplate(
          g,
          loc(80, 35),
          t.hgt,
          t.wid,
          t.dor,
          t.rows,
          t.tval,
          t.fewEntrances,
        );
        out.push(record(g, "template", t.name, seed, depth, ok));
      }
    }
    for (const v of vaults) {
      for (const seed of GLYPH_VECTOR_SEEDS) {
        const g = fx.makeGen(160, 70, depth, seed);
        const ok = buildVault(g, loc(80, 35), v);
        out.push(record(g, "vault", v.name, seed, depth, ok));
      }
    }
  }

  return out;
}

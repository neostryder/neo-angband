/**
 * The playing surface, ported from reference/src/cave.h struct chunk /
 * struct square, cave.c (cave_new, square accessors), and the feature
 * and square predicates of cave-square.c (Angband 4.2.6).
 *
 * Divergences by design: squares live in flat typed arrays instead of
 * pointer grids; objects/traps attach later via numeric handles (their
 * domains are separate modules); the square_set_feat side effects that
 * need traps and player refresh (square_destroy_trap, square_note_spot,
 * square_light_spot) are deferred and ledgered.
 */

import { FlagSet } from "../bitflag";
import { SQUARE, SQUARE_FLAG_ENTRIES, TF } from "../generated";
import type { Loc } from "../loc";
import type { Feature, FeatureRegistry } from "./feature";

/** Byte size of a square info FlagSet (upstream SQUARE_SIZE). */
export const SQUARE_SIZE = Math.ceil(SQUARE_FLAG_ENTRIES.length / 8);

/* ------------------------------------------------------------------ *
 * Feature predicates (feat_is_*): test a terrain feature index.
 * ------------------------------------------------------------------ */

export function featIsMagma(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["MAGMA"]);
}

export function featIsQuartz(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["QUARTZ"]);
}

export function featIsGranite(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["GRANITE"]);
}

export function featIsTreasure(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["GOLD"]);
}

export function featIsWall(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["WALL"]);
}

export function featIsFloor(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["FLOOR"]);
}

export function featIsTrapHolding(
  reg: FeatureRegistry,
  feat: number,
): boolean {
  return reg.featHas(feat, TF["TRAP"]);
}

export function featIsObjectHolding(
  reg: FeatureRegistry,
  feat: number,
): boolean {
  return reg.featHas(feat, TF["OBJECT"]);
}

export function featIsMonsterWalkable(
  reg: FeatureRegistry,
  feat: number,
): boolean {
  return reg.featHas(feat, TF["PASSABLE"]);
}

export function featIsShop(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["SHOP"]);
}

export function featIsLos(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["LOS"]);
}

export function featIsPassable(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["PASSABLE"]);
}

export function featIsProjectable(
  reg: FeatureRegistry,
  feat: number,
): boolean {
  return reg.featHas(feat, TF["PROJECT"]);
}

export function featIsTorch(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["TORCH"]);
}

export function featIsBright(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["BRIGHT"]);
}

export function featIsFiery(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["FIERY"]);
}

export function featIsNoFlow(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["NO_FLOW"]);
}

export function featIsNoScent(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["NO_SCENT"]);
}

export function featIsSmooth(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["SMOOTH"]);
}

/* ------------------------------------------------------------------ *
 * The chunk.
 * ------------------------------------------------------------------ */

export class Chunk {
  name = "";
  turn = 0;
  depth = 0;
  feeling = 0;
  objRating = 0;
  monRating = 0;
  goodItem = false;
  feelingSquares = 0;

  readonly height: number;
  readonly width: number;
  /** Occurrences of each feature (feat_count). */
  readonly featCount: number[];

  private feats: Uint8Array;
  private infos: FlagSet[];
  private lights: Int16Array;
  private mons: Int16Array;
  /** Noise and scent heatmaps. */
  readonly noise: Uint16Array;
  readonly scent: Uint16Array;

  constructor(
    readonly features: FeatureRegistry,
    height: number,
    width: number,
  ) {
    this.height = height;
    this.width = width;
    const n = height * width;
    this.feats = new Uint8Array(n);
    this.lights = new Int16Array(n);
    this.mons = new Int16Array(n);
    this.noise = new Uint16Array(n);
    this.scent = new Uint16Array(n);
    this.infos = Array.from({ length: n }, () => new FlagSet(SQUARE_SIZE));
    this.featCount = new Array<number>(this.features.count() + 8).fill(0);
  }

  private idx(grid: Loc): number {
    return grid.y * this.width + grid.x;
  }

  /** square_in_bounds. */
  inBounds(grid: Loc): boolean {
    return (
      grid.x >= 0 && grid.y >= 0 && grid.x < this.width && grid.y < this.height
    );
  }

  /** square_in_bounds_fully: not on the outer border. */
  inBoundsFully(grid: Loc): boolean {
    return (
      grid.x > 0 &&
      grid.y > 0 &&
      grid.x < this.width - 1 &&
      grid.y < this.height - 1
    );
  }

  private assertBounds(grid: Loc): void {
    if (!this.inBounds(grid)) {
      throw new RangeError(`square out of bounds: ${grid.x},${grid.y}`);
    }
  }

  /** square(c, grid)->feat. */
  feat(grid: Loc): number {
    this.assertBounds(grid);
    return this.feats[this.idx(grid)] as number;
  }

  /** The Feature at a grid. */
  feature(grid: Loc): Feature {
    return this.features.get(this.feat(grid));
  }

  /**
   * square_set_feat with feat_count bookkeeping and bright-terrain glow.
   * The in-game side effects (trap destruction, note/light spot) belong
   * to later modules; callers during generation match upstream behavior.
   */
  setFeat(grid: Loc, feat: number): void {
    this.assertBounds(grid);
    const i = this.idx(grid);
    const current = this.feats[i] as number;
    if (current) this.featCount[current] = (this.featCount[current] ?? 0) - 1;
    if (feat) this.featCount[feat] = (this.featCount[feat] ?? 0) + 1;
    this.feats[i] = feat;
    if (featIsBright(this.features, feat)) {
      this.info(grid).on(SQUARE["GLOW"]);
    }
  }

  /** square(c, grid)->info flag set. */
  info(grid: Loc): FlagSet {
    this.assertBounds(grid);
    return this.infos[this.idx(grid)] as FlagSet;
  }

  /** sqinfo_has / on / off conveniences. */
  sqinfoHas(grid: Loc, flag: number): boolean {
    return this.info(grid).has(flag);
  }

  sqinfoOn(grid: Loc, flag: number): void {
    this.info(grid).on(flag);
  }

  sqinfoOff(grid: Loc, flag: number): void {
    this.info(grid).off(flag);
  }

  /** square light level. */
  light(grid: Loc): number {
    this.assertBounds(grid);
    return this.lights[this.idx(grid)] as number;
  }

  setLight(grid: Loc, value: number): void {
    this.assertBounds(grid);
    this.lights[this.idx(grid)] = value;
  }

  /** Monster index on the square (0 = none, negative = player upstream). */
  mon(grid: Loc): number {
    this.assertBounds(grid);
    return this.mons[this.idx(grid)] as number;
  }

  setMon(grid: Loc, monIdx: number): void {
    this.assertBounds(grid);
    this.mons[this.idx(grid)] = monIdx;
  }

  /* -------------------------------------------------------------- *
   * Square predicates (cave-square.c), feature-driven subset.
   * -------------------------------------------------------------- */

  isFloor(grid: Loc): boolean {
    return featIsFloor(this.features, this.feat(grid));
  }

  isTrapHolding(grid: Loc): boolean {
    return featIsTrapHolding(this.features, this.feat(grid));
  }

  isObjectHolding(grid: Loc): boolean {
    return featIsObjectHolding(this.features, this.feat(grid));
  }

  isMonsterWalkable(grid: Loc): boolean {
    return featIsMonsterWalkable(this.features, this.feat(grid));
  }

  isShop(grid: Loc): boolean {
    return featIsShop(this.features, this.feat(grid));
  }

  isGranite(grid: Loc): boolean {
    return featIsGranite(this.features, this.feat(grid));
  }

  isMagma(grid: Loc): boolean {
    return featIsMagma(this.features, this.feat(grid));
  }

  isQuartz(grid: Loc): boolean {
    return featIsQuartz(this.features, this.feat(grid));
  }

  /** square_isperm: PERMANENT and ROCK. */
  isPerm(grid: Loc): boolean {
    const f = this.feature(grid);
    return f.flags.has(TF["PERMANENT"]) && f.flags.has(TF["ROCK"]);
  }

  /** square_isrubble: ROCK that is not WALL. */
  isRubble(grid: Loc): boolean {
    const f = this.feature(grid);
    return !f.flags.has(TF["WALL"]) && f.flags.has(TF["ROCK"]);
  }

  /** square_ismineralwall equivalent: magma, quartz or granite. */
  isMineralWall(grid: Loc): boolean {
    return this.isMagma(grid) || this.isQuartz(grid) || this.isGranite(grid);
  }

  isWall(grid: Loc): boolean {
    return featIsWall(this.features, this.feat(grid));
  }

  isDoor(grid: Loc): boolean {
    return this.feature(grid).flags.has(TF["DOOR_ANY"]);
  }

  isClosedDoor(grid: Loc): boolean {
    return this.feature(grid).flags.has(TF["DOOR_CLOSED"]);
  }

  isStairs(grid: Loc): boolean {
    return this.feature(grid).flags.has(TF["STAIR"]);
  }

  isUpstairs(grid: Loc): boolean {
    return this.feature(grid).flags.has(TF["UPSTAIR"]);
  }

  isDownstairs(grid: Loc): boolean {
    return this.feature(grid).flags.has(TF["DOWNSTAIR"]);
  }

  isFiery(grid: Loc): boolean {
    return featIsFiery(this.features, this.feat(grid));
  }

  /** square_ispassable (asserts bounds like upstream). */
  isPassable(grid: Loc): boolean {
    this.assertBounds(grid);
    return featIsPassable(this.features, this.feat(grid));
  }

  /** square_isprojectable (false out of bounds, like upstream). */
  isProjectable(grid: Loc): boolean {
    if (!this.inBounds(grid)) return false;
    return featIsProjectable(this.features, this.feat(grid));
  }

  /** square_allows_los equivalent used by the LOS routine. */
  allowsLos(grid: Loc): boolean {
    if (!this.inBounds(grid)) return false;
    return featIsLos(this.features, this.feat(grid));
  }

  /** Generation flags on square info. */
  isWallInner(grid: Loc): boolean {
    return this.sqinfoHas(grid, SQUARE["WALL_INNER"]);
  }

  isWallOuter(grid: Loc): boolean {
    return this.sqinfoHas(grid, SQUARE["WALL_OUTER"]);
  }

  isWallSolid(grid: Loc): boolean {
    return this.sqinfoHas(grid, SQUARE["WALL_SOLID"]);
  }

  /** fill the whole chunk with a feature (generation helper). */
  fill(feat: number): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.setFeat({ x, y }, feat);
      }
    }
  }
}

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

import { FlagSet } from "../bitflag.js";
import { SQUARE, SQUARE_FLAG_ENTRIES, TF } from "../generated/index.js";
import { UINT32_MAX } from "../guard.js";
import type { Loc } from "../loc.js";
import type { Feature, FeatureRegistry } from "./feature.js";

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

/* square_isnoflow (cave-square.c:738) is this test on a grid's feat. */
export function featIsNoFlow(reg: FeatureRegistry, feat: number): boolean {
  return reg.featHas(feat, TF["NO_FLOW"]);
}

/* square_isnoscent (cave-square.c:746) is this test on a grid's feat. */
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
  /**
   * p->upkeep->only_partial (cave-view.c:849-851): when true, the feeling
   * reveal at feeling_need is suppressed (level-entry full update).
   */
  onlyPartial = false;

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
   * Live-play hook for square_set_feat's character_dungeon path
   * (cave-square.c:1256-1262): destroy traps when the new terrain cannot
   * hold them (or square_player_trap_allowed fails). Installed by the
   * session while a chunk is the live cave; absent during generation.
   */
  onFeatSet?: (grid: Loc) => void;

  /**
   * square_set_feat (cave-square.c:1238-1268): feat_count bookkeeping and
   * bright-terrain glow. When onFeatSet is installed (live dungeon, C
   * character_dungeon path) it runs trap destruction / note-spot. When
   * absent (generation), clears SQUARE_WALL_INNER/OUTER/SOLID immediately
   * (cave-square.c:1263-1268). End-of-builder clearGenerationFlags still
   * sweeps remaining marks set via generateMark without a later setFeat.
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
    if (this.onFeatSet) {
      /* character_dungeon path (cave-square.c:1256-1262). */
      this.onFeatSet(grid);
    } else {
      /* Generation path (cave-square.c:1263-1268): drop stale WALL_* marks
       * so mid-gen predicates match C after a feature change. Mark helpers
       * (setMarkedGranite / fillRectangle) call setFeat then generateMark,
       * same order as C set_marked_granite (gen-room.c:426-429). */
      this.info(grid).off(SQUARE["WALL_INNER"]);
      this.info(grid).off(SQUARE["WALL_OUTER"]);
      this.info(grid).off(SQUARE["WALL_SOLID"]);
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

  /** square_istrappable (cave-square.c:220): feat_is_trap_holding on a grid. */
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

  /**
   * square_isrock (cave-square.c:236-240): granite that is not a door
   * (secret doors carry GRANITE | DOOR_ANY and must not count as mineral).
   */
  isRock(grid: Loc): boolean {
    return this.isGranite(grid) && !this.feature(grid).flags.has(TF["DOOR_ANY"]);
  }

  /**
   * square_ismineral (cave-square.c:278-282): rock, magma or quartz.
   * Secret doors are excluded via isRock.
   */
  isMineralWall(grid: Loc): boolean {
    return this.isMagma(grid) || this.isQuartz(grid) || this.isRock(grid);
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

  /** square_isdamaging: fiery terrain (lava etc). */
  isDamaging(grid: Loc): boolean {
    return this.isFiery(grid);
  }

  /** square_allowsfeel (cave-square.c L680): a legal level-feeling grid. */
  allowsFeel(grid: Loc): boolean {
    return this.isPassable(grid) && !this.isDamaging(grid);
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

  /**
   * add_to_monster_rating (mon-make.c): saturating accumulate into
   * mon_rating, ceiling at UINT32_MAX.
   */
  addToMonsterRating(part: number): void {
    this.monRating =
      this.monRating < UINT32_MAX - part ? this.monRating + part : UINT32_MAX;
  }

  /**
   * place_object's obj_rating accumulation (gen-util.c L534-539): saturating
   * accumulate, ceiling at UINT32_MAX.
   */
  addToObjRating(sqrating: number): void {
    this.objRating =
      this.objRating < UINT32_MAX - sqrating ? this.objRating + sqrating : UINT32_MAX;
  }

  /** fill the whole chunk with a feature (generation helper). */
  fill(feat: number): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.setFeat({ x, y }, feat);
      }
    }
  }

  /**
   * A JSON-safe snapshot of every square (features, info flags, light,
   * monster occupancy) plus the chunk scalars, for savefiles. Noise and
   * scent heatmaps are transient (upstream does not save them either;
   * they rebuild on the first turn) - so `includeFlow` defaults to false and
   * the faithful payload omits them.
   *
   * bug-fixes #4605 ("Noise and scent not saved"): with includeFlow set (the
   * bug-fixes mod's bugfix.noiseScentSave rule, passed from the save layer),
   * the noise and scent heatmaps ARE serialized, so save/reload no longer
   * changes monster tracking versus uninterrupted play. Absent in the payload
   * (the faithful default) => restoreSquares leaves them zeroed, as before.
   */
  snapshotSquares(includeFlow = false): ChunkSquaresData {
    return {
      name: this.name,
      turn: this.turn,
      depth: this.depth,
      feeling: this.feeling,
      objRating: this.objRating,
      monRating: this.monRating,
      goodItem: this.goodItem,
      feelingSquares: this.feelingSquares,
      height: this.height,
      width: this.width,
      feats: Array.from(this.feats),
      infos: this.infos.map((f) => Array.from(f.bits)),
      lights: Array.from(this.lights),
      mons: Array.from(this.mons),
      ...(includeFlow
        ? { noise: Array.from(this.noise), scent: Array.from(this.scent) }
        : {}),
    };
  }

  /** Restore a snapshotSquares() payload into this chunk (sizes must match). */
  restoreSquares(data: ChunkSquaresData): void {
    if (data.height !== this.height || data.width !== this.width) {
      throw new RangeError("chunk restore: size mismatch");
    }
    this.name = data.name;
    this.turn = data.turn;
    this.depth = data.depth;
    this.feeling = data.feeling;
    this.objRating = data.objRating;
    this.monRating = data.monRating;
    this.goodItem = data.goodItem;
    this.feelingSquares = data.feelingSquares;
    this.featCount.fill(0);
    for (let i = 0; i < data.feats.length; i++) {
      const feat = data.feats[i] as number;
      this.feats[i] = feat;
      if (feat) this.featCount[feat] = (this.featCount[feat] ?? 0) + 1;
      (this.infos[i] as FlagSet).bits.set(data.infos[i] as number[]);
      this.lights[i] = data.lights[i] as number;
      this.mons[i] = data.mons[i] as number;
    }
    /* bug-fixes #4605: restore the noise/scent heatmaps when the save carried
     * them (bugfix.noiseScentSave). Self-describing: a faithful save omits
     * both, so this is skipped and the transient heatmaps stay zeroed and
     * rebuild on the first turn, exactly as before. */
    if (data.noise) this.noise.set(data.noise);
    if (data.scent) this.scent.set(data.scent);
  }
}

/** The snapshotSquares() / restoreSquares() payload. */
export interface ChunkSquaresData {
  name: string;
  turn: number;
  depth: number;
  feeling: number;
  objRating: number;
  monRating: number;
  goodItem: boolean;
  feelingSquares: number;
  height: number;
  width: number;
  feats: number[];
  infos: number[][];
  lights: number[];
  mons: number[];
  /** bug-fixes #4605: the noise heatmap, present only when bugfix.noiseScentSave is on. */
  noise?: number[];
  /** bug-fixes #4605: the scent heatmap, present only when bugfix.noiseScentSave is on. */
  scent?: number[];
}

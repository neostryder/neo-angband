/**
 * The core of the Borg flow/pathfinding subsystem: a faithful port of
 * reference/src/borg/borg-flow.c. This owns the borg_data cost/flow/hard/know/
 * icky arrays, the flow circular queue, the borg_temp scan array, the location
 * tracks (track_less/more/step/door/closed/...), and the BFS flood-fill itself
 * (borg_flow_spread / borg_flow_enqueue_grid / borg_flow_commit / borg_flow_old
 * / borg_play_step / borg_can_dig).
 *
 * WHAT CHANGED FOR THE PORT (documented, behaviour preserved)
 * - The C borg's file-scope globals become a FlowState instance created once and
 *   threaded in (see createFlowState). borg_init_flow's constant borg_data_hard
 *   (all 255) and the track lists are set up in the constructor.
 * - borg_play_step emitted keypresses; our engine is command-based, so it RETURNS
 *   the next AgentCommand (ctx.act.move/melee/tunnel/open/disarm/close/ascend)
 *   instead. borg_flow_old therefore returns AgentCommand | null (null == "no
 *   step / goal cancelled") and every goal-flow function returns that up.
 * - borg_danger (P8.2) and the trait[] self-model (P8.3) are not yet ported, so
 *   danger is an injectable FlowHooks.danger (default 0 == no danger, the
 *   faithful degenerate value) and traits read 0 until filled. The BFS, cost
 *   model, fear thresholds, goal ordering, AUTO_FLOW_MAX (1536), the 250-grid
 *   path assumption and the play-step branch order are ported verbatim.
 * - Spell/ring/activation branches inside borg_play_step (stone-to-mud melting,
 *   disable-traps, etc.) need magic/item subsystems not yet ported; the port
 *   keeps the surrounding structure and falls through to the physical action
 *   (tunnel / disarm / open), which is the same grid the borg would end on.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "../context";
import type { BorgWorld } from "../world/model";
import {
  GOAL_DARK,
  GOAL_DIGGING,
} from "../world/model";
import { distance } from "../think";
import {
  AUTO_FLOW_MAX,
  AUTO_MAX_X,
  AUTO_MAX_Y,
  AUTO_TEMP_MAX,
  BI,
  BORG_DIG,
  BORG_DIG_HARD,
  BORG_DIG_MOD,
  FEAT,
  borgGotoDir,
  ddx,
  ddx_ddd,
  ddy,
  ddy_ddd,
  featIsShop,
  inBoundsFully,
  trait,
} from "./flow-consts";

/** Map width used to flatten borg_data[y][x] into a single typed array. */
const W = AUTO_MAX_X;
const H = AUTO_MAX_Y;
const DATA_SIZE = W * H;

/** Flatten (x, y) into the borg_data backing index. */
export function dataIdx(x: number, y: number): number {
  return y * W + x;
}

/**
 * struct borg_track: a growable list of tracked grid coordinates (borg-flow.h).
 * Faithful num/size semantics; add() is a no-op once full, as upstream.
 */
export class BorgTrack {
  readonly x: number[];
  readonly y: number[];
  num = 0;
  readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.x = new Array<number>(size).fill(0);
    this.y = new Array<number>(size).fill(0);
  }

  add(y: number, x: number): void {
    if (this.num >= this.size) return;
    this.x[this.num] = x;
    this.y[this.num] = y;
    this.num += 1;
  }

  wipe(): void {
    this.num = 0;
  }
}

/**
 * Injectable dependencies that the flow code reaches for but that live in
 * subsystems not yet ported. Every default is the faithful "nothing available"
 * value so the flow behaves exactly as a borg with no danger model / no digging
 * magic / no ranged attack, rather than fabricating behaviour.
 */
export interface FlowHooks {
  /** borg_danger(y, x, 1, true, false): estimated danger at a grid. */
  danger: (world: BorgWorld, y: number, x: number) => number;
  /**
   * The digging-magic half of borg_can_dig: stone-to-mud / shatter-stone /
   * digging-ring availability (with or without a fail-rate check).
   */
  canDigMagic: (world: BorgWorld, checkFail: boolean) => boolean;
  /** borg_has_distance_attack(): can the borg shoot from where it stands. */
  hasDistanceAttack: (world: BorgWorld) => boolean;
  /** Lay a glyph of warding at the current grid (spell/scroll/activation). */
  layGlyph: (ctx: BorgContext) => AgentCommand | null;
  /** OPT(player, birth_force_descend): the level cannot be climbed. */
  forceDescend: boolean;
  /** borg_prepared(depth + 1) == NULL: safe to dive one level deeper. */
  preparedToDescend: (world: BorgWorld) => boolean;
  /** borg_count_sell(): how many pack items the borg wants to sell in town. */
  countSell: (world: BorgWorld) => number;
  /** borg_items[PACK_SLOTS - 1].iqty: is the pack full (no free slot). */
  packFull: (world: BorgWorld) => boolean;
  /**
   * rf_has(r_info[kill->r_idx].flags, RF_<flag>): does a tracked monster's race
   * carry a flag ("UNIQUE", "MULTIPLY", "NEVER_MOVE", "GROUP_AI", "PASS_WALL",
   * "KILL_WALL"). Needs the monster-race model (P8.6); defaults to false.
   */
  monsterHasFlag: (world: BorgWorld, killIndex: number, flag: string) => boolean;
  /** borg_los(y1, x1, y2, x2): clear line of sight between two grids. */
  los: (world: BorgWorld, y1: number, x1: number, y2: number, x2: number) => boolean;
}

/** The default hooks: a borg with no danger model, no dig magic, no ranged. */
export function defaultFlowHooks(): FlowHooks {
  return {
    danger: () => 0,
    canDigMagic: () => false,
    hasDistanceAttack: () => false,
    layGlyph: () => null,
    forceDescend: false,
    preparedToDescend: () => true,
    countSell: () => 0,
    packFull: () => false,
    monsterHasFlag: () => false,
    los: () => true,
  };
}

/**
 * The complete flow scratch state (replacing borg-flow.c's file-scope globals).
 * Create one with createFlowState() and reuse it across thinks, exactly as the
 * C borg allocated borg_data once in borg_init_flow.
 */
export interface FlowState {
  /* borg_data arrays, flattened row-major (y * W + x). */
  readonly cost: Uint8Array;
  readonly flow: Uint8Array;
  readonly hard: Uint8Array;
  readonly know: Uint8Array;
  readonly icky: Uint8Array;

  /* The circular flow queue (borg_flow_x/y, flow_head/flow_tail). */
  readonly flowX: Uint8Array;
  readonly flowY: Uint8Array;
  flowHead: number;
  flowTail: number;

  /* The temp scanning array (borg_temp_x/y, borg_temp_n). */
  readonly tempX: Uint8Array;
  readonly tempY: Uint8Array;
  tempN: number;

  /* Location tracks. */
  readonly less: BorgTrack;
  readonly more: BorgTrack;
  readonly step: BorgTrack;
  readonly door: BorgTrack;
  readonly closed: BorgTrack;
  readonly glyph: BorgTrack;
  readonly vein: BorgTrack;
  readonly shopX: number[];
  readonly shopY: number[];

  /* Flags / thresholds (borg-flow.c globals). */
  avoidance: number;
  borgDesperate: boolean;
  borgDigging: boolean;
  borgDangerWipe: boolean;
  borgTAntisummon: number;
  borgAsPosition: boolean;
  borgMorgothPosition: boolean;
  /** borg_t at level entry, for the (borg_t - borg_began) boredom thresholds. */
  borgBegan: number;

  /* Glyph "sea of runes" state (borg-flow-glyph.c). */
  glyphX: number;
  glyphY: number;
  glyphXCenter: number;
  glyphYCenter: number;
  borgNeedsNewSea: boolean;

  /* Spastic search state (borg-flow-misc.c). */
  spasticX: number;
  spasticY: number;

  hooks: FlowHooks;
}

/** borg_init_flow: allocate the flow scratch state (borg_data_hard all 255). */
export function createFlowState(hooks: FlowHooks = defaultFlowHooks()): FlowState {
  const hard = new Uint8Array(DATA_SIZE).fill(255);
  return {
    cost: new Uint8Array(DATA_SIZE),
    flow: new Uint8Array(DATA_SIZE),
    hard,
    know: new Uint8Array(DATA_SIZE),
    icky: new Uint8Array(DATA_SIZE),
    flowX: new Uint8Array(AUTO_FLOW_MAX),
    flowY: new Uint8Array(AUTO_FLOW_MAX),
    flowHead: 0,
    flowTail: 0,
    tempX: new Uint8Array(AUTO_TEMP_MAX),
    tempY: new Uint8Array(AUTO_TEMP_MAX),
    tempN: 0,
    less: new BorgTrack(16),
    more: new BorgTrack(16),
    step: new BorgTrack(100),
    door: new BorgTrack(100),
    closed: new BorgTrack(100),
    glyph: new BorgTrack(200),
    vein: new BorgTrack(100),
    shopX: new Array<number>(9).fill(0),
    shopY: new Array<number>(9).fill(0),
    avoidance: 0,
    borgDesperate: false,
    borgDigging: false,
    borgDangerWipe: false,
    borgTAntisummon: 0,
    borgAsPosition: false,
    borgMorgothPosition: false,
    borgBegan: 0,
    glyphX: 0,
    glyphY: 0,
    glyphXCenter: 0,
    glyphYCenter: 0,
    borgNeedsNewSea: false,
    spasticX: 0,
    spasticY: 0,
    hooks,
  };
}

/**
 * The shared "fear" threshold used to reject dangerous grids during a flow. This
 * block appears verbatim in borg_flow_spread, borg_flow_enqueue_grid and
 * borg_flow_direct; the only variation is the in-town divisor (3/10 for
 * spread/enqueue, 1/10 for direct), passed as townTenths.
 */
export function computeFear(world: BorgWorld, flow: FlowState, townTenths: number): number {
  const av = flow.avoidance;
  let fear = 0;
  if (trait(world, BI.MAXCLEVEL) === 50) fear = Math.trunc((av * 5) / 10);
  if (trait(world, BI.MAXCLEVEL) !== 50) fear = Math.trunc((av * 3) / 10);
  if (world.facts.scaryGuyOnLevel) fear = av * 2;
  if (world.facts.uniqueOnLevel && world.facts.vaultOnLevel && trait(world, BI.MAXCLEVEL) === 50)
    fear = av * 3;
  if (world.facts.scaryGuyOnLevel && trait(world, BI.CLEVEL) <= 5) fear = av * 3;
  if (world.self.goal.ignoring) fear = av * 5;
  if (world.clock - flow.borgBegan > 5000) fear = av * 25;
  if (trait(world, BI.FOOD) === 0) fear = av * 100;
  if (trait(world, BI.CLEVEL) === 0) fear = Math.trunc((av * townTenths) / 10);
  return fear;
}

/** True while any danger-based icky marking should be skipped (borg-flow.c). */
function skipDangerMarking(world: BorgWorld, flow: FlowState): boolean {
  return (
    flow.borgDesperate ||
    world.self.lunalMode ||
    world.self.munchkinMode ||
    flow.borgDigging
  );
}

/**
 * borg_can_dig (borg-flow.c): can the borg tunnel the given feature. The
 * trait/twitch/skill portion is ported verbatim; the spell/ring/activation
 * portion (which needs the magic + item subsystems) is delegated to
 * FlowHooks.canDigMagic.
 */
export function borgCanDig(
  ctx: BorgContext,
  flow: FlowState,
  checkFail: boolean,
  feat: number,
): boolean {
  const w = ctx.world;

  /* No digging when hungry */
  if (trait(w, BI.ISHUNGRY)) return false;

  /* some features can't be dug out */
  if (
    feat === FEAT.PERM ||
    feat === FEAT.LAVA ||
    (feat < FEAT.SECRET && feat !== FEAT.CLOSED)
  )
    return false;

  let digCheck: number;
  if (feat === FEAT.GRANITE || feat === FEAT.CLOSED || feat === FEAT.SECRET) {
    digCheck = BORG_DIG_HARD;
  } else if (feat === FEAT.QUARTZ || feat === FEAT.QUARTZ_K) {
    digCheck = BORG_DIG_MOD;
  } else {
    digCheck = BORG_DIG;
  }

  /* try digging even when hard if out of moves (times_twitch) */
  if (w.self.timesTwitch > 10)
    digCheck -= Math.min(w.self.timesTwitch - 10, 19);

  /*
   * The upstream weapon_swap digger check needs the swap-item model; the borg's
   * derived BI_DIG already reflects the wielded digger, so the port keeps the
   * (BI_DIG >= digCheck + 20) branch faithfully.
   */
  if (trait(w, BI.DIG) >= digCheck + 20) return true;

  if (
    (feat === FEAT.RUBBLE || feat === FEAT.PASS_RUBBLE) &&
    !trait(w, BI.ISWEAK)
  )
    return true;

  if (flow.hooks.canDigMagic(w, checkFail)) return true;

  return false;
}

/**
 * borg_flow_clear (borg-flow.c): reset the cost field to "hard" (255), and wipe
 * the know/icky flags when a danger recompute is pending.
 */
export function borgFlowClear(flow: FlowState): void {
  flow.cost.set(flow.hard);
  if (flow.borgDangerWipe) {
    flow.know.fill(0);
    flow.icky.fill(0);
    flow.borgDangerWipe = false;
  }
  flow.flowHead = 0;
  flow.flowTail = 0;
}

/**
 * borg_flow_enqueue_grid (borg-flow.c): enqueue a fresh, safe starting grid.
 */
export function borgFlowEnqueueGrid(
  ctx: BorgContext,
  flow: FlowState,
  y: number,
  x: number,
): void {
  const w = ctx.world;
  const gi = dataIdx(x, y);

  /* Avoid icky grids */
  if (flow.icky[gi]) return;

  /* Unknown -> danger-check once */
  if (!flow.know[gi]) {
    flow.know[gi] = 1;
    const p = flow.hooks.danger(w, y, x);
    const fear = computeFear(w, flow, 3);
    if (p > fear && !skipDangerMarking(w, flow)) {
      flow.icky[gi] = 1;
      return;
    }
  }

  /* Only enqueue a grid once (cost already 0 means queued) */
  if (!flow.cost[gi]) return;

  /* Save the flow cost (zero) */
  flow.cost[gi] = 0;

  /* Enqueue that entry */
  flow.flowY[flow.flowHead] = y;
  flow.flowX[flow.flowHead] = x;

  const oldHead = flow.flowHead;
  if (++flow.flowHead === AUTO_FLOW_MAX) flow.flowHead = 0;
  if (flow.flowHead === flow.flowTail) flow.flowHead = oldHead;
}

/**
 * borg_flow_spread (borg-flow.c): BFS flood-fill from the enqueued destination
 * grids outward, filling cost[] with steps-to-reach. Ported verbatim: the
 * circular queue, the "queue children in reverse ddd order", the optimize/depth
 * stop, the sneak/avoid/tunneling/monster/trap/shop-entry gates, and the
 * per-grid danger-vs-fear icky marking.
 */
export function borgFlowSpread(
  ctx: BorgContext,
  flow: FlowState,
  depth: number,
  optimize: boolean,
  avoid: boolean,
  tunneling: boolean,
  stairIdx: number,
  sneak: boolean,
): void {
  const w = ctx.world;
  let o = 0;

  /* Default starting points */
  let originY = w.self.c.y;
  let originX = w.self.c.x;

  /* Moving under boosted bravery? */
  const twitchy = flow.avoidance > trait(w, BI.CURHP);

  /* Use the closest stair as the cost origin for low-level distance checks */
  if (stairIdx >= 0 && trait(w, BI.CLEVEL) < 15) {
    originY = flow.less.y[stairIdx]!;
    originX = flow.less.x[stairIdx]!;
    optimize = false;
  }

  /* Process the queue */
  while (flow.flowHead !== flow.flowTail) {
    const x1 = flow.flowX[flow.flowTail]!;
    const y1 = flow.flowY[flow.flowTail]!;

    if (++flow.flowTail === AUTO_FLOW_MAX) flow.flowTail = 0;

    /* Cost (one per movement grid) */
    const n = flow.cost[dataIdx(x1, y1)]! + 1;

    /* New depth */
    if (n > o) {
      if (optimize && n > flow.cost[dataIdx(originX, originY)]!) break;
      if (n > depth) break;
      o = n;
    }

    /* Queue the children (reverse ddd order via the 0..7 scan) */
    for (let i = 0; i < 8; i++) {
      let badSneak = false;

      const x = x1 + ddx_ddd[i]!;
      const y = y1 + ddy_ddd[i]!;

      if (!inBoundsFully(x, y)) continue;

      const gi = dataIdx(x, y);

      /* Skip "reached" grids */
      if (flow.cost[gi]! <= n) continue;

      const ag = w.map.at(x, y);

      if (sneak && !flow.borgDesperate && !twitchy) {
        for (let ii = 0; ii < 8; ii++) {
          const xx = x + ddx_ddd[ii]!;
          const yy = y + ddy_ddd[ii]!;
          if (!inBoundsFully(xx, yy)) continue;
          if (w.map.at(xx, yy).kill) {
            badSneak = true;
            break;
          }
        }
      }
      if (badSneak) continue;

      /* Avoid "wall" grids (not doors) unless tunneling (FEAT-order dependent) */
      if (
        !tunneling &&
        ag.feat >= FEAT.SECRET &&
        ag.feat !== FEAT.PASS_RUBBLE &&
        ag.feat !== FEAT.LAVA
      )
        continue;

      /* Avoid perma-wall grids */
      if (ag.feat === FEAT.PERM) continue;

      /* Avoid Lava (unless immune to fire) */
      if (ag.feat === FEAT.LAVA && !trait(w, BI.IFIRE)) continue;

      /* Avoid unknown grids (if requested or retreating) unless twitchy */
      if ((avoid || flow.borgDesperate) && ag.feat === FEAT.NONE && !twitchy)
        continue;

      /* Flowing into monsters */
      if (ag.kill) {
        if (flow.borgDesperate || w.self.lunalMode || w.self.munchkinMode)
          continue;
        if (trait(w, BI.ISAFRAID)) continue;
        if (!twitchy && trait(w, BI.FOOD) >= 2 && trait(w, BI.MAXCLEVEL) < 5)
          continue;
      }

      /* Avoid shop entries when not heading to that shop */
      if (
        w.self.goal.shop >= 0 &&
        featIsShop(ag.feat) &&
        ag.store !== w.self.goal.shop &&
        y !== w.self.c.y &&
        x !== w.self.c.x
      )
        continue;

      /* Avoid traps if low level -- unless brave */
      if (ag.trap && !ag.glyph && !twitchy) {
        if (trait(w, BI.CURHP) < 60) continue;
        if (trait(w, BI.DISP) < 30 && trait(w, BI.CLEVEL) < 20) continue;
        if (trait(w, BI.DISP) < 45 && trait(w, BI.CLEVEL) < 10) continue;
        if (trait(w, BI.DISM) < 30 && trait(w, BI.CLEVEL) < 20) continue;
        if (trait(w, BI.DISM) < 45 && trait(w, BI.CLEVEL) < 10) continue;
      }

      /* Ignore icky grids */
      if (flow.icky[gi]) continue;

      /* Analyze every grid once */
      if (!flow.know[gi]) {
        flow.know[gi] = 1;
        if (!skipDangerMarking(w, flow)) {
          const p = flow.hooks.danger(w, y, x);
          const fear = computeFear(w, flow, 3);
          if (p > fear) {
            flow.icky[gi] = 1;
            continue;
          }
        }
      }

      /* Save the flow cost */
      flow.cost[gi] = n;

      /* Enqueue that entry */
      flow.flowX[flow.flowHead] = x;
      flow.flowY[flow.flowHead] = y;

      const oldHead = flow.flowHead;
      if (++flow.flowHead === AUTO_FLOW_MAX) flow.flowHead = 0;
      if (flow.flowHead === flow.flowTail) flow.flowHead = oldHead;
    }
  }

  /* Forget the flow info */
  flow.flowHead = 0;
  flow.flowTail = 0;
}

/**
 * borg_flow_commit (borg-flow.c): if the current grid is reachable (cost < 250),
 * snapshot cost[] into flow[] and set the active goal type. Returns false when
 * the goal is unreachable.
 */
export function borgFlowCommit(
  ctx: BorgContext,
  flow: FlowState,
  why: number,
): boolean {
  const w = ctx.world;
  const cost = flow.cost[dataIdx(w.self.c.x, w.self.c.y)]!;

  if (cost >= 250) return false;

  flow.flow.set(flow.cost);
  w.self.goal.type = why;
  return true;
}

/**
 * borg_play_step (borg-flow.c): take one step toward (x2, y2), returning the
 * AgentCommand that realises it (or null when there is nothing to do). The
 * branch order -- breeder door-closing, stand-on-up-stairs, monster, take,
 * glyph, trap, closed door, wall/vein/rubble, shop, plain move -- is preserved.
 */
export function borgPlayStep(
  ctx: BorgContext,
  flow: FlowState,
  y2: number,
  x2: number,
): AgentCommand | null {
  const w = ctx.world;
  const act = ctx.act;
  const cy = w.self.c.y;
  const cx = w.self.c.x;

  /* Breeder levels: close open doors behind me */
  if (w.facts.breederLevel) {
    let oY = 0;
    let oX = 0;
    let doorFound = 0;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        if (oy + cy === cy && ox + cx === cx) continue;
        if (!w.map.inBounds(cx + ox, cy + oy)) continue;
        const ag = w.map.at(cx + ox, cy + oy);
        if (ag.feat !== FEAT.OPEN) continue;
        if (ag.kill) continue;
        if (flow.door.num >= 255) continue;
        if (oy + cy === y2 && ox + cx === x2) continue;
        oY = oy;
        oX = ox;
        doorFound++;
      }
    }
    if (doorFound) {
      const dir = borgGotoDir(w, cy, cx, cy + oY, cx + oX);
      const x = cx + ddx[dir]!;
      const y = cy + ddy[dir]!;
      w.self.goal.g.x = x;
      w.self.goal.g.y = y;
      /* Track the newly closed door */
      let known = false;
      for (let i = 0; i < flow.door.num; i++) {
        if (flow.door.x[i] === x && flow.door.y[i] === y) {
          known = true;
          break;
        }
      }
      if (!known) flow.door.add(y, x);
      return act.close(dir);
    }
  }

  /* Stand on up-stairs (goal.less) */
  if (w.self.goal.less) {
    const ag = w.map.at(cx, cy);
    if (ag.feat === FEAT.LESS && !flow.hooks.forceDescend) {
      w.self.goal.less = false;
      return act.ascend();
    }
  }

  /* Direction toward the target */
  const dir = borgGotoDir(w, cy, cx, y2, x2);

  /* Arrived */
  if (dir === 5) return null;

  const x = cx + ddx[dir]!;
  const y = cy + ddy[dir]!;
  if (!w.map.inBounds(x, y)) return null;
  const ag = w.map.at(x, y);

  w.self.goal.g.x = x;
  w.self.goal.g.y = y;

  /* Monster -- attack */
  if (ag.kill) {
    const kill = w.kills.at(ag.kill);
    if (kill.rIdx === 0) return null;
    if (trait(w, BI.ISAFRAID) || trait(w, BI.CRSFEAR)) return null;
    /* Ignore town uniques until level 5 (Maggot) -- kept via known level */
    if (trait(w, BI.CDEPTH) === 0 && trait(w, BI.CLEVEL) < 5) {
      /* RF_UNIQUE detection is refined in P8.6; skip walking into it */
      return null;
    }
    return act.melee(dir);
  }

  /* Object -- take (walk onto and forget it) */
  if (ag.take && w.takes.has(ag.take)) {
    /*
     * Upstream chest/Orb-of-Draining cheats need the engine object + magic
     * subsystems (P8.5); the port keeps the plain "walk onto and delete" path,
     * which is the same grid the borg ends on.
     */
    w.takes.delete(ag.take);
    ag.take = 0;
    return act.move(dir);
  }

  /* Glyph of warding -- walk onto */
  if (ag.glyph) return act.move(dir);

  /* Traps -- disarm (spell/activation disable needs P8.x; go straight to it) */
  if (
    trait(w, BI.LIGHT) &&
    !trait(w, BI.ISBLIND) &&
    !trait(w, BI.ISCONFUSED) &&
    !w.facts.scaryGuyOnLevel &&
    ag.trap
  ) {
    ag.trap = false;
    return act.disarm(dir);
  }

  /* Closed doors -- open */
  if (ag.feat === FEAT.CLOSED) {
    if (ctx.rng.randint0(100) === 0) return null;
    /* Don't open locked doors while a monster is beating on a weak borg */
    for (let i = 0; i < 8; i++) {
      const ax = cx + ddx_ddd[i]!;
      const ay = cy + ddy_ddd[i]!;
      if (!w.map.inBounds(ax, ay)) continue;
      const ag2 = w.map.at(ax, ay);
      if (ag2.kill && trait(w, BI.CLEVEL) < 15 && !trait(w, BI.ISAFRAID))
        return null;
    }
    if (flow.closed.num) flow.closed.wipe();
    return act.open(dir);
  }

  /* Can't step on these */
  if (ag.feat === FEAT.PERM) return null;
  if (ag.feat === FEAT.LAVA && !trait(w, BI.IFIRE)) return null;

  /* Rubble, treasure, seams, walls -- tunnel (FEAT-order dependent) */
  if (ag.feat >= FEAT.SECRET && ag.feat <= FEAT.GRANITE) {
    if (ag.feat !== FEAT.RUBBLE && w.self.goal.type === GOAL_DARK) return null;
    if (!borgCanDig(ctx, flow, false, ag.feat)) {
      w.self.goal.type = 0;
      return null;
    }
    flow.vein.wipe();
    return act.tunnel(dir);
  }

  /* Shops -- enter */
  if (featIsShop(ag.feat)) {
    return act.move(dir);
  }

  /* Plain move */
  w.self.inShop = false;
  return act.move(dir);
}

/**
 * borg_flow_old (borg-flow.c): choose the optimal next step down the committed
 * flow[] gradient and realise it via borg_play_step. Preserves the never-
 * backtrack rule, the 10x cost scaling with the -5 loop-prevention bias, the
 * depth-based randomizer, and the GOAL_DIGGING no-straight-lines special case.
 * Returns the step's AgentCommand, or null (cancelling the goal, as upstream).
 */
export function borgFlowOld(
  ctx: BorgContext,
  flow: FlowState,
  why: number,
): AgentCommand | null {
  const w = ctx.world;

  if (w.self.goal.type === why) {
    let bN = 0;
    let bI = -1;

    /* Flow cost of the current grid (x10), minus 5 to prevent loops */
    let bC = flow.flow[dataIdx(w.self.c.x, w.self.c.y)]! * 10;
    bC = bC - 5;

    for (let i = 0; i < 8; i++) {
      const x = w.self.c.x + ddx_ddd[i]!;
      const y = w.self.c.y + ddy_ddd[i]!;
      if (!w.map.inBounds(x, y)) continue;

      const c = flow.flow[dataIdx(x, y)]! * 10;

      /* Never backtrack */
      if (c > bC) continue;

      /* Avoid screen edges */
      if (x > AUTO_MAX_X - 1 || x < 1 || y > AUTO_MAX_Y - 1 || y < 1) continue;

      /* Notice a new best value */
      if (c < bC) bN = 0;

      /* Apply the randomizer to equivalent values */
      if (
        trait(w, BI.CDEPTH) === 0 &&
        ++bN >= 2 &&
        ctx.rng.randint0(bN) !== 0
      )
        continue;
      else if (trait(w, BI.CDEPTH) >= 1 && ++bN >= 2) continue;

      /* Anti-summon corridor: no straight lines near the destination */
      if (
        w.self.goal.type === GOAL_DIGGING &&
        (ddx_ddd[i] === 0 || ddy_ddd[i] === 0)
      ) {
        if (distance(w.self.c.x, w.self.c.y, flow.flowX[0]!, flow.flowY[0]!) <= 2)
          continue;
      }

      bI = i;
      bC = c;
    }

    if (bI >= 0) {
      const x = w.self.c.x + ddx_ddd[bI]!;
      const y = w.self.c.y + ddy_ddd[bI]!;
      const cmd = borgPlayStep(ctx, flow, y, x);
      if (cmd) return cmd;
    }

    /* Mark a timestamp to wait in an anti-summon spot */
    if (
      w.self.goal.type === GOAL_DIGGING &&
      w.self.c.y === flow.flowY[0] &&
      w.self.c.x === flow.flowX[0]
    )
      flow.borgTAntisummon = w.clock;

    /* Cancel goal */
    w.self.goal.type = 0;
  }

  return null;
}

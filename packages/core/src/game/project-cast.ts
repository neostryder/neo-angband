/**
 * The projection-casting spine, the game-layer glue that makes the projection
 * stack usable. It wires the two projection drivers - game/project-monster.ts
 * (projectMonster) and game/project-player.ts (projectPlayer) - to the generic
 * beam/bolt/ball/arc driver project() (world/project.ts) using the live
 * GameState.
 *
 * castProjection is the core: it assembles project()'s ProjectHooks from the
 * two drivers plus GameState (and the injected hooks for the genuinely
 * downstream consequences those drivers defer - kills/drops/exp, polymorph,
 * teleport, inventory damage, stat/exp drain, messages) and runs one
 * projection. This is the single entry point the attack effect handlers (#18),
 * monster spells (#19) and player spellcasting (#22) all dispatch a projection
 * through. The flag-shape helpers (castBolt / castBeam / castBall) preset
 * project()'s flags and radius exactly as the matching effect_handler_* in
 * effect-handler-attack.c and delegate to it: castBolt / castBeam / castBall /
 * castArc / castBreath / castShortBeam / castLine / castAlter / castSpot /
 * castSphere / castStrike / castStar / castStarBall / castTouch / castSwarm /
 * castProjectLos.
 *
 * The target grid is resolved by the caller. resolveAimedTarget ports the
 * portable branches of get_target (effect-handler-attack.c L38): the player
 * and no-source cases fully, and the monster case to the player's grid. The
 * monster confused-direction / target-monster / decoy branches need the
 * monster-spell targeting and decoys (both #19+), so #19 resolves those and
 * passes the grid in.
 *
 * The player-projection actor (PlayerProjActor: resist levels, damage
 * reduction, minus_ac) is supplied by the caller, exactly as PlayerActor's
 * combat / defense views are, because calc_bonuses (which derives them) is
 * deferred. basicPlayerActor builds the no-resist, no-reduction view over the
 * live Player for callers and tests until calc_bonuses lands; take_hit's
 * mutations (chp, is_dead) write back through it to the live player/state.
 */

import { TMD } from "../generated";
import { DIR_TARGET } from "../effects/interpreter";
import { DDGRID, DDGRID_DDD, loc, locSum } from "../loc";
import type { Loc } from "../loc";
import { monsterIsVisible } from "../mon/predicate";
import { PROJECT, project } from "../world/project";
import type {
  BoltStep,
  Projection,
  ProjectHooks,
  ProjectParams,
} from "../world/project";
import { los } from "../world/view";
import type { ProjectionInfo } from "../world/projection";
import type { DamageReduction } from "../player/take-hit";
import { monsterMax } from "./context";
import type { GameState } from "./context";
import { projectMonster } from "./project-monster";
import type { ProjectMonsterHooks } from "./project-monster";
import { projectPlayer } from "./project-player";
import { projectObject } from "./project-obj";
import { projectFeature } from "./project-feat";
import type { PlayerProjActor, ProjectPlayerHooks } from "./project-player";

/** option.c: op_ptr->hitpoint_warn default (0..9). Options system deferred. */
export const DEFAULT_HITPOINT_WARN = 3;

/**
 * The projection source, unified across the two drivers. Built from a struct
 * source with playerCastSource / monsterCastSource, or by hand.
 */
export interface CastSource {
  /** origin.what == SRC_PLAYER. */
  isPlayer: boolean;
  /** origin.what == SRC_MONSTER. */
  isMonster: boolean;
  /** origin.which.monster (midx); 0 when the source is not a monster. */
  monster: number;
  /** origin_get_loc(origin): the projection's start grid. */
  grid: Loc;
  /** player_has(PF_CHARM): boosts a player projection's effects vs animals. */
  charm?: boolean;
  /** monster_is_visible(source): false hides an unseen monster source. */
  monsterVisible?: boolean;
  /** kb_str death cause for take_hit ("an orc", "a trap", "yourself"). */
  killer?: string;
  /** Monster spell power, forwarded to the player side-effect handler. */
  power?: number;
}

/** source_player(): a player-origin cast from the live player grid. */
export function playerCastSource(
  state: GameState,
  opts: { charm?: boolean; killer?: string } = {},
): CastSource {
  return {
    isPlayer: true,
    isMonster: false,
    monster: 0,
    grid: state.actor.grid,
    charm: opts.charm ?? false,
    killer: opts.killer ?? "yourself",
  };
}

/** source_monster(midx): a monster-origin cast from that monster's grid. */
export function monsterCastSource(
  state: GameState,
  midx: number,
  opts: { killer?: string; power?: number } = {},
): CastSource {
  const mon = state.monsters[midx] ?? null;
  return {
    isPlayer: false,
    isMonster: true,
    monster: midx,
    grid: mon ? mon.grid : loc(-1, -1),
    monsterVisible: mon ? monsterIsVisible(mon) : false,
    killer: opts.killer ?? "a monster",
    power: opts.power ?? 0,
  };
}

/** The consequences and UI seams a cast defers to its caller. */
export interface CastHooks {
  /** project_m's deferred consequences (kills, poly, teleport, messages). */
  monster?: ProjectMonsterHooks;
  /** project_p's deferred consequences (side effects, take_hit, messages). */
  player?: ProjectPlayerHooks;
  /** UI: one traveled bolt/beam step (suppressed when the player is blind). */
  onBolt?: (step: BoltStep, typ: number, beam: boolean) => void;
  /** UI: the whole blast, once, before per-grid effects. */
  onBlast?: (proj: Projection, typ: number) => void;
  /** Recall / health-track the single monster a player projection hit. */
  onTrackMonster?: (grid: Loc) => void;
}

/** Everything a cast needs beyond the source and the shot parameters. */
export interface CastContext {
  /** The bound projection table (world/projection.ts bindProjections). */
  projections: readonly ProjectionInfo[];
  /** z_info->max_range. */
  maxRange: number;
  /** The player-projection actor (resist / reduction view; see module doc). */
  playerActor: PlayerProjActor;
  hooks?: CastHooks;
  /**
   * World seams for project_o / project_f (floor destruction, stone-to-mud,
   * trap and door effects). When absent, PROJECT.ITEM / PROJECT.GRID
   * projections skip objects and terrain (the pre-#20/#21 behaviour).
   */
  worldEnv?: import("./project-feat").ProjectFeatEnv;
}

/**
 * basicPlayerActor: the no-resist, no-reduction player-projection view over the
 * live Player, for callers and tests until calc_bonuses (el_info, dam_red,
 * perc_dam_red, minus_ac) lands. chp and is_dead are live so take_hit's
 * mutations write back to the player and the game state.
 */
export function basicPlayerActor(
  state: GameState,
  opts: {
    /** state.el_info[type].res_level from the live derived state. */
    resistLevel?: (type: number) => number;
    /** state.dam_red / perc_dam_red from the live derived state. */
    reduction?: () => DamageReduction;
  } = {},
): PlayerProjActor {
  const p = state.actor.player;
  return {
    get chp(): number {
      return p.chp;
    },
    set chp(v: number) {
      p.chp = v;
    },
    get mhp(): number {
      return p.mhp;
    },
    get lev(): number {
      return p.lev;
    },
    get isDead(): boolean {
      return state.isDead;
    },
    set isDead(v: boolean) {
      state.isDead = v;
    },
    timed: p.timed,
    hitpointWarn: DEFAULT_HITPOINT_WARN,
    resistLevel: opts.resistLevel ?? ((): number => 0),
    get reduction(): DamageReduction {
      return opts.reduction ? opts.reduction() : { damRed: 0, percDamRed: 0 };
    },
    minusAc: false,
  };
}

/**
 * The portable branches of get_target (effect-handler-attack.c L38) for the
 * aimed bolt/beam family. Returns the target grid and whether PROJECT_PLAY
 * should be set (get_target sets it for monster and no-source projections so
 * they can hit the player).
 *
 * - SRC_PLAYER: DIR_TARGET with an acquired target aims at it; otherwise the
 *   adjacent grid in `dir`. The target system (target_okay / target_get) is
 *   deferred (#24), so the acquired grid is passed in as `aimed`.
 * - SRC_MONSTER: aims at the player. The confused-direction, target-monster
 *   and decoy branches need monster-spell targeting and decoys (#19+); #19
 *   resolves those and passes the grid in directly.
 * - default (SRC_NONE / trap / object): aims at the player, sets PROJECT_PLAY.
 */
export function resolveAimedTarget(
  state: GameState,
  source: CastSource,
  dir: number,
  aimed?: Loc,
): { grid: Loc; play: boolean } {
  if (source.isPlayer) {
    if (dir === DIR_TARGET && aimed) return { grid: aimed, play: false };
    return { grid: locSum(state.actor.grid, DDGRID[dir] ?? loc(0, 0)), play: false };
  }
  /* Monster and no-source projections target the player and may hit them. */
  return { grid: state.actor.grid, play: true };
}

/**
 * castProjection: assemble project()'s hooks from the two drivers plus the live
 * GameState and fire one projection at `target`. `flg` is the fully-resolved
 * PROJECT_* flag set; `rad` is 0 for a bolt/beam or the ball/arc radius. Returns
 * project()'s notice value (the player observed some effect). This is the seam
 * every attack effect, monster spell and player spell dispatches through.
 */
export function castProjection(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  dam: number,
  typ: number,
  flg: number,
  rad: number,
  degreesOfArc = 0,
  diameterOfSource = 0,
): boolean {
  const hooks = cctx.hooks ?? {};

  const monCtx = {
    state,
    projections: cctx.projections,
    origin: {
      isPlayer: source.isPlayer,
      monster: source.monster,
      grid: source.grid,
      charm: source.charm ?? false,
    },
    hooks: hooks.monster ?? {},
  };

  const plCtx = {
    rng: state.rng,
    actor: cctx.playerActor,
    playerGrid: state.actor.grid,
    projections: cctx.projections,
    origin: {
      isPlayer: source.isPlayer,
      isMonster: source.isMonster,
      ...(source.monsterVisible !== undefined
        ? { monsterVisible: source.monsterVisible }
        : {}),
      killer: source.killer ?? "a bug",
    },
    power: source.power ?? 0,
    hooks: hooks.player ?? {},
  };

  const projectHooks: ProjectHooks = {
    onMonster: (dist, g, d, t, f) => projectMonster(monCtx, dist, g, d, t, f),
    onPlayer: (dist, g, d, t, self) => projectPlayer(plCtx, dist, g, d, t, self),
    playerIsDead: () => cctx.playerActor.isDead,
    ...(hooks.onTrackMonster ? { onTrackMonster: hooks.onTrackMonster } : {}),
    ...(hooks.onBolt ? { onBolt: hooks.onBolt } : {}),
    ...(hooks.onBlast ? { onBlast: hooks.onBlast } : {}),
    /* project_o / project_f over the live floor piles and terrain. */
    ...(cctx.worldEnv
      ? {
          onObject: (dist: number, g: Loc, d: number, t: number): boolean =>
            projectObject(state, dist, g, d, t, cctx.worldEnv),
          onFeature: (dist: number, g: Loc, d: number, t: number): boolean =>
            projectFeature(state, dist, g, d, t, cctx.worldEnv),
        }
      : {}),
  };

  const params: ProjectParams = {
    origin: source.grid,
    finish: target,
    rad,
    typ,
    flg,
    dam,
    maxRange: cctx.maxRange,
    sourceIsPlayer: source.isPlayer,
    blind: cctx.playerActor.timed[TMD.BLIND]! > 0,
    degreesOfArc,
    diameterOfSource,
  };

  return project(state.chunk, params, projectHooks);
}

/**
 * effect_handler_BOLT: a bolt that stops at the first monster. project_aimed
 * adds PROJECT_THRU; get_target adds PROJECT_PLAY for a non-player source.
 */
export function castBolt(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  dam: number,
  typ: number,
): boolean {
  let flg = PROJECT.STOP | PROJECT.KILL | PROJECT.THRU;
  if (!source.isPlayer) flg |= PROJECT.PLAY;
  return castProjection(state, cctx, source, target, dam, typ, flg, 0);
}

/**
 * effect_handler_BEAM: a beam that passes through monsters. As castBolt but
 * PROJECT_BEAM instead of PROJECT_STOP.
 */
export function castBeam(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  dam: number,
  typ: number,
): boolean {
  let flg = PROJECT.BEAM | PROJECT.KILL | PROJECT.THRU;
  if (!source.isPlayer) flg |= PROJECT.PLAY;
  return castProjection(state, cctx, source, target, dam, typ, flg, 0);
}

/**
 * effect_handler_BALL: an exploding ball. A monster source adds PROJECT_PLAY
 * and drops STOP/THRU so it detonates on the player; a player source drops
 * STOP/THRU only when a specific target was acquired (aimedAtTarget), so a
 * bare-direction ball still stops at the first obstacle. `rad` defaults to 2
 * upstream; the caller applies any powerful-monster or player-level radius
 * bonus before calling.
 */
export function castBall(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  dam: number,
  typ: number,
  rad = 2,
  opts: { aimedAtTarget?: boolean } = {},
): boolean {
  let flg =
    PROJECT.THRU | PROJECT.STOP | PROJECT.GRID | PROJECT.ITEM | PROJECT.KILL;
  if (source.isMonster) {
    flg |= PROJECT.PLAY;
    flg &= ~(PROJECT.STOP | PROJECT.THRU);
  } else if (source.isPlayer && opts.aimedAtTarget) {
    flg &= ~(PROJECT.STOP | PROJECT.THRU);
  }
  return castProjection(state, cctx, source, target, dam, typ, flg, rad);
}

/**
 * effect_handler_LINE (L173): a beam that also affects grids (e.g. light).
 * As castBeam but with PROJECT_GRID.
 */
export function castLine(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  dam: number,
  typ: number,
): boolean {
  let flg = PROJECT.BEAM | PROJECT.GRID | PROJECT.KILL | PROJECT.THRU;
  if (!source.isPlayer) flg |= PROJECT.PLAY;
  return castProjection(state, cctx, source, target, dam, typ, flg, 0);
}

/**
 * effect_handler_ALTER (L186): affect grids and objects, not monsters, with no
 * damage (door/wall alteration). PROJECT_BEAM | GRID | ITEM (+THRU from
 * project_aimed).
 */
export function castAlter(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  typ: number,
): boolean {
  let flg = PROJECT.BEAM | PROJECT.GRID | PROJECT.ITEM | PROJECT.THRU;
  if (!source.isPlayer) flg |= PROJECT.PLAY;
  return castProjection(state, cctx, source, target, 0, typ, flg, 0);
}

/** diameter_of_source for an arc/breath of the given width (arc.c geometry). */
function arcDiameter(baseDiameter: number, degreesOfArc: number): number {
  let d = baseDiameter;
  if (degreesOfArc < 60) d = Math.trunc((d * 60) / degreesOfArc);
  return d > 25 ? 25 : d;
}

/**
 * effect_handler_ARC (L789): a cone from the caster. PROJECT_ARC | GRID | ITEM |
 * KILL (+PLAY for a monster source). A radius of 0 means no fixed limit
 * (z_info->max_range). The arc's energy source diameter starts at 4 and widens
 * as the cone narrows, so a tight arc dissipates more slowly. degrees_of_arc is
 * clamped to a minimum of 20.
 */
export function castArc(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  dam: number,
  typ: number,
  rad: number,
  degreesOfArc: number,
): boolean {
  let flg = PROJECT.ARC | PROJECT.GRID | PROJECT.ITEM | PROJECT.KILL;
  if (source.isMonster) flg |= PROJECT.PLAY;
  const degrees = Math.max(degreesOfArc, 20);
  const r = rad === 0 ? cctx.maxRange : rad;
  const diameter = arcDiameter(4, degrees);
  return castProjection(state, cctx, source, target, dam, typ, flg, r, degrees, diameter);
}

/**
 * effect_handler_BREATH (L681): breathe an element in a cone. Like castArc, but
 * a powerful monster breathes at full strength further out (source diameter
 * 4 -> 6 before the arc-width widening). The damage (breath_dam) and the
 * "You breathe X" message are the caller's (#19); a radius of 0 means
 * z_info->max_range.
 */
export function castBreath(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  dam: number,
  typ: number,
  degreesOfArc: number,
  opts: { radius?: number; powerful?: boolean } = {},
): boolean {
  let flg = PROJECT.ARC | PROJECT.GRID | PROJECT.ITEM | PROJECT.KILL;
  if (source.isMonster) flg |= PROJECT.PLAY;
  const degrees = Math.max(degreesOfArc, 20);
  const rad = opts.radius && opts.radius > 0 ? opts.radius : cctx.maxRange;
  /* Powerful monsters breathe at full strength further out. */
  const baseDiameter = opts.powerful ? Math.trunc((4 * 3) / 2) : 4;
  const diameter = arcDiameter(baseDiameter, degrees);
  return castProjection(state, cctx, source, target, dam, typ, flg, rad, degrees, diameter);
}

/**
 * effect_handler_SHORT_BEAM (L852): a fixed-length beam. PROJECT_ARC with
 * degrees 0 and a positive radius is normalised to a beam by project(); the
 * source diameter equals the radius so it is full strength for its whole
 * length. The caller applies any player-level radius bonus (rad += lev / other).
 */
export function castShortBeam(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  dam: number,
  typ: number,
  rad: number,
): boolean {
  let flg = PROJECT.ARC | PROJECT.GRID | PROJECT.ITEM | PROJECT.KILL;
  if (source.isMonster) flg |= PROJECT.PLAY;
  const diameter = rad > 25 ? 25 : rad;
  return castProjection(state, cctx, source, target, dam, typ, flg, rad, 0, diameter);
}

/**
 * effect_handler_SPOT (L545): explode on the player's own grid, hitting the
 * player (PROJECT_PLAY | SELF), grids, objects and monsters. The source
 * diameter equals the radius. The caller applies any player-level radius bonus.
 */
export function castSpot(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  dam: number,
  typ: number,
  rad: number,
): boolean {
  const flg =
    PROJECT.STOP |
    PROJECT.PLAY |
    PROJECT.GRID |
    PROJECT.ITEM |
    PROJECT.KILL |
    PROJECT.SELF;
  return castProjection(state, cctx, source, state.actor.grid, dam, typ, flg, rad, 0, rad);
}

/**
 * effect_handler_SPHERE (L571): a ball from the player's grid with an explicit
 * source diameter (full strength out to that diameter). Affects grids, objects
 * and monsters, but not the player.
 */
export function castSphere(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  dam: number,
  typ: number,
  rad: number,
  diameterOfSource: number,
): boolean {
  const flg = PROJECT.STOP | PROJECT.GRID | PROJECT.ITEM | PROJECT.KILL;
  return castProjection(
    state,
    cctx,
    source,
    state.actor.grid,
    dam,
    typ,
    flg,
    rad,
    0,
    diameterOfSource,
  );
}

/**
 * effect_handler_STRIKE (L1001): drop a ball on the target from above
 * (PROJECT_JUMP, no travel path). Affects grids, objects and monsters.
 */
export function castStrike(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  dam: number,
  typ: number,
  rad: number,
): boolean {
  const flg = PROJECT.JUMP | PROJECT.GRID | PROJECT.ITEM | PROJECT.KILL;
  return castProjection(state, cctx, source, target, dam, typ, flg, rad);
}

/**
 * effect_handler_STAR (L1032): a beam in each of the eight compass directions
 * from the player. Affects grids and monsters. Returns whether any beam was
 * noticed.
 */
export function castStar(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  dam: number,
  typ: number,
): boolean {
  const flg = PROJECT.THRU | PROJECT.BEAM | PROJECT.GRID | PROJECT.KILL;
  let notice = false;
  for (const off of DDGRID_DDD) {
    const target = locSum(state.actor.grid, off);
    if (castProjection(state, cctx, source, target, dam, typ, flg, 0)) notice = true;
  }
  return notice;
}

/**
 * effect_handler_STAR_BALL (L1062): a ball in each of the eight compass
 * directions from the player. Affects grids, objects and monsters.
 */
export function castStarBall(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  dam: number,
  typ: number,
  rad: number,
): boolean {
  const flg =
    PROJECT.STOP | PROJECT.THRU | PROJECT.GRID | PROJECT.ITEM | PROJECT.KILL;
  let notice = false;
  for (const off of DDGRID_DDD) {
    const target = locSum(state.actor.grid, off);
    if (castProjection(state, cctx, source, target, dam, typ, flg, rad)) notice = true;
  }
  return notice;
}

/**
 * project_touch (L112): a radius-1 (or given) ball centred on the player,
 * affecting grids, objects and monsters but hidden from bolt visuals
 * (PROJECT_HIDE). PROJECT_AWARE is set when the player is aware of the effect.
 * The monster-source decoy / target-monster branches of effect_handler_TOUCH
 * are deferred (#19); this is the base player-centred touch.
 */
export function castTouch(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  dam: number,
  typ: number,
  rad: number,
  aware: boolean,
): boolean {
  let flg =
    PROJECT.GRID | PROJECT.KILL | PROJECT.HIDE | PROJECT.ITEM | PROJECT.THRU;
  if (aware) flg |= PROJECT.AWARE;
  const r = rad > 0 ? rad : 1;
  return castProjection(state, cctx, source, state.actor.grid, dam, typ, flg, r);
}

/**
 * effect_handler_SWARM (L974): fire `num` non-jumping balls at the same target
 * (targeting an absolute grid so a monster's death does not move the aim).
 * Always player-sourced. Returns whether any shot was noticed.
 */
export function castSwarm(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  target: Loc,
  dam: number,
  typ: number,
  rad: number,
  num: number,
): boolean {
  const flg =
    PROJECT.THRU | PROJECT.STOP | PROJECT.GRID | PROJECT.ITEM | PROJECT.KILL;
  let notice = false;
  for (let n = num; n > 0; n--) {
    if (castProjection(state, cctx, source, target, dam, typ, flg, rad)) notice = true;
  }
  return notice;
}

/**
 * effect_handler_PROJECT_LOS (L1088): apply a jump projection to every monster
 * in line of sight of the origin. The projection source is always the player
 * (damage is attributed to them), exactly as upstream. `excludeMonster` is the
 * currently-acting monster (cave->mon_current), skipped so a monster casting
 * this does not hit itself; `originGrid` defaults to the player's grid.
 */
export function castProjectLos(
  state: GameState,
  cctx: CastContext,
  source: CastSource,
  dam: number,
  typ: number,
  opts: { originGrid?: Loc; excludeMonster?: number } = {},
): boolean {
  const flg = PROJECT.JUMP | PROJECT.KILL | PROJECT.HIDE;
  const originGrid = opts.originGrid ?? state.actor.grid;
  const exclude = opts.excludeMonster ?? 0;
  let notice = false;
  const max = monsterMax(state);
  for (let i = 1; i < max; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (i === exclude) continue;
    if (!los(state.chunk, originGrid, mon.grid)) continue;
    if (castProjection(state, cctx, source, mon.grid, dam, typ, flg, 0)) notice = true;
  }
  return notice;
}

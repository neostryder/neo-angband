/**
 * Golden vectors for project_p: what EVERY projection does to the PLAYER,
 * recorded from the code BEFORE the dispatch switch became a registry.
 *
 * WHY A RECORDING AND NOT "THE TESTS STILL PASS". player-side.test.ts asserts
 * particular behaviours - SHARD cuts, PROT_STUN blocks a SOUND stun, a resisted
 * breath still teaches its rune - and those were written to pin the bugs they
 * were found by, not the cross product. Converting a 21-case switch over
 * faithful behaviour to a registry buys moddability and nothing else, so the
 * standard is "nothing moved", and only a recording of the producer can say so.
 *
 * WHAT A SCENARIO CAPTURES. project_p is the widest-reaching of the three
 * projection handlers: it damages the pack, drains stats and experience, sets
 * nine timed effects, disenchants worn gear, spends mana and energy, and
 * teleports the player outright. So the snapshot is broad on purpose - every
 * message in order, the extra damage returned, the whole timed array, both stat
 * arrays, exp / mana / energy, where the player ended up, and what is left of
 * the pack and the worn armour.
 *
 * AND THE RNG POSITION. `rngProbe` is one draw taken after the scenario. Two
 * implementations can agree on every visible value while drawing a different
 * NUMBER of randoms, and here that is not hypothetical: FIRE, COLD, DARK,
 * NETHER and POIS all roll `randint0(dam)` and then decide, TIME picks a branch
 * with two draws before doing anything, and POIS's acid sting runs adjust_dam,
 * which evaluates a dice denominator. Every one of those is invisible in the
 * result and diverges the whole game a few turns later.
 *
 * The fixtures are INJECTED (`PlayerSideFixtures`) so this module needs no
 * node:fs and stays importable anywhere; the one copy that reads the disk is
 * `player-side-vectors.fixtures.ts`, shared by the test and the generator so
 * they cannot disagree about what they are measuring.
 */

import { ELEM, PROJ, TMD } from "../generated/index.js";
import { loc } from "../loc.js";
import type { GameState } from "./context.js";
import type { ProjectionInfo } from "../world/projection.js";
import type { PlayerProjActor } from "./project-player.js";
import { makePlayerSideEffects } from "./player-side.js";
import type { PlayerSideDeps } from "./player-side.js";
import type { TimedEffect } from "../player/types.js";

/** What the recorder needs from the real content pack and the real harness. */
export interface PlayerSideFixtures {
  /** A fresh game state on a given seed; the same one the game tests use. */
  makeState: (seed: number) => GameState;
  /** The bound player_timed table, so the timed effects are the shipped ones. */
  timed: readonly TimedEffect[];
  /**
   * The bound projection table. POIS's acid sting runs adjust_dam through it,
   * and adjust_dam EVALUATES A DICE DENOMINATOR - so a stubbed table would
   * record a different draw count than the game makes.
   */
  projections: readonly ProjectionInfo[];
  /** Fill the pack with real kinds that real elements really destroy. */
  fillPack: (state: GameState) => void;
  /**
   * The kind inven_damage really destroys, per element, as the fixture derived
   * it. Exposed so the coverage guard can fail when an element found none -
   * an empty pack would make every ACID row record an untouched pack forever.
   */
  destroyedByElement: ReadonlyMap<number, unknown>;
  /**
   * Fill every weapon and armour slot, optionally with every protective flag
   * project_p reads. Not optional and not one item: minus_ac and
   * disenchant_equipment both pick a random slot BY TYPE and then look for an
   * item in it, so a single suit in the wrong slot is invisible to both.
   */
  equipArmour: (state: GameState, warded: boolean) => void;
  /** Put a real monster at `grid`; returns its index, or 0 if it could not. */
  addMonster: (state: GameState, grid: ReturnType<typeof loc>) => number;
}

/** One recorded scenario: its inputs, and everything observable afterwards. */
export interface PlayerSideVector {
  /** Stable identity for the row, so a divergence names the case. */
  readonly id: string;
  readonly proj: string;
  readonly dam: number;
  readonly power: number;
  /** "none" | "resist" | "immune": the res_level the actor reports for all. */
  readonly resist: string;
  /** Whether the worn armour carries the protective flags. */
  readonly warded: boolean;
  /** "monster" | "trap": what cave->mon_current and origin.grid resolve to. */
  readonly origin: string;
  readonly seed: number;
  /** The extra damage the handler returned (POIS's acid sting). */
  readonly xtra: number;
  /** Every message, in order. */
  readonly messages: readonly string[];
  /** Non-zero timed effects afterwards, by name, sorted. */
  readonly timed: readonly string[];
  /** p->stat_cur, then p->stat_max: drains show in one or both. */
  readonly statCur: readonly number[];
  readonly statMax: readonly number[];
  readonly exp: number;
  readonly maxExp: number;
  readonly csp: number;
  /** p->energy: NETHER's "Your energy is sapped!" zeroes it. */
  readonly energy: number;
  /** Where the player ended up: GRAVITY, NEXUS and FORCE all move them. */
  readonly grid: readonly [number, number];
  /** The depth teleport_player_level asked for, or null if it did not. */
  readonly levelChangeTo: number | null;
  /** How many times the post-move seam fired (teleports and FORCE's thrust). */
  readonly postMoves: number;
  /** How many stacks remain in the pack, and how many items in total. */
  readonly packStacks: number;
  readonly packItems: number;
  /**
   * The summed to_h + to_d + to_a over EVERY carried and worn object.
   *
   * One number rather than one slot, because the three ways project_p writes
   * enchantment land in different places: disenchant_equipment picks a random
   * worn slot, minus_ac picks a random ARMOUR slot, and inven_damage's damage
   * arm decrements a PACK weapon or suit. Reading slot 0 saw only the first of
   * those, and reported 8 in all 2,304 rows of the first recording.
   */
  readonly gearEnchant: number;
  /** Object flags the player has LEARNED: every arm here teaches runes. */
  readonly learnedFlags: number;
  /** ONE draw taken after the scenario: catches a changed DRAW COUNT. */
  readonly rngProbe: number;
}

/**
 * The projections worth recording: every arm of the switch, plus three that
 * fall to the empty default. The default group is sampled rather than
 * enumerated because the vectors would then be measuring `PROJ`'s size rather
 * than project_p's behaviour - its membership is asserted separately by the
 * coverage guard in the test.
 */
export const VECTOR_PROJECTIONS: readonly (readonly [string, number])[] = [
  ["ACID", PROJ.ACID],
  ["ELEC", PROJ.ELEC],
  ["FIRE", PROJ.FIRE],
  ["COLD", PROJ.COLD],
  ["POIS", PROJ.POIS],
  ["LIGHT", PROJ.LIGHT],
  ["DARK", PROJ.DARK],
  ["DARK_WEAK", PROJ.DARK_WEAK],
  ["SOUND", PROJ.SOUND],
  ["SHARD", PROJ.SHARD],
  ["NEXUS", PROJ.NEXUS],
  ["NETHER", PROJ.NETHER],
  ["CHAOS", PROJ.CHAOS],
  ["DISEN", PROJ.DISEN],
  ["WATER", PROJ.WATER],
  ["ICE", PROJ.ICE],
  ["GRAVITY", PROJ.GRAVITY],
  ["INERTIA", PROJ.INERTIA],
  ["FORCE", PROJ.FORCE],
  ["TIME", PROJ.TIME],
  ["PLASMA", PROJ.PLASMA],
  /* The empty-handler group: no player side effect at all. */
  ["METEOR", PROJ.METEOR],
  ["MISSILE", PROJ.MISSILE],
  ["MANA", PROJ.MANA],
];

/**
 * Damage values. The `randint0(dam) > 500` gates in FIRE, COLD and DARK cannot
 * fire below 501 at all, so a grid that only ran small hits would record the
 * powerful-attack arms as dead code. 5000 clears every threshold in the file.
 */
export const VECTOR_DAMAGE: readonly number[] = [10, 5000];

/**
 * Monster spell power. The bonus arms gate on >= 60 (POIS), >= 70 (DARK) and
 * >= 80 (FIRE, COLD, NETHER); 0 is below all of them and 80 is above all.
 */
export const VECTOR_POWER: readonly number[] = [0, 80];

/**
 * res_level the projection actor reports for EVERY element. 3 is immunity,
 * which is what ACID / ELEC / FIRE / COLD / ICE check before touching the pack;
 * 1 is the plain resist that makes nine handlers bail with "You resist the
 * effect!" - and those early breaks are exactly what a mis-keyed registry would
 * skip.
 */
export const VECTOR_RESISTS: readonly (readonly [string, number])[] = [
  ["none", 0],
  ["resist", 1],
  ["immune", 3],
];

/**
 * The seeds the grid runs.
 *
 * SIX, NOT TWO, and the reason is worth keeping. Seven handlers ignore `power`
 * and NEXUS ignores `dam` as well, so for those the whole rest of the grid
 * collapses onto ONE rng stream per seed - two seeds gave NEXUS four distinct
 * paths and its 1-in-4 teleport-level arm came up empty in all 96 of its rows.
 * A dimension that does not vary the handler's input does not sample it.
 */
export const VECTOR_SEEDS: readonly number[] = [1, 7, 16, 29, 43, 61];

/** Where a monster-sourced projection comes from: away from the player. */
const CASTER_GRID = loc(7, 7);

/** Name by index for a TMD value, so a vector reads as an effect not a number. */
function timedName(idx: number): string {
  for (const [name, value] of Object.entries(TMD)) {
    if (value === idx) return name;
  }
  return `TMD_${String(idx)}`;
}

/**
 * A stub projection actor reporting one res_level for every element.
 *
 * FLAT ON PURPOSE. Per-element resist profiles would multiply the grid by the
 * element count to separate handlers that are already separated by `proj`; what
 * the vectors need is that each handler's resisted and unresisted arms are both
 * reached, and one level applied to all elements does that in three rows.
 */
function stubActor(level: number, energyRef: { value: number }): PlayerProjActor {
  return {
    resistLevel: () => level,
    get energy(): number {
      return energyRef.value;
    },
    set energy(v: number) {
      energyRef.value = v;
    },
  } as unknown as PlayerProjActor;
}

/**
 * Run one scenario and record it.
 *
 * Built fresh from a seeded state each time, so a vector is a function of its
 * own inputs alone - no ordering between rows, which is what lets one `it()`
 * per row report a divergence by name.
 */
export function recordPlayerSide(
  fx: PlayerSideFixtures,
  projName: string,
  proj: number,
  dam: number,
  power: number,
  resistName: string,
  resistLevel: number,
  warded: boolean,
  originName: string,
  seed: number,
): PlayerSideVector {
  const state = fx.makeState(seed);
  const p = state.actor.player;

  /* A level and an experience total, because four handlers drain experience and
   * a level-1 player with 0 exp records every drain as a no-op. GRAVITY's blink
   * also compares randint1(127) against p->lev. */
  p.lev = 20;
  p.exp = 50_000;
  p.maxExp = 50_000;
  p.msp = 40;
  p.csp = 40;
  /* Stats above the floor, so a drain has somewhere to go. */
  for (let i = 0; i < p.statCur.length; i++) {
    p.statCur[i] = 15;
    p.statMax[i] = 15;
  }

  fx.equipArmour(state, warded);
  fx.fillPack(state);

  const monsterIdx =
    originName === "monster" ? fx.addMonster(state, CASTER_GRID) : 0;

  const messages: string[] = [];
  /* state.actor.energy is a live field on the harness actor; the stub reads and
   * writes THROUGH it so NETHER's "Your energy is sapped!" stays observable. */
  const energyRef = { value: 100 };
  state.actor.energy = 100;

  /* The teleport seams GRAVITY, NEXUS and FORCE reach through. Recorded rather
   * than omitted: `changeLevel` is the ONLY observable half of NEXUS's
   * teleport-level arm - the harness has no session to change level for - and
   * without it that arm looks identical to a no-op. */
  let levelChangeTo: number | null = null;
  let postMoves = 0;
  const deps: PlayerSideDeps = {
    timed: fx.timed,
    actor: stubActor(resistLevel, energyRef),
    projections: fx.projections,
    expDeps: { rng: state.rng },
    lifeDrainPercent: 2,
    teleport: {
      changeLevel: (depth: number) => {
        levelChangeTo = depth;
      },
      onPlayerPostMove: () => {
        postMoves++;
      },
    },
    msg: (t: string) => messages.push(t),
  };
  const hook = makePlayerSideEffects(state, deps);

  const xtra = hook({
    origin:
      originName === "monster"
        ? {
            isPlayer: false,
            isMonster: true,
            monster: monsterIdx,
            grid: CASTER_GRID,
            killer: "a recorded caster",
          }
        : {
            isPlayer: false,
            isMonster: false,
            isTrap: true,
            /* On the player's OWN grid: FORCE's trap arm reads exactly that,
             * and pushes them in a random direction when it holds. */
            grid: state.actor.grid,
            killer: "a recorded trap",
          },
    r: 0,
    grid: state.actor.grid,
    dam,
    typ: proj,
    power,
    obvious: true,
  });

  const timedOn: string[] = [];
  for (let i = 0; i < p.timed.length; i++) {
    if ((p.timed[i] ?? 0) > 0) timedOn.push(`${timedName(i)}=${String(p.timed[i])}`);
  }

  let packItems = 0;
  for (const handle of state.gear.pack) {
    packItems += state.gear.store.get(handle)?.number ?? 0;
  }
  let gearEnchant = 0;
  for (const handle of [...state.gear.pack, ...p.equipment]) {
    const obj = state.gear.store.get(handle);
    if (obj) gearEnchant += obj.toH + obj.toD + obj.toA;
  }

  return {
    id:
      `${projName}/dam${String(dam)}/pow${String(power)}/${resistName}` +
      `/${warded ? "warded" : "bare"}/${originName}/seed${String(seed)}`,
    proj: projName,
    dam,
    power,
    resist: resistName,
    warded,
    origin: originName,
    seed,
    xtra,
    messages,
    timed: timedOn.sort(),
    statCur: [...p.statCur],
    statMax: [...p.statMax],
    exp: p.exp,
    maxExp: p.maxExp,
    csp: p.csp,
    energy: state.actor.energy,
    grid: [state.actor.grid.x, state.actor.grid.y],
    levelChangeTo,
    postMoves,
    packStacks: state.gear.pack.length,
    packItems,
    gearEnchant,
    /* Nearly every arm teaches a rune - the sustains, HOLD_LIFE, PROT_STUN -
     * and equip_learn_flag is a real side effect upstream performs whether or
     * not the effect landed. Counting them makes a dropped learn visible. */
    learnedFlags: p.objKnown.flags.count(),
    /* Capped well under Rand_div's 0x10000000 limit. */
    rngProbe: state.rng.randint0(100_000_000),
  };
}

/** Every scenario in the grid, in a fixed order. */
export function recordAllPlayerSide(
  fx: PlayerSideFixtures,
): PlayerSideVector[] {
  const out: PlayerSideVector[] = [];
  for (const [projName, proj] of VECTOR_PROJECTIONS) {
    for (const dam of VECTOR_DAMAGE) {
      for (const power of VECTOR_POWER) {
        for (const [resistName, resistLevel] of VECTOR_RESISTS) {
          for (const warded of [false, true]) {
            for (const originName of ["monster", "trap"]) {
              for (const seed of VECTOR_SEEDS) {
                out.push(
                  recordPlayerSide(
                    fx, projName, proj, dam, power, resistName, resistLevel,
                    warded, originName, seed,
                  ),
                );
              }
            }
          }
        }
      }
    }
  }
  return out;
}

/** The elements whose immunity gates a pack-damage arm, for the coverage guard. */
export const PACK_DAMAGE_ELEMENTS: readonly number[] = [
  ELEM.ACID,
  ELEM.ELEC,
  ELEM.FIRE,
  ELEM.COLD,
];

/**
 * The dungeon depth every scenario runs at. Not incidental: the harness builds
 * at depth 0, the TOWN, and teleport_player_level cannot go up from there - so
 * its up/down coin flip, a real RNG draw, never happened on the first pass.
 */
export const VECTOR_DEPTH = 5;

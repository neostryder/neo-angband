/**
 * Golden vectors for project_f: what EVERY projection does to EVERY kind of
 * terrain, recorded from the code BEFORE the dispatch switch became a registry.
 *
 * WHY A RECORDING AND NOT "THE TESTS STILL PASS". `projectFeature` is a
 * 37-case switch over faithful behaviour whose whole value is being identical
 * to Angband 4.2.6, and the existing tests over it assert particular
 * behaviours - lava creation, trap disabling, door locks - not the cross
 * product. Converting it to a registry is a refactor of live code with no
 * new capability of its own, so the standard is "nothing moved", and only a
 * recording of the producer can say that.
 *
 * WHAT A SCENARIO CAPTURES. Everything the caller and the player can observe:
 * the boolean project_f returns, the feature and its GLOW bit afterwards,
 * every message in order, what is left on the floor, whether the monster and
 * the traps survived, and whether the FOV refresh was requested.
 *
 * AND THE RNG POSITION. `rngProbe` is one draw taken after the scenario. Two
 * implementations can agree on every visible value while drawing a different
 * NUMBER of randoms - KILL_WALL's 10% rubble find and FIRE's lava threshold
 * both draw before deciding - and that difference is invisible in the result
 * and diverges the whole game a few turns later. See
 * `blow-vectors.ts`, where a mutation that changed nothing else moved only
 * this field.
 *
 * The fixtures are INJECTED (`ProjectFeatFixtures`) so this module needs no
 * node:fs and stays importable anywhere; the one copy that reads the disk is
 * `project-feat-vectors.fixtures.ts`, shared by the test and the generator so
 * they cannot disagree about what they are measuring.
 */

import { FEAT, PROJ, SQUARE, TMD } from "../generated/index.js";
import { loc } from "../loc.js";
import type { Loc } from "../loc.js";
import type { GameState } from "./context.js";
import type { MakeDeps } from "../obj/make.js";
import type { TrapDeps } from "./trap.js";
import { floorPile } from "./floor.js";
import { projectFeature } from "./project-feat.js";
import type { ProjectFeatEnv } from "./project-feat.js";

/** What the recorder needs from the real content pack and the real harness. */
export interface ProjectFeatFixtures {
  /** A fresh game state on a given seed; the same one the game tests use. */
  makeState: (seed: number) => GameState;
  /** Object generation, so the rubble find and the gold vein really roll. */
  makeDeps: MakeDeps;
  /** The real trap kinds, so webs and door locks are the shipped ones. */
  trapDeps: TrapDeps;
  /** Put a monster at `grid`; returns false if the harness could not. */
  addMonster: (state: GameState, grid: Loc) => boolean;
  /** Put a plain object on the floor at `grid`. */
  addObject: (state: GameState, grid: Loc) => void;
  /** Place a real, REVEALED trap of the shipped kinds at `grid`. */
  addTrap: (state: GameState, grid: Loc, name: string) => void;
  /** Give a door grid a lock, so the unlock branch is reachable. */
  lockDoor: (state: GameState, grid: Loc) => void;
}

/** One recorded scenario: its inputs, and everything observable afterwards. */
export interface ProjectFeatVector {
  /** Stable identity for the row, so a divergence names the case. */
  readonly id: string;
  readonly proj: string;
  readonly terrain: string;
  readonly dam: number;
  readonly seed: number;
  readonly blind: boolean;
  readonly occupied: boolean;
  /** Dungeon depth: 0 is the surface, where the sun branches live. */
  readonly depth: number;
  /** project_f's return: did the player observe anything. */
  readonly obvious: boolean;
  /** The feature at the grid afterwards, by name. */
  readonly feat: string;
  /** Whether the grid is lit afterwards. */
  readonly glow: boolean;
  /** Every message, in order. */
  readonly messages: readonly string[];
  /** How many objects sit on the target grid afterwards. */
  readonly objectsHere: number;
  /** How many objects exist anywhere (push_object moves rather than destroys). */
  readonly objectsTotal: number;
  /** Whether a trap remains at the grid, and its disabled timeout if any. */
  readonly trapHere: boolean;
  /** Whether the monster that was placed is still alive. */
  readonly monsterAlive: boolean;
  /** Whether the handler asked for an FOV refresh. */
  readonly fovRefreshed: boolean;
  /** ONE draw taken after the scenario: catches a changed DRAW COUNT. */
  readonly rngProbe: number;
}

/**
 * The projections worth recording.
 *
 * Every arm of the switch, plus representatives of the two groups that share a
 * body: the monster-directed projections that upstream leaves as empty feature
 * handlers, and the elemental ones that fall to the observe-only default. A
 * group is sampled rather than enumerated because the vectors would then be
 * measuring `PROJ`'s size, not project_f's behaviour - but each group's
 * membership is asserted separately by the coverage guard.
 */
export const VECTOR_PROJECTIONS: readonly (readonly [string, number])[] = [
  ["LIGHT", PROJ.LIGHT],
  ["LIGHT_WEAK", PROJ.LIGHT_WEAK],
  ["DARK", PROJ.DARK],
  ["DARK_WEAK", PROJ.DARK_WEAK],
  ["KILL_WALL", PROJ.KILL_WALL],
  ["KILL_DOOR", PROJ.KILL_DOOR],
  ["KILL_TRAP", PROJ.KILL_TRAP],
  ["MAKE_DOOR", PROJ.MAKE_DOOR],
  ["MAKE_TRAP", PROJ.MAKE_TRAP],
  ["FIRE", PROJ.FIRE],
  ["PLASMA", PROJ.PLASMA],
  ["COLD", PROJ.COLD],
  ["ICE", PROJ.ICE],
  // The empty-handler group (never touches terrain, never sets obvious).
  ["AWAY_ALL", PROJ.AWAY_ALL],
  ["MON_CLONE", PROJ.MON_CLONE],
  ["SLEEP_EVIL", PROJ.SLEEP_EVIL],
  // The observe-only default.
  ["ACID", PROJ.ACID],
  ["ELEC", PROJ.ELEC],
  ["POIS", PROJ.POIS],
  ["LIGHT_BAD", PROJ.SHARD],
];

/**
 * The terrains a projection can land on, chosen to reach every branch inside
 * KILL_WALL (rubble / door / treasure vein / magma / quartz / granite / perm)
 * and the fiery and floor gates of FIRE and COLD.
 */
export const VECTOR_TERRAINS: readonly (readonly [string, number])[] = [
  ["FLOOR", FEAT.FLOOR],
  ["GRANITE", FEAT.GRANITE],
  ["MAGMA", FEAT.MAGMA],
  ["QUARTZ", FEAT.QUARTZ],
  ["MAGMA_K", FEAT.MAGMA_K],
  ["QUARTZ_K", FEAT.QUARTZ_K],
  ["RUBBLE", FEAT.RUBBLE],
  ["PASS_RUBBLE", FEAT.PASS_RUBBLE],
  ["CLOSED", FEAT.CLOSED],
  ["OPEN", FEAT.OPEN],
  ["SECRET", FEAT.SECRET],
  ["LAVA", FEAT.LAVA],
  ["PERM", FEAT.PERM],
];

/** Damage values: below every threshold, and above the lava/solidify ones. */
export const VECTOR_DAMAGE: readonly number[] = [10, 5000];

/** Feature name by index, so a vector reads as terrain rather than a number. */
function featName(feat: number): string {
  for (const [name, value] of Object.entries(FEAT)) {
    if (value === feat) return name;
  }
  return `FEAT_${String(feat)}`;
}

/**
 * Run one scenario and record it.
 *
 * The scenario is built fresh each time from a seeded state, so a vector is a
 * function of its own inputs alone - no ordering between rows, which is what
 * lets one `it()` per row report a divergence by name.
 */
export function recordProjectFeat(
  fx: ProjectFeatFixtures,
  projName: string,
  proj: number,
  terrainName: string,
  terrain: number,
  dam: number,
  seed: number,
  blind: boolean,
  occupied: boolean,
  depth: number,
): ProjectFeatVector {
  const state = fx.makeState(seed);
  const c = state.chunk;
  /* DEPTH IS NOT INCIDENTAL, and the harness's default hid a whole branch. The
   * harness builds its chunk at depth 0 - the SURFACE - and project_f reads
   * that twice: DARK skips un-glowing a daylit surface grid, and KILL_WALL /
   * KILL_DOOR / FIRE / COLD re-expose freshly changed terrain to the sun. On
   * the first recording every row sat at depth 0, so `glow` was true in all
   * 6,240 of them and DARK's actual behaviour was never recorded at all. The
   * grid now runs at a dungeon depth, which is what the game reaches, with a
   * separate surface pass for the sun handlers. */
  c.depth = depth;
  /* Away from the player's own grid: MAKE_DOOR and the COLD occupancy test
   * both read "is the player here", and a target under the player would make
   * every row exercise that one branch. */
  const grid = loc(5, 5);

  c.setFeat(grid, terrain);
  /* Seen and in view unless the scenario blinds the player, so the message
   * branches are reachable; SQUARE.GLOW is what squareIsSeen reads. */
  c.sqinfoOn(grid, SQUARE.GLOW);
  c.sqinfoOn(grid, SQUARE.VIEW);
  c.sqinfoOn(grid, SQUARE.SEEN);
  state.actor.player.timed[TMD.BLIND] = blind ? 20 : 0;

  fx.addObject(state, grid);
  /* HALF the rows carry a trap, keyed off the seed rather than a fifth
   * dimension - doubling the grid to reach one branch is a poor trade. The
   * confound is deliberate and harmless here: a golden vector has to cover the
   * branch and reproduce, not isolate a variable. Without an untrapped row,
   * KILL_TRAP always takes its disarmable arm and the square_unlock_door
   * "Click!" branch below is never recorded at all. */
  const trapped = seed % 2 === 1;
  if (trapped) fx.addTrap(state, grid, "pit");
  /* A LOCKED door where the terrain is one, so KILL_TRAP's second arm - the
   * square_unlock_door / "Click!" branch - is reachable. It only runs when the
   * grid has no disarmable trap, so the pit above must be gone for it to fire;
   * both orders are recorded because both rows exist in the grid. */
  fx.lockDoor(state, grid);
  const monsterPlaced = occupied && fx.addMonster(state, grid);

  const messages: string[] = [];
  let fovRefreshed = false;
  state.updateFov = () => {
    fovRefreshed = true;
  };
  const env: ProjectFeatEnv = {
    msg: (m: string) => messages.push(m),
    makeDeps: fx.makeDeps,
    trapDeps: fx.trapDeps,
  };

  const obvious = projectFeature(state, 0, grid, dam, proj, env);

  /* Through the accessor the game itself uses, not the map's key shape: the
   * pile key is an implementation detail and a vector keyed on it would go
   * quietly wrong if it changed. `objectsTotal` is what makes push_object
   * visible - it MOVES the pile rather than destroying it, so a count taken
   * only at the target grid would read a successful push as a deletion. */
  const objectsHere = floorPile(state, grid).length;
  let objectsTotal = 0;
  for (const [, pile] of state.floor) objectsTotal += pile.length;

  return {
    id: `${projName}/${terrainName}/dam${String(dam)}/seed${String(seed)}/d${String(depth)}${blind ? "/blind" : ""}${occupied ? "/occupied" : ""}`,
    proj: projName,
    terrain: terrainName,
    dam,
    seed,
    blind,
    occupied,
    depth,
    obvious,
    feat: featName(c.feat(grid)),
    glow: c.sqinfoHas(grid, SQUARE.GLOW),
    messages,
    objectsHere,
    objectsTotal,
    trapHere: state.traps.size > 0,
    /* MAKE_DOOR refuses an occupied grid and push_object's mimic arm can
     * delete a monster outright, so "is it still there" is observable. */
    monsterAlive: monsterPlaced && state.monsters.some((m) => m !== null),
    fovRefreshed,
    /* Capped well under Rand_div's 0x10000000 limit. */
    rngProbe: state.rng.randint0(100_000_000),
  };
}

/** The dungeon depth the main grid runs at: what the game actually reaches. */
export const VECTOR_DEPTH = 5;

/**
 * The handlers that re-expose changed terrain to the sun, and so behave
 * differently on the surface. Recorded as a SEPARATE small pass at depth 0
 * rather than doubling the whole grid, because only these four read it.
 */
export const SUN_PROJECTIONS: readonly string[] = [
  "KILL_WALL",
  "KILL_DOOR",
  "FIRE",
  "COLD",
];

/** The seeds the grid runs; 16 is chosen, the rest arbitrary. See above. */
export const VECTOR_SEEDS: readonly number[] = [1, 7, 16, 29];

/** Every scenario in the grid, in a fixed order. */
export function recordAllProjectFeat(
  fx: ProjectFeatFixtures,
): ProjectFeatVector[] {
  const out: ProjectFeatVector[] = [];
  const run = (
    projName: string, proj: number, terrainName: string, terrain: number,
    dam: number, seed: number, depth: number,
  ): void => {
    for (const occupied of [false, true]) {
      out.push(
        recordProjectFeat(
          fx, projName, proj, terrainName, terrain, dam, seed, false, occupied, depth,
        ),
      );
    }
    out.push(
      recordProjectFeat(
        fx, projName, proj, terrainName, terrain, dam, seed, true, false, depth,
      ),
    );
  };

  for (const [projName, proj] of VECTOR_PROJECTIONS) {
    for (const [terrainName, terrain] of VECTOR_TERRAINS) {
      for (const dam of VECTOR_DAMAGE) {
        for (const seed of VECTOR_SEEDS) {
          run(projName, proj, terrainName, terrain, dam, seed, VECTOR_DEPTH);
        }
        /* The surface pass. One seed is enough: it exists to record the sun
         * branch at all, not to sample it. */
        if (SUN_PROJECTIONS.includes(projName)) {
          run(projName, proj, terrainName, terrain, dam, VECTOR_SEEDS[0] as number, 0);
        }
      }
    }
  }
  return out;
}

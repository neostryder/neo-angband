/**
 * New-game assembly: pack in, a live GameState the turn loop can run.
 *
 * bootLevel (boot.ts) produces the world and the spot the player would
 * occupy; this adds the missing half - birthing a player character and
 * wiring it, the generated monsters, and the action registry into the
 * GameState the loop operates on. It is the smallest "start a playable
 * game" entry point and, like the rest of the boot seam, is headless and
 * takes already-parsed pack JSON so it serves tests and any front end.
 *
 * It composes public domain APIs only and adds no rules: generatePlayer
 * (birth), calcBonuses (derived combat/defence), and the context helpers
 * that place the player and register the monsters.
 *
 * Two honest simplifications for this stage, both deferred to the title /
 * character-birth flow (PORT_PLAN.md decision 21):
 * - Race and class default to Human Warrior; pass raceName/className to
 *   override. There is no birth UI or point-buy here.
 * - The character is birthed from the same RNG stream AFTER the level is
 *   generated (upstream births first). The result is still deterministic
 *   for a given seed - our reproducibility guarantee (decision 22) is that
 *   our engine is a function of the seed, not that the draw order matches
 *   the C game - so this is a faithful-enough dev entry point.
 */

import { loc } from "../loc";
import type { Loc } from "../loc";
import { SKILL } from "../player/types";
import { bindPlayer } from "../player/bind";
import type { PlayerPackRecords, PlayerRegistry } from "../player/bind";
import { generatePlayer } from "../player/birth";
import { calcBonuses, toCombatState, toDefenderState } from "../player/calcs";
import {
  DEFAULT_GAME_CONSTANTS,
  addMonster,
  placePlayer,
  updateMonsterDistances,
} from "../game/context";
import type { GameState, PlayerActor, PlayerCommand } from "../game/context";
import { createDefaultRegistry } from "../game/player-turn";
import type { ActionRegistry } from "../game/player-turn";
import { bootLevel } from "./boot";
import type { BootedLevel, BootLevelOptions, CorePack } from "./boot";

/** A pack that also carries the player-domain records (races, classes, ...). */
export interface GamePack extends CorePack {
  player: PlayerPackRecords;
}

/** Options for starting a new game. */
export interface StartGameOptions extends BootLevelOptions {
  /** Race name (case-insensitive). Default "Human". */
  raceName?: string;
  /** Class name (case-insensitive). Default "Warrior". */
  className?: string;
}

/** A started game: the loop's state and registry, plus what a renderer needs. */
export interface StartedGame {
  state: GameState;
  registry: ActionRegistry;
  /** The generated world (features, placed objects, registries) for rendering. */
  booted: BootedLevel;
  players: PlayerRegistry;
}

/**
 * Assemble a runnable GameState from a pack: generate a level, birth a
 * character, derive its bonuses, and register the placed monsters. The
 * caller wires state.nextCommand (input) and state.updateFov (FOV) and then
 * drives runGameLoop.
 */
export function startGame(pack: GamePack, opts: StartGameOptions = {}): StartedGame {
  const booted = bootLevel(pack, opts);
  const reg = booted.registries;
  const players = bindPlayer(pack.player);

  const race =
    (opts.raceName ? players.raceByName(opts.raceName) : null) ??
    players.raceByName("Human") ??
    players.races[0]!;
  const cls =
    (opts.className ? players.classByName(opts.className) : null) ??
    players.classByName("Warrior") ??
    players.classes[0]!;

  const body = players.bodies[race.body] ?? players.bodies[0]!;
  const birth = generatePlayer(
    race,
    cls,
    { body, historyChart: players.historyChart(race) },
    booted.rng,
  );

  const pstate = calcBonuses(birth.player);
  const combat = toCombatState(pstate);

  const spot: Loc = booted.playerSpot ?? loc(1, 1);
  const actor: PlayerActor = {
    player: birth.player,
    grid: spot,
    energy: 0,
    speed: pstate.speed,
    totalEnergy: 0,
    combat,
    defense: toDefenderState(pstate),
    weapon: null,
    stealth: combat.skills[SKILL.STEALTH] ?? 0,
  };

  const state: GameState = {
    rng: booted.rng,
    chunk: booted.chunk,
    actor,
    monsters: [null],
    turn: 0,
    z: { ...DEFAULT_GAME_CONSTANTS, maxSight: reg.constants.maxSight },
    brands: [null],
    slays: [null],
    playing: true,
    isDead: false,
    generateLevel: false,
    nextCommand: (): PlayerCommand | null => null,
  };

  placePlayer(state, spot);
  for (const pm of booted.monsters) {
    pm.mon.grid = pm.grid;
    addMonster(state, pm.mon);
  }
  updateMonsterDistances(state);

  return { state, registry: createDefaultRegistry(), booted, players };
}

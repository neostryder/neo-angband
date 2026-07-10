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
import { monsterGroupAssign, monsterGroupsVerify } from "../game/mon-group";
import { floorCarry } from "../game/floor";
import { installPickup } from "../game/pickup";
import { EffectRegistry } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { registerAttackHandlers } from "../game/effect-attack";
import { registerMonsterHandlers } from "../game/effect-monster";
import { registerTeleportHandlers } from "../game/effect-teleport";
import { basicPlayerActor } from "../game/project-cast";
import type { CastContext } from "../game/project-cast";
import type { EffectEnvDeps } from "../game/effect-env";
import { installMonsterCasting } from "../game/mon-ranged";
import { installObjCommands } from "../game/obj-cmd";
import { installCaveCommands } from "../game/cave-cmd";
import {
  calcUnlockingChance,
  installTraps,
  placeTrap,
  squareDoorPower,
  squareRemoveAllTraps,
  squareSetDoorLock,
  trapPredicates,
} from "../game/trap";
import type { TrapDeps } from "../game/trap";
import { lookupTrap } from "../world/trap";
import {
  calcMana,
  calcSpells,
  playerSpellsInit,
  registerBookKinds,
} from "../player/spell";
import { installSpellCommands } from "../game/spell-cmd";
import {
  FlavorKnowledge,
  makeRuneEnv,
  objectLearnOnWield,
  playerLearnInnate,
} from "../obj/knowledge";
import { ELEM_MAX } from "../obj/types";
import { ObjAllocState } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import type { ProjectFeatEnv } from "../game/project-feat";
import { newGear, outfitPlayer, gearGet } from "../game/gear";
import { createDefaultRegistry } from "../game/player-turn";
import type { ActionRegistry } from "../game/player-turn";
import { bindCore, bootLevel, genDeps } from "./boot";
import type {
  BootedLevel,
  BootLevelOptions,
  CorePack,
  CoreRegistries,
} from "./boot";
import { Rng } from "../rng";
import type { Player } from "../player/player";
import { generateLevel } from "../gen/generate";
import { iToGrid } from "../gen/util";
import {
  SAVE_VERSION,
  deserializeChunk,
  deserializeFloor,
  deserializeGear,
  deserializeMonster,
  deserializePlayer,
  deserializeTraps,
  serializeGame,
} from "./save";
import type { SavedGame } from "./save";

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
  /** Per-game flavor knowledge (aware/tried), for the save format. */
  flavor: FlavorKnowledge;
  /**
   * dungeon_change_level + prepare_next_level: generate a fresh level at
   * `depth` from the game's own RNG stream and repopulate the state in
   * place (same GameState object, so installed commands keep working).
   * The caller clears state.generateLevel and refreshes FOV/render.
   */
  changeLevel: (depth: number) => void;
}

/** What the shared command/effect wiring returns. */
interface WiredGame {
  registry: ActionRegistry;
  trapDeps: TrapDeps | null;
  flavor: FlavorKnowledge;
}

/**
 * Install every command and effect-stack seam on a constructed GameState:
 * pickup, the effect interpreter (monster casting, item use, player
 * spells), traps (disarm + the step hook) and the cave commands with the
 * lock seams. Shared by startGame and loadGame; the same state object is
 * captured by every closure, so a level change may swap the state's chunk
 * and entity stores in place without rewiring.
 */
function wireGame(
  state: GameState,
  reg: CoreRegistries,
  players: PlayerRegistry,
  pstate: { skills: readonly number[]; statInd: readonly number[] },
): WiredGame {
  // Live commands over the floor piles: 'g'et + autopickup on stepping.
  const registry = createDefaultRegistry();
  installPickup(state, registry, { constants: reg.constants });

  const flavor = new FlavorKnowledge(reg.objects.ordinaryKindCount);

  // Rune learning (obj-knowledge.c learn-by-use): the registry tables plus
  // live equipment access. Reads through the state object so level changes
  // and gear swaps need no rewiring.
  state.runeEnv = makeRuneEnv(
    (slot) =>
      state.gear.store.get(state.actor.player.equipment[slot] ?? 0) ?? null,
    (v) => state.rng.randcalcVaries(v),
    {
      brands: reg.objects.brands,
      slays: reg.objects.slays,
      curses: reg.objects.curses,
      properties: reg.objects.properties,
      ...(reg.projections
        ? {
            elementNames: reg.projections
              .slice(0, ELEM_MAX)
              .map((p) => p.name),
          }
        : {}),
      flavor,
    },
  );

  // The effect stack: with bound projections, monsters cast spells on
  // their turns (make_ranged_attack), items are usable (cmd-obj.c), the
  // player casts (player-spell.c) and traps fire (trap.c) - all through
  // the same effect interpreter.
  let trapDeps: TrapDeps | null = null;
  const makeDeps: MakeDeps = {
    reg: reg.objects,
    alloc: new ObjAllocState(reg.objects, reg.constants),
    constants: reg.constants,
  };
  if (reg.projections) {
    const effects = new EffectRegistry();
    registerCoreHandlers(effects);
    registerAttackHandlers(effects);
    registerMonsterHandlers(effects);
    registerTeleportHandlers(effects);
    // project_o / project_f world access; trapDeps joins it below once the
    // trap system is wired (the mutual reference is deliberate).
    const worldEnv: ProjectFeatEnv = { makeDeps };
    const cast: CastContext = {
      projections: reg.projections,
      maxRange: reg.constants.maxRange,
      playerActor: basicPlayerActor(state),
      worldEnv,
    };
    const envDeps: EffectEnvDeps = { timedTable: players.timed };

    // The trap-backed square predicates feed every consumer that stubbed
    // them (teleport landing checks, drop placement) once traps exist.
    const preds = reg.traps ? trapPredicates(state) : null;
    const teleport = preds
      ? {
          isPlayerTrap: preds.isPlayerTrap,
          isWarded: preds.isWarded,
          isWebbed: preds.isWebbed,
          changeLevel: (targetDepth: number): void => {
            state.targetDepth = targetDepth;
            state.generateLevel = true;
          },
        }
      : undefined;

    installMonsterCasting(state, {
      registry: effects,
      cast,
      spells: reg.monsters.spells,
      envDeps,
      saveSkill: pstate.skills[SKILL.SAVE] ?? 0,
      ...(teleport ? { teleport } : {}),
    });

    installObjCommands(registry, {
      constants: reg.constants,
      registry: effects,
      cast,
      envDeps,
      flavor,
      ...(teleport ? { teleport } : {}),
      ...(preds ? { floorEnv: { isTrap: preds.isTrap } } : {}),
    });

    // Player spellcasting (cast / study) for casting classes.
    installSpellCommands(registry, {
      effects: {
        registry: effects,
        cast,
        envDeps,
        ...(teleport ? { teleport } : {}),
      },
      statInd: pstate.statInd,
    });

    // Traps: disarm + the step-onto-trap hook; a trapdoor drops a level.
    if (reg.traps) {
      trapDeps = {
        kinds: reg.traps,
        effects: {
          registry: effects,
          cast,
          envDeps,
          ...(teleport ? { teleport } : {}),
        },
        env: {
          changeLevel: (s: GameState): void => {
            s.targetDepth = s.chunk.depth + 1;
            s.generateLevel = true;
          },
        },
      };
      installTraps(state, registry, trapDeps);
      worldEnv.trapDeps = trapDeps;
    }
  }

  // Cave commands (open / close / tunnel / alter / stair checks); rubble
  // finds and gold veins pay out through the object generator, and door
  // locks resolve through the trap system when it is live.
  const lockKind = trapDeps ? lookupTrap(trapDeps.kinds, "door lock") : null;
  const deps = trapDeps; // narrow for the closures
  installCaveCommands(registry, {
    makeDeps,
    ...(deps && lockKind
      ? {
          env: {
            isLockedDoor: (grid: Loc): boolean =>
              squareDoorPower(state, grid, deps) > 0,
            pickLock: (grid: Loc): boolean => {
              const power = squareDoorPower(state, grid, deps);
              const chance = calcUnlockingChance(state, power);
              if (state.rng.randint0(100) < chance) {
                squareRemoveAllTraps(state, grid, lockKind.tidx);
                return true;
              }
              return false;
            },
          },
        }
      : {}),
  });

  return { registry, trapDeps, flavor };
}

/** The parts of a generated level that populate a GameState. */
interface LevelContent {
  playerSpot: Loc | null;
  monsters: readonly { grid: Loc; mon: import("../mon/monster").Monster }[];
  objects: readonly { grid: Loc; obj: import("../obj/object").GameObject }[];
  trapGrids: readonly Loc[];
  lockedDoors: readonly { grid: Loc; power: number }[];
  depth: number;
}

/**
 * Register a generated level's content on the live state: place the player,
 * the monsters (rebuilding groups from the generation group_info, exactly
 * as upstream rebuilds from a savefile), the floor piles, and instantiate
 * the marked traps and rolled door locks.
 */
function populateFromLevel(
  state: GameState,
  level: LevelContent,
  trapDeps: TrapDeps | null,
): void {
  const spot: Loc = level.playerSpot ?? loc(1, 1);
  state.actor.grid = spot;
  placePlayer(state, spot);

  for (const pm of level.monsters) {
    pm.mon.grid = pm.grid;
    addMonster(state, pm.mon);
  }
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (mon) monsterGroupAssign(state, mon, mon.groupInfo, true);
  }
  monsterGroupsVerify(state);
  updateMonsterDistances(state);

  // Register the generated floor objects as live piles (floor_carry), so
  // pickup / drop / projections operate on the same objects the level laid
  // down.
  for (const po of level.objects) {
    floorCarry(state, po.grid, po.obj);
  }

  // Instantiate the generation-marked traps on the live cave (the random
  // pick happens here, exactly as place_trap) and the rolled door locks.
  if (trapDeps) {
    for (const grid of level.trapGrids) {
      placeTrap(state, grid, -1, level.depth, trapDeps);
    }
    for (const door of level.lockedDoors) {
      squareSetDoorLock(state, door.grid, door.power, trapDeps);
    }
  }
}

/**
 * dungeon_change_level + prepare_next_level: generate a fresh level at
 * `depth` from the state's own RNG stream and swap it into the state in
 * place. Installed commands keep working (they close over the state
 * object, whose chunk and entity stores are replaced).
 */
function makeChangeLevel(
  state: GameState,
  reg: CoreRegistries,
  trapDeps: TrapDeps | null,
): (depth: number) => void {
  return (depth: number): void => {
    const g = generateLevel(state.rng, depth, genDeps(reg, true));
    state.chunk = g.c;
    state.monsters = [null];
    state.groups = [null];
    state.floor = new Map();
    state.traps = new Map();
    populateFromLevel(
      state,
      {
        playerSpot: g.playerSpot,
        monsters: g.monsters,
        objects: g.objects,
        trapGrids: [...g.trapGrids].map((i) => iToGrid(i, g.c.width)),
        lockedDoors: g.lockedDoors,
        depth,
      },
      trapDeps,
    );
    delete state.targetDepth;
    state.updateFov?.(state);
  };
}

/**
 * Assemble a runnable GameState from a pack: generate a level, birth a
 * character, derive its bonuses, and register the placed monsters. The
 * caller wires state.nextCommand (input) and state.updateFov (FOV) and then
 * drives runGameLoop; on LOOP_STATUS.LEVEL_CHANGE it calls
 * game.changeLevel(state.targetDepth) and clears state.generateLevel.
 */
export function startGame(pack: GamePack, opts: StartGameOptions = {}): StartedGame {
  // Bind registries and the player domain first: spellbook object kinds
  // are created FROM the class book definitions (init.c write_book_kind),
  // and must exist before level generation builds the allocation tables
  // (so books spawn) and before the starting kit resolves.
  const reg = bindCore(pack);
  const players = bindPlayer(pack.player);
  registerBookKinds(reg.objects, players.classes);

  const booted = bootLevel(pack, { ...opts, registries: reg });

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

  // Populate the gear store and wear the class starting kit (player_outfit +
  // wield_all) BEFORE deriving bonuses, so calc_bonuses sees the worn gear.
  const gear = newGear();
  outfitPlayer(gear, birth.player, reg.objects, booted.rng, reg.constants);

  // Resolve the worn objects by body slot; calc_bonuses reads them for the
  // equipment analysis, and the wielded weapon drives melee (py_attack).
  const equipment = birth.player.equipment.map((h) =>
    h ? gearGet(gear, h) : null,
  );
  const weaponSlot = birth.player.body.slots.findIndex(
    (s) => s.type === "WEAPON",
  );
  const weapon = weaponSlot >= 0 ? (equipment[weaponSlot] ?? null) : null;

  const pstate = calcBonuses(birth.player, { equipment });
  const combat = toCombatState(pstate);

  // Spell bookkeeping for casting classes: size the spell arrays, compute
  // the learnable-spell allowance (calc_spells) and mana (calc_mana, with
  // the worn-armor weight over the class allowance as the penalty).
  playerSpellsInit(birth.player);
  calcSpells(birth.player, pstate.statInd);
  calcMana(birth.player, pstate.statInd, wornArmorWeight(birth.player, equipment));
  birth.player.csp = birth.player.msp; // born rested, full mana

  const spot: Loc = booted.playerSpot ?? loc(1, 1);
  const actor: PlayerActor = {
    player: birth.player,
    grid: spot,
    energy: 0,
    speed: pstate.speed,
    totalEnergy: 0,
    combat,
    defense: toDefenderState(pstate),
    weapon,
    stealth: combat.skills[SKILL.STEALTH] ?? 0,
  };

  const state: GameState = {
    rng: booted.rng,
    chunk: booted.chunk,
    actor,
    gear,
    monsters: [null],
    groups: [null],
    floor: new Map(),
    traps: new Map(),
    turn: 0,
    z: {
      ...DEFAULT_GAME_CONSTANTS,
      maxSight: reg.constants.maxSight,
      floorSize: reg.constants.floorSize,
      maxDepth: reg.constants.maxDepth,
    },
    brands: reg.objects.brands,
    slays: reg.objects.slays,
    /* Placeholder; wireGame installs the full registry-backed env. */
    runeEnv: makeRuneEnv(
      () => null,
      () => false,
    ),
    playing: true,
    isDead: false,
    generateLevel: false,
    nextCommand: (): PlayerCommand | null => null,
  };

  const wired = wireGame(state, reg, players, pstate);

  // Racial rune knowledge (player-birth.c L1274 player_learn_innate) and the
  // starting kit's obvious runes (L495 object_learn_on_wield): the outfit
  // wield ran before the rune env existed and learned only the modifier
  // runes, so run the full wield learning over the worn items now (their
  // WORN notice bit is still clear).
  playerLearnInnate(birth.player, state.runeEnv);
  for (let i = 0; i < birth.player.body.count; i++) {
    const worn = state.runeEnv.slotObject(i);
    if (worn) objectLearnOnWield(birth.player, worn, state.runeEnv);
  }

  populateFromLevel(
    state,
    {
      playerSpot: booted.playerSpot,
      monsters: booted.monsters,
      objects: booted.objects,
      trapGrids: booted.trapGrids,
      lockedDoors: booted.lockedDoors,
      depth: booted.depth,
    },
    wired.trapDeps,
  );

  return {
    state,
    registry: wired.registry,
    booted,
    players,
    flavor: wired.flavor,
    changeLevel: makeChangeLevel(state, reg, wired.trapDeps),
  };
}

/** The worn-armor weight calc_mana penalizes (non-weapon/bow/jewelry slots). */
function wornArmorWeight(
  player: Player,
  equipment: readonly (import("../obj/object").GameObject | null)[],
): number {
  let weight = 0;
  for (let i = 0; i < player.body.count; i++) {
    const slotType = player.body.slots[i]?.type ?? "";
    if (
      slotType === "WEAPON" ||
      slotType === "BOW" ||
      slotType === "RING" ||
      slotType === "AMULET" ||
      slotType === "LIGHT"
    ) {
      continue;
    }
    const worn = equipment[i];
    if (worn) weight += worn.weight;
  }
  return weight;
}

/** Serialize a started game into the JSON save format (decision 9). */
export function saveGame(game: StartedGame): SavedGame {
  return serializeGame(game.state, game.flavor);
}

/**
 * Rebuild a running game from a save: bind the pack, restore every entity
 * store and the RNG stream (decision 22: reloading resumes the exact
 * stream, the anti-save-scum posture), rewire the commands, and derive the
 * combat state from the restored player and gear.
 */
export function loadGame(pack: GamePack, save: SavedGame): StartedGame {
  if (save.version !== SAVE_VERSION) {
    throw new Error(`save: unsupported version ${save.version}`);
  }
  const reg = bindCore(pack);
  const players = bindPlayer(pack.player);
  registerBookKinds(reg.objects, players.classes);

  const chunk = deserializeChunk(save.chunk, reg.features);
  const player = deserializePlayer(save.player, players);
  const gear = deserializeGear(save.gear, reg.objects);

  const equipment = player.equipment.map((h) => (h ? gearGet(gear, h) : null));
  const weaponSlot = player.body.slots.findIndex((s) => s.type === "WEAPON");
  const weapon = weaponSlot >= 0 ? (equipment[weaponSlot] ?? null) : null;
  const pstate = calcBonuses(player, { equipment });
  const combat = toCombatState(pstate);

  const rng = new Rng(1);
  rng.setState(save.rng);

  const actor: PlayerActor = {
    player,
    grid: loc(save.actor.grid.x, save.actor.grid.y),
    energy: save.actor.energy,
    speed: pstate.speed,
    totalEnergy: save.actor.totalEnergy,
    combat,
    defense: toDefenderState(pstate),
    weapon,
    stealth: combat.skills[SKILL.STEALTH] ?? 0,
  };

  const state: GameState = {
    rng,
    chunk,
    actor,
    gear,
    monsters: save.monsters.map((m) =>
      m ? deserializeMonster(m, reg.monsters) : null,
    ),
    groups: save.groups.map((g) =>
      g ? { index: g.index, leader: g.leader, members: [...g.members] } : null,
    ),
    floor: deserializeFloor(save.floor, reg.objects, chunk.width),
    traps: reg.traps
      ? deserializeTraps(save.traps, reg.traps, chunk.width)
      : new Map(),
    turn: save.turn,
    z: {
      ...DEFAULT_GAME_CONSTANTS,
      maxSight: reg.constants.maxSight,
      floorSize: reg.constants.floorSize,
      maxDepth: reg.constants.maxDepth,
    },
    brands: reg.objects.brands,
    slays: reg.objects.slays,
    /* Placeholder; wireGame installs the full registry-backed env. */
    runeEnv: makeRuneEnv(
      () => null,
      () => false,
    ),
    playing: save.playing,
    isDead: save.isDead,
    generateLevel: false,
    nextCommand: (): PlayerCommand | null => null,
  };

  const wired = wireGame(state, reg, players, pstate);
  wired.flavor.restore(save.flavor);

  // A renderer-facing view of the restored level (no generation ran).
  const booted: BootedLevel = {
    chunk,
    depth: chunk.depth,
    playerSpot: actor.grid,
    monsters: [],
    objects: [],
    trapGrids: [],
    lockedDoors: [],
    rng,
    registries: reg,
  };

  return {
    state,
    registry: wired.registry,
    booted,
    players,
    flavor: wired.flavor,
    changeLevel: makeChangeLevel(state, reg, wired.trapDeps),
  };
}

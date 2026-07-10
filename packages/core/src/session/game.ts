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
import { FlavorKnowledge } from "../obj/knowledge";
import { ObjAllocState } from "../obj/make";
import { newGear, outfitPlayer, gearGet } from "../game/gear";
import { createDefaultRegistry } from "../game/player-turn";
import type { ActionRegistry } from "../game/player-turn";
import { bindCore, bootLevel } from "./boot";
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
  let armorWeight = 0;
  for (let i = 0; i < birth.player.body.count; i++) {
    const slotType = birth.player.body.slots[i]?.type ?? "";
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
    if (worn) armorWeight += worn.weight;
  }
  calcMana(birth.player, pstate.statInd, armorWeight);
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
    },
    brands: reg.objects.brands,
    slays: reg.objects.slays,
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
  // Rebuild the monster groups from the group_info recorded at generation
  // (place_new_monster) - the loading path of monster_group_assign, exactly
  // as upstream rebuilds groups from a savefile.
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (mon) monsterGroupAssign(state, mon, mon.groupInfo, true);
  }
  monsterGroupsVerify(state);
  updateMonsterDistances(state);

  // Register the generated floor objects as live piles (floor_carry), so
  // pickup / drop / projections operate on the same objects the level laid
  // down. Generation placed each on a legal, empty grid, so this always
  // succeeds; piles keep working even if a mod pre-stacks a grid.
  for (const po of booted.objects) {
    floorCarry(state, po.grid, po.obj);
  }

  // Live commands over the floor piles: 'g'et + autopickup on stepping.
  const registry = createDefaultRegistry();
  installPickup(state, registry, { constants: reg.constants });

  // The effect stack: with bound projections, monsters cast spells on
  // their turns (make_ranged_attack), items are usable (cmd-obj.c), and
  // traps fire (trap.c) - all through the same effect interpreter.
  let trapDeps: TrapDeps | null = null;
  if (reg.projections) {
    const effects = new EffectRegistry();
    registerCoreHandlers(effects);
    registerAttackHandlers(effects);
    registerMonsterHandlers(effects);
    registerTeleportHandlers(effects);
    const cast: CastContext = {
      projections: reg.projections,
      maxRange: reg.constants.maxRange,
      playerActor: basicPlayerActor(state),
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
      flavor: new FlavorKnowledge(reg.objects.ordinaryKindCount),
      ...(teleport ? { teleport } : {}),
      ...(preds ? { floorEnv: { isTrap: preds.isTrap } } : {}),
    });

    // Player spellcasting (cast / study) for casting classes, through the
    // same effect stack.
    installSpellCommands(registry, {
      effects: {
        registry: effects,
        cast,
        envDeps,
        ...(teleport ? { teleport } : {}),
      },
      statInd: pstate.statInd,
    });

    // Traps: instantiate the generation-marked grids as real traps (the
    // random pick happens here, on the live cave, exactly as place_trap),
    // lock the doors generation rolled locked, and install disarm + the
    // step-onto-trap hook.
    if (reg.traps) {
      trapDeps = {
        kinds: reg.traps,
        effects: {
          registry: effects,
          cast,
          envDeps,
          ...(teleport ? { teleport } : {}),
        },
      };
      for (const grid of booted.trapGrids) {
        placeTrap(state, grid, -1, booted.depth, trapDeps);
      }
      for (const door of booted.lockedDoors) {
        squareSetDoorLock(state, door.grid, door.power, trapDeps);
      }
      installTraps(state, registry, trapDeps);
    }
  }

  // Cave commands (open / close / tunnel / alter / stair checks); rubble
  // finds and gold veins pay out through the object generator, and door
  // locks resolve through the trap system when it is live.
  const lockKind = trapDeps ? lookupTrap(trapDeps.kinds, "door lock") : null;
  const deps = trapDeps; // narrow for the closures
  installCaveCommands(registry, {
    makeDeps: {
      reg: reg.objects,
      alloc: new ObjAllocState(reg.objects, reg.constants),
      constants: reg.constants,
    },
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

  return { state, registry, booted, players };
}

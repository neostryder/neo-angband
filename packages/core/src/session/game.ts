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
import { EF, HIST, PF, RF, STAT, TMD } from "../generated";
import { bindPlayer } from "../player/bind";
import type { PlayerPackRecords, PlayerRegistry } from "../player/bind";
import { generatePlayer } from "../player/birth";
import {
  calcBonuses,
  calcHitpoints,
  toCombatState,
  toDefenderState,
} from "../player/calcs";
import type { PlayerState } from "../player/calcs";
import { playerBestDiggerDigging } from "../player/best-digger";
import { playerExpGain, playerKillExp } from "../player/exp";
import type { ExpDeps } from "../player/exp";
import { historyAdd, historyFindArtifact } from "../player/history";
import { artifactHistoryName, historyStamp } from "../game/history";
import { makePlayerSideEffects } from "../game/player-side";
import { makeMonBlowEnv } from "../game/mon-side";
import { adj_dex_safe } from "../player/calcs";
import { buildEffectContext } from "../game/effect-env";
import { sourceMonster } from "../effects/interpreter";
import {
  DEFAULT_GAME_CONSTANTS,
  addMonster,
  deleteMonster,
  placePlayer,
  updateMonsterDistances,
} from "../game/context";
import { Chunk } from "../world/chunk";
import { FEAT } from "../generated";
import { blankMonster } from "../mon/monster";
import { MON_GROUP } from "../mon/types";
import type {
  GameState,
  ItemTargetRef,
  PlayerActor,
  PlayerCommand,
} from "../game/context";
import { monsterGroupAssign, monsterGroupsVerify } from "../game/mon-group";
import { floorCarry, floorPile } from "../game/floor";
import { installPickup } from "../game/pickup";
import { IgnoreSettings, ignoreItemOk } from "../obj/ignore";
import { EffectRegistry } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { registerAttackHandlers } from "../game/effect-attack";
import { registerGeneralHandlers } from "../game/effect-general";
import type { GeneralEffectEnv } from "../game/effect-general";
import { registerMonsterHandlers } from "../game/effect-monster";
import { registerTeleportHandlers, teleportMonster } from "../game/effect-teleport";
import { registerTerrainHandlers } from "../game/effect-terrain";
import { registerItemHandlers } from "../game/effect-item";
import type { ItemEffectEnv, ItemRequest } from "../game/effect-item";
import { registerMeleeHandlers } from "../game/effect-melee";
import { registerSummonHandlers } from "../game/effect-summon";
import type { SummonEffectEnv } from "../game/effect-summon";
import { registerDetectHandlers } from "../game/effect-detect";
import { becomeAware, caveIlluminateKnown, newKnownMap } from "../game/known";
import { PY_EXERT, isDaytime, playerOverExert } from "../game/world";
import { squareIsLit } from "../world/view";
import { newTargetState, targetSetMonster } from "../game/target";
import {
  getLore,
  loreCountU16,
  loreLearnFlagIfVisible,
  loreLearnSpellIfVisible,
  loreUpdate,
} from "../mon/lore";
import { monsterIsVisible } from "../mon/predicate";
import {
  countMonsterRaces,
  multiplyMonster,
  pickAndPlaceDistantMonster,
  wipeMonsterCounts,
} from "../game/mon-place";
import type { MonPlaceDeps } from "../game/mon-place";
import { SummonTable } from "../mon/summon";
import { MonAllocTable } from "../mon/make";
import type { EffectBuilderInjections } from "../effects/effect";
import { thrustAway } from "../game/thrust";
import { basicPlayerActor } from "../game/project-cast";
import type { CastContext } from "../game/project-cast";
import type { EffectEnvDeps } from "../game/effect-env";
import { installMonsterCasting } from "../game/mon-ranged";
import { installMonCommand } from "../game/mon-cmd";
import { monsterChangeShape, monsterRevertShape } from "../game/mon-shape";
import type { MonShapeHooks } from "../mon/timed";
import { installObjCommands } from "../game/obj-cmd";
import { installCaveCommands } from "../game/cave-cmd";
import { installSteal } from "../game/steal";
import type { ChestCmdDeps } from "../game/chest";
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
import { installRangedCommands } from "../game/ranged-cmd";
import { createTownStores } from "../store/store";
import type { Store } from "../store/store";
import { storeBuy, storeSell } from "../store/transact";
import type { BuyResult, SellResult } from "../store/transact";
import { priceItem } from "../store/price";
import {
  formatMonsterMessage,
  formatMonsterMessageByName,
  formatPainMessage,
  monMessageSoundType,
  painMessageCode,
} from "../game/mon-message";
import {
  FlavorKnowledge,
  makeRuneEnv,
  objectLearnOnWield,
  playerLearnInnate,
} from "../obj/knowledge";
import type { FlavorAwareDeps } from "../obj/knowledge";
import { flavorInit } from "../obj/flavor";
import { ELEM_MAX } from "../obj/types";
import { ArtifactState, ObjAllocState } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import { monsterDeath } from "../game/mon-death";
import type { MonsterDeathDeps } from "../game/mon-death";
import type { ProjectFeatEnv } from "../game/project-feat";
import { newGear, outfitPlayer, gearGet } from "../game/gear";
import type { GameObject } from "../obj/object";
import { createDefaultRegistry } from "../game/player-turn";
import type { ActionRegistry } from "../game/player-turn";
import { disturb, installRunning } from "../game/player-path";
import { bindCore, bootLevel, genDeps } from "./boot";
import { isQuest, playerQuestsReset, questCheck } from "../game/quest";
import type {
  BootedLevel,
  BootLevelOptions,
  CorePack,
  CoreRegistries,
} from "./boot";
import { Rng } from "../rng";
import type { Player } from "../player/player";
import { OptionState } from "../player/options";
import type { OptionName } from "../player/options";
import { doRandart } from "../obj/randart";
import { generateLevel } from "../gen/generate";
import { iToGrid } from "../gen/util";
import {
  SAVE_VERSION,
  deserializeChunk,
  deserializeFloor,
  deserializeGear,
  deserializeKnown,
  deserializeLore,
  deserializeMonster,
  deserializePlayer,
  deserializeTraps,
  serializeGame,
} from "./save";
import type { SavedGame } from "./save";

/**
 * The getItem seam body (cmd_get_item's "tgtitem" fast path, cmd-core.c L1060):
 * resolve the shell's preset target (a gear handle or a floor-pile index) to a
 * live object. If it resolves and passes the request's tester, consume the
 * one-shot preset and return it; otherwise record the unfulfilled request and
 * return null - the faithful cancel/abort (C falls through a filter-failing
 * preset to the blocking prompt, which the port cannot do mid-turn). Draws no
 * RNG.
 */
export function resolveTargetItem(
  state: GameState,
  req: ItemRequest,
): GameObject | null {
  const ref = state.itemTarget;
  let obj: GameObject | null = null;
  if (ref) {
    if ("handle" in ref) {
      obj = gearGet(state.gear, ref.handle);
    } else {
      obj = floorPile(state, state.actor.grid)[ref.floor] ?? null;
    }
  }
  if (obj && req.tester(obj)) {
    /* One-shot: clear so a two-prompt effect cannot reuse the same object. */
    state.itemTarget = null;
    return obj;
  }
  state.itemRequest = req;
  return null;
}

/**
 * The chooseCurse seam body (get_curse, effect-handler-general.c): return the
 * shell's preset curse index when it is one of the removable curses, else the
 * first removable one (upstream get_curse's default highlight), else null. No
 * RNG - get_curse is a pure menu.
 */
export function resolveTargetCurse(
  state: GameState,
  removable: readonly number[],
): number | null {
  const preset = state.curseTarget;
  if (preset !== null && preset !== undefined && removable.includes(preset)) {
    return preset;
  }
  return removable[0] ?? null;
}

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
  /**
   * Birth / interface option choices, applied over the table defaults at
   * character creation (option.c options_init_defaults). Birth options become
   * the immutable birth snapshot; the rest seed the live option store.
   */
  optionOverrides?: Partial<Record<OptionName, boolean>>;
  /** op_ptr->hitpoint_warn (0..9). Default 3 (DEFAULT_HITPOINT_WARN). */
  hitpointWarn?: number;
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
  /** seed_flavor: the seed flavor_init used, persisted so a reload matches. */
  seedFlavor: number;
  /** The player option store (option.c), persisted in the save. */
  options: OptionState;
  /**
   * randart_seed (obj-randart.c): the seed do_randart used when birth_randarts
   * is on, persisted so a reload reproduces the same random artifact set. 0
   * when birth_randarts is off (no randart set was generated).
   */
  randartSeed: number;
  /**
   * dungeon_change_level + prepare_next_level: generate a fresh level at
   * `depth` from the game's own RNG stream and repopulate the state in
   * place (same GameState object, so installed commands keep working).
   * The caller clears state.generateLevel and refreshes FOV/render.
   */
  changeLevel: (depth: number) => void;
  /**
   * do_cmd_buy: purchase `amt` of a store-stock object into the player's pack
   * (store/transact.ts), with the deps and knowledge closed over. Town only.
   */
  buy: (store: Store, obj: GameObject, amt: number) => BuyResult;
  /** do_cmd_sell: sell `amt` of the pack object at `handle` to the store. */
  sell: (store: Store, handle: number, amt: number) => SellResult;
  /**
   * price_item for display: the per-item price the player pays (storeBuying
   * false) or is offered (storeBuying true).
   */
  price: (store: Store, obj: GameObject, storeBuying: boolean, qty: number) => number;
}

/** What the shared command/effect wiring returns. */
interface WiredGame {
  registry: ActionRegistry;
  trapDeps: TrapDeps | null;
  flavor: FlavorKnowledge;
}

/**
 * The real, in-play FlavorAwareDeps for object_flavor_aware's ignore fix
 * (obj-knowledge.c L2276-2279, #89): reads the live ignore settings so a
 * kind ignored while unaware keeps being ignored once identified, and flags
 * player->upkeep->notice's PN_IGNORE (state.noticeIgnore) so a later
 * ignore_drop() pass (#25 UI, not yet wired) can react. Shared by the two
 * in-play becomes-aware sites: game/obj-cmd.ts's item-use knowledge gain
 * (installObjCommands below) and store/transact.ts's buy/sell (makeStoreApi).
 */
function flavorAwareDeps(state: GameState): FlavorAwareDeps {
  return {
    isIgnoredUnaware: (kidx) => state.ignore.kindIsIgnoredUnaware(kidx),
    ignoreWhenAware: (kidx) => state.ignore.kindIgnoreWhenAware(kidx),
    requestIgnoreNotice: () => {
      state.noticeIgnore = true;
    },
  };
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
  pstate: PlayerState,
  seedFlavor: number,
): WiredGame {
  // Live commands over the floor piles: 'g'et + autopickup on stepping.
  const registry = createDefaultRegistry();

  const flavor = new FlavorKnowledge(reg.objects.ordinaryKindCount);

  // flavor_init (obj-util.c): assign each flavoured kind a colour/adjective and
  // mark the non-flavoured ordinary kinds aware. Deterministic in seedFlavor,
  // so a save/reload reproduces identical flavours. The assignment feeds the
  // object_desc name seams below (state.hasFlavor / state.flavorText).
  const flavorAssignment = flavorInit(seedFlavor, flavor, {
    kinds: reg.objects.kinds,
    flavors: reg.objects.flavors,
    ordinaryKindCount: reg.objects.ordinaryKindCount,
    nameSections: reg.nameSections,
    /* OPT(player, birth_randarts): scrub the fixed flavours so the randart
     * set's items are not pre-identified by their standard colour/adjective. */
    birthRandarts: state.options?.get("birth_randarts") ?? false,
  });
  state.hasFlavor = (kind) => flavorAssignment.hasFlavor(kind);
  state.flavorText = (kind) => flavorAssignment.text(kind);

  // ignore_item_ok (obj-ignore.c): the player's ignore settings resolved with
  // live flavor awareness. Everything reads it through state.isIgnored so the
  // floor / pickup / running / projection paths need no flavor coupling.
  state.isIgnored = (obj) =>
    ignoreItemOk(obj, state.ignore, flavor.isAware(obj.kind));

  // object_flavor_is_aware (obj-knowledge.c): the presentation view models
  // (obj-list.c, #25) read kind awareness through this seam, keeping them
  // decoupled from the flavor store just like isIgnored.
  state.isAware = (kind) => flavor.isAware(kind);

  installPickup(state, registry, {
    constants: reg.constants,
    env: { isIgnored: (obj) => state.isIgnored!(obj) },
  });

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

  // The live derived state (upstream p->state). refreshDerived is the
  // port's PU_BONUS | PU_HP | PU_MANA: recompute from the current gear,
  // refresh the actor (including the wielded weapon), re-derive hitpoints
  // from the rolled hitdice and mana from the armor encumbrance. Installed
  // as state.updateBonuses so equipment commands trigger it.
  let derived: PlayerState = pstate;
  // Expose the live derived state so update_mon reads the current OF flags
  // (telepathy / see-invisible) and see_infra. refreshDerived reassigns it.
  state.playerState = derived;
  // A stable live copy of state->stat_ind: refreshDerived replaces the whole
  // derived PlayerState (new statInd array), so anything that captured
  // pstate.statInd would freeze at birth values. This array keeps the same
  // reference and is refreshed in place, so the casting math and a shell's
  // fail-chance display always read the current stats.
  const liveStatInd: number[] = [...pstate.statInd];
  state.statInd = liveStatInd;
  const refreshDerived = (): void => {
    const p = state.actor.player;
    const equipment = p.equipment.map((h) =>
      h ? gearGet(state.gear, h) : null,
    );
    const daytime = isDaytime(state.turn, state.z.dayLength);
    derived = calcBonuses(p, {
      equipment,
      timedEffects: players.timed,
      curses: reg.objects.curses,
      update: true,
      depth: state.chunk.depth,
      isDaytime: daytime,
    });
    state.playerState = derived;
    /* calc_light's town-daytime branch (player-calcs.c 1608-1611) flags
     * PU_UPDATE_VIEW | PU_MONSTERS before returning; reinstate that refresh so
     * ambient town light tracks the day/night cycle. */
    if (state.chunk.depth === 0 && daytime) state.updateFov?.(state);
    for (let i = 0; i < liveStatInd.length; i++) {
      liveStatInd[i] = derived.statInd[i] ?? 0;
    }
    const combat = toCombatState(derived);
    state.actor.combat = combat;
    state.actor.defense = toDefenderState(derived);
    state.actor.speed = derived.speed;
    state.actor.light = derived.curLight;
    state.actor.unlight = derived.pflags.has(PF.UNLIGHT);
    state.actor.stealth = combat.skills[SKILL.STEALTH] ?? 0;
    const weaponSlot = p.body.slots.findIndex((s) => s.type === "WEAPON");
    state.actor.weapon =
      weaponSlot >= 0 ? (equipment[weaponSlot] ?? null) : null;
    /* calc_hitpoints from the rolled hitdice (CON may have changed). */
    p.mhp = calcHitpoints(
      p.playerHp[p.lev - 1] ?? p.hitdie,
      p.lev,
      derived.statInd[STAT.CON] ?? 0,
    );
    if (p.chp > p.mhp) p.chp = p.mhp;
    /* calc_mana with the worn-armor encumbrance. */
    calcMana(p, derived.statInd, wornArmorWeight(p, equipment));
    if (p.csp > p.msp) p.csp = p.msp;
  };
  state.updateBonuses = refreshDerived;

  // player_best_digger (player-util.c L744): digging temporarily wields the
  // pack's best digger and recomputes calc_bonuses (update=false, no RNG) to
  // read its DIGGING; this closes over the same calc_bonuses options as
  // refreshDerived so the swapped derive matches upstream. Feeds the existing
  // randint0(1600) dig roll (game/cave-cmd.ts tunnelAux, game/player-path.ts
  // rubblePenalty) without adding or reordering any draw.
  state.bestDiggerDigging = (): number => {
    const p = state.actor.player;
    const equipment = p.equipment.map((h) =>
      h ? gearGet(state.gear, h) : null,
    );
    const weaponSlot = p.body.slots.findIndex((s) => s.type === "WEAPON");
    const daytime = isDaytime(state.turn, state.z.dayLength);
    return playerBestDiggerDigging(
      equipment,
      [...state.gear.store.values()],
      weaponSlot,
      (equip) =>
        calcBonuses(p, {
          equipment: equip,
          timedEffects: players.timed,
          curses: reg.objects.curses,
          update: false,
          depth: state.chunk.depth,
          isDaytime: daytime,
        }).skills[SKILL.DIGGING] ?? 0,
    );
  };

  // Experience (player.c): a level change recomputes the derived state
  // (upstream's PU_BONUS | PU_HP | PU_SPELLS), and a player kill rewards
  // mexp * rlev / plev with the fractional carry.
  const expDeps: ExpDeps = {
    rng: state.rng,
    onLevelChange: (p): void => {
      refreshDerived();
      /* Casters learn/forget spells at the new level. */
      calcSpells(p, derived.statInd);
    },
    /* history_add(HIST_GAIN_LEVEL) (player.c L246-247), fired from inside
     * adjustLevel's up-loop before the "Welcome to level" message. */
    onGainLevel: (p, lev): void => {
      const stamp = historyStamp(state);
      historyAdd(p, `Reached level ${lev}`, HIST.GAIN_LEVEL, stamp.dlev, lev, stamp.turn);
    },
  };
  // Monster-death loot deps (mon_create_drop + monster_death, game/mon-death.ts).
  // Assigned inside the projections block below once makeDeps, the object
  // registry, the shared floorEnv and the trap predicates are all available;
  // onPlayerKill / onMonsterDeath run only after wireGame has finished, so the
  // deferred assignment is always resolved by the time they fire.
  let deathDeps: MonsterDeathDeps | undefined;
  /* become_aware (mon-util.c L711, game/known.ts): reveal a camouflaged
   * mimic. Installed once here and threaded into every hit / cast / melee
   * site below so a camouflaged monster unmasks wherever upstream calls
   * become_aware, instead of the flag never clearing. */
  state.becomeAware = (mon): void => becomeAware(state, mon);
  state.onPlayerKill = (mon): void => {
    /* Experience comes from the killed form (player_kill_monster computes
     * new_exp before monster_death's revert). */
    const expRace = mon.race;
    /* Shapechanged monsters revert on death (mon-util.c L1027). */
    monsterRevertShape(state, mon);
    /* player_kill_monster: dead uniques stay dead (max_num = 0). The flag
     * is session-lifetime; persisting it rides the save format (ledgered). */
    if (mon.race.flags.has(RF.UNIQUE)) {
      mon.race.maxNum = 0;
      /* history_add(HIST_SLAY_UNIQUE) (mon-util.c L1099-1101), read BEFORE
       * playerKillExp below so p.lev is the pre-kill level, matching
       * upstream's history_add-before-player_exp_gain order. MDESC_DIED_FROM
       * for a unique is just the race name (no article/pronoun swap), so no
       * MDESC subsystem is needed here. */
      const stamp = historyStamp(state);
      historyAdd(
        state.actor.player,
        `Killed ${mon.race.name}`,
        HIST.SLAY_UNIQUE,
        stamp.dlev,
        stamp.clev,
        stamp.turn,
      );
    }
    /* Generate treasure (monster_death, mon-util.c L1108) BEFORE the pkills /
     * tkills lore counting (L1118), so loreUpdate below sees any drop_gold /
     * drop_item that loreTreasure records. */
    if (deathDeps) monsterDeath(state, mon, deathDeps);
    /* quest_check (player-quest.c L219, called at the end of monster_death,
     * mon-util.c L1005): a slain guardian may finish a quest, build the
     * escape stairs, and - when the last quest falls (Morgoth) - win the
     * game. Placed here so every player-kill path (melee, ranged, spells,
     * effects) triggers it exactly once through this single seam. */
    questCheck(state, state.actor.player, mon);
    /* Recall even invisible uniques (mon-util.c L1118): count the kill
     * and refresh the derived lore (monster_race_track rides #25). */
    if (monsterIsVisible(mon) || mon.race.flags.has(RF.UNIQUE)) {
      const lore = getLore(state.lore, mon.race);
      loreCountU16(lore, "pkills");
      loreCountU16(lore, "tkills");
      loreUpdate(mon.race, lore);
    }
    playerKillExp(state.actor.player, expRace, expDeps);
  };
  const expGain = (amount: number): void =>
    playerExpGain(state.actor.player, amount, expDeps);

  // object_touch's history_find_artifact (obj-knowledge.c L960-972): fires
  // when an artifact enters the pack (pickup.ts's playerPickupAux). The
  // name builder is RNG-free (game/history.ts artifactHistoryName).
  state.onArtifactFound = (art): void => {
    const stamp = historyStamp(state);
    historyFindArtifact(
      state.actor.player,
      art,
      stamp.dlev,
      stamp.clev,
      stamp.turn,
      (a) => artifactHistoryName(state, reg.objects, reg.constants, a),
    );
  };

  // The effect stack: with bound projections, monsters cast spells on
  // their turns (make_ranged_attack), items are usable (cmd-obj.c), the
  // player casts (player-spell.c) and traps fire (trap.c) - all through
  // the same effect interpreter.
  let trapDeps: TrapDeps | null = null;
  let chestDeps: ChestCmdDeps | null = null;
  const makeDeps: MakeDeps = {
    reg: reg.objects,
    alloc: new ObjAllocState(reg.objects, reg.constants),
    constants: reg.constants,
    artifacts: state.artifacts ?? new ArtifactState(reg.objects.artifacts.length),
    noArtifacts: state.options?.get("birth_no_artifacts") ?? false,
  };
  if (reg.projections) {
    const effects = new EffectRegistry();
    registerCoreHandlers(effects);
    registerAttackHandlers(effects);
    registerMonsterHandlers(effects);
    registerTeleportHandlers(effects);
    registerGeneralHandlers(effects);
    registerTerrainHandlers(effects);
    registerItemHandlers(effects);
    registerMeleeHandlers(effects);
    registerSummonHandlers(effects);
    registerDetectHandlers(effects);

    // The trap-backed square predicates feed every consumer that stubbed
    // them (teleport landing checks, drop placement) once traps exist.
    const preds = reg.traps ? trapPredicates(state) : null;
    // The shared floor drop environment (drop_near's ignore / trap rules),
    // used by both the object commands and monster-death loot so a kill's
    // drops land under the same placement rules as any other floor drop.
    const floorEnv = {
      isIgnored: (obj: GameObject): boolean => state.isIgnored!(obj),
      ...(preds ? { isTrap: preds.isTrap } : {}),
    };
    // Monster-death loot deps: makeDeps builds the objects, reg.objects looks
    // up specified drops, floorEnv places them, state.lore feeds the theft
    // reduction and loreTreasure.
    deathDeps = {
      makeDeps,
      reg: reg.objects,
      floorEnv,
      lore: state.lore,
    };
    const teleport = preds
      ? {
          isPlayerTrap: preds.isPlayerTrap,
          isWarded: preds.isWarded,
          isWebbed: preds.isWebbed,
          /* is_quest (player-quest.c L140): the real implementation behind the
           * force_descend / teleport-level guards (effect-general.ts,
           * effect-teleport.ts, effect-terrain.ts) - a quest level cannot be
           * skipped or recalled away from. */
          isQuest: (depth: number): boolean => isQuest(state.actor.player, depth),
          changeLevel: (targetDepth: number): void => {
            state.targetDepth = targetDepth;
            state.generateLevel = true;
          },
        }
      : undefined;
    // Glyph / web creation needs the trap system; trapDeps joins below
    // once it is built (the mutual reference is deliberate). The stat
    // adjectives (desc_stat) come from the bound object properties, and
    // experience gains ripple level changes through expDeps.
    const general: GeneralEffectEnv = {
      properties: reg.objects.properties,
      expDeps,
      shapes: players.shapes,
    };
    // Item-targeting seams: the ego / curse tables, arrow generation, and the
    // get_item / get_curse choosers. The shell pre-resolves the target object
    // (async item menu) and rides it on the command as state.itemTarget; these
    // closures are the sync side of cmd_get_item's "tgtitem" fast path
    // (cmd-core.c L1060), turning the preset back into a live object without
    // blocking the turn loop. Absent a preset, the choosing effect aborts (the
    // upstream cancel path) and records the unfulfilled request for the shell.
    const item: ItemEffectEnv = {
      reg: reg.objects,
      makeDeps,
      getItem: (req) => resolveTargetItem(state, req),
      chooseCurse: (_obj, removable) => resolveTargetCurse(state, removable),
    };
    // Summoning: the bound summon table, the session's live allocation
    // table (get_mon_num over the full race registry) and the placement
    // deps. The summonNameToIdx injection lets effect chains resolve
    // "SUMMON:UNDEAD"-style subtypes at build time.
    const summons = new SummonTable(reg.monsters.summons, reg.monsters.bases);
    const summon: SummonEffectEnv = {
      summons,
      place: {
        table: new MonAllocTable(reg.monsters.races, {
          maxDepth: reg.constants.maxDepth,
          oodChance: reg.constants.oodMonsterChance,
          oodAmount: reg.constants.oodMonsterAmount,
        }),
        groupMax: reg.constants.monsterGroupMax,
        groupDist: reg.constants.monsterGroupDist,
        ...(preds ? { preds } : {}),
      },
    };
    const inject: EffectBuilderInjections = {
      summonNameToIdx: (name) => summons.nameToIdx(name),
      /* shape_name_to_idx (player-util.c): case-insensitive name lookup. */
      shapeNameToIdx: (name) =>
        players.shapes.findIndex(
          (s) => s.name.toLowerCase() === name.toLowerCase(),
        ),
    };
    // project_o / project_f world access; trapDeps joins it below once the
    // trap system is wired (the mutual reference is deliberate).
    const worldEnv: ProjectFeatEnv = { makeDeps };
    /* The projection view reads the LIVE derived state, so worn resistance
     * gear reduces projection damage and equipment swaps take effect. */
    const playerActor = basicPlayerActor(state, {
      resistLevel: (t) => derived.elInfo[t]?.resLevel ?? 0,
      reduction: () => ({
        damRed: derived.damRed,
        percDamRed: derived.percDamRed,
      }),
    });
    const cast: CastContext = {
      projections: reg.projections,
      maxRange: reg.constants.maxRange,
      playerActor,
      worldEnv,
      hooks: {
        monster: {
          /* Spell/device kills reward experience like melee kills. */
          onKill: (m): void => state.onPlayerKill?.(m),
          /* become_aware: reveal a camouflaged monster hit by a projection
           * (project_m) or that stopped an effect (PROJECT_STOP). */
          becomeAware: (m): void => state.becomeAware?.(m),
          /* monster_death for a monster-vs-monster kill: no player reward, just
           * drops (project-mon.c fires monster_death for these too). */
          onMonsterDeath: (m): void => {
            if (deathDeps) monsterDeath(state, m, deathDeps);
          },
          /* add_monster_message: "the kobold dies", "wakes up", "catches
           * fire" - the MON_MSG grammar, routed to the game's message sink so
           * a shell shows ranged/spell/status monster messages the same way
           * melee shows "You hit/slay the X". The projection already gates on
           * visibility before calling this. */
          message: (m, msgCode): void => {
            const text = formatMonsterMessage(m, msgCode);
            if (text) state.msg?.(text);
            state.sound?.(monMessageSoundType(msgCode));
          },
          /* message_pain: the graded "shrugs off the attack" / "cries out in
           * pain" line for a monster hurt but not killed. */
          messagePain: (m, dam): void => {
            const text = formatPainMessage(m, dam);
            if (text) state.msg?.(text);
            state.sound?.(monMessageSoundType(painMessageCode(m, dam)));
          },
          /* mon_set_timed's queued status messages (slowed, confused, held). */
          timedMessage: (m, note): void => {
            const text = formatMonsterMessageByName(m, note);
            if (text) state.msg?.(text);
          },
          /* Lore learning when a projection's outcome is seen. */
          learnRaceFlag: (m, flag): void =>
            loreLearnFlagIfVisible(getLore(state.lore, m.race), m, flag),
          learnSpellFlag: (m, flag): void =>
            loreLearnSpellIfVisible(getLore(state.lore, m.race), m, flag),
          /* monster_revert_shape on death / MON_DRAIN (mon-shape.ts). */
          revertShape: (m): void => {
            monsterRevertShape(state, m);
          },
          /* PROJ_AWAY_ALL teleports and PROJ_FORCE knockback for monsters. */
          teleport: (m, dist): void =>
            teleportMonster(state, m.midx, dist, teleport ?? {}),
          thrustAway: (centre, target, gridsAway): void =>
            thrustAway(state, centre, target, gridsAway),
        },
        /* The per-PROJ player side effects (project-player.c handlers). */
        player: {
          /* OPT(player, show_damage): the extra "you take N damage" lines. */
          showDamage: state.options?.get("show_damage") ?? false,
          onSideEffects: makePlayerSideEffects(state, {
            timed: players.timed,
            actor: playerActor,
            projections: reg.projections,
            expDeps,
            lifeDrainPercent: reg.constants.lifeDrainPercent,
            ...(teleport ? { teleport } : {}),
          }),
        },
      },
    };
    const envDeps: EffectEnvDeps = {
      timedTable: players.timed,
      // Effect status/damage messages ("You feel better", "You feel yourself
      // yanked upwards!") route to the game's message sink so a shell shows
      // them; absent, they would drop.
      onMessage: (text: string): void => state.msg?.(text),
    };

    /* monster_change_shape / monster_revert_shape, driving the
     * MON_TMD_CHANGED timer (the SHAPECHANGE monster spell). */
    const monShape: MonShapeHooks = {
      change: (m) =>
        monsterChangeShape(state, m, {
          summon,
          spells: reg.monsters.spells,
          ...(teleport ? { teleport } : {}),
        }),
      revert: (m) => monsterRevertShape(state, m),
    };

    const monSpellDeps = {
      registry: effects,
      cast,
      spells: reg.monsters.spells,
      envDeps,
      saveSkill: pstate.skills[SKILL.SAVE] ?? 0,
      inject,
      ...(teleport ? { teleport } : {}),
      general,
      summon,
      monShape,
    };
    installMonsterCasting(state, monSpellDeps, {
      /* become_aware: a hidden caster reveals itself (mon-attack.c L454). */
      becomeAware: (midx): void => {
        const caster = state.monsters[midx];
        if (caster) state.becomeAware?.(caster);
      },
    });
    /* do_cmd_mon_command: EF_COMMAND possession drives the monster. */
    installMonCommand(state, monSpellDeps);

    /* make_attack_normal's blow-effect environment (game/mon-side.ts): the
     * monster-melee analog of the player onSideEffects hook, so a melee blow
     * applies its full elemental / status / stat / theft / terrain
     * consequences in upstream RNG order. EF_EARTHQUAKE (SHATTER) routes
     * through the effect interpreter so its internal draws are shared. */
    state.monBlowEnv = makeMonBlowEnv(state, {
      timed: players.timed,
      actor: playerActor,
      projections: reg.projections,
      expDeps,
      lifeDrainPercent: reg.constants.lifeDrainPercent,
      adjDexSafe: adj_dex_safe,
      packSize: reg.constants.packSize,
      makeDeps,
      ...(teleport ? { teleport } : {}),
      earthquake: (mon, radius): void => {
        effects.effectSimple(EF.EARTHQUAKE, buildEffectContext(state, envDeps), {
          origin: sourceMonster(mon.midx),
          subtype: 0,
          radius,
        });
      },
      msg: (text: string): void => state.msg?.(text),
    });

    installObjCommands(registry, {
      constants: reg.constants,
      registry: effects,
      cast,
      envDeps,
      flavor,
      flavorDeps: flavorAwareDeps(state),
      inject,
      ...(teleport ? { teleport } : {}),
      general,
      item,
      summon,
      floorEnv,
      // Route object/effect messages (msg / msgt / activation_message) to the
      // game's message sink so a shell shows them; absent, they would drop.
      env: { msg: (text: string): void => state.msg?.(text) },
    });

    // Player spellcasting (cast / study) for casting classes.
    installSpellCommands(registry, {
      effects: {
        registry: effects,
        cast,
        envDeps,
        inject,
        ...(teleport ? { teleport } : {}),
        general,
        item,
        summon,
      },
      statInd: liveStatInd,
      env: {
        expGain,
        msg: (text: string): void => state.msg?.(text),
        // spell_chance's PF_UNLIGHT penalty (player-spell.c L417): the
        // Necromancer's +25 fail on a lit square (square_islit(cave, p->grid)).
        gridIsLit: (): boolean => squareIsLit(state.chunk, state.actor.grid),
        // spell_cast overcast (player-spell.c L552-553): once mana empties,
        // player_over_exert twice in the exact upstream order - FAINT then CON -
        // so the RNG stream draws faithfully (playerOverExert draws per flag).
        overExert: (oops: number): void => {
          playerOverExert(state, PY_EXERT.FAINT, 100, 5 * oops + 1);
          playerOverExert(state, PY_EXERT.CON, 50, 0);
        },
      },
    });

    // Player ranged attacks (fire launcher + ammo, throw an object). The hit
    // math is combat/ranged.ts; the front-end walks the missile's path and
    // routes hit / death messages through state.msg like the other commands.
    installRangedCommands(registry);

    // Traps: disarm + the step-onto-trap hook; a trapdoor drops a level.
    if (reg.traps) {
      trapDeps = {
        kinds: reg.traps,
        effects: {
          registry: effects,
          cast,
          envDeps,
          inject,
          ...(teleport ? { teleport } : {}),
          general,
          item,
          summon,
        },
        env: {
          expGain,
          msg: (text: string): void => state.msg?.(text),
          changeLevel: (s: GameState): void => {
            s.targetDepth = s.chunk.depth + 1;
            s.generateLevel = true;
          },
        },
      };
      installTraps(state, registry, trapDeps);
      worldEnv.trapDeps = trapDeps;
      general.trapDeps = trapDeps;
    }

    // Chests (gap #49): reuse the exact effect bundle traps/objects use, so
    // chest_trap's dice draws (poison/paralysis/summon/explosion) share the
    // interpreter, RNG stream and summon wiring with every other effect
    // source, and floorEnv so a chest's loot lands under the same drop
    // rules as any other floor drop.
    chestDeps = {
      makeDeps,
      floorEnv,
      effects: {
        registry: effects,
        cast,
        envDeps,
        inject,
        ...(teleport ? { teleport } : {}),
        general,
        item,
        summon,
      },
      env: {
        expGain,
        msg: (text: string): void => state.msg?.(text),
      },
    };
  }

  // Cave commands (open / close / tunnel / alter / stair checks); rubble
  // finds and gold veins pay out through the object generator, door locks
  // resolve through the trap system when it is live, and chests (gap #49)
  // open/disarm through game/chest.ts when the effect stack is live.
  const lockKind = trapDeps ? lookupTrap(trapDeps.kinds, "door lock") : null;
  const deps = trapDeps; // narrow for the closures
  installCaveCommands(registry, {
    makeDeps,
    env: {
      // Route open/close/tunnel/chest messages to the game's message sink
      // (matching installObjCommands/installSpellCommands/installTraps);
      // absent, door/tunnel/chest messages would silently drop.
      msg: (text: string): void => state.msg?.(text),
      ...(deps && lockKind
        ? {
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
          }
        : {}),
    },
    ...(chestDeps ? { chestDeps } : {}),
  });

  // steal (cmd-cave.c do_cmd_steal): the rogue / PF_STEAL lift-from-monster
  // command. The PF_STEAL gate reads the live derived state (state.playerState).
  installSteal(registry, {
    constants: reg.constants,
    msg: (text: string): void => state.msg?.(text),
  });

  // Running (player-path.c): the corridor / open-area running engine. It
  // re-queues itself onto state.cmdQueue, which processPlayer drains.
  installRunning(registry);

  // process_world upkeep environment (game/world.ts): the bound timed table so
  // decrease_timeouts / digestion route through the grade / message machinery,
  // the DoT take_hit hooks (rng is threaded in by worldTakeHit), and the
  // ambient-monster spawn using the same allocation-table placement path as
  // normal generation so its variable RNG draws stay faithful.
  const worldPreds = reg.traps ? trapPredicates(state) : null;
  const ambientPlaceDeps: MonPlaceDeps = {
    table: new MonAllocTable(reg.monsters.races, {
      maxDepth: reg.constants.maxDepth,
      oodChance: reg.constants.oodMonsterChance,
      oodAmount: reg.constants.oodMonsterAmount,
    }),
    groupMax: reg.constants.monsterGroupMax,
    groupDist: reg.constants.monsterGroupDist,
    ...(worldPreds ? { preds: worldPreds } : {}),
  };
  // monster_turn_multiply's multiply_monster (mon-move.c): a breeder spawns a
  // copy through the live placement path (reusing ambientPlaceDeps so the
  // scatter / createMonster draws stay faithful). monster_turn_multiply itself
  // (the cap / crowd / chance rolls) lives in game/monster-turn.ts.
  state.monsterMultiply = (m): boolean =>
    multiplyMonster(state, m, ambientPlaceDeps);

  // Door-lock seams for monster_turn_can_move's locked-door branch: locks are
  // "door lock" traps (#21), so these route through the trap system when live.
  if (deps && lockKind) {
    state.doorLockPower = (grid: Loc): number =>
      squareDoorPower(state, grid, deps);
    state.setDoorLock = (grid: Loc, power: number): void =>
      squareSetDoorLock(state, grid, power, deps);
    state.removeDoorLock = (grid: Loc): void => {
      squareRemoveAllTraps(state, grid, lockKind.tidx);
    };
  }

  state.world = {
    timedTable: players.timed,
    timedHooks: {
      onMessage: (text: string): void => state.msg?.(text),
      onNotify: (_idx: number, canDisturb: boolean): void => {
        if (canDisturb) disturb(state);
      },
    },
    takeHitHooks: {
      onMessage: (text: string): void => state.msg?.(text),
      onDisturb: (): void => disturb(state),
    },
    expDeps,
    spawnAmbientMonster: (s: GameState): boolean =>
      pickAndPlaceDistantMonster(
        s,
        s.actor.grid,
        s.z.maxSight + 5,
        true,
        s.chunk.depth,
        ambientPlaceDeps,
      ),
    // cave_illuminate on the town dawn/nightfall boundary (game-world.c,
    // called from processWorld in game/loop.ts): relights SQUARE_GLOW and
    // updates player map knowledge (square_memorize/square_forget) to match.
    caveIlluminate: (s: GameState, dawn: boolean): void =>
      caveIlluminateKnown(s, dawn),
  };

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

  /* Track the deepest level reached (player->max_depth). */
  if (level.depth > state.actor.player.maxDepth) {
    state.actor.player.maxDepth = level.depth;
  }
  /* A new level clears the decoy (glyph traps do not persist the swap). */
  state.decoy = null;

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
  /* Count racial occurrences (generation tracks uniques level-locally; the
   * live cur_num starts here and placement / deleteMonster maintain it). */
  countMonsterRaces(state);

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
  opts: { inArena?: boolean } = {},
): (depth: number) => void {
  /* The level stashed when entering an arena: leaving a level FOR an
   * arena persists it even without birth_levels_persist (generate.c
   * L1349), and the arena exit restores it. */
  let arenaStash: {
    chunk: GameState["chunk"];
    monsters: GameState["monsters"];
    groups: GameState["groups"];
    floor: GameState["floor"];
    traps: GameState["traps"];
    known: GameState["known"];
    decoy: Loc | null;
    monMidx: number;
  } | null = null;
  let inArena = opts.inArena ?? false;

  return (depth: number): void => {
    /* --- Arena entry: EF_SINGLE_COMBAT fired the change. --- */
    if (state.arenaLevel && !inArena) {
      const mon = state.healthWho;
      if (mon) {
        arenaStash = {
          chunk: state.chunk,
          monsters: state.monsters,
          groups: state.groups,
          floor: state.floor,
          traps: state.traps,
          known: state.known,
          decoy: state.decoy ?? null,
          monMidx: mon.midx,
        };
        /* arena_gen (gen-cave.c L3984): 6x6 floor bounded by perm rock,
         * the player in one corner and the opponent in the other. */
        const arena = new Chunk(reg.features, 6, 6);
        arena.depth = state.chunk.depth;
        for (let y = 0; y < 6; y++) {
          for (let x = 0; x < 6; x++) {
            const edge = y === 0 || x === 0 || y === 5 || x === 5;
            arena.setFeat(loc(x, y), edge ? FEAT.PERM : FEAT.FLOOR);
          }
        }
        state.chunk = arena;
        state.monsters = [null];
        state.groups = [null];
        state.floor = new Map();
        state.traps = new Map();
        state.known = newKnownMap(6, 6);
        delete state.decoy;

        /* The monster is COPIED in (upstream memcpy); the original stays
         * in the stashed level and is finished on the way out. Held
         * objects are ignored, and it gets a fresh group. */
        const copy = blankMonster(mon.race);
        copy.originalRace = mon.originalRace;
        copy.hp = mon.hp;
        copy.maxhp = mon.maxhp;
        copy.mspeed = mon.mspeed;
        copy.energy = mon.energy;
        copy.mTimed.set(mon.mTimed);
        copy.mflag = mon.mflag.clone();
        copy.grid = loc(4, 1);
        addMonster(state, copy);
        state.groups[1] = { index: 1, leader: copy.midx, members: [copy.midx] };
        copy.groupInfo[0] = { index: 1, role: MON_GROUP.LEADER };
        state.healthWho = copy;
        targetSetMonster(state, copy);

        placePlayer(state, loc(1, 4));
        inArena = true;
        delete state.targetDepth;
        state.updateFov?.(state);
        return;
      }
      /* No tracked opponent: fall through to a normal change. */
      state.arenaLevel = false;
    }

    /* --- Arena exit: the fight is over (or abandoned). --- */
    if (inArena) {
      inArena = false;
      state.arenaLevel = false;
      const stash = arenaStash;
      arenaStash = null;
      if (stash) {
        /* Restore the level left behind (the player marker stayed). */
        state.chunk = stash.chunk;
        state.monsters = stash.monsters;
        state.groups = stash.groups;
        state.floor = stash.floor;
        state.traps = stash.traps;
        state.known = stash.known;
        if (stash.decoy) state.decoy = stash.decoy;
        const back = state.oldGrid ?? state.actor.grid;
        state.actor.grid = back;
        state.chunk.setMon(back, -1);
        delete state.oldGrid;

        /* Kill the arena monster's original (kill_arena_monster). */
        const orig = state.monsters[stash.monMidx];
        if (orig) {
          orig.hp = -1;
          state.msg?.(`${orig.race.name} is defeated!`);
          state.onPlayerKill?.(orig);
          deleteMonster(state, orig.midx);
        }
        state.healthWho = null;
        targetSetMonster(state, null);
        delete state.targetDepth;
        state.updateFov?.(state);
        return;
      }
      /* The stash did not survive a save boundary: fall through to a
       * fresh level of the same depth (ledgered). */
      delete state.oldGrid;
    }

    /* dungeon_change_level: track the deepest level reached. */
    if (depth > state.actor.player.maxDepth) {
      state.actor.player.maxDepth = depth;
    }
    /* wipe_mon_list: the old level's monsters forget their racial counts
     * before the new level allocates against them. */
    wipeMonsterCounts(state);
    /* Forget the target and the tracked monster (game-world.c L1010),
     * and release any commanded monster (L1065). */
    targetSetMonster(state, null);
    state.healthWho = null;
    state.actor.player.timed[TMD.COMMAND] = 0;
    const g = generateLevel(
      state.rng,
      depth,
      genDeps(
        reg,
        true,
        state.artifacts,
        state.options?.get("birth_no_artifacts") ?? false,
      ),
      /* is_daytime() only affects the town (depth 0) build; passed always so a
       * RECALL back to town honours the day/night clock. */
      {
        daytime: isDaytime(state.turn, state.z.dayLength),
        birthLoseArts: state.options?.get("birth_lose_arts") ?? false,
      },
    );
    state.chunk = g.c;
    state.monsters = [null];
    state.groups = [null];
    state.floor = new Map();
    state.traps = new Map();
    state.known = newKnownMap(g.c.width, g.c.height);
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
    refreshTownStores(state, reg);
    delete state.targetDepth;
    state.updateFov?.(state);
  };
}

/**
 * store_init / store_reset on entering town: build and stock the eight shops
 * when the active level is the town (depth 0), and clear them in the dungeon.
 * Stock is regenerated per visit (save-persistence of store stock is a
 * documented parity gap). No-op when the pack ships no stores.
 */
function refreshTownStores(state: GameState, reg: CoreRegistries): void {
  if (state.chunk.depth === 0 && reg.stores) {
    const storeDeps: MakeDeps = {
      reg: reg.objects,
      alloc: new ObjAllocState(reg.objects, reg.constants),
      constants: reg.constants,
      /* Stores pass allowArtifacts=false, so these are inert here; shared
       * for consistency with the rest of the game's MakeDeps. */
      artifacts: state.artifacts ?? new ArtifactState(reg.objects.artifacts.length),
      noArtifacts: state.options?.get("birth_no_artifacts") ?? false,
    };
    state.stores = createTownStores(
      reg.stores.stores,
      storeDeps,
      state.rng,
      state.actor.player.maxDepth,
    );
  } else {
    delete state.stores;
  }
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

  // The player option store (option.c options_init_defaults): seeded from
  // OPTION_ENTRIES defaults, with the birth/interface choices applied. Built
  // before level generation so birth_randarts can swap the artifact set first.
  const options = new OptionState({
    ...(opts.optionOverrides ? { overrides: opts.optionOverrides } : {}),
    ...(opts.hitpointWarn !== undefined ? { hitpointWarn: opts.hitpointWarn } : {}),
  });

  // OPT(player, birth_randarts) (obj-randart.c do_randart): replace the
  // standard artifact set with a random one BEFORE the starting level is
  // generated, so its drops come from the randart set. The seed is derived
  // deterministically from the game seed (decision 22: a function of the seed)
  // and persisted so a reload reproduces the identical set. Off by default, so
  // the standard set and the existing draw order are untouched.
  let randartSeed = 0;
  if (options.get("birth_randarts")) {
    randartSeed = new Rng(opts.seed ?? 1).randint0(0x10000000);
    swapRandartSet(reg, randartSeed);
  }

  // aup_info[] (obj-make.c): the game's shared artifact-created registry.
  // Built AFTER swapRandartSet so its length matches the (index-preserving)
  // final artifact set, and BEFORE bootLevel so the starting level shares it.
  const artifacts = new ArtifactState(reg.objects.artifacts.length);
  const noArtifacts = options.get("birth_no_artifacts") ?? false;

  const booted = bootLevel(pack, {
    ...opts,
    registries: reg,
    artifacts,
    noArtifacts,
  });

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

  // player_quests_reset (player-quest.c L157, called from player_birth): copy
  // the standard quest table into the fresh character's quest history so
  // is_quest and quest_check see the Sauron/Morgoth guardians from turn one.
  playerQuestsReset(birth.player, reg.quests);

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

  const pstate = calcBonuses(birth.player, {
    equipment,
    timedEffects: players.timed,
    curses: reg.objects.curses,
    update: true,
  });
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
    light: pstate.curLight,
    unlight: pstate.pflags.has(PF.UNLIGHT),
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
    known: newKnownMap(booted.chunk.width, booted.chunk.height),
    target: newTargetState(),
    ignore: new IgnoreSettings(),
    options,
    artifacts,
    lore: new Map(),
    turn: 0,
    z: {
      ...DEFAULT_GAME_CONSTANTS,
      maxSight: reg.constants.maxSight,
      maxRange: reg.constants.maxRange,
      floorSize: reg.constants.floorSize,
      maxDepth: reg.constants.maxDepth,
      stairSkip: reg.constants.stairSkip,
      dayLength: reg.constants.dayLength,
      foodValue: reg.constants.foodValue,
      allocMonsterChance: reg.constants.allocMonsterChance,
      storeTurns: reg.constants.storeTurns,
      lifeDrainPercent: reg.constants.lifeDrainPercent,
      levelMonsterMax: reg.constants.levelMonsterMax,
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

  // seed_flavor (player-birth.c L1291): drawn once at birth from the game RNG
  // and persisted, so the object colours/titles stay stable across reloads.
  const seedFlavor = booted.rng.randint0(0x10000000);
  const wired = wireGame(state, reg, players, pstate, seedFlavor);

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
  refreshTownStores(state, reg);

  return {
    state,
    registry: wired.registry,
    booted,
    players,
    flavor: wired.flavor,
    seedFlavor,
    options,
    randartSeed,
    changeLevel: makeChangeLevel(state, reg, wired.trapDeps),
    ...makeStoreApi(state, reg, wired.flavor, options),
  };
}

/**
 * The store buy/sell/price closures a shell uses: they build the maintenance
 * context (for restock after a purchase empties a shop), read the live flavour
 * knowledge and no-selling option, and route through the ported store runtime.
 * Shared by startGame and loadGame so both StartedGame results expose them.
 */
function makeStoreApi(
  state: GameState,
  reg: CoreRegistries,
  flavor: FlavorKnowledge,
  options: OptionState,
): Pick<StartedGame, "buy" | "sell" | "price"> {
  const storeCtx = (): {
    rng: typeof state.rng;
    deps: MakeDeps;
    maxDepth: number;
    stores: Store[];
  } => ({
    rng: state.rng,
    deps: {
      reg: reg.objects,
      alloc: new ObjAllocState(reg.objects, reg.constants),
      constants: reg.constants,
      /* allowArtifacts=false in store generation; inert but shared. */
      artifacts: state.artifacts ?? new ArtifactState(reg.objects.artifacts.length),
      noArtifacts: state.options?.get("birth_no_artifacts") ?? false,
    },
    maxDepth: state.actor.player.maxDepth,
    stores: state.stores ?? [],
  });
  const noSelling = (): boolean => options.get("birth_no_selling") ?? false;
  const txnKnow = (
    obj: GameObject,
  ): {
    flavor: FlavorKnowledge;
    flavorDeps: FlavorAwareDeps;
    aware: boolean;
    noSelling: boolean;
  } => ({
    flavor,
    flavorDeps: flavorAwareDeps(state),
    aware: flavor.isAware(obj.kind),
    noSelling: noSelling(),
  });
  return {
    buy: (store, obj, amt): BuyResult =>
      storeBuy(storeCtx(), store, obj, amt, state.actor.player, state.gear, txnKnow(obj)),
    sell: (store, handle, amt): SellResult => {
      const obj = state.gear.store.get(handle);
      const know = obj
        ? txnKnow(obj)
        : { flavor, flavorDeps: flavorAwareDeps(state), aware: false, noSelling: noSelling() };
      return storeSell(storeCtx(), store, handle, amt, state.actor.player, state.gear, know);
    },
    price: (store, obj, storeBuying, qty): number =>
      priceItem(
        reg.objects,
        store,
        store.owner,
        obj,
        storeBuying,
        qty,
        flavor.isAware(obj.kind),
        noSelling(),
      ),
  };
}

/**
 * do_randart (obj-randart.c): generate a random artifact set from `seed` and
 * install it in place of the registry's standard set. do_randart preserves the
 * artifact indices (aidx), so live references and saved-object aidx lookups
 * keep resolving; only the artifact properties change. Mutates the per-game
 * ObjRegistry (built fresh by bindCore), never a shared global.
 */
function swapRandartSet(reg: CoreRegistries, seed: number): void {
  const randarts = doRandart(reg.objects, seed);
  reg.objects.artifacts.length = 0;
  reg.objects.artifacts.push(...randarts);
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
  return serializeGame(game.state, game.flavor, game.seedFlavor, game.randartSeed);
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

  // Restore the option store (older saves lack it: table defaults). Do this
  // before the artifact-set swap so birth_randarts is known.
  const options = save.options
    ? OptionState.restore(save.options)
    : new OptionState();

  // OPT(player, birth_randarts): rebuild the same random artifact set from the
  // persisted seed, so saved-object aidx references resolve to the identical
  // randarts (do_randart preserves indices). Off / seed 0: the standard set.
  const randartSeed = save.randartSeed ?? 0;
  if (options.get("birth_randarts") && randartSeed) {
    swapRandartSet(reg, randartSeed);
  }

  // aup_info[] (load.c): the artifact-created registry. Restore the saved
  // flags (built after swapRandartSet so aidx references align); older saves
  // predate the field and load with an all-false set (a fresh game's state).
  const artifacts = save.artifactsCreated
    ? ArtifactState.restore(save.artifactsCreated)
    : new ArtifactState(reg.objects.artifacts.length);

  const chunk = deserializeChunk(save.chunk, reg.features);
  const player = deserializePlayer(save.player, players);
  const gear = deserializeGear(save.gear, reg.objects);

  const equipment = player.equipment.map((h) => (h ? gearGet(gear, h) : null));
  const weaponSlot = player.body.slots.findIndex((s) => s.type === "WEAPON");
  const weapon = weaponSlot >= 0 ? (equipment[weaponSlot] ?? null) : null;
  const pstate = calcBonuses(player, {
    equipment,
    timedEffects: players.timed,
    curses: reg.objects.curses,
    update: true,
  });
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
    light: pstate.curLight,
    unlight: pstate.pflags.has(PF.UNLIGHT),
  };

  const state: GameState = {
    rng,
    chunk,
    actor,
    gear,
    monsters: save.monsters.map((m) =>
      m ? deserializeMonster(m, reg.monsters, reg.objects) : null,
    ),
    groups: save.groups.map((g) =>
      g ? { index: g.index, leader: g.leader, members: [...g.members] } : null,
    ),
    floor: deserializeFloor(save.floor, reg.objects, chunk.width),
    traps: reg.traps
      ? deserializeTraps(save.traps, reg.traps, chunk.width)
      : new Map(),
    known: deserializeKnown(save.known, chunk.width, chunk.height),
    /* The target is not persisted (as upstream: the savefile carries no
     * target and loading starts unset). */
    target: newTargetState(),
    ignore: new IgnoreSettings(),
    options,
    artifacts,
    lore: deserializeLore(save.lore),
    turn: save.turn,
    z: {
      ...DEFAULT_GAME_CONSTANTS,
      maxSight: reg.constants.maxSight,
      maxRange: reg.constants.maxRange,
      floorSize: reg.constants.floorSize,
      maxDepth: reg.constants.maxDepth,
      stairSkip: reg.constants.stairSkip,
      dayLength: reg.constants.dayLength,
      foodValue: reg.constants.foodValue,
      allocMonsterChance: reg.constants.allocMonsterChance,
      storeTurns: reg.constants.storeTurns,
      lifeDrainPercent: reg.constants.lifeDrainPercent,
      levelMonsterMax: reg.constants.levelMonsterMax,
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

  /* Rebuild the racial counts from the restored monster list (the save
   * carries the monsters, not the registry-side counters). Killed-unique
   * max_num zeroes are not yet persisted (ledgered with mon-place). */
  countMonsterRaces(state);

  /* A save taken in single combat resumes it (the stashed pre-arena
   * level is gone: winning exits to a fresh level of the same depth). */
  if (save.arena) {
    state.arenaLevel = true;
    state.oldGrid = loc(save.arena.oldGrid.x, save.arena.oldGrid.y);
  }

  /* seed_flavor from the save (load.c L960). Older saves predate it; fall
   * back to 0 so flavor_init still produces a stable per-load assignment. */
  const seedFlavor = save.seedFlavor ?? 0;
  const wired = wireGame(state, reg, players, pstate, seedFlavor);
  /* restore() replaces the aware/tried sets, so it must run AFTER flavor_init's
   * aware-marking of non-flavoured kinds - the save is the source of truth for
   * what the player has actually identified. */
  wired.flavor.restore(save.flavor);
  if (save.ignore) state.ignore.restore(save.ignore);

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

  /* Resuming in town: re-stock the shops (store stock is not persisted). */
  refreshTownStores(state, reg);

  return {
    state,
    registry: wired.registry,
    booted,
    players,
    flavor: wired.flavor,
    seedFlavor,
    options,
    randartSeed,
    changeLevel: makeChangeLevel(state, reg, wired.trapDeps, {
      inArena: !!save.arena,
    }),
    ...makeStoreApi(state, reg, wired.flavor, options),
  };
}

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
 * Race and class default to Human Warrior; pass raceName/className to
 * override. Decision 6.2 stream order matches C player-birth.c:1269-1292 +
 * ui-game.c:757-760: store_reset, seed_randart, seed_flavor (back-to-back),
 * then prepare_next_level generation.
 */

import { DDGRID, loc, locSum } from "../loc.js";
import type { Loc } from "../loc.js";
import { MessageLog } from "../msg.js";
import { CommandVerbTable } from "../cmd.js";
import { PN, SKILL, STAT_MAX } from "../player/types.js";
import { EF, ELEM, HIST, MSG, OF, PF, RF, STAT, TMD } from "../generated/index.js";
import { bindPlayer } from "../player/bind.js";
import type { PlayerPackRecords, PlayerRegistry } from "../player/bind.js";
import {
  generatePlayer,
  optionsInitCheat,
  flavorSetAllAware,
} from "../player/birth.js";
import {
  bonusChangeMessages,
  calcBonuses,
  calcHitpoints,
  toCombatState,
  toDefenderState,
} from "../player/calcs.js";
import type { CalcBonusesOptions, PlayerState } from "../player/calcs.js";
import {
  playerBestDiggerDigging,
  playerBestDiggerWithClause,
} from "../player/best-digger.js";
import { playerExpGain, playerKillExp } from "../player/exp.js";
import type { ExpDeps } from "../player/exp.js";
import { historyAdd, historyFindArtifact, historyLoseArtifact } from "../player/history.js";
import { artifactHistoryName, historyStamp } from "../game/history.js";
import {
  makePlayerSideEffects,
  makeIncCheckHooks,
  makeIncCheckQueries,
  makeTimedNotifyQueries,
} from "../game/player-side.js";
import { ProjectionHandlerRegistry } from "../game/projection-handlers.js";
import { UiEntryRegistry } from "../game/ui-entry-registry.js";
import { makeTakeHitHooks } from "../game/take-hit-hooks.js";
import { makeMonBlowEnv } from "../game/mon-side.js";
import {
  BlowEffectRegistry,
  registerCoreBlowEffects,
} from "../combat/mon-melee.js";
import { adj_dex_safe } from "../player/calcs.js";
import { processCurseTimeouts } from "../game/curse-tick.js";
import { buildEffectContext } from "../game/effect-env.js";
import { attachGameEnv } from "../game/effect-game-env.js";
import type { TeleportEnv } from "../game/effect-teleport.js";
import { sourceMonster, sourceNone, sourcePlayer } from "../effects/interpreter.js";
import {
  DEFAULT_GAME_CONSTANTS,
  addMonster,
  deleteMonster,
  placePlayer,
  playerOfHas,
  squareMonster,
  updateMonsterDistances,
} from "../game/context.js";
import { Chunk } from "../world/chunk.js";
import { chunkWriteTerrain } from "../gen/cave.js";
import { FEAT, SQUARE } from "../generated/index.js";
import { blankMonster } from "../mon/monster.js";
import type { Monster } from "../mon/monster.js";
import type { MonsterRace } from "../mon/types.js";
import { MON_GROUP } from "../mon/types.js";
import type {
  GameState,
  PlayerActor,
  PlayerCommand,
} from "../game/context.js";
import { monsterGroupAssign, monsterGroupsVerify } from "../game/mon-group.js";
import { floorCarry, floorObjectForUse, floorPile } from "../game/floor.js";
import type { FloorEnv } from "../game/floor.js";
import { installPickup } from "../game/pickup.js";
import { IgnoreSettings, ignoreItemOk } from "../obj/ignore.js";
import { EffectRegistry } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { registerAttackHandlers } from "../game/effect-attack.js";
import { registerGeneralHandlers } from "../game/effect-general.js";
import type { GeneralEffectEnv } from "../game/effect-general.js";
import { registerMonsterHandlers } from "../game/effect-monster.js";
import { registerTeleportHandlers, teleportMonster } from "../game/effect-teleport.js";
import { registerTerrainHandlers, wizLightLevel } from "../game/effect-terrain.js";
import { registerItemHandlers } from "../game/effect-item.js";
import type { ItemEffectEnv, ItemRequest } from "../game/effect-item.js";
import { registerMeleeHandlers } from "../game/effect-melee.js";
import { registerSummonHandlers } from "../game/effect-summon.js";
import type { SummonEffectEnv } from "../game/effect-summon.js";
import { registerDetectHandlers } from "../game/effect-detect.js";
import {
  becomeAware,
  caveIlluminateKnown,
  caveKnown,
  newKnownMap,
  noteSpots,
  monsterLightSources,
  updateMon,
  viewerStateOf,
} from "../game/known.js";
import { squareIsView, updateView } from "../world/view.js";
import { PROJECT } from "../world/project.js";
import { PY_EXERT, compactMonsters, isDaytime, playerOverExert } from "../game/world.js";
import { restoreMonsters } from "../game/scheduler.js";
import {
  newTargetState,
  targetGet,
  targetOkay,
  targetSetMonster,
} from "../game/target.js";
import {
  getLore,
  loreCountU16,
  loreLearnFlagIfVisible,
  loreLearnSpellIfVisible,
  loreUpdate,
} from "../mon/lore.js";
import { monsterIsVisible } from "../mon/predicate.js";
import {
  countMonsterRaces,
  multiplyMonster,
  pickAndPlaceDistantMonster,
  squareIsEmptyLive,
  wipeMonsterCounts,
} from "../game/mon-place.js";
import type { MonPlaceDeps } from "../game/mon-place.js";
import { SummonTable } from "../mon/summon.js";
import { MonAllocTable } from "../mon/make.js";
import type { EffectBuilderInjections } from "../effects/effect.js";
import { thrustAway } from "../game/thrust.js";
import { basicPlayerActor } from "../game/project-cast.js";
import type { CastContext } from "../game/project-cast.js";
import type { EffectEnvDeps } from "../game/effect-env.js";
import { installMonsterCasting } from "../game/mon-ranged.js";
import { polyRace, polymorphMonster } from "../game/poly.js";
import { buildMonSpellHooks, buildFailRuneEnv } from "../game/mon-cast.js";
import { installMonCommand } from "../game/mon-cmd.js";
import { monsterChangeShape, monsterRevertShape } from "../game/mon-shape.js";
import type { MonShapeHooks } from "../mon/timed.js";
import { installMonTimedLore } from "../mon/timed.js";
import {
  applyAutoinscription,
  autoinscribeGround,
  autoinscribePack,
  installObjCommands,
  packOverflow,
} from "../game/obj-cmd.js";
import type { ObjCmdDeps } from "../game/obj-cmd.js";
import { displayFeeling, installCaveCommands, movementAutoDig } from "../game/cave-cmd.js";
import type { CaveCmdDeps } from "../game/cave-cmd.js";
import { installSteal } from "../game/steal.js";
import type { ChestCmdDeps } from "../game/chest.js";
import {
  calcUnlockingChance,
  installChunkFeatHook,
  installTrap,
  installTraps,
  playerIsTrapsafe,
  squareDoorPower,
  squareIsPlayerTrap,
  squareIsWarded,
  squareIsWebbed,
  squareRemoveAllTraps,
  squareSetDoorLock,
  trapPredicates,
} from "../game/trap.js";
import type { TrapDeps } from "../game/trap.js";
import { lookupTrap } from "../world/trap.js";
import {
  calcMana,
  calcSpells,
  cumberArmorFrom,
  playerSpellsInit,
  registerBookKinds,
  wornArmorWeight,
} from "../player/spell.js";
import { installSpellCommands, makeSpellChanceEnv } from "../game/spell-cmd.js";
import { installRangedCommands } from "../game/ranged-cmd.js";
import { markNoscore, NOSCORE } from "../game/wizard.js";
import type { WizardDeps } from "../game/wizard.js";
import {
  createTownStores,
  registerCoreStoreBehaviour,
  StoreBehaviourRegistry,
  storeUpdate,
  storeWillBuy,
} from "../store/store.js";
import type { Store, StoreMaintContext } from "../store/store.js";
import {
  homeCarry,
  homeRetrieve,
  homeStash,
  storeBuy,
  storeSell,
  storeSellFloor,
} from "../store/transact.js";
import type { BuyResult, SellResult, TxnKnowledge } from "../store/transact.js";
import { storeCheckNum } from "../store/store.js";
import { installStoreCommands } from "../store/store-cmd.js";
import { priceItem } from "../store/price.js";
import {
  addMonsterMessage,
  addMonsterMessageShowDamage,
  messagePain,
  messagePainShowDamage,
  monMessageCodeByName,
} from "../game/mon-message.js";
import {
  AutoinscriptionRegistry,
  RuneNoteRegistry,
  buildRuneList,
  runeKey,
  FlavorKnowledge,
  EverseenKnowledge,
  equipLearnElement,
  equipLearnFlag,
  makeRuneEnv,
  NOOP_FLAVOR_AWARE_DEPS,
  OBJ_NOTICE,
  objectLearnOnWield,
  playerLearnInnate,
  playerLearnAllRunes,
} from "../obj/knowledge.js";
import type { FlavorAwareDeps } from "../obj/knowledge.js";
import { flavorInit } from "../obj/flavor.js";
import { ELEM_MAX } from "../obj/types.js";
import type { ObjectKind } from "../obj/types.js";
import { ArtifactState, ObjAllocState } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import { monsterDeath, installNonplayerHitDeps } from "../game/mon-death.js";
import type { MonsterDeathDeps } from "../game/mon-death.js";
import type { ProjectFeatEnv } from "../game/project-feat.js";
import {
  newGear,
  outfitPlayer,
  gearGet,
  gearTotalWeight,
  calcInventory,
  combinePackForPlayer,
  minusAc as applyMinusAc,
  objectCopyAmt,
} from "../game/gear.js";
import type { CalcInventoryOpts } from "../game/gear.js";
import { objectValue as computeObjectValue } from "../obj/value.js";
import type { GameObject, CurseTimedFoil } from "../obj/object.js";
import { buildCurseTimedFoil } from "../obj/object.js";
import { createDefaultRegistry, installMeleeSideEffects, search } from "../game/player-turn.js";
import { noticeNewLevel } from "../game/notice.js";
import { cmdDisableRepeatFloorItem } from "../game/repeat.js";
import type { ActionRegistry } from "../game/player-turn.js";
import { buildTempBrandSlay, playerIncCheck } from "../player/timed.js";
import { describeObject, knownDescOf, objectKnownView } from "../game/describe.js";
import {
  knownBonusView,
  objectFlagIsKnown,
  objectKnownShadow,
} from "../obj/known-object.js";
import { ODESC, objDescNameFormat } from "../obj/desc.js";
import type {
  TimedTempBrandSlayRecord,
  PlayerIncCheckQueries,
  TimedWeaponDesc,
} from "../player/timed.js";
import { disturb, installRunning } from "../game/player-path.js";
import { bindCore, bootLevel, genDeps } from "./boot.js";
import {
  dungeonGetNextLevel,
  isQuest,
  playerQuestsReset,
  questCheck,
} from "../game/quest.js";
import type {
  BootedLevel,
  BootLevelOptions,
  CorePack,
  CoreRegistries,
} from "./boot.js";
import { Rng } from "../rng.js";
import type { Player } from "../player/player.js";
import { OptionState } from "../player/options.js";
import type { OptionName } from "../player/options.js";
import { optionsInitDefaults } from "../player/options-file.js";
import { host } from "../host/io.js";
import { doRandart, RANDNAME_TOLKIEN } from "../obj/randart.js";
import { makeActivationSummarizer } from "../obj/effects-info.js";
import type { RawTimedRecord } from "../obj/effects-info.js";
import type { ActivationSummarizer } from "../obj/randart-build.js";
import {
  generateLevel,
  getJoinInfo,
  getMinLevelSize,
  type QuestSpawn,
} from "../gen/generate.js";
import { iToGrid } from "../gen/util.js";
import {
  deserializeAutoinscriptions,
  deserializeEverseen,
  deserializeFlavor,
  deserializeIgnore,
  deserializeChunk,
  deserializeFloor,
  buildFeatRemap,
  deserializeArtifactsCreated,
  deserializeArtifactFlags,
  deserializeGear,
  deserializeKnown,
  deserializeLevelCache,
  deserializeLore,
  deserializeMessages,
  deserializeMonster,
  deserializePlayer,
  deserializeStores,
  deserializeTraps,
  serializeGame,
} from "./save.js";
import type { SavedGame } from "./save.js";
import { migrateSave } from "./save-migrate.js";
import { ContentIdResolver } from "../mod/ids.js";
import {
  coreOnlyManifest,
  mismatchedNamespaces,
  quarantineSave,
  reconcilePackManifest,
  rehydrateSave,
} from "../mod/save-blocks.js";
import type {
  ModBag,
  OrphanStore,
  SaveManifest,
  SavePackRef,
} from "../mod/save-blocks.js";

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
 * The getAimTarget seam body: effect_handler_TELEPORT_TO's own get_aim_dir
 * (effect-handler-general.c:2770-2778), resolved from the direction the shell
 * pre-asked and rode on the command.
 *
 *   do { if (!get_aim_dir(&dir)) return false; } while (dir == DIR_TARGET && !target_okay());
 *   if (dir == DIR_TARGET) target_get(&aim);
 *   else aim = loc_offset(start, ddx[dir], ddy[dir]);
 *
 * The C loop re-asks until the answer is usable; a port that cannot block
 * instead treats an unusable answer as the cancel the loop's ESC produces. No
 * RNG either way.
 */
export function resolveEffectAim(state: GameState): Loc | null {
  const dir = state.effectAimDir;
  if (dir === null || dir === undefined || dir < 1 || dir > 9) return null;
  /* DIR_TARGET: the while() means a target that is gone is not a direction. */
  if (dir === 5) return targetOkay(state) ? targetGet(state) : null;
  return locSum(state.actor.grid, DDGRID[dir] ?? loc(0, 0));
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
   * Stat roller method (ui-birth.c BIRTH_ROLLER_CHOICE). "point" applies the
   * point-based allocation in `birthStats` (no stat RNG); "roller" (the
   * default when omitted) runs the classic get_stats roller.
   */
  roller?: "point" | "roller";
  /**
   * Point-based allocated base stats (STAT_MAX values), used only when
   * `roller` is "point". Threaded into generatePlayer so the character is born
   * with these stats and the stat stage draws no RNG.
   */
  birthStats?: readonly number[];
  /**
   * A standard-roller result the shell's roller UI rolled and the player
   * accepted (do_cmd_roll_stats, player-birth.c:1159-1193): the STAT_MAX natural
   * stat values, applied VERBATIM by generatePlayer (no point-buy clamp, no
   * stat RNG). Used when `roller` is "roller"/omitted; wins over `birthStats`.
   */
  rolledStats?: readonly number[];
  /**
   * An edited character background the shell's history stage produced
   * (do_cmd_choose_history, player-birth.c:1219-1230). Replaces the get_history
   * text on the player; the history walk still runs so the RNG order is intact.
   */
  history?: string;
  /**
   * Birth / interface option choices, applied over the table defaults at
   * character creation (option.c options_init_defaults). Birth options become
   * the immutable birth snapshot; the rest seed the live option store.
   */
  optionOverrides?: Partial<Record<OptionName, boolean>>;
  /** op_ptr->hitpoint_warn (0..9). Default 3 (DEFAULT_HITPOINT_WARN). */
  hitpointWarn?: number;
  /**
   * The player's per-patch choices, resolved by the host from each enabled mod's
   * manifest `rules`. Recorded on GameState.modRules and saved, so a save says
   * which patches a character was played with. OPAQUE to core - see the field's
   * note in game/context.ts.
   */
  modRules?: Readonly<Record<string, boolean>>;
  /**
   * The behaviour every enabled mod supplies, already folded into one object by
   * the host (mod/hooks.ts composeModHooks). Absent - the case with no mod
   * enabled - leaves core byte-identical to faithful 4.2.6.
   */
  modHooks?: import("../mod/hooks.js").ModHooks;
  /**
   * The host's own FOV refresh, installed BEFORE the initial level-entry flood.
   *
   * Core installs a default when this is absent, so a host needs this only when it
   * wants its own - the web shell routes the view's events at its sound bus. It is
   * an option rather than a post-boot assignment because the level-entry flood runs
   * inside startGame: a seam installed afterwards misses it, which is how the web
   * build came to do its first view build with `onlyPartial` already cleared.
   */
  updateFov?: (state: GameState) => void;
}

/** A started game: the loop's state and registry, plus what a renderer needs. */
export interface StartedGame {
  state: GameState;
  registry: ActionRegistry;
  /**
   * The effect interpreter (null on a worldless boot). Surfaced so a host can
   * build the trusted-mod registry facade (mod/registry-host.ts, W2.2) for
   * effect-handler overrides. The room registry lives on booted.registries.rooms
   * and the command seam is `registry` above.
   */
  effects: EffectRegistry | null;
  /** The generated world (features, placed objects, registries) for rendering. */
  booted: BootedLevel;
  players: PlayerRegistry;
  /** Per-game flavor knowledge (aware/tried), for the save format. */
  flavor: FlavorKnowledge;
  /**
   * Per-game everseen knowledge (kind/ego "ever seen"), for the object + ego
   * knowledge browsers and the save format.
   */
  everseen: EverseenKnowledge;
  /** seed_flavor: the seed flavor_init used, persisted so a reload matches. */
  seedFlavor: number;
  /**
   * The mod manifest (save-blocks.ts, P7.2): the pack set + resolved load order
   * + core-owned determinism mode. A core-only game carries coreOnlyManifest();
   * a loaded game carries the manifest the save was written with.
   */
  manifest: SaveManifest;
  /** Per-mod private save bags (mod:<id>), round-tripped verbatim. */
  mods: Record<string, ModBag>;
  /**
   * Quarantined entities (missing/shadowed packs), preserved across save/load
   * so reinstalling a pack rehydrates its content. Empty for a core-only game.
   */
  orphans: OrphanStore;
  /** decision-8: whether the one-time orphan keep/purge prompt has been shown. */
  orphansAcknowledged: boolean;
  /**
   * Namespaces present now whose recorded content hash no longer matches
   * their current one (issue #20, save-blocks.ts mismatchedNamespaces): a
   * pack that PATCHED a record - a session mod re-pricing a core sword,
   * say - instead of only adding one, so nothing was orphaned when the patch
   * changed or the pack went away. Empty on a core-only game, on a save
   * written before this field, and whenever the loading host supplied no
   * `currentPacks` (or none with a measurable hash) to compare against -
   * absent evidence is not evidence of a match.
   */
  mismatchedPacks: readonly string[];
  /**
   * What loadGame had to convert to read this save (session/save-migrate.ts).
   * Absent on a new game and on a save already at SAVE_VERSION. `applied` is one
   * line per format version crossed; `notes` is anything that could not be
   * carried across, in words a player can act on. A host SHOULD show both - a
   * character that quietly lost an item is worse than one that says it did.
   */
  saveMigration?: { applied: string[]; notes: string[] };
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
   * reincarnate_borg (borg/borg-reincarnate.c): wipe the live player, roll a new
   * one from the real birth pipeline, and carry on in the SAME session - no new
   * savefile, no return to a menu. Race and class are rolled unless pinned. See
   * makeReincarnate for what it does and what it deliberately leaves alone.
   *
   * A HOST-SIDE CALL, by construction. `AgentCommand` is `PlayerCommand`, an
   * in-game turn command, and birth has no representation there - so an autoplayer
   * mod cannot ask for this through its per-turn return value and the host's own
   * death handling has to be what calls it.
   */
  reincarnate: (opts?: ReincarnateOptions) => ReincarnateResult;
  /**
   * The wizard/debug engine bundles (WP-14 / gap 15.2): effect interpreter,
   * ExpDeps, TrapDeps, live MonPlaceDeps and MakeDeps for the interactive debug
   * command menu. Assembled inside wireGame (single source of truth).
   */
  wizardBundles: WizardBundle;
  /**
   * do_cmd_buy: purchase `amt` of a store-stock object into the player's pack
   * (store/transact.ts), with the deps and knowledge closed over. Town only.
   */
  buy: (store: Store, obj: GameObject, amt: number) => BuyResult;
  /**
   * do_cmd_sell: sell `amt` of the gear object at `handle` to the store. The
   * handle may name a pack, equipped, or quiver object (ui-store.c L487 get_mode
   * USE_INVEN|USE_EQUIP|USE_QUIVER); a stuck equipped item is refused.
   */
  sell: (store: Store, handle: number, amt: number) => SellResult;
  /**
   * do_cmd_sell for a FLOOR object (ui-store.c L487 USE_FLOOR): sell `amt` of the
   * floor pile object `obj` (at the player's grid) to the store. Detached via
   * floor_object_for_use rather than a gear handle.
   */
  sellFloor: (store: Store, obj: GameObject, amt: number) => SellResult;
  /**
   * price_item for display: the per-item price the player pays (storeBuying
   * false) or is offered (storeBuying true).
   */
  price: (store: Store, obj: GameObject, storeBuying: boolean, qty: number) => number;
  /**
   * store_will_buy (store.c L524): whether `store` would purchase `obj`, for the
   * sell picker's pre-filter (ui-store.c store_sell get_item tester). Uses the
   * same knowledge the sell transaction does so the picker and the sale agree.
   */
  willBuy: (store: Store, obj: GameObject) => boolean;
}

/**
 * The wizard/debug engine bundles (WP-14 / gap 15.2): the effect interpreter,
 * ExpDeps, TrapDeps, the live MonPlaceDeps and MakeDeps that the interactive
 * wizard commands (game/wizard.ts) dispatch through. Assembled once inside
 * wireGame - the single source of truth for this wiring - and surfaced on
 * StartedGame so the web debug menu (packages/web wizard.ts) never re-derives
 * them. A subset of WizardDeps: the shell adds the wizard flag, msg, the
 * markNoscore hook and the pure registry data (races/artifacts/curses).
 */
export type WizardBundle = Pick<
  WizardDeps,
  "makeDeps" | "expDeps" | "effect" | "trapDeps" | "monPlace"
>;

/** What the shared command/effect wiring returns. */
interface WiredGame {
  registry: ActionRegistry;
  trapDeps: TrapDeps | null;
  flavor: FlavorKnowledge;
  everseen: EverseenKnowledge;
  /**
   * The effect interpreter, or null on a worldless boot (no projections). Kept
   * on the wired result so the host can hand it to a trusted mod's registry
   * facade (W2.2, mod/registry-host.ts) for effect-handler overrides.
   */
  effects: EffectRegistry | null;
  /** The wizard/debug engine bundles (WP-14), for the debug command menu. */
  wizardBundles: WizardBundle;
}

/**
 * The real, in-play FlavorAwareDeps for object_flavor_aware's ignore fix
 * (obj-knowledge.c L2276-2279, #89): reads the live ignore settings so a
 * kind ignored while unaware keeps being ignored once identified, and raises
 * player->upkeep->notice's PN_IGNORE (obj-knowledge.c L2279) so the next
 * notice_stuff runs an ignore_drop pass. Shared by the two in-play
 * becomes-aware sites: game/obj-cmd.ts's item-use knowledge gain
 * (installObjCommands below) and store/transact.ts's buy/sell (makeStoreApi).
 *
 * This used to set a bespoke `state.noticeIgnore` boolean because there was no
 * notice mask to raise a bit in - and nothing ever read the boolean, which is
 * PORT_TODO 2.5. It raises the real bit now.
 */
function flavorAwareDeps(state: GameState): FlavorAwareDeps {
  return {
    isIgnoredUnaware: (kidx) => state.ignore.kindIsIgnoredUnaware(kidx),
    ignoreWhenAware: (kidx) => state.ignore.kindIgnoreWhenAware(kidx),
    requestIgnoreNotice: () => {
      state.actor.player.upkeep.notice |= PN.IGNORE;
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
  // Rolling message log (message.c file-statics; gap 12.8). Shared producer for
  // both new-game and load paths: startGame arrives with no log so this creates
  // it; loadGame already restored one via deserializeMessages, so preserve it
  // (??=) rather than clobber. The shell's message sink (state.msg) appends here
  // in addition to its existing routing.
  state.messages ??= new MessageLog();

  // Live commands over the floor piles: 'g'et + autopickup on stepping.
  const registry = createDefaultRegistry();

  // The verbs the "Really <verb> ...? " inscription confirm reads, seeded with
  // core's. Per game and beside the registry it belongs to, so a mod that
  // registers a command here can name that command's verb in the same breath
  // and neither outlives the character (cmd.ts, CommandVerbTable).
  state.commandVerbs = new CommandVerbTable();

  const flavor = new FlavorKnowledge(reg.objects.ordinaryKindCount);

  // kind/ego everseen (object_kind/ego_item everseen): one per-game store, read
  // by the object + ego knowledge browsers and marked on live describes via
  // knownDescOf (game/describe.ts) and for bought start items (startGame).
  const everseen = new EverseenKnowledge();
  state.everseen = everseen;

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
  state.flavorGlyph = (kind) => flavorAssignment.get(kind);

  // ignore_item_ok (obj-ignore.c): the player's ignore settings resolved with
  // live flavor awareness. Everything reads it through state.isIgnored so the
  // floor / pickup / running / projection paths need no flavor coupling.
  state.isIgnored = (obj) =>
    ignoreItemOk(
      obj,
      objectKnownView(state, obj),
      state.ignore,
      flavor.isAware(obj.kind),
    );

  // object_flavor_is_aware (obj-knowledge.c): the presentation view models
  // (obj-list.c, #25) read kind awareness through this seam, keeping them
  // decoupled from the flavor store just like isIgnored.
  state.isAware = (kind) => flavor.isAware(kind);

  // The flavor store + its object_flavor_aware side-channel, exposed so the
  // game-layer knowledge sweep (game/known.ts updatePlayerObjectKnowledge, the
  // port of update_player_object_knowledge) can flip a kind aware when a
  // rune-learn completes a carried jewel's runes (KN-03).
  state.flavorKnown = flavor;
  state.flavorAwareDeps = flavorAwareDeps(state);

  installPickup(state, registry, {
    constants: reg.constants,
    env: { isIgnored: (obj) => state.isIgnored!(obj) },
    /* PU_INVEN after inven_carry (see PickupDeps.refreshInventory): route
     * picked-up ammo into the quiver. Same calc_inventory opts as the store
     * refreshQuiver and object-command paths. */
    refreshInventory: (): void => {
      calcInventory(state.gear, reg.constants, {
        store: false,
        /* earlier_object reads player->state.ammo_tval off the global player
         * (player-calcs.c:954-959), so EVERY caller must supply the live value
         * -- omitting it here silently sorted the quiver as if no launcher were
         * wielded, so a picked-up usable arrow lost its precedence over
         * unusable ammo. Same source calcInvOpts uses (obj-cmd.ts:168). */
        ammoTval: state.playerState?.ammoTval ?? 0,
        objectValue: (obj: GameObject): number =>
          computeObjectValue(reg.objects, obj, 1, true),
        rogueLike: state.options?.get("rogue_like_commands") ?? false,
        characterDungeon: true,
        msg: (text: string): void => state.msg?.(text),
      });
    },
  });

  // Rune learning (obj-knowledge.c learn-by-use): the registry tables plus
  // live equipment access. Reads through the state object so level changes
  // and gear swaps need no rewiring. `describeBase` is the real ODESC_BASE for
  // the six rune / flag / curse messages (PORT_TODO 3.23); it is supplied HERE
  // and only here, because the two other makeRuneEnv calls in this file are the
  // documented placeholders wireGame replaces.
  state.runeEnv = makeRuneEnv(
    (slot) =>
      state.gear.store.get(state.actor.player.equipment[slot] ?? 0) ?? null,
    (v) => state.rng.randcalcVaries(v),
    {
      brands: reg.objects.brands,
      slays: reg.objects.slays,
      curses: reg.objects.curses,
      properties: reg.objects.properties,
      describeBase: (obj): string => describeObject(state, obj, ODESC.BASE),
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
  /**
   * calc_bonuses(p, &known_state, TRUE, TRUE) (player-calcs.c:2349): the SECOND
   * derive, the one the player is SHOWN. Same options and the same `update`
   * flag upstream passes - its side effects (zeroing TMD_FASTCAST on a stun
   * grade) are idempotent, so running them twice is what upstream does and
   * costs nothing.
   *
   * knownBonusView is the whole difference: it hands the equipment loop each
   * worn item's known twin, so an unlearned rune's to_a / to_h / to_d / resist
   * / flag is left out of what gets printed while staying in what gets rolled.
   *
   * A named function rather than three lines inside refreshDerived because it
   * is also called ONCE at the end of wiring. Without that seed, actor
   * .knownCombat would hold the real state until the first equipment change,
   * and a loaded character wearing unidentified gear would see true numbers on
   * the sidebar for exactly as long as they stood still.
   */
  const refreshKnownCombat = (
    p: Player,
    bonusOptions: CalcBonusesOptions,
  ): void => {
    const known = calcBonuses(p, {
      ...bonusOptions,
      knownOnly: (obj) =>
        knownBonusView(obj, p, state.runeEnv, knownDescOf(state)),
    });
    state.knownPlayerState = known;
    state.actor.knownCombat = toCombatState(known);
  };

  /**
   * The calc_bonuses options bag for the world as it stands, minus the loadout.
   * ONE definition, because a hypothetical derive that reads a different bag
   * from the live one is a derive that quietly answers a different question -
   * the curse traversal in particular is easy to leave out and impossible to
   * notice from the number that comes back.
   */
  const liveBonusOptions = (update: boolean): CalcBonusesOptions => ({
    timedEffects: players.timed,
    curses: reg.objects.curses,
    update,
    depth: state.chunk.depth,
    isDaytime: isDaytime(state.turn, state.z.dayLength),
  });

  const refreshDerived = (): void => {
    const p = state.actor.player;
    const equipment = p.equipment.map((h) =>
      h ? gearGet(state.gear, h) : null,
    );
    const daytime = isDaytime(state.turn, state.z.dayLength);
    /* p->state before the memcpy at the end of calc_bonuses: the encumbrance
     * notices below diff against it (player-calcs.c:2412-2453). */
    const before = derived;
    const bonusOptions = { ...liveBonusOptions(true), equipment };
    derived = calcBonuses(p, bonusOptions);
    state.playerState = derived;
    refreshKnownCombat(p, bonusOptions);
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
    /* calc_mana with the worn-armor encumbrance. It owns state->cumber_armor
     * (player-calcs.c:1503, :1528), so record it before the diff below reads
     * it - upstream's calc_mana runs inside calc_bonuses, ahead of the
     * notices. */
    derived.cumberArmor = calcMana(
      p,
      derived.statInd,
      wornArmorWeight(p, equipment),
    );
    if (p.csp > p.msp) p.csp = p.msp;
    /* The state-change notices at the end of calc_bonuses (2412-2453). Emitted
     * last because cumber_armor is only known once calc_mana has run. */
    const weaponSlotIdx = p.body.slots.findIndex((s) => s.type === "WEAPON");
    const bowSlotIdx = p.body.slots.findIndex((s) => s.type === "BOW");
    for (const text of bonusChangeMessages(before, derived, {
      hasWeapon: weaponSlotIdx >= 0 && !!equipment[weaponSlotIdx],
      hasLauncher: bowSlotIdx >= 0 && !!equipment[bowSlotIdx],
    })) {
      state.msg?.(text);
    }
  };
  state.updateBonuses = refreshDerived;

  /**
   * calc_bonuses for a loadout the player is NOT wearing (update=false, so the
   * derive keeps its hands off p->timed[TMD_FASTCAST] and the town-light redraw),
   * over the same options bag the live refresh uses.
   *
   * This is the one thing a hypothetical derive could not do from outside: the
   * bag carries the bound timed table and the curse registry, and a caller
   * assembling its own would silently drop whichever it did not know about. It is
   * installed here for the same reason updateBonuses is - the session is the only
   * place that has all of it.
   */
  state.derivedFor = (equipment, totalWeight): PlayerState =>
    calcBonuses(state.actor.player, {
      ...liveBonusOptions(false),
      equipment: equipment.slice(),
      ...(totalWeight === undefined ? {} : { totalWeight }),
    });

  /**
   * update_stuff's PU_UPDATE_VIEW arm (player-calcs.c:2608), as the DEFAULT.
   *
   * `state.updateFov` is a host seam that core already calls from ~25 sites - the
   * level-entry flood, the after-action refresh in player-turn.ts, every terrain
   * and light effect. All of them are `?.`, and core supplied no default, so a
   * host that did not install one got silence from every one of them. Measured on
   * a fresh startGame boot with no host wiring: of 12740 cells, `known` was true
   * for 0 and `inView` for 0, including the player's own square. The engine was
   * complete and every caller was wired; the DEFAULT was the missing piece, and
   * an agent driving the frozen agent API therefore had no map at all.
   *
   * Invisible until something drove it: the web shell installs its own (main.ts,
   * routing view events at its sound bus) and the Borg's tests use a hand-built
   * fake AgentView, so no test in the repository ever ran core's perceive path
   * with nothing installed.
   *
   * `??=` rather than `=`: a host that wants its own events bus or light sources
   * can still replace this. NOTE that no shipped host does - the web calls core's
   * (main.ts:8484 throws if wireGame did not install one) and so does the MCP
   * session. This comment used to assert "and the web does", which is how the
   * hardcoded `[]` below survived: a seam documented as host-supplied reads as
   * deliberate rather than empty. Wired in wireGame so startGame and loadGame
   * both get it - a resumed character has the same right to a map as a new one.
   *
   * The viewer fields come from `viewerStateOf` (game/known.ts) rather than being
   * spelled out again here, because spelling them out twice is how both hosts came
   * to pass `chunk.depth` where cave-view.c:778 reads `p->lev`.
   */
  state.updateFov ??= (s: GameState): void => {
    updateView(
      s.chunk,
      viewerStateOf(s),
      { maxSight: reg.constants.maxSight, feelingNeed: reg.constants.feelingNeed },
      /* calc_lighting's monster scan (cave-view.c L696-719). Was `[]`. */
      monsterLightSources(s),
      s.events,
      /* cave-view.c:852: the object feeling, the moment the player has seen
       * enough of the level to earn it. objOnly is display_feeling(true) - the
       * one-line object half, not the joined ^F line - and the disturb is
       * upstream's, so a run or a rest stops on the news. */
      () => {
        displayFeeling(s, { objOnly: true });
        disturb(s);
      },
    );
    noteSpots(s);
  };
  /* The live calc_inventory inputs, shared by every closure below that has to
   * re-derive upkeep->inven[] / upkeep->quiver[]. One function rather than a
   * copy per seam, so a change to the options bag reaches all of them. */
  const liveCalcInv = (): CalcInventoryOpts => ({
    ammoTval: state.playerState?.ammoTval ?? 0,
    objectValue: (obj: GameObject): number =>
      computeObjectValue(reg.objects, obj, 1, true),
    rogueLike: state.options?.get("rogue_like_commands") ?? false,
    characterDungeon: true,
    ...(state.msg ? { msg: state.msg } : {}),
    /* The partialStackMerge / packOverflowVictim seams (mod/hooks.ts). */
    ...(state.modHooks ? { hooks: state.modHooks } : {}),
  });
  /* game-world.c:941-947: the C refreshes upkeep->inven[] before its
   * catch-all pack_overflow(NULL).  This closure has the same live
   * calc_inventory inputs used by pickup and command paths, preserving the
   * earlier_object order of the derived gear.inven view. */
  state.overflowPack = (): void => {
    /* GameState.gear.quiver as it stood before this recompute, for the
     * packOverflowVictim seam - the one point that catches an inscription (or
     * any other note-only change) displacing an item out of the quiver. */
    const previousQuiver = [...(state.gear.quiver ?? [])];
    const calcInv = liveCalcInv();
    /* notice_stuff()/handle_stuff() precede pack_overflow(NULL) at
     * game-world.c:941-947; materialize the current upkeep->inven[] analogue
     * before selecting its final entry. */
    calcInventory(state.gear, reg.constants, calcInv);
    packOverflow(state, 0, reg.constants, {
      calcInv,
      previousQuiver,
      ...(state.msg ? { msg: state.msg } : {}),
      ...(state.modHooks ? { hooks: state.modHooks } : {}),
    });
  };
  /* notice_stuff's PN_COMBINE branch (player-calcs.c L2546-2549). combine_pack
   * ends in its own calc_inventory, so this needs the same options bag. */
  state.combinePack = (): void => {
    combinePackForPlayer(state.gear, state.actor.player, reg.constants, liveCalcInv());
  };
  /* Stash the class list so refreshTownStores can expand the bookseller's
   * town-book always lines (object_kind_to_book, store.c:208-231). */
  state.classes = players.classes;

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

  /* The same swap decision as a string, for tunnel_aux's with_clause
   * (cmd-cave.c:541, :552) - "with your hands" / "with your weapon" / "with
   * your swap digger". Shares bestDiggerSwap with the roll above so the
   * message and the chance can never disagree. */
  const digWithClause = (): string => {
    const p = state.actor.player;
    const equipment = p.equipment.map((h) =>
      h ? gearGet(state.gear, h) : null,
    );
    const weaponSlot = p.body.slots.findIndex((s) => s.type === "WEAPON");
    const daytime = isDaytime(state.turn, state.z.dayLength);
    return playerBestDiggerWithClause(
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
    /* msgt(MSG_LEVEL, "Welcome to level %d.") (player.c L250). This sink was
     * missing, so every level-up was silent: the level and max HP simply
     * changed on the status line with no message at all. */
    msg: (text, type): void => state.msg?.(text, type),
    onLevelChange: (p): void => {
      refreshDerived();
      /* Casters learn/forget spells at the new level; calcSpells announces the
       * new allowance ("You can learn N more spells.") on a change, as C's
       * calc_bonuses->calc_spells does (player-calcs.c:1465). */
      calcSpells(p, derived.statInd, (text) => state.msg?.(text));
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
    /* player_kill_monster: dead uniques stay dead (max_num = 0). This is NOT
     * session-lifetime, contrary to what this comment used to say: the save
     * carries the lore, and the load path re-derives maxNum = 0 for every
     * unique with pkills > 0 (see the SV-01 block below), exactly as
     * load.c:532-535 does. Nothing about it rides an unbuilt save format. */
    if (mon.race.flags.has(RF.UNIQUE)) {
      /* bug-fixes #4245 ("Unique coming back to life?"): a unique can produce
       * multiple "Killed X" kill-history entries via shape-change / projection
       * death paths (the misleading death MESSAGE was fixed by PR #6245, in the
       * 4.2.6 baseline, but its author states that does NOT fix the multiple-
       * history-entries defect). With bugfix.uniqueKillHistory on, a second kill
       * of an already-dead unique (race.maxNum already 0) does not log a duplicate
       * entry; faithful 4.2.6 logs one per lethal blow. Read BEFORE max_num=0. */
      const alreadyDead = mon.race.maxNum === 0;
      mon.race.maxNum = 0;
      /* history_add(HIST_SLAY_UNIQUE) (mon-util.c L1099-1101), read BEFORE
       * playerKillExp below so p.lev is the pre-kill level, matching
       * upstream's history_add-before-player_exp_gain order. MDESC_DIED_FROM
       * for a unique is just the race name (no article/pronoun swap), so no
       * MDESC subsystem is needed here. */
      /* The history seam (mod/hooks.ts historyAdd). Faithful 4.2.6 logs one entry
       * per lethal blow, duplicates included, so with no hook installed the
       * `?? true` below IS the faithful answer. `duplicate` tells a mod what it
       * needs to decide without core deciding anything. */
      const entry: import("../mod/hooks.js").HistoryAddEntry = {
        what: `Killed ${mon.race.name}`,
        type: HIST.SLAY_UNIQUE,
        duplicate: alreadyDead,
      };
      const wanted = state.modHooks?.historyAdd?.(entry) ?? true;
      if (wanted) {
        const stamp = historyStamp(state);
        historyAdd(
          state.actor.player,
          entry.what,
          HIST.SLAY_UNIQUE,
          stamp.dlev,
          stamp.clev,
          stamp.turn,
          entry.expandUserInput,
        );
      }
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

  // history_lose_artifact (player-history.c L246): an artifact is destroyed,
  // abandoned on a regenerated level, or discarded by a store. RNG-free name.
  state.onArtifactLost = (art): void => {
    const stamp = historyStamp(state);
    historyLoseArtifact(
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
  /* Hoisted so the wired result can surface it to the host (W2.2 mod facade);
   * assigned inside the projections block below, null on a worldless boot. */
  let effectRegistry: EffectRegistry | null = null;
  /* The wizard/debug effect bundle (WP-14): the same effect_simple stack items
   * and spells run through, assembled once the block's locals exist. undefined
   * on a worldless boot, where the wizard effect commands are inert anyway. */
  let wizardEffect: WizardDeps["effect"] = undefined;
  /* obj_kind_can_browse(kind) for the birthed class (obj-tval.c): the set of
   * this character's readable spellbook kinds (tval,sval), stamped by
   * registerBookKinds. make_object uses it to reject unreadable books (gap 3.5).
   * Empty for a non-caster class, so it rejects every book (faithful). */
  const classBookKeys = new Set(
    state.actor.player.cls.magic.books.map((b) => `${b.tvalIdx},${b.sval}`),
  );
  const makeDeps: MakeDeps = {
    reg: reg.objects,
    alloc: new ObjAllocState(reg.objects, reg.constants),
    constants: reg.constants,
    chestTraps: reg.chestTraps,
    artifacts: state.artifacts ?? new ArtifactState(reg.objects.artifacts.length),
    noArtifacts: state.options?.get("birth_no_artifacts") ?? false,
    /* The mod behaviour seam: read state.modHooks LIVE, not captured, so a mod
     * that installs a hook at boot (after wireGame builds this) is still seen.
     * Absent => makeArtifact's faithful branch, which is the only branch. */
    get hooks() {
      return state.modHooks;
    },
    /* append_object_curse TIMED_INC foil (obj-curse.c L159-188, gap 3.2):
     * reject a curse an existing item property would foil, built from the bound
     * player-timed fail tables. */
    timedFoil: buildCurseTimedFoil(players.timed),
    /* obj_kind_can_browse book rejection (obj-make.c L1187-1194, gap 3.5). */
    canBrowseBook: (kind): boolean =>
      classBookKeys.has(`${kind.tval},${kind.sval}`),
    /* make_gold birth_no_selling 5x dungeon inflation (obj-make.c L1310-1312,
     * gap 3.7). */
    noSelling: state.options?.get("birth_no_selling") ?? false,
  };
  /* The one complete player take_hit consequences object, shared by every
   * damage site (projections, melee via mon-side, effects via envDeps, DoT /
   * terrain via state.world). Defined out here so both the projections block
   * and the state.world assignment below reference the same object. Wiring
   * onDeath is what finally records died_from + clears total_winner on death
   * (audit 01 P1 CRITICAL). wizardEffect.current is filled once the effect
   * stack exists so EVENT_CHEAT_DEATH can call wizCheatDeath (W2-009). */
  const wizardEffectHolder: { current: WizardDeps["effect"] | undefined } = {
    current: undefined,
  };
  const sharedTakeHitHooks = makeTakeHitHooks(state, {
    wizardEffect: wizardEffectHolder,
  });
  /* on_begin_effect / on_end_effect dispatch for timed transitions (audit 01
   * T2, player-timed.c:873-891). Assigned inside the projections block where the
   * effect registry + env exist, and read by the world-clock timedHooks
   * (function-body scope, like sharedTakeHitHooks). Undefined when no effect
   * stack is built (headless save inspection); then transitions run no chain. */
  let runTimedTransition:
    | ((idx: number, begin: boolean, canDisturb: boolean) => void)
    | undefined;
  if (reg.projections) {
    const effects = new EffectRegistry();
    effectRegistry = effects;
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
    const floorEnv: FloorEnv = {
      isIgnored: (obj: GameObject): boolean => state.isIgnored!(obj),
      ...(preds ? { isTrap: preds.isTrap } : {}),
      /* floor_carry_fail's message (obj-pile.c:992-1011). Neither of these two
       * had a producer, so an item that broke on a throw, or vanished because
       * the floor had no room for it, disappeared in total silence - the player
       * was simply short an item with no line to explain it. object_desc's mode
       * is ODESC_BASE (:1002), the bare name. */
      onBreak: (obj: GameObject, broke: boolean): void => {
        const name = describeObject(state, obj, ODESC.BASE);
        const verb = broke
          ? obj.number > 1
            ? "break"
            : "breaks"
          : obj.number > 1
            ? "disappear"
            : "disappears";
        state.msg?.(`The ${name} ${verb}.`);
      },
      /* sound(MSG_DROP) (obj-pile.c:1150), the moment an object lands. */
      onDrop: (): void => {
        state.sound?.(MSG.DROP);
      },
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
    /* The teleport-family environment (game/effect-teleport.ts TeleportEnv).
     *
     * This used to be `preds ? {...seven fields} : undefined` - so a game
     * without the trap registry had NO teleport env at all, and nine of the
     * sixteen fields had no producer anywhere even when it did. Each of those
     * nine is a live upstream read whose subsystem has since been built, so the
     * "inert default" they fell back on was a silently missing feature: the
     * OF_NO_TELEPORT curse never blocked a teleport and its rune was never
     * learned, a teleport could land the player in lava, nexus resistance did
     * not foil a hostile teleport-level, and Dimension Door aborted every time.
     * Only the trap predicates are conditional now.
     *
     * The three player reads are GETTERS, not values: this object is built once
     * per game and every consumer holds the same reference, so a captured
     * boolean would freeze the answer at wiring time - before the player ever
     * picked up the cursed ring. */
    const teleport: TeleportEnv = {
      ...(preds
        ? {
            isPlayerTrap: preds.isPlayerTrap,
            isWarded: preds.isWarded,
            isWebbed: preds.isWebbed,
          }
        : {}),
      /* square_isdamaging (cave-square.c): fiery terrain. Nothing supplied it,
       * so has_teleport_destination_prereqs happily landed the player in lava. */
      isDamaging: (grid: Loc): boolean => state.chunk.isDamaging(grid),
      /* is_quest (player-quest.c L140): the real implementation behind the
       * force_descend / teleport-level guards (effect-general.ts,
       * effect-teleport.ts, effect-terrain.ts) - a quest level cannot be
       * skipped or recalled away from. */
      isQuest: (depth: number): boolean => isQuest(state.actor.player, depth),
      /* dungeon_get_next_level (player-util.c:1147). This seam existed but
       * nothing ever wired it, so every consumer silently degraded to a
       * bare `depth + dir` - no stair_skip, no max_depth clamp and, worst,
       * no quest scan. */
      getNextLevel: (from: number, dir: 1 | -1): number =>
        dungeonGetNextLevel(
          state.actor.player,
          from,
          dir,
          state.z,
          state.levelTopology,
        ),
      canTravelLevel: (from: number, dir: 1 | -1): boolean =>
        state.levelTopology?.canTravel(from, dir) ??
        (from + dir >= 0 && from + dir < state.z.maxDepth),
      changeLevel: (targetDepth: number): void => {
        state.targetDepth = targetDepth;
        state.generateLevel = true;
      },
      /* player_handle_post_move (player-util.c:1596-1636): the eval_trap half
       * at the landing grid, and then update_view(cave, p) - the LAST line of
       * the function (:1635).
       *
       * That second call is not cosmetic. no_light(p) is
       * `!square_isseen(cave, p->grid)` (cave-view.c:913), so until the view is
       * recomputed the player's OWN grid still reads as unseen at the grid they
       * just left, and player_can_read refuses with "You have no light to read
       * by." A walk does not show this because the turn loop recomputes the
       * view anyway; a phase door lands mid-turn, and the light did not catch
       * up until a tick passed. Reported from play, 2026-08-12. */
      onPlayerPostMove: (_byMonster: boolean): void => {
        state.onPlayerMoved?.(state, state.actor.grid);
        state.updateFov?.(state);
      },
      /* handle_stuff(player) after a monster teleports (PU_UPDATE_VIEW): the
       * monster's own visibility and lighting are monsterSwap's, but the
       * player's field of view is not, and a light-carrying monster arriving
       * next door has to change what the player can see. */
      onMonsterPostMove: (_midx: number): void => {
        state.updateFov?.(state);
      },
      /* player_of_has(OF_NO_TELEPORT) and its equip_learn_flag, the pair that
       * makes a Teleportation-forbidding curse do anything at all. */
      get hasNoTeleport(): boolean {
        return playerOfHas(state, OF.NO_TELEPORT);
      },
      onLearnNoTeleport: (): void => {
        equipLearnFlag(state.actor.player, state.runeEnv, OF.NO_TELEPORT);
      },
      /* player_resists(player, ELEM_NEXUS) (player-util.c): res_level > 0, off
       * the LIVE derived state, so a swapped-in resist ring counts. */
      get resistsNexus(): boolean {
        return (state.playerState?.elInfo[ELEM.NEXUS]?.resLevel ?? 0) > 0;
      },
      /* player->max_depth: EF_TELEPORT_LEVEL's force_descend target is the
       * deepest level REACHED, not the current one. Defaulting to the current
       * depth made "deep descent"-style descent one level, every time. */
      get maxPlayerDepth(): number {
        return state.actor.player.maxDepth;
      },
      /* z_info->max_depth, from the bound constants rather than the hardcoded
       * 128 the default assumed - a mod may ship a different dungeon bottom. */
      maxDepth: reg.constants.maxDepth,
      /* OPT(player, birth_force_descend) off the live option store. */
      get forceDescend(): boolean {
        return state.options?.get("birth_force_descend") ?? false;
      },
      /* get_aim_dir inside effect_handler_TELEPORT_TO (Dimension Door,
       * effect-handler-general.c:2770-2778). The port cannot block mid-turn, so
       * the shell asks first and rides the direction on the command; core does
       * the resolution because `start` is the player's grid and the offset
       * arithmetic belongs next to the handler, not in a front end. */
      getAimTarget: (): Loc | null => resolveEffectAim(state),
    };
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
      /* shape_name_to_idx (player-util.c L987) over lookup_player_shape (L971).
       * NOTE: upstream matches with streq (z-util.h:157 = strcmp), i.e. CASE
       * SENSITIVELY, unlike the my_stricmp used by stat_name_to_idx /
       * proj_name_to_idx. Core shape names ("Pukel-man") are cited with exact
       * case in class.txt so the two agree on stock data; this stays
       * case-insensitive because narrowing it would reject mod data the port has
       * always accepted, and the parity-visible behaviour is identical.
       * lookup_player_shape's msg("Could not find %s shape!") on failure is a
       * diagnostic the -1 return covers. */
      shapeNameToIdx: (name) =>
        players.shapes.findIndex(
          (s) => s.name.toLowerCase() === name.toLowerCase(),
        ),
      /* W2.3 vocabulary extension: resolve effect NAMES beyond the upstream EF
       * set so a mod can name its own effect codes in pack/effect text. Only
       * reached after effect_lookup fails (a non-core name), so core effect
       * text is byte-identical; a string EffectCode dispatches to itself via
       * the EffectRegistry (mods register string codes through the W2.2
       * ModRegistryHost.effects facade). Unknown names still return null ->
       * PARSE_ERROR_INVALID_EFFECT, exactly as before. */
      lookupEffect: (name) => (effects.isRegistered(name) ? name : null),
    };
    /* Published on the state so buildObjectEffectChain has these by default.
     * The chain is rebuilt from raw records on every USE and every INSPECT, and
     * a caller that omitted them could not resolve `SUMMON:ANY` - it threw
     * mid-turn. See GameState.effectInject. */
    state.effectInject = inject;
    /* The three projection handler tables (game/projection-handlers.ts), seeded
     * with core's 69. Built here, per game, for the same reason as the blow and
     * store registries: a module-level table would carry one character's mod
     * into the next character's game.
     *
     * Handed to the engine BY IDENTITY below - `worldEnv` and the playerHandlers
     * dep hold these very Maps. A mod's register() runs after this wiring, so a
     * snapshot would be a seam that ignored every mod. */
    const projectionHandlers = new ProjectionHandlerRegistry();
    state.projectionHandlers = projectionHandlers;
    /* The second character screen's combiner and renderer-backend tables
     * (game/ui-entry-registry.ts), seeded with core's nine and six. Per game for
     * the same reason as the projection tables above, and published rather than
     * passed because the two consumers - characterGrid and equipCmpSummary -
     * both already take the live GameState and read this field at the moment
     * they compute a row. */
    state.uiEntry = new UiEntryRegistry();
    // project_o / project_f world access; trapDeps joins it below once the
    // trap system is wired (the mutual reference is deliberate).
    const worldEnv: ProjectFeatEnv = {
      makeDeps,
      featHandlers: projectionHandlers.feat.table,
      objHandlers: projectionHandlers.obj.table,
    };
    /* The projection view reads the LIVE derived state, so worn resistance
     * gear reduces projection damage and equipment swaps take effect. */
    const playerActor = basicPlayerActor(state, {
      resistLevel: (t) => derived.elInfo[t]?.resLevel ?? 0,
      reduction: () => ({
        damRed: derived.damRed,
        percDamRed: derived.percDamRed,
      }),
      /* minus_ac (obj-gear.c L376-438 / project-player.c L69): a live acid hit
       * damages a random worn armour piece and halves the damage (gap 6.2/4.2).
       * Called by project_p only inside adjust_dam's PROJ_ACID branch, so the
       * armour-damage side effect and its RNG draws fire exactly as upstream. */
      minusAc: (): boolean =>
        applyMinusAc(state.actor.player, state.gear, state.rng, {
          msg: (text: string): void => state.msg?.(text),
          describe: (o): string => describeObject(state, o, ODESC.BASE),
          updateBonuses: (): void => state.updateBonuses?.(),
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
           * fire" - STACKED on the mon_msg[] queue, not emitted here, so one
           * breath over a pit produces "8 kobolds die." and the deaths come
           * last. noticeStuff drains it. The projection already gates on
           * visibility before calling this. */
          message: (m, msgCode, delay, damage): void => {
            /* add_monster_message_show_damage (mon-msg.c:288) when the driver
             * passed a damage total, else add_monster_message (L252). */
            if (damage === undefined) {
              addMonsterMessage(state, m, msgCode, delay);
            } else {
              addMonsterMessageShowDamage(state, m, msgCode, delay, damage);
            }
          },
          /* OPT(player, show_damage): project_m_player_attack's display_dam
           * (project-mon.c:1111) picks the *_show_damage message variants. */
          showDamage: state.options?.get("show_damage") ?? false,
          /* message_pain: the graded "shrugs off the attack" / "cries out in
           * pain" line for a monster hurt but not killed. */
          messagePain: (m, dam, showDamage): void => {
            if (showDamage) messagePainShowDamage(state, m, dam);
            else messagePain(state, m, dam);
          },
          /* mon_set_timed's queued status messages (slowed, confused, held),
           * add_monster_message(mon, m_note, true) at mon-timed.c:215 - the
           * delayed pass, so a status line follows the blow that caused it. */
          timedMessage: (m, note): void => {
            const code = monMessageCodeByName(note);
            if (code !== null) addMonsterMessage(state, m, code, true);
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
          /* poly_race + the delete/place swap (project-mon.c:45, :1225-1229).
           * Both halves are supplied, and separately, because upstream queues
           * MON_MSG_CHANGE between them - naming the old monster while it still
           * exists. Until this was wired the hook had NO supplier at all, so a
           * Wand of Polymorph rolled its saving throw, spent the charge and then
           * reported "maintains its shape" every single time.
           *
           * ambientPlaceDeps is declared later in this same function; the
           * forward reference is safe for the same reason state.monsterMultiply
           * (which uses it too) is - these arrows only run during play. Reusing
           * it rather than a private table also means the polymorphed monster
           * gets its held drops, as place_monster does for any origin != 0. */
          polyRace: (race): MonsterRace =>
            polyRace(state, race, state.chunk.depth, ambientPlaceDeps),
          replaceMonster: (m, race): Monster | null =>
            polymorphMonster(state, m, race, ambientPlaceDeps),
          /* multiply_monster, called UNCONDITIONALLY by
           * project_monster_handler_MON_CLONE (project-mon.c:888-902). The port
           * made it an optional hook and then never supplied it, so
           * `ctx.hooks.multiplyMonster?.(ctx.mon)` short-circuited to undefined
           * in every real game: a Wand of Clone Monster healed its target to
           * full and hasted it for 50 turns and NEVER CLONED IT, and MON_MSG
           * SPAWN could not be queued because the && never reached `ctx.seen`.
           *
           * This is the THIRD instance of the shape recorded four lines above
           * for polyRace/replaceMonster and once before that for
           * PlayerSideDeps.msg: an optional hook, a conditional spread at
           * game/project-monster.ts:203-205, and no supplier - which reads as
           * deliberate at every single site and is invisible to any test that
           * asserts the registry is wired rather than that the context is
           * whole. Found by ENUMERATING the context's fields (#259 row 7), not
           * by reading the handler.
           *
           * Same ambientPlaceDeps as polyRace/replaceMonster, safe for the
           * reason given there, and it is what gives the clone its drops. */
          multiplyMonster: (m): boolean =>
            multiplyMonster(state, m, ambientPlaceDeps),
          /* PROJ_AWAY_ALL teleports and PROJ_FORCE knockback for monsters. */
          teleport: (m, dist): void =>
            teleportMonster(state, m.midx, dist, teleport),
          /* update_mon(mon, cave, false) on a monster that SURVIVED the
           * projection (project-mon.c:1262). Unsupplied, so a monster that was
           * polymorphed, knocked back, woken or revealed by a spell kept its
           * pre-projection visibility until something else happened to move it.
           * updateMon has been ported since the FOV work; this hook was simply
           * never given a producer. */
          onUpdate: (mon): void => {
            updateMon(state, mon, false);
          },
          /* project-mon.c:183-185 / 208-212 + player thrust landing. */
          thrustAway: (centre, target, gridsAway): void =>
            thrustAway(state, centre, target, gridsAway, {
              onPlayerPostMove: (): void => {
                state.onPlayerMoved?.(state, state.actor.grid);
                /* update_view, as the teleport wiring above - thrust_away
                 * lands the player through the same player_handle_post_move. */
                state.updateFov?.(state);
              },
            }),
        },
        /* The per-PROJ player side effects (project-player.c handlers). */
        player: {
          /* OPT(player, show_damage): the extra "you take N damage" lines. */
          showDamage: state.options?.get("show_damage") ?? false,
          /* project_p's own messages ("You are hit by ...!") and disturb, plus
           * the full take_hit consequences. Without these a breath / spell that
           * damaged or killed the player was silent and never recorded the
           * killer (audit 01 P1 CRITICAL). */
          message: (text: string): void => state.msg?.(text),
          onDisturb: (): void => disturb(state),
          takeHit: sharedTakeHitHooks,
          onSideEffects: makePlayerSideEffects(state, {
            timed: players.timed,
            actor: playerActor,
            projections: reg.projections,
            expDeps,
            lifeDrainPercent: reg.constants.lifeDrainPercent,
            playerHandlers: projectionHandlers.player.table,
            /* project_p's OWN messages (project-player.c): "You resist the
             * effect!", "The intense heat saps you.", "Your eyes fill with
             * smoke!" - thirty-odd lines across the 21 arms, plus every timed
             * effect's onMessage, which makePlayerSideEffects gates on this
             * same optional.
             *
             * UNSUPPLIED UNTIL 2026-08-09, so all of them were dropped in the
             * live game and only the outer "You are hit by fire!" survived.
             * The seam was optional, every harness that exercised the arms
             * supplied it, and the one caller that matters did not - found by
             * a mod handler calling ctx.msg and getting silence
             * (session/projection-registry-wiring.test.ts). */
            msg: (text: string): void => state.msg?.(text),
            teleport,
          }),
          /* adjust_dam(actual=true) equip_learn_element (project-player.c
           * L60-62, audit 01 P5): being hit by an element teaches the resist
           * rune on worn gear. No RNG. */
          equipLearnElement: (resType: number): void =>
            equipLearnElement(state.actor.player, state.runeEnv, resType),
        },
      /* health_track (project.c:971-980): a player projection that affected
       * exactly one monster, without jumping, recalls and health-tracks it.
       *
       * This hook was DECLARED in world/project.ts, fired with the right gate,
       * and threaded through project-cast.ts - and no production caller ever
       * supplied it. Only two tests did, which is exactly why it read as live:
       * the call-site census counts references, so a hook referenced only by a
       * test is indistinguishable from a wired one. The visible symptom was that
       * no bolt or ball spell ever put a monster on the health bar.
       *
       * project.ts has already applied the one-monster / no-JUMP / player-source
       * gate and confirmed a monster is on the grid, so this must not re-check
       * them. The gate here is VISIBLE, not obvious - project.c uses
       * monster_is_visible. */
        onTrackMonster: (grid: Loc): void => {
          const mon = squareMonster(state, grid);
          if (mon && monsterIsVisible(mon)) state.healthWho = mon;
        },
        /* event_signal_bolt / event_signal_blast (project.c:724,915): the UI
         * seam for the traveling bolt/beam glyph and the blast's inside-out
         * flash. Declared in world/project.ts and threaded through
         * project-cast.ts since the beginning, and never supplied here - so
         * a host that installs a "bolt"/"explosion" listener (the web's
         * front end, a mod) never received one. `seen`/`playerSeesGrid` are
         * square_isview reads (panel_contains has no web equivalent, the
         * established "no panels on the web" reduction); `drawing` is always
         * false in 4.2.6 itself (project.c:595, never reassigned), so it is
         * hardcoded rather than threaded through as dead plumbing. */
        onBolt: (step, typ, beam): void => {
          state.events?.emit("bolt", {
            projType: typ,
            drawing: false,
            seen: squareIsView(state.chunk, step.to),
            beam,
            oy: step.from.y,
            ox: step.from.x,
            y: step.to.y,
            x: step.to.x,
          });
        },
        onBlast: (proj, typ): void => {
          const blind = (state.actor.player.timed[TMD.BLIND] ?? 0) > 0;
          const hide = (proj.flg & PROJECT.HIDE) !== 0;
          state.events?.emit("explosion", {
            projType: typ,
            numGrids: proj.grids.length,
            distanceToGrid: proj.distanceToGrid,
            drawing: false,
            playerSeesGrid: proj.grids.map(
              (g) => !blind && !hide && squareIsView(state.chunk, g),
            ),
            blastGrid: proj.grids,
            centre: proj.centre,
          });
        },
      },
    };
    /* player_inc_check resolvers (player-timed.c:945-953, gaps 2.8/6.11): read
     * the LIVE derived state so EF_TIMED_INC on the player is foiled by a worn
     * resist ("You resist the effect!") and the resisted LIGHT/SOUND messages
     * are gated. Absent, every increase was allowed. Same shape as
     * buildFailRuneEnv / makePlayerSideEffects. */
    const incQueries: PlayerIncCheckQueries = makeIncCheckQueries(state);
    /* player_inc_check's equip-learn side effects on the INTERPRETER path -
     * traps, potions, wands, player spells. Only mon-cast.ts supplied incHooks
     * before, so a trap you were immune to taught nothing, where upstream's
     * non-lore branch always calls equip_learn_flag / equip_learn_element
     * (player-timed.c:945, :967, :985). No monster is passed: these sources are
     * not cave->mon_current, so update_smart_learn and "You resist the effect!"
     * correctly stay silent. */
    const incHooks = makeIncCheckHooks(state);
    const envDeps: EffectEnvDeps = {
      timedTable: players.timed,
      // Effect status/damage messages ("You feel better", "You feel yourself
      // yanked upwards!") route to the game's message sink so a shell shows
      // them; absent, they would drop.
      onMessage: (text: string, msgt?: string): void => state.msg?.(text, msgt),
      incQueries,
      incHooks,
      /* player_set_timed's notify suppression: the obj_k reads that silence a
       * message duplicating known player state (player-timed.c:828-839). */
      notifyQueries: makeTimedNotifyQueries(state),
      /* on_begin_effect / on_end_effect (audit 01 T2): the interpreter timed
       * path (a SCRAMBLE / SPRINT potion or spell) must run the chain too, not
       * just the world clock. The thunk reads runTimedTransition (assigned just
       * below) at call time, so SCRAMBLE_STATS fires when the potion lands. */
      timedHooks: {
        onTransition: (idx: number, begin: boolean, canDisturb: boolean): void =>
          runTimedTransition?.(idx, begin, canDisturb),
      },
      /* The shared take_hit consequences, so effect-driven player damage (traps,
       * EF_DAMAGE, activations, monster casts via mon-cast) shows the message
       * chain and records died_from on death, exactly like melee/projection. */
      takeHitHooks: sharedTakeHitHooks,
    };

    /* on_begin_effect / on_end_effect chain runner (audit 01 T2): dispatch the
     * bound chain of the timed effect at `idx` through the live effect stack.
     * Upstream (player-timed.c:878-889) uses source_none() when can_disturb is
     * true and source_player() otherwise, so any TIMED_INC in the chain honors
     * disturbance. Runs SCRAMBLE's SCRAMBLE_STATS / UNSCRAMBLE_STATS and
     * SPRINT's ending TIMED_INC_NO_RES:SLOW; a no-op for effects with no chain. */
    runTimedTransition = (idx, begin, canDisturb): void => {
      const eff = players.timed[idx];
      const chain = begin ? eff?.onBeginEffect : eff?.onEndEffect;
      if (!chain) return;
      const origin = canDisturb ? sourceNone() : sourcePlayer();
      for (const step of chain) {
        /* The chain effects (SCRAMBLE_STATS etc.) read the full game env, so the
         * context must be attachGameEnv-wrapped exactly like the trap/obj-cmd
         * paths - a bare buildEffectContext leaves gameEnv() null and they no-op. */
        const ctx = attachGameEnv(buildEffectContext(state, envDeps), {
          state,
          cast,
          takeHitHooks: sharedTakeHitHooks,
          teleport,
          general,
          item,
          summon,
        });
        effects.effectSimple(step.effect, ctx, {
          origin,
          subtype: step.subtype,
          ...(step.dice !== undefined ? { diceString: step.dice } : {}),
        });
      }
    };

    /* The wizard/debug effect bundle (WP-14): identical to the object-command
     * and trap effect bundles - registry + the game-env pieces effect_simple
     * needs. The interactive debug commands (cure/detect/map/teleport/summon-
     * random/hit-los) run their effect_simple calls over exactly this stack. */
    wizardEffect = {
      registry: effects,
      cast,
      envDeps,
      inject,
      teleport,
      general,
      item,
      summon,
    };
    /* Fill the take_hit cheat-death holder so wizCheatDeath can clear timers
     * (W2-009; ui-display.c EVENT_CHEAT_DEATH). */
    wizardEffectHolder.current = wizardEffect;

    /* monster_change_shape / monster_revert_shape, driving the
     * MON_TMD_CHANGED timer (the SHAPECHANGE monster spell). */
    const monShape: MonShapeHooks = {
      change: (m) =>
        monsterChangeShape(state, m, {
          summon,
          spells: reg.monsters.spells,
          teleport,
        }),
      revert: (m) => monsterRevertShape(state, m),
    };

    /* spell_message {type}/{oftype} tags resolve the caster's lash projection
     * name to its lash_desc (mon-spell.c L47-274 tag substitution). */
    const projLashDesc = new Map<string, string | null>();
    for (const proj of reg.projections) projLashDesc.set(proj.name, proj.lashDesc);

    const monSpellDeps = {
      registry: effects,
      cast,
      spells: reg.monsters.spells,
      envDeps,
      saveSkill: pstate.skills[SKILL.SAVE] ?? 0,
      inject,
      teleport,
      general,
      summon,
      monShape,
      /* do_mon_spell UI/lore hooks (8.1/8.2/8.11): announce the cast
       * (spell_message, mon-spell.c L369), print the save message, and learn
       * the foil rune on a save (spell_check_for_fail_rune, L383). Without this
       * a monster's spells were silent. */
      hooks: buildMonSpellHooks(state, {
        lashDesc: (name: string): string | null => projLashDesc.get(name) ?? null,
        failRune: buildFailRuneEnv(state, players.timed),
      }),
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

    /* mon_take_nonplayer_hit deps (mon-util.c L1193, gaps 5.1/7.2): monster-vs-
     * monster and terrain (lava) damage route through the full non-player hit
     * path - die/pain messages, loot via monster_death, fear rolls. The
     * scheduler reads these for monster_take_terrain_damage; without them
     * terrain damage was inert. */
    installNonplayerHitDeps(state, deathDeps);

    /* does_resist lore (mon-timed.c L107-110, gap 8.6): when a monster resists a
     * timed effect via a race flag, learn that flag into visible lore. The
     * timed layer has no deps param (get_lore is a global upstream), so register
     * the session's lore store against its Rng. */
    installMonTimedLore(state.rng, state.lore);

    /* make_attack_normal's blow-effect environment (game/mon-side.ts): the
     * monster-melee analog of the player onSideEffects hook, so a melee blow
     * applies its full elemental / status / stat / theft / terrain
     * consequences in upstream RNG order. EF_EARTHQUAKE (SHATTER) routes
     * through the effect interpreter so its internal draws are shared. */
    /* The blow-effect handler table (combat/mon-melee.ts). Built here, per game,
     * and seeded with core's 30: a module-level singleton would carry one
     * character's mod-registered blow into the next character's game. */
    const blowEffects = new BlowEffectRegistry();
    registerCoreBlowEffects(blowEffects);
    state.blowEffects = blowEffects;

    /* Store behaviour (store/store.ts): what a shop will buy, and how many of a
     * thing it stocks. Per game for the same reason as the blow table. */
    const storeBehaviour = new StoreBehaviourRegistry();
    registerCoreStoreBehaviour(storeBehaviour);
    state.storeBehaviour = storeBehaviour;

    state.monBlowEnv = makeMonBlowEnv(state, {
      timed: players.timed,
      actor: playerActor,
      projections: reg.projections,
      expDeps,
      lifeDrainPercent: reg.constants.lifeDrainPercent,
      adjDexSafe: adj_dex_safe,
      packSize: reg.constants.packSize,
      makeDeps,
      teleport,
      earthquake: (mon, radius): void => {
        effects.effectSimple(EF.EARTHQUAKE, buildEffectContext(state, envDeps), {
          origin: sourceMonster(mon.midx),
          subtype: 0,
          radius,
        });
      },
      msg: (text: string, msgt?: string): void => state.msg?.(text, msgt),
    });

    const objCmdDeps: ObjCmdDeps = {
      constants: reg.constants,
      registry: effects,
      cast,
      envDeps,
      flavor,
      flavorDeps: flavorAwareDeps(state),
      /* get_autoinscription (obj-ignore.c L229): read the per-game per-kind
       * note registry so a note registered through the knowledge-menu manager
       * is applied by applyAutoinscription. */
      autoNote: (kind, aware): string | null =>
        state.autoinscribe?.get(kind.kidx, aware) ?? null,
      inject,
      teleport,
      general,
      item,
      summon,
      floorEnv,
      /* object_learn_on_use XP (obj-knowledge.c L1925-1936, gap 4.3): a first
       * identify-by-use rewards experience via the same ExpDeps hook as
       * spell/trap/chest use. */
      expGain,
      /* calc_inventory quiver inputs (gap 4.1a): the earlier_object ammo value
       * tiebreak (object_value, ammo is always aware), the preferred_quiver_slot
       * keyset (rogue_like_commands) and the character_dungeon re-arrange
       * message gate (true in live play). ammoTval falls back to the live
       * derived state.playerState.ammoTval inside calcInvOpts. */
      objectValue: (obj: GameObject): number =>
        computeObjectValue(reg.objects, obj, 1, true),
      rogueLike: state.options?.get("rogue_like_commands") ?? false,
      characterDungeon: true,
      // Route object/effect messages (msg / msgt / activation_message) to the
      // game's message sink so a shell shows them; absent, they would drop.
      env: { msg: (text: string): void => state.msg?.(text) },
    };
    installObjCommands(registry, objCmdDeps);

    /* apply_autoinscription / autoinscribe_ground + autoinscribe_pack as seams,
     * so the upstream call sites that have no ObjCmdDeps can reach them:
     * inven_carry (obj-gear.c:868), store selling (store.c:1977) and
     * update_player_object_knowledge's tail (obj-knowledge.c:1245-1247). */
    state.autoinscribeObject = (obj: GameObject): void => {
      applyAutoinscription(state, obj, objCmdDeps);
    };
    state.autoinscribeAll = (): void => {
      autoinscribeGround(state, objCmdDeps);
      autoinscribePack(state, objCmdDeps);
    };

    /* Player melee blow side effects (player-attack.c:669-1012, gap 2.5/3.6):
     * the OF_IMPACT earthquake (effect_simple(EF_EARTHQUAKE, source_player, 10)
     * L688) and the temporary brand/slay predicate (player_has_temporary_brand/
     * slay over the live timed array, obj-slays.c:287-317). Without these the
     * quake never fired and brand/slay potions gave no melee multiplier. The
     * brand/slay directives live in the player_timed pack records (untyped on
     * PlayerTimedRecordJson but present in the data), in TMD index order. */
    installMeleeSideEffects(state, {
      earthquake: (): void => {
        effects.effectSimple(EF.EARTHQUAKE, buildEffectContext(state, envDeps), {
          origin: sourcePlayer(),
          subtype: 0,
          radius: 10,
        });
      },
      /* The ONE bound instance (state.tempBrandSlay), not a private second copy.
       * This used to build its own, which is why nothing outside the melee path
       * could ask the question - PORT_TODO 3.20. */
      temp: state.tempBrandSlay,
    });

    // Player spellcasting (cast / study) for casting classes.
    installSpellCommands(registry, {
      effects: {
        registry: effects,
        cast,
        envDeps,
        inject,
        teleport,
        general,
        item,
        summon,
      },
      statInd: liveStatInd,
      env: {
        expGain,
        msg: (text: string): void => state.msg?.(text),
        // spell_chance fear + PF_UNLIGHT inputs (player-spell.c:417,424),
        // shared with the fail-chance DISPLAY path so the shown rate matches
        // the cast rate (see makeSpellChanceEnv).
        ...makeSpellChanceEnv(state),
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
    installRangedCommands(registry, floorEnv);

    // Traps: disarm + the step-onto-trap hook; a trapdoor drops a level.
    if (reg.traps) {
      trapDeps = {
        kinds: reg.traps,
        effects: {
          registry: effects,
          cast,
          envDeps,
          inject,
          teleport,
          general,
          item,
          summon,
        },
        env: {
          expGain,
          msg: (text: string): void => state.msg?.(text),
          /* player_of_has for trap saves / OF_TRAP_IMMUNE (trap.c:515-539). */
          playerHasFlag: (flag: number): boolean =>
            state.playerState?.flags.has(flag) ?? false,
          /* is_quest(player->depth) (trap.c:310-311): no trap doors on a quest
           * level - the guardian's floor must not open under the player. The
           * generation path already supplied this (gen/util.ts, from dun.quest);
           * the RUNTIME path did not, so every trap laid after generation - by
           * EF_TOUCH:MAKE_TRAP, by square_add_trap - drew from a table that
           * still contained the trapdoor on depths 99 and 100. Dropping a kind
           * also shifts pick_trap's cumulative total, so the omission moved the
           * whole draw, not just the trapdoor. */
          isQuest: (depth: number): boolean =>
            isQuest(state.actor.player, depth),
          changeLevel: (s: GameState): void => {
            /* trap.c:579-582: a TRF_DOWN trapdoor drops you through
             * dungeon_get_next_level, not blindly one level. */
            s.targetDepth = dungeonGetNextLevel(
              s.actor.player,
              s.chunk.depth,
              1,
              s.z,
              s.levelTopology,
            );
            if (s.targetDepth !== s.chunk.depth) s.generateLevel = true;
          },
          /* disturb(player) before trap effects (trap.c:525-526). */
          disturb: (): void => disturb(state),
        },
      };
      installTraps(state, registry, trapDeps);
      installChunkFeatHook(state);
      worldEnv.trapDeps = trapDeps;
      general.trapDeps = trapDeps;
    }

    // Curse periodic effects (DECISION E, do_curse_effect / decrease_timeouts):
    // once per game turn each equipped item's curse timeouts count down and fire
    // when they reach zero, running the curse's effect through the same bundle.
    state.curseTick = (): void => {
      processCurseTimeouts(state, {
        curses: reg.objects.curses,
        effects: {
          registry: effects,
          cast,
          envDeps,
          inject,
          teleport,
          general,
          item,
          summon,
        },
      });
    };

    // Chests (gap #49): reuse the exact effect bundle traps/objects use, so
    // chest_trap's dice draws (poison/paralysis/summon/explosion) share the
    // interpreter, RNG stream and summon wiring with every other effect
    // source, and floorEnv so a chest's loot lands under the same drop
    // rules as any other floor drop.
    chestDeps = {
      makeDeps,
      floorEnv,
      traps: reg.chestTraps,
      effects: {
        registry: effects,
        cast,
        envDeps,
        inject,
        teleport,
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
  const caveDeps: CaveCmdDeps = {
    makeDeps,
    ...(deps ? { trapDeps: deps } : {}),
    env: {
      // Route open/close/tunnel/chest messages to the game's message sink
      // (matching installObjCommands/installSpellCommands/installTraps);
      // absent, door/tunnel/chest messages would silently drop.
      msg: (text: string): void => state.msg?.(text),
      /* player_is_trapsafe (player-util.c:1073-1077) via trap.ts:86. */
      isTrapsafe: playerIsTrapsafe,
      digWithClause,
      /* get_check for do_cmd_go_down's force_descend quest warning
       * (cmd-cave.c:126). The shell has no synchronous prompt inside a turn,
       * so this takes the same default as the effect handlers' confirm seam:
       * an unprompted terminal auto-accepts. */
      confirm: (): boolean => true,
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
  };
  installCaveCommands(registry, caveDeps);

  // The walk-into-a-wall seam (mod/hooks.ts walkBlockedByDiggable). walkAction
  // consults this before its no-energy bump; movementAutoDig returns null having
  // drawn no RNG when no mod installed a hook, so faithful play is byte-identical.
  // null, not 0: zero is a mod handling the walk for free, which is a different
  // answer from no mod handling it at all.
  state.autoDigStep = (s, grid): number | null => movementAutoDig(s, grid, caveDeps);

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
    /* mon_create_drop at live placement (summons, breeders, ambient spawns,
     * wizard): build the held pile so monster_death spills it. makeDeps makes
     * the objects; lore feeds the unique theft reduction. */
    makeDeps,
    lore: state.lore,
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

  /* player_inc_check for the world clock's over-exertion / DoT timed increases
   * (audit 01 T1, player-timed.c:1056): the game-turn callers (world.ts inc with
   * check=true - fainting SCRAMBLE, over-cast CONFUSED/IMAGE) previously passed
   * hooks lacking incCheck, so timed.ts defaulted to ALLOW and PROT_CONF /
   * RES_CHAOS / RES_NEXUS were ignored on that path. Shares makeIncCheckQueries
   * with the effect-interpreter env, reading the live derived state. */
  const worldIncQueries = makeIncCheckQueries(state);
  state.world = {
    timedTable: players.timed,
    timedHooks: {
      onMessage: (text: string, msgt?: string): void => state.msg?.(text, msgt),
      onNotify: (_idx: number, canDisturb: boolean): void => {
        if (canDisturb) disturb(state);
      },
      /* player_set_timed's notify suppression on the WORLD CLOCK path too -
       * this is where a timed resist most often ticks down (player-timed.c:
       * 828-839). */
      notifyQueries: makeTimedNotifyQueries(state),
      incCheck: (idx: number): boolean => {
        const eff = players.timed[idx];
        return eff ? playerIncCheck(eff, worldIncQueries) : true;
      },
      /* on_begin_effect / on_end_effect dispatch (audit 01 T2): when a timed
       * effect starts or lapses on the world clock (e.g. SPRINT ends -> SLOW,
       * SCRAMBLE ends -> UNSCRAMBLE_STATS), run its bound chain. */
      onTransition: (idx: number, begin: boolean, canDisturb: boolean): void => {
        runTimedTransition?.(idx, begin, canDisturb);
      },
      /* print_custom_message weapon substitution (obj-util.c:1118, gap 2.9):
       * the {name}/{kind}/{s}/{is} tags in weapon-related timed messages (the
       * temporary-brand on-begin/on-end lines) resolve against the CURRENTLY
       * wielded weapon, so a getter keeps it live across wield/takeoff. name /
       * PORT_TODO 3.23: {name} and {kind} are DIFFERENT upstream functions, and
       * neither is the raw kind name this used to pass. {name} is
       * object_desc(ODESC_PREFIX | ODESC_BASE) - so it carries the article - and
       * {kind} is object_kind_name(kind, easy_know=true), which with easy_know
       * set is exactly obj_desc_name_format(kind->name, NULL, false). Passing
       * `w.kind.name` printed the raw `&` and `~` markers to the player.
       * No weapon => the obj == NULL tag forms. */
      get weapon(): TimedWeaponDesc {
        const w = state.actor.weapon;
        /* No weapon => the obj == NULL tag forms. A sentinel with name/kind
         * "hands" and number 2 reproduces substituteTimedMessage's obj == NULL
         * output byte-for-byte ({name}/{kind} -> "hands", {s} -> "", {is} ->
         * "are"), so exactOptionalPropertyTypes is satisfied without a getter
         * that returns undefined. */
        if (!w) return { name: "hands", kind: "hands", number: 2 };
        return {
          name: describeObject(state, w, ODESC.PREFIX | ODESC.BASE),
          kind: objDescNameFormat(w.kind.name, null, false),
          number: w.number,
        };
      },
    },
    /* The same shared consequences drive the world clock's DoT ticks, terrain
     * (lava) damage and over-exertion, so poison / a fatal wound / starvation
     * death records died_from and shows the full chain too. */
    takeHitHooks: sharedTakeHitHooks,
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
    /* player_take_terrain_damage's adjust_dam(PROJ_FIRE) needs the projection
     * table to scale lava damage by the player's fire resistance. */
    ...(reg.projections ? { projections: reg.projections } : {}),
  };

  /* Surface the wizard/debug engine bundles (WP-14): all four locals are in
   * scope here (makeDeps L731, expDeps L603, trapDeps hoisted, wizardEffect
   * assigned in the projections block, ambientPlaceDeps the live MonPlaceDeps).
   * Null bundles are omitted so WizardDeps' optional fields stay absent. */
  const wizardBundles: WizardBundle = {
    makeDeps,
    expDeps,
    monPlace: ambientPlaceDeps,
    ...(wizardEffect ? { effect: wizardEffect } : {}),
    ...(trapDeps ? { trapDeps } : {}),
  };

  /* Seed p->known_state now that runeEnv and the flavour store are live. */
  refreshKnownCombat(state.actor.player, {
    equipment: state.actor.player.equipment.map((h) =>
      h ? gearGet(state.gear, h) : null,
    ),
    timedEffects: players.timed,
    curses: reg.objects.curses,
    update: true,
    depth: state.chunk.depth,
    isDaytime: isDaytime(state.turn, state.z.dayLength),
  });

  return { registry, trapDeps, flavor, everseen, effects: effectRegistry, wizardBundles };
}

/** The parts of a generated level that populate a GameState. */
interface LevelContent {
  playerSpot: Loc | null;
  monsters: readonly { grid: Loc; mon: import("../mon/monster.js").Monster }[];
  objects: readonly { grid: Loc; obj: import("../obj/object.js").GameObject }[];
  trapGrids: readonly Loc[];
  /**
   * Kind+power chosen at generation (place_trap). Required for every trapGrid
   * when trapDeps is live; bare markers throw rather than re-draw (trap.c:356).
   */
  traps?: readonly { grid: Loc; tidx: number; power: number }[];
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

  /* Track the deepest level reached: on_new_level (game-world.c:1023-1024)
   * sets `max_depth = recall_depth = depth`, BOTH of them. recall_depth is the
   * anchor Word of Recall drops you back to, and this assignment is its only
   * producer on the ordinary walk down - EF_RECALL re-anchors it only when the
   * scroll is read in the dungeon. Setting max_depth alone left recall_depth at
   * 0 forever for a character who never read one below the town. */
  if (level.depth > state.actor.player.maxDepth) {
    state.actor.player.maxDepth = state.actor.player.recallDepth = level.depth;
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

  // Instantiate generation-marked traps on the live cave. Kind+power were
  // chosen at gen time (level.traps / place_trap); install without a second
  // pick/power draw (trap.c:356-394). Every C place_trap site must record a
  // GenTrap. Bare trapGrids markers are a gen bug - fail loudly rather than
  // re-drawing on the play stream or silently dropping them.
  if (trapDeps) {
    const descriptors = level.traps ?? [];
    const covered = new Set(
      descriptors.map((t) => t.grid.y * state.chunk.width + t.grid.x),
    );
    for (const grid of level.trapGrids) {
      const key = grid.y * state.chunk.width + grid.x;
      if (!covered.has(key)) {
        throw new Error(
          `populateFromLevel: bare trap marker at (${grid.x},${grid.y}) ` +
            `without kind+power; generation must call placeTrap with ` +
            `trapKinds so pick_trap + power are spent in the gen stream ` +
            `(trap.c:356-394)`,
        );
      }
    }
    for (const t of descriptors) {
      installTrap(state, t.grid, t.tidx, t.power, trapDeps);
    }
    for (const door of level.lockedDoors) {
      squareSetDoorLock(state, door.grid, door.power, trapDeps);
    }
  }
}

/** square_isarrivable (cave-square.c L613) on the live cave: no occupant, no
 * player trap / web, and a floor or stair (a legal player arrival square). */
function squareIsArrivable(state: GameState, grid: Loc): boolean {
  const c = state.chunk;
  if (c.mon(grid) !== 0) return false;
  if (squareIsPlayerTrap(state, grid)) return false;
  if (squareIsWebbed(state, grid)) return false;
  return c.isFloor(grid) || c.isStairs(grid);
}

/**
 * sanitize_player_loc (generate.c L1265): keep the player's grid if it is a
 * legal arrival square (in bounds, arrivable, not a vault); otherwise pick a
 * random empty non-vault square, then fall back to a full linear scan (keeping
 * a vault square only as a last resort). A faithful port including the RNG
 * draws - reached only on the birth_levels_persist restore path. Mutates
 * state.actor.grid in place, as upstream mutates p->grid.
 */
function sanitizePlayerLoc(state: GameState): void {
  const c = state.chunk;
  const preds = {
    isPlayerTrap: (g: Loc): boolean => squareIsPlayerTrap(state, g),
    isWebbed: (g: Loc): boolean => squareIsWebbed(state, g),
    isWarded: (g: Loc): boolean => squareIsWarded(state, g),
  };
  const isVault = (g: Loc): boolean => c.sqinfoHas(g, SQUARE.VAULT);

  /* Allow direct transfer if the retained grid is teleportable. */
  const grid = state.actor.grid;
  if (
    c.inBoundsFully(grid) &&
    squareIsArrivable(state, grid) &&
    !isVault(grid)
  ) {
    return;
  }

  /* A bunch of random locations. */
  for (let attempt = 1000; attempt > 0; attempt--) {
    const tx = state.rng.randint0(c.width - 1) + 1;
    const ty = state.rng.randint0(c.height - 1) + 1;
    const g = loc(tx, ty);
    if (squareIsEmptyLive(state, g, preds) && !isVault(g)) {
      state.actor.grid = g;
      return;
    }
  }

  /* Whelp, that didn't work: scan the whole dungeon linearly from a random
   * start, remembering the last empty vault square as a fallback. */
  const ix = state.rng.randint0(c.width - 1) + 1;
  const iy = state.rng.randint0(c.height - 1) + 1;
  let tx = ix + 1;
  let ty = iy;
  if (tx >= c.width - 1) {
    tx = 1;
    ty = ty + 1;
    if (ty >= c.height - 1) ty = 1;
  }
  let vx = 1;
  let vy = 1;
  for (;;) {
    const g = loc(tx, ty);
    if (squareIsEmptyLive(state, g, preds)) {
      if (!isVault(g)) {
        state.actor.grid = g;
        return;
      }
      /* A vault, but remember it just in case. */
      vy = ty;
      vx = tx;
    }
    /* Oops, tried every tile. */
    if (tx === ix && ty === iy) break;
    tx = tx + 1;
    if (tx >= c.width - 1) {
      tx = 1;
      ty = ty + 1;
      if (ty >= c.height - 1) ty = 1;
    }
  }

  /* Fallback vault location (or at least a non-crashy square). */
  state.actor.grid = loc(vx, vy);
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
  /* The level stashed when entering an arena lives on GameState
   * (state.arenaStash), not in this closure: leaving a level FOR an arena
   * persists it even without birth_levels_persist (generate.c L1349), and
   * upstream keeps that copy in the chunk_list, which the savefile carries. A
   * save taken mid-fight used to lose the level behind it and exit onto a
   * fresh one; now it exits where it went in.
   *
   * `inArena` stays a separate flag rather than "the stash exists", because a
   * save written before the stash was persisted restores with arena_level set
   * and no stash, and still has to be let out of the arena. */
  let inArena = opts.inArena ?? false;

  return (depth: number): void => {
    /* Consume the pending arrival-stair request (create_up_stair /
     * create_down_stair) exactly once, on every path - the equivalent of
     * player_place clearing the flags (player-util.c:1585-1586). Only a fresh
     * generation below acts on it; arena/recall/persist-restore paths clear it
     * without laying a stair, exactly as upstream leaves the flags unset. */
    const pendingStair = state.arrivalStair ?? null;
    delete state.arrivalStair;

    /* --- Arena entry: EF_SINGLE_COMBAT fired the change. --- */
    if (state.arenaLevel && !inArena) {
      const mon = state.healthWho;
      if (mon) {
        state.arenaStash = {
          chunk: state.chunk,
          monsters: state.monsters,
          groups: state.groups,
          floor: state.floor,
          traps: state.traps,
          known: state.known,
          decoy: state.decoy ?? null,
          monMidx: mon.midx,
          /* StoredLevel's other two fields. The freeze turn is stamped as
           * cave_store does; `join` is empty because an arena exit restores
           * the level wholesale and never re-aligns stairs against it. */
          turn: state.turn,
          join: [],
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
        installChunkFeatHook(state);
        state.monsters = [null];
        state.groups = [null];
        state.floor = new Map();
        state.traps = new Map();
        state.known = newKnownMap(6, 6);
        delete state.decoy;

        /* wiz_light(chunk, p, false) (generate.c:1109): every arena level is
         * lit on generation. Upstream runs it while `chunk` is not yet `cave`,
         * so square_memorize / square_know_pile / square_forget all short-
         * circuit on their `c != cave` guard and the call is a pure
         * SQUARE_GLOW pass - hence isCurrentCave = false here. Without it the
         * arena is unlit and the opponent invisible without a light source. */
        wizLightLevel(state, true, false, false);

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
        /* on_new_level (game-world.c:1034-1035): PN_COMBINE then notice_stuff,
         * one line BEFORE update_stuff, so the combine lands first. */
        noticeNewLevel(state);
        /* cmd_disable_repeat_floor_item (game-world.c:1068). Upstream's call is
         * in on_leave_level, which this port has no single equivalent of -
         * `generateLevel = true` is set at fourteen sites. It rides the ENTRY
         * path instead, which is observationally identical: the change is
         * synchronous, so the repeat key cannot be pressed between leaving and
         * arriving. The old level's pile is gone either way, so a remembered
         * args.floor index must not be re-dispatched. */
        cmdDisableRepeatFloorItem(state.actor.player);
        state.updateBonuses?.(); /* on_new_level PU_BONUS -> calc_light */
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
      const stash = state.arenaStash;
      delete state.arenaStash;
      if (stash) {
        /* Restore the level left behind (the player marker stayed). */
        state.chunk = stash.chunk;
        installChunkFeatHook(state);
        state.monsters = stash.monsters;
        state.groups = stash.groups;
        state.floor = stash.floor;
        state.traps = stash.traps;
        state.known = stash.known;
        if (stash.decoy) state.decoy = stash.decoy;
        /* A level restored after single combat is the same kind of revisit as
         * one recovered from birth_levels_persist.  Faithful core leaves every
         * field untouched; an opt-in mod can update transient per-level state
         * before the player and its monsters resume. */
        state.modHooks?.levelRevisited?.(state.chunk, stash.turn, state.turn);
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
        /* on_new_level (game-world.c:1034-1035): PN_COMBINE then notice_stuff,
         * one line BEFORE update_stuff, so the combine lands first. */
        noticeNewLevel(state);
        /* cmd_disable_repeat_floor_item (game-world.c:1068). Upstream's call is
         * in on_leave_level, which this port has no single equivalent of -
         * `generateLevel = true` is set at fourteen sites. It rides the ENTRY
         * path instead, which is observationally identical: the change is
         * synchronous, so the repeat key cannot be pressed between leaving and
         * arriving. The old level's pile is gone either way, so a remembered
         * args.floor index must not be re-dispatched. */
        cmdDisableRepeatFloorItem(state.actor.player);
        state.updateBonuses?.(); /* on_new_level PU_BONUS -> calc_light */
        state.updateFov?.(state);
        return;
      }
      /* The stash did not survive a save boundary: fall through to a
       * fresh level of the same depth (ledgered). */
      delete state.oldGrid;
    }

    /* dungeon_change_level: track the deepest level reached. The same
     * `max_depth = recall_depth = depth` pair as populateFromLevel, because the
     * port checks on both the request and the arrival where upstream checks
     * once in on_new_level - whichever fires first, the other is a no-op. */
    if (depth > state.actor.player.maxDepth) {
      state.actor.player.maxDepth = state.actor.player.recallDepth = depth;
    }

    /* birth_levels_persist (#30, off by default): when on, the level being
     * left is frozen into a depth-keyed cache and a previously-frozen target
     * level is restored instead of regenerated (prepare_next_level's persist
     * branch, generate.c L1347-1556). The whole branch is gated on the option,
     * so default play runs the original fresh-level path below unchanged. The
     * key is `depth` - the faithful identity for upstream's level NAME
     * (chunk_find_name of level_by_depth(depth)->name); see StoredLevel. */
    const persist = state.options?.get("birth_levels_persist") ?? false;
    const currentDepth = state.chunk.depth;

    /*
     * Non-persist town store (generate.c:1371-1373): leaving depth 0 always
     * keeps a terrain-only Town chunk so town_gen can reload the same layout
     * (shops, stairs, ruins) without birth_levels_persist.
     */
    if (!persist && currentDepth === 0) {
      state.townChunk = chunkWriteTerrain(state.chunk);
    }

    /* wipe_mon_list: the old level's monsters forget their racial counts
     * before the new level allocates against them. Under persist the old level
     * (and its monsters) survives in the cache with its counts intact, exactly
     * as the persist branch skips cave_clear/wipe_mon_list. */
    if (!persist) {
      wipeMonsterCounts(state);
    }
    /* Forget the target and the tracked monster (game-world.c L1010),
     * and release any commanded monster (L1065). */
    targetSetMonster(state, null);
    state.healthWho = null;
    state.actor.player.timed[TMD.COMMAND] = 0;

    if (persist) {
      const cache = (state.levelCache ??= new Map());

      /* Freeze the level being left (cave_store, generate.c L1366).
       * compact_monsters(cave, 0) is the RNG-free "too many holes" pass; the
       * player marker is cleared (L1362, non-arena - arena freezing keeps it
       * and is handled by the arena stash above); the freeze turn is stamped on
       * the chunk (cave_store L1032) for restore_monsters. Persistent levels
       * keep their artifacts, so the non-persist artifact-loss loop below is
       * skipped on this path. */
      compactMonsters(state, 0);
      state.chunk.setMon(state.actor.grid, 0);
      state.chunk.turn = state.turn;
      /* chunk_list_add (gen-chunk.c L69) is this Map insert: the C appends the
       * stored chunk to a realloc'd chunk_list[] keyed by chunk->name (which is
       * level_by_depth(depth)->name), so a depth-keyed Map is the same lookup
       * without the name indirection or the manual growth. */
      cache.set(currentDepth, {
        chunk: state.chunk,
        monsters: state.monsters,
        groups: state.groups,
        floor: state.floor,
        traps: state.traps,
        known: state.known,
        decoy: state.decoy ?? null,
        turn: state.turn,
        /* chunk->join (generate.c L1203-1214): freeze the level's stair
         * connectors so a later first-visit neighbour can align its stairs. */
        join: state.currentJoins ?? [],
      });

      /* Enter a previously-frozen target level: assign it back and let its
       * monsters recover over the elapsed turns (prepare_next_level
       * L1414-1506). chunk_find_name is the depth lookup here. */
      const stored = cache.get(depth);
      if (stored) {
        cache.delete(depth); // chunk_list_remove (L1505)
        state.chunk = stored.chunk;
        installChunkFeatHook(state);
        state.monsters = stored.monsters;
        state.groups = stored.groups;
        state.floor = stored.floor;
        state.traps = stored.traps;
        state.known = stored.known;
        state.decoy = stored.decoy;
        /* Restore the level's stair connectors so a subsequent departure
         * re-freezes them and adjacent first-visits keep aligning. */
        state.currentJoins = stored.join;

        /* restore_monsters (mon-move.c L2007): HP regen + timed reduction over
         * the turns the level was frozen (turn - chunk->freeze-turn). */
        restoreMonsters(state, state.turn - stored.turn);

        /* A restored persistent level is live again.  Core deliberately does
         * nothing here, matching 4.2.6; a mod may observe the exact freeze and
         * resume turns to update level-owned transient state before any monster
         * can receive a turn. */
        state.modHooks?.levelRevisited?.(state.chunk, stored.turn, state.turn);

        /* Place the player (prepare_next_level non-arena, L1497-1501): sanitize
         * the retained grid into a legal arrival square, then player_place.
         * DEFERRAL: exact stair-connector matching (dun->persist / one_off_*
         * join connectors, generate.c L1147-1152) is applied by upstream only
         * when GENERATING a persistent level, not when restoring one - a
         * restored level uses this same sanitize+place, so the round-trip is
         * faithful. The connector wiring for FIRST-visit generation stays
         * dormant (cave.ts): a first visit arrives at the fresh level's normal
         * playerSpot, which is a valid stair/empty grid. Level identity on
         * re-entry is exact; only the first-visit arrival stair is approximate. */
        sanitizePlayerLoc(state);
        placePlayer(state, state.actor.grid);
        installChunkFeatHook(state);

        refreshTownStores(state, reg);
        delete state.targetDepth;
        /* on_new_level (game-world.c:1034-1035): PN_COMBINE then notice_stuff,
         * one line BEFORE update_stuff, so the combine lands first. */
        noticeNewLevel(state);
        /* cmd_disable_repeat_floor_item (game-world.c:1068). Upstream's call is
         * in on_leave_level, which this port has no single equivalent of -
         * `generateLevel = true` is set at fourteen sites. It rides the ENTRY
         * path instead, which is observationally identical: the change is
         * synchronous, so the repeat key cannot be pressed between leaving and
         * arriving. The old level's pile is gone either way, so a remembered
         * args.floor index must not be re-dispatched. */
        cmdDisableRepeatFloorItem(state.actor.player);
        state.updateBonuses?.(); /* on_new_level PU_BONUS -> calc_light */
        /* only_partial during level-entry FOV (ui-display.c:2522 / cave-view.c:851). */
        state.chunk.onlyPartial = true;
        state.updateFov?.(state);
        /* on_new_level's own disturb (game-world.c:1016-1017), immediately before
         * the feeling and the search: arriving on a level cancels whatever was
         * still queued from the level you left. */
        disturb(state);
        announceFeeling(state, reg);
        search(state); /* on_new_level (game-world.c:1052). */
        state.chunk.onlyPartial = false;
        return;
      }
      /* First visit to this depth: fall through to fresh generation. The old
       * level is already frozen; counts were not wiped and artifacts are not
       * lost (both skipped above / below under persist). */
    }

    /* Consume stored town layout for non-persist re-entry (town_gen L2682). */
    const townLayout =
      !persist && depth === 0 && state.townChunk ? state.townChunk : null;
    if (townLayout) state.townChunk = null;

    /* birth_levels_persist first-visit generation (generate.c L1147-1152): seed
     * this fresh level's stair connectors from the frozen adjacent levels so
     * up/down stairs line up, and mark the build persistent so dun.persist
     * branches run. Off by default: persist is false, joinInfo stays undefined,
     * and generateLevel builds exactly as before. */
    const persistCache = state.levelCache;
    let joinInfo: ReturnType<typeof getJoinInfo> | undefined;
    let minSize: { height: number; width: number } | undefined;
    if (persist && persistCache) {
      const aboveDepth = reg.topology.nextDepth(depth, -1);
      const belowDepth = reg.topology.nextDepth(depth, 1);
      const twoAboveDepth = reg.topology.nextDepth(aboveDepth, -1);
      const twoBelowDepth = reg.topology.nextDepth(belowDepth, 1);
      const above =
        aboveDepth === depth ? undefined : persistCache.get(aboveDepth)?.join;
      const twoAbove =
        twoAboveDepth === aboveDepth ? undefined : persistCache.get(twoAboveDepth)?.join;
      const below =
        belowDepth === depth ? undefined : persistCache.get(belowDepth)?.join;
      const twoBelow =
        twoBelowDepth === belowDepth ? undefined : persistCache.get(twoBelowDepth)?.join;
      joinInfo = getJoinInfo({
        ...(above ? { above } : {}),
        ...(twoAbove ? { twoAbove } : {}),
        ...(below ? { below } : {}),
        ...(twoBelow ? { twoBelow } : {}),
      });
      /* get_min_level_size (prepare_next_level L1531-1546): the new level must
       * be big enough to hold the stairs its frozen neighbours already expect,
       * or build_staircase_rooms has nowhere to put them and quits. Only the
       * IMMEDIATE neighbours are measured - a one-off connector two levels away
       * seeds dun.one_off_* (an avoid list), never a staircase room, so it
       * imposes no minimum. Starts at 0/0 exactly as the C's locals do. */
      minSize = getMinLevelSize(below ?? [], false, getMinLevelSize(above ?? [], true));
    }

    /* choose_profile's NOSCORE_JUMPING request (generate.c L824-836): consumed
     * once, cleared as it is passed on, exactly as the C clears the bit. */
    const jumpProfileName = state.jumpProfileName;
    state.jumpProfileName = undefined;

    const g = generateLevel(
      state.rng,
      depth,
      {
        ...genDeps(
          reg,
          true,
          /* The player-dependent make_object / make_gold foils. These were
           * supplied to both STORE paths and to nothing else, so during level
           * generation - the path they exist for - every book was browsable, no
           * curse was ever foiled, and generated gold skipped the no-selling
           * inflation. Two of the three are RNG draws, so the generation stream
           * itself was off upstream's. */
          genFoilFields(state),
          state.artifacts,
          state.options?.get("birth_no_artifacts") ?? false,
          /* mon_create_drop's unique theft reduction reads the live lore store. */
          state.lore,
        ),
        /* The mod behaviour seam, read at build time (this call is synchronous,
         * so a Fixes & tweaks toggle applies from the next level onward).
         * `levelGenerated` is the only hook cave_generate consults; absent =>
         * faithful. */
        ...(state.modHooks ? { hooks: state.modHooks } : {}),
        /* new_player_spot's placement failure (gen-util.c:422): always audible. */
        msg: (text: string): void => state.msg?.(text),
        /* cheat_room's restart narration (generate.c:1164, :1222): only when
         * the cheat option is on, which is what gates it upstream. */
        ...((state.options?.get("cheat_room") ?? false)
          ? { cheatMsg: (text: string): void => state.msg?.(text) }
          : {}),
      },
      /* is_daytime() only affects the town (depth 0) build; passed always so a
       * RECALL back to town honours the day/night clock. */
      {
        daytime: isDaytime(state.turn, state.z.dayLength),
        birthLoseArts: state.options?.get("birth_lose_arts") ?? false,
        questSpawns: questSpawnsForDepth(state, reg, depth),
        persist,
        ...(joinInfo ? { joinInfo } : {}),
        /* chunk_find_adjacent (gen-chunk.c:147): whether the neighbour levels
         * already exist in the frozen-level cache, so handle_level_stairs skips
         * the alloc_stairs for a direction the neighbour already seeded. Passed
         * unconditionally; only read under persist. */
        hasAdjacentAbove:
          reg.topology.canTravel(depth, -1) &&
          (persistCache?.has(reg.topology.nextDepth(depth, -1)) ?? false),
        hasAdjacentBelow:
          reg.topology.canTravel(depth, 1) &&
          (persistCache?.has(reg.topology.nextDepth(depth, 1)) ?? false),
        /* get_min_level_size's answer (prepare_next_level L1531-1546), the
         * only producer these two builder inputs have. Omitted entirely when
         * not persisting, so generateLevel keeps its own defaults. */
        ...(minSize ? { minHeight: minSize.height, minWidth: minSize.width } : {}),
        /* birth_connect_stairs (gen-util.c:427-433): lay the arrival stair the
         * stair command requested ("up" after a descent, "down" after an
         * ascent), unless the option is off. Recall/first-spawn leave
         * pendingStair null, so no arrival stair is laid. */
        ...(pendingStair &&
        (state.options?.get("birth_connect_stairs") ?? true)
          ? { createStair: pendingStair }
          : {}),
        ...(townLayout ? { townLayout } : {}),
        ...(jumpProfileName ? { profileName: jumpProfileName } : {}),
      },
    );
    g.c.name = reg.topology.nameAtDepth(depth);
    /* chunk->join (generate.c L1203-1214): remember this level's stair
     * connectors for freezing and adjacent-level alignment. Gated on persist so
     * that with birth_levels_persist off the field stays unset and the savefile
     * is byte-identical to today (no currentJoins key emitted). */
    if (persist) state.currentJoins = g.joins;
    state.chunk = g.c;
    state.monsters = [null];
    state.groups = [null];
    /* Artifacts left on the abandoned level are lost (generate.c L1383-1394):
     * a known one (or any, under birth_lose_arts) is logged as missed. The
     * created-mark reset that lets an unknown one regenerate rides artifact
     * upkeep (#24). Runs before the floor is cleared below. This is the
     * NON-persist branch only: a frozen persistent level keeps its artifacts. */
    if (!persist) {
      const loseArts = state.options?.get("birth_lose_arts") ?? false;
      for (const pile of state.floor.values()) {
        for (const obj of pile) {
          if (
            obj.artifact &&
            (loseArts || (obj.notice & OBJ_NOTICE.ASSESSED) !== 0)
          ) {
            state.onArtifactLost?.(obj.artifact);
          }
        }
      }
    }
    state.floor = new Map();
    state.traps = new Map();
    state.known = newKnownMap(g.c.width, g.c.height);
    installChunkFeatHook(state);
    populateFromLevel(
      state,
      {
        playerSpot: g.playerSpot,
        monsters: g.monsters,
        objects: g.objects,
        trapGrids: [...g.trapGrids].map((i) => iToGrid(i, g.c.width)),
        traps: g.traps,
        lockedDoors: g.lockedDoors,
        depth,
      },
      trapDeps,
    );
    refreshTownStores(state, reg);
    /* town_gen -> cave_illuminate (gen-cave.c / cave-map.c L555): the town is
     * illuminated at generation. The chunk-flag half already ran in the town
     * builder (gen/cave.ts caveIlluminate); this applies the player-KNOWLEDGE
     * half against the freshly built known map so a daytime town is fully
     * memorized (visible from anywhere on entry, exactly like the C town) and a
     * night town forgets its boring floors. Town only (depth 0); dungeon levels
     * start dark. Runs on both birth and recall-to-town. */
    if (depth === 0) {
      caveKnown(state);
      caveIlluminateKnown(state, isDaytime(state.turn, state.z.dayLength));
    }
    /* cave_generate (generate.c:1255-1258): a builder that asked for the level
     * to be revealed (labyrinth_gen's "known" maze, gen-cave.c:1594) gets
     * `wiz_light(chunk, p, false)` and the flag is cleared. `chunk` is not yet
     * `cave` there, so square_memorize / square_know_pile / square_forget all
     * short-circuit on their `c != cave` guard and the call perma-LIGHTS the
     * level without memorizing anything - hence isCurrentCave = false. */
    if (g.lightLevel) {
      wizLightLevel(state, true, false, false);
      g.lightLevel = false;
    }
    delete state.targetDepth;
    /* on_new_level (game-world.c:1034-1035): PN_COMBINE then notice_stuff, one
     * line BEFORE update_stuff, so the combine lands first. */
    noticeNewLevel(state);
    /* cmd_disable_repeat_floor_item (game-world.c:1068); see the note at the
     * other level-entry sites for why it rides entry rather than leave. */
    cmdDisableRepeatFloorItem(state.actor.player);
    /* on_new_level (game-world.c:1034-1037): PU_BONUS -> update_bonuses ->
     * calc_light recomputes cur_light for the NEW depth, then the view is
     * flooded. Without this the daytime-town cur_light (0) leaks into the
     * dungeon, so the torch radius is -1 and arrival renders dark until the
     * next bonus recompute. Run the bonus pass before the first view build. */
    state.updateBonuses?.();
    /* only_partial during level-entry FOV (ui-display.c:2522 / cave-view.c:851). */
    state.chunk.onlyPartial = true;
    state.updateFov?.(state);
    /* on_new_level's own disturb (game-world.c:1016-1017), immediately before
     * the feeling and the search: arriving on a level cancels whatever was
     * still queued from the level you left. */
    disturb(state);
    announceFeeling(state, reg);
    search(state); /* on_new_level (game-world.c:1052). */
    state.chunk.onlyPartial = false;
  };
}

/**
 * What a caller may pin about the character a reincarnation rolls. Every field is
 * optional, and every omission means "roll it", which is upstream's own default:
 * `borg_cfg[BORG_RESPAWN_RACE]` and `[BORG_RESPAWN_CLASS]` are -1 unless a config
 * file sets them, and -1 means `player_id2race(randint0(MAX_RACES))`.
 */
export interface ReincarnateOptions {
  /** A race by name. Absent, or a name no pack defines, rolls one. */
  raceName?: string;
  /** A class by name. Absent, or a name no pack defines, rolls one. */
  className?: string;
  /**
   * Cheat bits to OR onto the new character (game/wizard.ts NOSCORE). The mark is
   * one-way - markNoscore never clears a bit and nothing else writes the field -
   * so a character that came out of this loop stays marked for the rest of its
   * life and across every save. Upstream's tail is the same line:
   * `if (!(player->noscore & NOSCORE_BORG)) player->noscore |= NOSCORE_BORG`.
   */
  noscore?: number;
  /** The new character's `full_name`. Absent leaves the blank birth value. */
  fullName?: string;
}

/** Which character a reincarnation rolled. */
export interface ReincarnateResult {
  raceName: string;
  className: string;
}

/**
 * reincarnate_borg (borg/borg-reincarnate.c:408): wipe the live player in place,
 * roll a new one, and carry on in the SAME session.
 *
 * WHAT MAKES THIS DIFFERENT FROM A NEW GAME. Upstream never exits to a menu and
 * never opens a second savefile. It saves the level off, calls `player_init` and
 * `player_generate` on the same `struct player *`, restores the level, and returns
 * to the game loop. Everything a session owns - the turn counter, the RNG stream,
 * the message log, the option store, the mod manifest, the save slot - is still
 * the same object afterwards. This does the same thing for the same reason: a host
 * that reloaded the page or claimed a new slot would be a different program that
 * happens to end up somewhere similar.
 *
 * THE PLAYER OBJECT IS MUTATED, NOT REPLACED, and that is load-bearing rather than
 * incidental. wireGame's closures captured `state`, and a good number of them
 * captured `state.actor.player` - the same reason a level change swaps the chunk in
 * place. Upstream reuses the pointer for the identical reason.
 *
 * WHERE THE NEW CHARACTER COMES FROM. `generatePlayer` and `outfitPlayer`, the
 * same two functions `startGame` births from. Upstream's `borg_roll_hp` and
 * `borg_outfit_player` are near-copies of `roll_hp` and `player_outfit` that exist
 * because the borg cannot run the interactive birth UI; this port's birth pipeline
 * is not interactive, so the real one is reachable and the copies are not needed.
 * The one upstream detail with no equivalent here is `create_random_name`'s
 * per-race syllable tables - this port has `playerRandomName`, so a caller passes
 * `fullName` from that rather than a second name generator landing in core.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Upstream re-seeds `seed_flavor` and, under
 * `birth_randarts`, `seed_randart`. Both are seeds this port's savefile stores and
 * re-derives the world from (docs/PARITY.md names them as the two places a stream
 * change IS a defect), so moving either mid-session would make the save describe a
 * world the game is not in. The flavour KNOWLEDGE is reset instead, which is the
 * half a player can observe: the new character does not inherit what the dead one
 * identified.
 */
function makeReincarnate(
  state: GameState,
  reg: CoreRegistries,
  players: PlayerRegistry,
  flavor: FlavorKnowledge,
  everseen: EverseenKnowledge,
  changeLevel: (depth: number) => void,
): (opts?: ReincarnateOptions) => ReincarnateResult {
  return (opts: ReincarnateOptions = {}): ReincarnateResult => {
    const rng = state.rng;

    /* "save the existing dungeon. It is cleared later but needs to be blank when
     * creating the new player" (borg-reincarnate.c:414-418). Nothing below clears
     * it here - the wipe is confined to the player and their gear - so the restore
     * at the end is a no-op in the ordinary case. It is still written both ways,
     * because the pair is what says the level is not this function's to touch. */
    const savedChunk = state.chunk;
    const savedMonsters = state.monsters;
    const savedGroups = state.groups;
    const savedFloor = state.floor;
    const savedTraps = state.traps;
    const savedKnown = state.known;
    const savedGrid = state.actor.grid;

    /* Roll up a new character (borg-reincarnate.c:465-476). A named race or class
     * that no pack defines falls through to the roll rather than throwing: the
     * caller is a mod's configuration, and a typo there should cost a reroll. */
    const race =
      (opts.raceName ? players.raceByName(opts.raceName) : null) ??
      players.races[rng.randint0(players.races.length)]!;
    const cls =
      (opts.className ? players.classByName(opts.className) : null) ??
      players.classes[rng.randint0(players.classes.length)]!;
    const body = players.bodies[race.body] ?? players.bodies[0]!;

    const birth = generatePlayer(
      race,
      cls,
      { body, historyChart: players.historyChart(race) },
      rng,
    );

    /* player_init(player) then player_generate(player, race, class, false)
     * (borg-reincarnate.c:435, :476), on the same object. Every own key goes and
     * the fresh character's keys land, so a field added to Player later is carried
     * across without this function being edited - the alternative, a field-by-field
     * copy, is a list that silently stops being complete. */
    const live = state.actor.player as unknown as Record<string, unknown>;
    for (const key of Object.keys(live)) delete live[key];
    Object.assign(live, birth.player);
    const p = state.actor.player;

    /* player_quests_reset (player-quest.c:157), as at birth. */
    playerQuestsReset(p, reg.quests);

    /* The dead character's belongings do not come forward. Emptied IN PLACE for
     * the same reason the player object is: `state.gear` is captured. */
    state.gear.store.clear();
    state.gear.next = 1;
    state.gear.pack.length = 0;
    state.gear.inven = [];
    state.gear.quiver = [];

    /* Nor does what they identified. Upstream reaches this through flavor_init's
     * reshuffle; see the header for why the seed itself is left alone. */
    flavor.restore({ aware: [], tried: [] });

    /* borg_outfit_player (borg-reincarnate.c:521) is player_outfit. */
    const startKinds: ObjectKind[] = [];
    outfitPlayer(state.gear, p, reg.objects, rng, reg.constants, {
      opt: (name: string): boolean => state.options?.get(name) ?? false,
      onStartKind: (kind): void => void startKinds.push(kind),
    });
    /* The same three passes over the new kit startGame runs after birth:
     * kind->everseen (player-birth.c:658), object_flavor_aware (:650) and
     * obj->known->effect (:650). */
    for (const obj of state.gear.store.values()) everseen.markKind(obj.kind);
    for (const kind of startKinds) {
      flavor.objectFlavorAware(kind, NOOP_FLAVOR_AWARE_DEPS);
    }
    for (const obj of state.gear.store.values()) obj.knownEffect = obj.effect;

    /* player_spells_init (borg-reincarnate.c:518), then the derived recompute -
     * PU_BONUS | PU_HP | PU_MANA - which is what turns the rolled hitdice into
     * mhp and the worn armour into the mana penalty. calcSpells wants the stat
     * indices that recompute produces, so it follows rather than leads. */
    playerSpellsInit(p);
    state.updateBonuses?.();
    calcSpells(p, state.statInd ?? [], (text) => state.msg?.(text));
    /* rd_gear's tail / the first update_stuff after player_outfit. The ammo tval
     * is the NEW class's, so it is read back off the recompute above. */
    buildGearViews(state, reg, state.playerState?.ammoTval ?? 0);

    /* player_learn_innate (borg-reincarnate.c:515) and the worn kit's obvious
     * runes, exactly as startGame does them after the rune env exists. */
    playerLearnInnate(p, state.runeEnv);
    for (let i = 0; i < p.body.count; i++) {
      const worn = state.runeEnv.slotObject(i);
      if (worn) objectLearnOnWield(p, worn, state.runeEnv);
    }

    /* "fully healed and rested" (borg-reincarnate.c:569-571). */
    p.chp = p.mhp;
    p.csp = p.msp;

    /* Mark the savefile (borg-reincarnate.c:587-589). One-way. */
    if (opts.noscore) p.noscore = markNoscore(p.noscore, opts.noscore);
    if (opts.fullName !== undefined) p.fullName = opts.fullName;

    /* The new player is now ready (borg-reincarnate.c:585). Cheating death is
     * upstream's other branch and not this one, so any suspended fatal blow is
     * dropped with the character that took it. */
    state.isDead = false;
    state.playing = true;
    state.pendingDeath = undefined;

    /* Restore the level (borg-reincarnate.c:579-582). */
    state.chunk = savedChunk;
    state.monsters = savedMonsters;
    state.groups = savedGroups;
    state.floor = savedFloor;
    state.traps = savedTraps;
    state.known = savedKnown;
    state.actor.grid = savedGrid;
    installChunkFeatHook(state);

    /* store_reset() and chunk_list_max = 0 (borg-reincarnate.c:534-535): the new
     * character does not inherit the dead one's shopping, its home stash, or any
     * frozen level. Dropping `stores` is what makes refreshTownStores rebuild them
     * from scratch on arrival rather than age the old ones forward. */
    delete state.stores;
    state.daycount = 0;
    state.levelCache?.clear();
    state.townChunk = null;

    /* "Start in town" plus generate_level = true (borg-reincarnate.c:483, :524).
     * Upstream's restored cave survives only until run_game_loop's next pass calls
     * prepare_next_level at the new depth of 0; changeLevel IS that call, so it is
     * made here and the flag is left down rather than handed to the host as a
     * second thing to remember. */
    changeLevel(0);
    state.generateLevel = false;
    delete state.targetDepth;

    return { raceName: race.name, className: cls.name };
  };
}

/**
 * Resolve the quest guardians to place on a freshly generated level
 * (generate.c L1170-1191). Returns one QuestSpawn per active quest whose
 * level == depth, mapping the stored race index to its MonsterRace. A
 * completed quest has level 0 (never a dungeon depth), so it is naturally
 * excluded. The unique-already-alive (cur_num > 0) skip is applied inside
 * generateLevel, matching upstream's placement-time check.
 */
function questSpawnsForDepth(
  state: GameState,
  reg: CoreRegistries,
  depth: number,
): QuestSpawn[] {
  if (depth <= 0) return [];
  const quests = state.actor.player.quests;
  if (!quests || quests.length === 0) return [];
  const spawns: QuestSpawn[] = [];
  for (const q of quests) {
    if (q.level !== depth) continue;
    const race = reg.monsters.races[q.race];
    if (!race) continue;
    spawns.push({ race, maxNum: q.maxNum });
  }
  return spawns;
}

/**
 * on_new_level's level-feeling announcement (game-world.c:1047-1049):
 *
 *     if (player->depth)
 *             display_feeling(false);
 *
 * The whole feeling system was ported - both message tables verbatim, the
 * obj/mon rating arithmetic, place_feeling's scatter, feeling_squares, the
 * birth_feelings gate, the LF: status row - and displayFeeling had exactly ONE
 * caller in the repo: the ^F command. Nothing announced it on arrival, so a
 * player who never pressed ^F never saw a feeling message in the whole game.
 * That is the shape a call-site census is built to catch: the function exists and
 * is correct, and no live path reaches it.
 *
 * The depth guard is the CALLER's upstream, not displayFeeling's own - the town
 * line ("Looks like a typical town.") is reachable only through ^F, so guarding
 * here rather than inside is what keeps the town silent on every arrival.
 *
 * Deliberately NOT called from the two arena paths, which mirror upstream's
 * `arena_level` early return at game-world.c:1044-1046.
 */
function announceFeeling(state: GameState, reg: CoreRegistries): void {
  if (!state.chunk.depth) return;
  displayFeeling(state, { feelingNeed: reg.constants.feelingNeed });
}

/**
 * store_init / store_reset / store_update lifecycle (store.c). The stores
 * (including FEAT_HOME) are PERSISTENT global state, created once and kept alive
 * for the whole game - they are NOT wiped on descent, so the home stash and
 * shop stock survive across levels and save/load (gap 12.1). First creation
 * (store_reset) fills every non-home shop; each subsequent return to town runs
 * store_update, catching the shops up on the days that elapsed in the dungeon
 * and occasionally shuffling a shopkeeper (gaps 12.2/12.3), consuming daycount.
 * No-op when the pack ships no stores; a loaded save's restored stores skip the
 * first-creation branch and (in town, daycount 0) leave the RNG stream untouched.
 */
function refreshTownStores(state: GameState, reg: CoreRegistries): void {
  if (!reg.stores) return;
  const storeDeps: MakeDeps = {
    reg: reg.objects,
    alloc: new ObjAllocState(reg.objects, reg.constants),
    constants: reg.constants,
    /* Stores pass allowArtifacts=false, so these are inert here; shared
     * for consistency with the rest of the game's MakeDeps. */
    artifacts: state.artifacts ?? new ArtifactState(reg.objects.artifacts.length),
    noArtifacts: state.options?.get("birth_no_artifacts") ?? false,
    /* class book-rejection / curse-foil / no-selling generation foils. */
    ...genFoilFields(state),
  };
  if (!state.stores) {
    /* First time in town: store_init + store_reset. Build and stock every shop
     * once. Gated on depth 0 so a game that begins in the dungeon (tests, or a
     * future non-town start) draws no store RNG until town is actually reached -
     * preserving the exact stream and the pre-fix behaviour. */
    if (state.chunk.depth !== 0) return;
    state.stores = createTownStores(
      reg.stores.stores,
      storeDeps,
      state.rng,
      state.actor.player.maxDepth,
      /* parse_always book expansion (store.c:208-231): the bookseller's
       * no-sval always lines need class-book metadata to resolve which town
       * spellbooks to stock. Stashed on state by wireGame. */
      state.classes,
    );
    return;
  }
  /* Stores already exist (persisted across levels). On the return to town run
   * store_update over the accrued days, then zero daycount (store.c:1462). In
   * the dungeon the stores are simply left as-is (home stash preserved). */
  if (state.chunk.depth === 0) {
    const ctx: StoreMaintContext = {
      rng: state.rng,
      deps: storeDeps,
      maxDepth: state.actor.player.maxDepth,
      stores: state.stores,
      /* history_lose_artifact (store.c:1091 / :1307): an artifact the player
       * sold into stock and the store then turned over or purged is gone. */
      onArtifactLost: (art): void => state.onArtifactLost?.(art),
      /* Store behaviour a mod may have added to (StoreBehaviourRegistry). */
      ...(state.storeBehaviour ? { behaviour: state.storeBehaviour } : {}),
      /* OPT(cheat_xtra) (store.c:1424, :1444). */
      ...(state.options?.get("cheat_xtra")
        ? { cheatMsg: (text: string): void => state.msg?.(text) }
        : {}),
    };
    storeUpdate(ctx, state.daycount ?? 0);
    state.daycount = 0;
  }
}

/**
 * Materialise upkeep->inven[] and upkeep->quiver[] for a game that has just
 * come into existence, from birth (player_outfit -> inven_carry sets PU_INVEN,
 * which the first update_stuff turns into calc_inventory) or from a savefile
 * (rd_gear's explicit calc_inventory tail, load.c:1187).
 *
 * Both views are DERIVED and never persisted, and until this ran nothing built
 * them: the port only recomputed them as a side effect of an object command or
 * a game turn. Anything reading them before that - an inventory listing, an
 * item picker, the quiver screen - saw an empty pack and an empty quiver.
 *
 * `characterDungeon` is false here: upstream's "You re-arrange your quiver."
 * notice belongs to play, not to a character coming into being.
 */
function buildGearViews(
  state: GameState,
  reg: CoreRegistries,
  ammoTval: number,
): void {
  calcInventory(state.gear, reg.constants, {
    store: false,
    ammoTval,
    objectValue: (obj: GameObject): number =>
      computeObjectValue(reg.objects, obj, 1, true),
    rogueLike: state.options?.get("rogue_like_commands") ?? false,
    characterDungeon: false,
  });
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

  // The player option store, options_init_defaults whole (option.c L186-205,
  // called from player_init at player.c:491). In upstream's order:
  //
  //   1. every option from its table `normal` (OPTION_ENTRIES),
  //   2. the player's customised BIRTH defaults from ANGBAND_DIR_USER,
  //   3. their customised INTERFACE defaults,
  //   4. delay_factor = 40 and hitpoint_warn = 3,
  //
  // and only then this call's explicit birth/interface CHOICES on top. Steps 2
  // and 3 read customized_<page>_options.txt through the installed host; with
  // no host, or no such file, they are exactly the table defaults, which is why
  // a test or an MCP session sees no change. Built before level generation so
  // birth_randarts can swap the artifact set first.
  const initial = optionsInitDefaults(host());
  const options = new OptionState({
    overrides: { ...initial.opts, ...(opts.optionOverrides ?? {}) },
    hitpointWarn: opts.hitpointWarn ?? initial.hitpointWarn,
    delayFactor: initial.delayFactor,
  });

  // options_init_cheat (player-birth.c:1234, gap 1.12): at character accept,
  // clear every cheat option and its score twin, THEN re-apply the port-only
  // birth optionOverrides seam AFTER the clear. Maintainer-decided faithful
  // ordering: a NORMAL birth matches upstream exactly (cheat options default
  // off, so this clear is a no-op), while an EXPLICIT birth-time cheat override
  // (the port-only seam with no upstream equivalent) still survives because it
  // is re-applied last. Birth options were already frozen into the snapshot at
  // construction, so re-applying them here is a harmless no-op (set() is locked
  // for birth options); only the interface/cheat/score overrides take effect.
  optionsInitCheat(options);
  if (opts.optionOverrides) {
    for (const [name, value] of Object.entries(opts.optionOverrides)) {
      if (value !== undefined) options.set(name, value);
    }
  }

  // Main game RNG (Decision 6.2): one continuous stream for birth UI
  // continuation (opts.rng / opts.rngState), store_reset, seed_randart,
  // seed_flavor, player outfit, and level gen. C player-birth.c:1269-1292
  // order is store_reset, then seed_randart immediately followed by
  // seed_flavor; prepare_next_level (ui-game.c:757-760) runs only later.
  const mainRng = opts.rng ?? new Rng(opts.seed ?? 1);
  if (!opts.rng && opts.rngState) mainRng.setState(opts.rngState);

  const race =
    (opts.raceName ? players.raceByName(opts.raceName) : null) ??
    players.raceByName("Human") ??
    players.races[0]!;
  const cls =
    (opts.className ? players.classByName(opts.className) : null) ??
    players.classByName("Warrior") ??
    players.classes[0]!;

  const body = players.bodies[race.body] ?? players.bodies[0]!;
  // Point-based birth: apply the chosen allocation (drawing no stat RNG) only
  // when the roller method is "point" AND a full stat array was supplied;
  // otherwise fall through to the classic roller (the unchanged default).
  const usePointBuy =
    opts.roller === "point" &&
    opts.birthStats !== undefined &&
    opts.birthStats.length === STAT_MAX;
  // The accepted standard-roller stats ride opts.rolledStats (gap, birth
  // thread-through): applied verbatim, they draw no stat RNG, so the character
  // is born with exactly the set the roller UI showed.
  const useRolledStats =
    opts.rolledStats !== undefined && opts.rolledStats.length === STAT_MAX;
  // Character birth draws (roll_hp / ahw / history / stats) run before
  // store_reset, matching C accept order where player_generate / roll_hp
  // precede store_reset (player-birth.c:1236-1270). When the shell already
  // advanced the stream for birth UI and supplies rolledStats/history, only
  // roll_hp / ahw / the history walk remain here.
  const birth = generatePlayer(
    race,
    cls,
    {
      body,
      historyChart: players.historyChart(race),
      ...(useRolledStats ? { rolledStats: opts.rolledStats } : {}),
      ...(usePointBuy ? { stats: opts.birthStats } : {}),
      ...(opts.history !== undefined ? { historyOverride: opts.history } : {}),
    },
    mainRng,
  );

  // player_quests_reset (player-quest.c L157, called from player_birth): copy
  // the standard quest table into the fresh character's quest history so
  // is_quest and quest_check see the Sauron/Morgoth guardians from turn one.
  playerQuestsReset(birth.player, reg.quests);

  // C player-birth.c:1269-1292 then ui-game.c:757-760:
  //   store_reset -> seed_randart -> seed_flavor -> (later) prepare_next_level
  // Town store_reset draws on the main stream BEFORE both seeds; level gen
  // draws come AFTER both seeds. Gated on starting depth 0 so a game that
  // begins in the dungeon (tests) still draws no store RNG until town.
  const startDepth = opts.depth ?? 1;
  let earlyStores: Store[] | undefined;
  if (reg.stores && startDepth === 0) {
    const bookKeys = new Set(
      birth.player.cls.magic.books.map((b) => `${b.tvalIdx},${b.sval}`),
    );
    const storeDeps: MakeDeps = {
      reg: reg.objects,
      alloc: new ObjAllocState(reg.objects, reg.constants),
      constants: reg.constants,
      artifacts: new ArtifactState(reg.objects.artifacts.length),
      noArtifacts: options.get("birth_no_artifacts") ?? false,
      timedFoil: buildCurseTimedFoil(players.timed),
      canBrowseBook: (kind): boolean =>
        bookKeys.has(`${kind.tval},${kind.sval}`),
      noSelling: options.get("birth_no_selling") ?? false,
    };
    earlyStores = createTownStores(
      reg.stores.stores,
      storeDeps,
      mainRng,
      birth.player.maxDepth,
      players.classes,
    );
  }

  // OPT(player, birth_randarts) (obj-randart.c do_randart): seed_randart =
  // randint0(0x10000000) on the main stream (player-birth.c:1285), then
  // seed_flavor immediately after (player-birth.c:1291).
  let randartSeed = 0;
  if (options.get("birth_randarts")) {
    randartSeed = mainRng.randint0(0x10000000);
    swapRandartSet(
      reg,
      randartSeed,
      buildCurseTimedFoil(players.timed),
      buildActivationSummarizer(pack, reg),
    );
  }
  const seedFlavor = mainRng.randint0(0x10000000);

  // aup_info[] (obj-make.c): the game's shared artifact-created registry.
  // Built AFTER swapRandartSet so its length matches the (index-preserving)
  // final artifact set, and BEFORE bootLevel so the starting level shares it.
  const artifacts = new ArtifactState(reg.objects.artifacts.length);
  const noArtifacts = options.get("birth_no_artifacts") ?? false;

  // player_outfit (player-birth.c L1299): after seed_flavor, before level gen.
  const gear = newGear();
  /* object_flavor_aware(p, obj) on each start item (player-birth.c:650) has to
   * wait for wireGame to build the awareness store, so collect the kinds here
   * and apply them below. Without this a Warrior's own starting Flask of Oil
   * read as "a Clear Flask" - named by flavour, as though they had found it on
   * the floor. */
  const startKinds: ObjectKind[] = [];
  outfitPlayer(gear, birth.player, reg.objects, mainRng, reg.constants, {
    opt: (name: string): boolean => options.get(name) ?? false,
    onStartKind: (kind): void => void startKinds.push(kind),
  });

  // prepare_next_level (ui-game.c:757-760): level generation AFTER both seeds.
  const booted = bootLevel(pack, {
    ...opts,
    rng: mainRng,
    registries: reg,
    artifacts,
    noArtifacts,
  });

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
  /* Record cumber_armor on the birth state too, so the first refreshDerived of
   * the game diffs against the true starting value and cannot announce an
   * armour change that never happened. */
  pstate.cumberArmor = calcMana(
    birth.player,
    pstate.statInd,
    wornArmorWeight(birth.player, equipment),
  );
  birth.player.csp = birth.player.msp; // born rested, full mana

  const spot: Loc = booted.playerSpot ?? loc(1, 1);
  const actor: PlayerActor = {
    player: birth.player,
    grid: spot,
    energy: 0,
    speed: pstate.speed,
    totalEnergy: 0,
    combat,
    /* p->known_state, seeded with the real state and replaced with the true
     * known derive at the end of wireGame - the flavour store and the rune env
     * it needs do not exist yet at this line. */
    knownCombat: combat,
    defense: toDefenderState(pstate),
    weapon,
    stealth: combat.skills[SKILL.STEALTH] ?? 0,
    light: pstate.curLight,
    unlight: pstate.pflags.has(PF.UNLIGHT),
  };

  const state: GameState = {
    rng: booted.rng,
    chunk: booted.chunk,
    levelTopology: reg.topology,
    chestTraps: reg.chestTraps,
    actor,
    gear,
    monsters: [null],
    groups: [null],
    floor: new Map(),
    traps: new Map(),
    known: newKnownMap(booted.chunk.width, booted.chunk.height),
    target: newTargetState(),
    ignore: new IgnoreSettings(),
    autoinscribe: new AutoinscriptionRegistry(),
    runeNotes: new RuneNoteRegistry(),
    options,
    artifacts,
    /* Effective mod-rule flags (declarative bundled-mod seam): absent/empty =
     * faithful 4.2.6. Seeded a copy so later menu toggles mutate this map, not
     * the caller's. */
    ...(opts.modRules ? { modRules: { ...opts.modRules } } : {}),
    /* The behaviour seam itself, already composed by the host. Not copied: it is
     * a fold of functions, not mutable player state, and the menu re-composes it
     * rather than editing it in place. */
    ...(opts.modHooks ? { modHooks: opts.modHooks } : {}),
    lore: new Map(),
    /* birth_levels_persist (#30) frozen-level cache; empty until a level is
     * left with the option on (the whole persist path is option-gated). */
    levelCache: new Map(),
    /* The STARTING level's stair connectors, on the same option gate
     * changeLevel uses. Without this the first level a character ever stands on
     * freezes with an empty join list and its neighbour cannot align to it. */
    ...((options.get("birth_levels_persist") ?? false)
      ? { currentJoins: [...booted.joins] }
      : {}),
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
    curses: reg.objects.curses,
    /* player_has_temporary_brand / _slay (player-util.c), bound ONCE here from the
     * pack's timed records. The melee hooks used to build a private copy and
     * nothing else could reach one, so obj-info's brand/slay gathering carried a
     * "DEFERRED" note beside a predicate that already existed - PORT_TODO 3.20. */
    tempBrandSlay: buildTempBrandSlay(
      birth.player,
      /* The RAW pack records, not players.timed - bindPlayer's TimedEffect has no
       * brand/slay code arrays, so passing the bound table silently mapped every
       * index to -1 and hasBrand answered false for everything. Measured: the
       * first draft of this did exactly that and the test caught it. */
      pack.player.timed as unknown as readonly TimedTempBrandSlayRecord[],
      reg.objects.brands,
      reg.objects.slays,
    ),
    /* Placeholder; wireGame installs the full registry-backed env. */
    runeEnv: makeRuneEnv(
      () => null,
      () => false,
    ),
    playing: true,
    isDead: false,
    generateLevel: false,
    nextCommand: (): PlayerCommand | null => null,
    // store_reset already ran on the main stream before seed_randart/flavor.
    ...(earlyStores ? { stores: earlyStores } : {}),
  };

  // seed_flavor already drawn above; flavor_init runs inside wireGame.
  if (opts.updateFov) state.updateFov = opts.updateFov;
  const wired = wireGame(state, reg, players, pstate, seedFlavor);
  /* PU_INVEN from the starting kit's inven_carry (player-birth.c). */
  buildGearViews(state, reg, pstate.ammoTval);

  // kind->everseen = true for each bought start item (player-birth.c L658). At
  // birth the gear holds only the starting kit, so marking every carried kind
  // is exactly the start-item set. Pure Set insert, no RNG.
  for (const obj of state.gear.store.values()) {
    wired.everseen.markKind(obj.kind);
  }

  // object_flavor_aware(p, obj) per start item (player-birth.c:650), applied now
  // that flavor_init has run and the awareness store exists. NOOP deps, not the
  // live ones: upstream's L2276-79 ignore side effects re-check a pack that does
  // not exist yet at this point in birth, and the first real notice_stuff pass
  // covers it. No RNG.
  for (const kind of startKinds) {
    wired.flavor.objectFlavorAware(kind, NOOP_FLAVOR_AWARE_DEPS);
  }

  // obj->known->effect = obj->effect per start item (player-birth.c:650). The
  // objectFlavorAware pass above already covers every kind the outfit can
  // contain, so this is the C's line rather than a behaviour change - but it is
  // the line, and the field now exists to hold it.
  for (const obj of state.gear.store.values()) {
    obj.knownEffect = obj.effect;
  }

  // birth_know_runes (player-birth.c L1261-1262): a birth_know_runes character
  // knows every rune for ID-on-walkover (gap 1.5). No RNG. Before
  // player_learn_innate, matching the C acceptance order.
  if (options.get("birth_know_runes")) {
    playerLearnAllRunes(birth.player, state.runeEnv);
  }

  // birth_know_flavors (player-birth.c L1295-1296): a birth_know_flavors
  // character is aware of every flavoured kind for auto-ID of consumables (gap
  // 1.5). flavor_init already ran inside wireGame. No RNG.
  if (options.get("birth_know_flavors")) {
    flavorSetAllAware(wired.flavor, reg.objects.kinds, (k) =>
      state.hasFlavor ? state.hasFlavor(k) : false,
    );
  }

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
      traps: booted.traps,
      lockedDoors: booted.lockedDoors,
      depth: booted.depth,
    },
    wired.trapDeps,
  );
  // Stores already created pre-seed when startDepth === 0; refresh is then a
  // daycount-0 no-op. Depth > 0 still no-ops until the first town entry.
  refreshTownStores(state, reg);
  /* town_gen -> cave_illuminate (gen-cave.c / cave-map.c L555): the birth town
   * is illuminated at generation. The chunk-flag half ran in the town builder;
   * this applies the player-KNOWLEDGE half so a daytime town is fully memorized
   * (visible from the spawn corner on entry, exactly like the C town) and a
   * night town forgets its boring floors. Town only (booted depth 0); the level
   * changer (changeLevel) does the same for recall-to-town. */
  if (booted.depth === 0) {
    caveKnown(state);
    caveIlluminateKnown(state, isDaytime(state.turn, state.z.dayLength));
  }

  /*
   * only_partial during the initial level-entry FOV (ui-display.c:2522 /
   * cave-view.c:851): C sets this for the first new-level display too, not
   * only for later change_level transitions.
   *
   * The guard used to be load-bearing: with no default updateFov, a host that had
   * not wired one yet got NO initial flood, and onlyPartial was left set for it to
   * run later. That is what left an agent with a blank map - it never wired one, so
   * the else branch was the whole story rather than a fallback. wireGame now
   * installs a default, so the branch is always taken. The `if` stays because a
   * host may still replace the seam with its own, and one that deleted it outright
   * should get silence rather than a crash.
   */
  state.chunk.onlyPartial = true;
  if (state.updateFov) {
    state.updateFov(state);
    /* on_new_level's own disturb (game-world.c:1016-1017), immediately before
     * the feeling and the search: arriving on a level cancels whatever was
     * still queued from the level you left. */
    disturb(state);
    announceFeeling(state, reg);
    search(state); /* on_new_level (game-world.c:1052). */
    state.chunk.onlyPartial = false;
  }

  /* One instance, shared: reincarnate ends by asking for the town, and it must be
   * the same level changer the host drives so the arena bookkeeping inside it is
   * not split across two closures with separate `inArena` flags. */
  const changeLevel = makeChangeLevel(state, reg, wired.trapDeps);

  return {
    state,
    registry: wired.registry,
    effects: wired.effects,
    booted,
    players,
    flavor: wired.flavor,
    everseen: wired.everseen,
    seedFlavor,
    /* A freshly-birthed game is core-only, deterministic, with no mod bags or
     * quarantined content (P7.2). A future mod loader seeds a richer manifest. */
    manifest: coreOnlyManifest(),
    mods: {},
    orphans: {},
    orphansAcknowledged: false,
    mismatchedPacks: [],
    options,
    randartSeed,
    changeLevel,
    reincarnate: makeReincarnate(
      state,
      reg,
      players,
      wired.flavor,
      wired.everseen,
      changeLevel,
    ),
    wizardBundles: wired.wizardBundles,
    ...makeStoreApi(state, reg, wired.flavor, options, wired.registry),
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
  registry: ActionRegistry,
): Pick<StartedGame, "buy" | "sell" | "sellFloor" | "price" | "willBuy"> {
  const storeCtx = (): StoreMaintContext => ({
    rng: state.rng,
    deps: {
      reg: reg.objects,
      alloc: new ObjAllocState(reg.objects, reg.constants),
      constants: reg.constants,
      /* allowArtifacts=false in store generation; inert but shared. */
      artifacts: state.artifacts ?? new ArtifactState(reg.objects.artifacts.length),
      noArtifacts: state.options?.get("birth_no_artifacts") ?? false,
      /* class book-rejection / curse-foil / no-selling generation foils. */
      ...genFoilFields(state),
    },
    maxDepth: state.actor.player.maxDepth,
    stores: state.stores ?? [],
    /* history_lose_artifact (store.c:1087 for the turnover, :1303 for the
     * black-market purge). storeBuy runs ten storeMaint passes when a purchase
     * empties a shop (store.c:1753), and each one can storeDeleteRandom.
     *
     * LATENT, NOT LIVE: generated stock can never be an artifact, which
     * upstream states with assert(!obj->artifact) once each in
     * store_create_random (:1197) and store_create_item (:1267). The port
     * documents rather than reproduces upstream asserts - five precedents, and
     * a runtime throw where upstream has a compile-out assert would be core
     * ADDING something. The invariant is held by a test instead.
     *
     * Supplied anyway because the town-return context at :2988 supplies it and
     * this one did not, and a seam supplied to every path but one is exactly
     * the shape that lets a mod work in town and not in the shop - the same
     * sentence the comment below already had to write about storeWillBuy. */
    onArtifactLost: (art): void => state.onArtifactLost?.(art),
    /* The sell path decides through storeWillBuy too, so it reads the same
     * registry the maintenance path does - a seam supplied to every path but
     * one is the shape that lets a mod work in town and not in the shop. */
    ...(state.storeBehaviour ? { behaviour: state.storeBehaviour } : {}),
  });
  const noSelling = (): boolean => options.get("birth_no_selling") ?? false;
  /* update_stuff's PU_INVEN after a gear change (obj-gear.c: inven_carry /
   * gear_object_for_use both set PU_INVEN): rebuild the computed quiver so
   * bought/sold ammo is routed into (or out of) the quiver, exactly as the
   * wield/takeoff/use paths already do (obj-cmd.ts). Without this a purchased
   * bolt stays displayed in the pack instead of the quiver. Mirrors the
   * calc_inventory opts assembled for the object commands above. */
  const refreshQuiver = (): void => {
    calcInventory(state.gear, reg.constants, {
      store: false,
      /* Live ammo_tval, as refreshInventory above and calcInvOpts do; without
       * it a store purchase re-sorted the quiver ignoring the wielded
       * launcher. */
      ammoTval: state.playerState?.ammoTval ?? 0,
      objectValue: (obj: GameObject): number =>
        computeObjectValue(reg.objects, obj, 1, true),
      rogueLike: state.options?.get("rogue_like_commands") ?? false,
      characterDungeon: true,
      msg: (text: string): void => state.msg?.(text),
    });
  };
  /**
   * object_flag_is_known(player, obj, flag) bound to one object, for
   * store_will_buy's buy-list branch (store.c:551). PORT_TODO 2.10 / 5.8.
   *
   * The shadow is synthesised ONCE per object rather than per flag: a buy list
   * can name several flags for one tval, and objectKnownShadow walks the whole
   * rune set each time it is called.
   */
  const flagKnownFor = (obj: GameObject): ((flag: number) => boolean) => {
    const p = state.actor.player;
    const shadow = objectKnownShadow(obj, p, state.runeEnv, knownDescOf(state));
    return (flag) => objectFlagIsKnown(obj, shadow, p, state.runeEnv, flag);
  };

  const txnKnow = (obj: GameObject): TxnKnowledge => ({
    flavor,
    flavorDeps: flavorAwareDeps(state),
    aware: flavor.isAware(obj.kind),
    noSelling: noSelling(),
    flagKnown: flagKnownFor(obj),
    /* do_cmd_sell L1946-1951: selling teaches the runes as well as the flavour.
     * buildRuneList is rebuilt per call for the same reason effect-item.ts does
     * it (L930): a mod can add runes mid-session, so a cached list would go
     * stale. Unused by storeBuy, which learns flavour only. */
    learnRunes: { env: state.runeEnv, runes: buildRuneList(state.runeEnv) },
  });
  const storeApi: Pick<StartedGame, "buy" | "sell" | "sellFloor" | "price" | "willBuy"> = {
    buy: (store, obj, amt): BuyResult => {
      /* do_cmd_retrieve (store.c:1783): Home Take is free - no price, no
       * ORIGIN_STORE, no shuffle/maint RNG. Reuse the existing homeRetrieve. */
      if (store.feat === FEAT.HOME) {
        const r = homeRetrieve(
          store,
          obj,
          amt,
          state.actor.player,
          state.gear,
          reg.constants,
        );
        if (!r.ok) {
          return {
            ok: false,
            failure: r.failure === "no-room" ? "no-room" : "not-in-stock",
          };
        }
        refreshQuiver();
        return r.obj
          ? { ok: true, price: 0, bought: r.obj }
          : { ok: true, price: 0 };
      }
      const result = storeBuy(storeCtx(), store, obj, amt, state.actor.player, state.gear, txnKnow(obj));
      if (result.ok) refreshQuiver();
      return result;
    },
    sell: (store, handle, amt): SellResult => {
      /* do_cmd_stash (store.c:2009): Home Drop is free, pack-style stacking,
       * no value gate / note-fuel-timeout rewrite. Reuse homeStash/homeCarry. */
      if (store.feat === FEAT.HOME) {
        const r = homeStash(
          store,
          handle,
          amt,
          state.actor.player,
          state.gear,
          reg.constants,
        );
        if (!r.ok) {
          return {
            ok: false,
            failure: r.failure ?? "no-item",
          };
        }
        refreshQuiver();
        return {
          ok: true,
          price: 0,
          ...(r.obj ? { sold: r.obj } : {}),
          ...(r.noneLeft !== undefined ? { noneLeft: r.noneLeft } : {}),
          carried: true,
        };
      }
      const obj = state.gear.store.get(handle);
      const know = obj
        ? txnKnow(obj)
        : {
            flavor,
            flavorDeps: flavorAwareDeps(state),
            aware: false,
            noSelling: noSelling(),
            /* No object behind the handle, so the sale is refused before the
             * buy list is consulted; nothing can be known about a flag on it. */
            flagKnown: (): boolean => false,
          };
      const result = storeSell(storeCtx(), store, handle, amt, state.actor.player, state.gear, know);
      /* do_cmd_sell: selling an artifact reveals it (history_find_artifact,
       * store.c:1924); if the store then discards it, it is lost (:1988).
       *
       * Both line numbers were WRONG here until 2026-08-14 - :1928 and :1992,
       * four lines late, matching a cluster of same-signed drift across store.c
       * and obj-knowledge.c. Re-checked against reference/src/store.c, which is
       * blob-identical to the 4.2.6 tag, so the C is ground truth and these are
       * transcription errors rather than a baseline mismatch. */
      if (result.ok && result.sold?.artifact) {
        state.onArtifactFound?.(result.sold.artifact);
        if (result.carried === false) state.onArtifactLost?.(result.sold.artifact);
      }
      /* apply_autoinscription (store.c:1971-1973): "Autoinscribe if we still
       * have any" - the remaining stack, not the sold copy. (Cited :1976-1977
       * until 2026-08-14; that lands on notice_stuff, a different call.) */
      if (result.ok && result.noneLeft === false) {
        const left = state.gear.store.get(handle);
        if (left) state.autoinscribeObject?.(left);
      }
      if (result.ok) refreshQuiver();
      return result;
    },
    sellFloor: (store, obj, amt): SellResult => {
      /* Home Drop from the floor pile: room check, detach, home_carry. */
      if (store.feat === FEAT.HOME) {
        const n = Math.min(amt, obj.number);
        const dummy = objectCopyAmt(obj, n);
        if (!storeCheckNum(store, dummy)) {
          return { ok: false, failure: "no-room" };
        }
        const { usable, noneLeft } = floorObjectForUse(state, obj, n);
        homeCarry(store, usable, reg.constants);
        refreshQuiver();
        return {
          ok: true,
          price: 0,
          sold: usable,
          noneLeft,
          carried: true,
        };
      }
      const result = storeSellFloor(
        storeCtx(),
        store,
        obj,
        amt,
        state.actor.player,
        txnKnow(obj),
        (n) => {
          const { usable, noneLeft } = floorObjectForUse(state, obj, n);
          return { obj: usable, noneLeft };
        },
      );
      /* do_cmd_sell artifact reveal / loss, exactly as the gear-handle path. */
      if (result.ok && result.sold?.artifact) {
        state.onArtifactFound?.(result.sold.artifact);
        if (result.carried === false) state.onArtifactLost?.(result.sold.artifact);
      }
      if (result.ok) refreshQuiver();
      return result;
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
    /* runesKnown matches storeSell's know (txnKnow never sets it, so the
     * transaction treats it as false); keep the filter aligned with the sale. */
    willBuy: (store, obj): boolean =>
      storeWillBuy(
        reg.objects,
        store,
        obj,
        flavor.isAware(obj.kind),
        noSelling(),
        false,
        flagKnownFor(obj),
        state.storeBehaviour,
      ),
  };
  /* shop-buy / shop-sell / shop-exit (docs/PLANNED.md, "An agent cannot
   * trade"): wire the agent-facing store commands through the SAME buy/sell
   * closures the interactive shop screen calls, so a keystroke and an
   * agent's command reach identical pack/gold/knowledge effects. */
  installStoreCommands(registry, { buy: storeApi.buy, sell: storeApi.sell });
  return storeApi;
}

/**
 * do_randart (obj-randart.c): generate a random artifact set from `seed` and
 * install it in place of the registry's standard set. do_randart preserves the
 * artifact indices (aidx), so live references and saved-object aidx lookups
 * keep resolving; only the artifact properties change. Mutates the per-game
 * ObjRegistry (built fresh by bindCore), never a shared global.
 */
/**
 * The player-class-and-timed dependent object-generation foils shared by every
 * live MakeDeps built after wireGame (store stock): append_object_curse's
 * TIMED_INC foil (gap 3.2), obj_kind_can_browse book rejection (gap 3.5) and
 * make_gold's birth_no_selling inflation (gap 3.7). The dungeon/loot makeDeps
 * in wireGame builds these inline from players.timed (state.world is not set
 * yet at that point). Reads the LIVE timed table so it stays correct.
 */
function genFoilFields(
  state: GameState,
): Pick<MakeDeps, "timedFoil" | "canBrowseBook" | "noSelling"> {
  const keys = new Set(
    state.actor.player.cls.magic.books.map((b) => `${b.tvalIdx},${b.sval}`),
  );
  return {
    timedFoil: buildCurseTimedFoil(state.world?.timedTable ?? []),
    canBrowseBook: (kind): boolean => keys.has(`${kind.tval},${kind.sval}`),
    noSelling: state.options?.get("birth_no_selling") ?? false,
  };
}

/**
 * Build the effect_summarize_properties summarizer (effects-info.c L898)
 * injected into remove_contradictory_activation (obj-randart.c L2420, gap 3.8).
 * Draws no RNG; only ever nulls a redundant activation.
 */
function buildActivationSummarizer(
  pack: GamePack,
  reg: CoreRegistries,
): ActivationSummarizer {
  return makeActivationSummarizer({
    timedRecords: pack.player.timed as unknown as readonly RawTimedRecord[],
    brands: reg.objects.brands,
    slays: reg.objects.slays,
    ofIndex: (n) => (OF as Record<string, number>)[n] ?? 0,
    elemIndex: (n) => (ELEM as Record<string, number>)[n] ?? -1,
  });
}

/**
 * birth_randarts as the save itself recorded it, read straight off the document
 * before any migration runs: loadGame has to choose the artifact set before it
 * can build the content-id resolver a migration needs. A blob that is not the
 * option-store shape reads as off, which is the table default, so a damaged or
 * future-shaped file cannot throw here and mask the error migrateSave gives.
 */
function savedBirthRandarts(save: SavedGame): boolean {
  const opts: unknown = save.options;
  if (typeof opts !== "object" || opts === null) return false;
  const values: unknown = (opts as { values?: unknown }).values;
  if (typeof values !== "object" || values === null) return false;
  return (values as Record<string, unknown>).birth_randarts === true;
}

/** The randart seed a save recorded, or 0 for absent, damaged or non-finite. */
function savedRandartSeed(save: SavedGame): number {
  const seed: unknown = save.randartSeed;
  return typeof seed === "number" && Number.isFinite(seed) ? seed : 0;
}

function swapRandartSet(
  reg: CoreRegistries,
  seed: number,
  timedFoil?: CurseTimedFoil,
  activationSummarize?: ActivationSummarizer,
): void {
  /* Thread the RANDNAME_TOLKIEN corpus (names.json section 1, loaded into
   * CoreRegistries.nameSections at boot) so artifact_gen_name draws faithful
   * Markov names via randnameMake instead of the local syllable fallback -
   * this also keeps the RNG draw count identical to upstream for the whole set
   * (obj-randart.c L2713-L2724). */
  /* artifact_curse_conflicts TIMED_INC foil (obj-randart.c L2530, gap 3.3):
   * thread the player-timed fail tables so a randart curse an item property
   * would foil is rejected / removable. The activation-redundancy summarizer
   * (gap 3.8, effect_summarize_properties) is threaded via activationSummarize
   * so remove_contradictory_activation can drop a redundant activation
   * (obj-randart.c L2420); absent, it stays a conservative no-op. */
  const randarts = doRandart(
    reg.objects,
    reg.constants,
    seed, true,
    reg.nameSections.get(RANDNAME_TOLKIEN),
    timedFoil || activationSummarize
      ? { timedFoil, activationSummarize }
      : undefined,
  );
  reg.objects.artifacts.length = 0;
  reg.objects.artifacts.push(...randarts);
}

/** Serialize a started game into the JSON save format (decision 9). */
export function saveGame(game: StartedGame): SavedGame {
  const ids = new ContentIdResolver(game.booted.registries);
  const save = serializeGame(
    game.state,
    game.flavor,
    game.seedFlavor,
    ids,
    game.randartSeed,
    game.everseen,
  );
  /* The mod-lifecycle blocks (P7.2): the manifest fingerprint always travels
   * with the save; the per-mod bags and any quarantined orphans ride along only
   * when non-empty, so a core-only save stays clean. */
  save.manifest = game.manifest;
  if (Object.keys(game.mods).length > 0) save.mods = game.mods;
  if (Object.keys(game.orphans).length > 0) save.orphans = game.orphans;
  if (game.orphansAcknowledged) save.orphansAcknowledged = true;
  return save;
}

/**
 * Rebuild a running game from a save: bind the pack, restore every entity
 * store and the RNG stream (decision 22: reloading resumes the exact
 * stream, the anti-save-scum posture), rewire the commands, and derive the
 * combat state from the restored player and gear.
 */
/** Options for loadGame (client settings not stored in the savefile). */
export interface LoadGameOptions {
  /**
   * The effective "mod rule" flags to seed GameState.modRules with, recomputed
   * by the host from the enabled mods' manifest `rules` and the player's saved
   * choices (the same resolution startGame uses). A client setting, not part of
   * the save; absent/empty = faithful 4.2.6.
   */
  modRules?: Readonly<Record<string, boolean>>;
  /**
   * The composed behaviour of every enabled mod (mod/hooks.ts). A client setting
   * like the flags above; absent = faithful 4.2.6.
   */
  modHooks?: import("../mod/hooks.js").ModHooks;
  /**
   * arg_wizard (savefile.c:631 savefile_load's cheat_death parameter): the game
   * was launched in wizard mode. Loading a DEAD character this way resurrects it
   * (savefile.c:647-651) and marks it NOSCORE_WIZARD so it stays off the score
   * table. A client/launch setting, not part of the save. The web wizard-mode
   * entry (WP-14) passes this; a normal load leaves it false.
   */
  wizard?: boolean;
  /**
   * The content digest this host can measure RIGHT NOW for each present pack
   * (issue #20) - one `SavePackRef` per namespace it can hash, with the pack's
   * CURRENT id/version/hash, not the save's recorded one. Compared against
   * the save's own recorded manifest (`mismatchedNamespaces`) to catch a
   * pack that PATCHED a record rather than only adding one, then folded into
   * the manifest this load returns (`reconcilePackManifest`) so the NEXT save
   * carries today's hash forward. Omitting an entry for a present namespace
   * is the honest "cannot measure this one yet" - it is compared against
   * nothing and never flagged as a mismatch. Absent/empty: no pack is
   * compared or updated, which is the behavior before this option existed.
   */
  currentPacks?: readonly SavePackRef[];
}

export function loadGame(
  pack: GamePack,
  saveDocument: SavedGame,
  present: ReadonlySet<string> = new Set(["core"]),
  opts: LoadGameOptions = {},
): StartedGame {
  const reg = bindCore(pack);
  const players = bindPlayer(pack.player);
  registerBookKinds(reg.objects, players.classes);

  // OPT(player, birth_randarts): rebuild the same random artifact set from the
  // persisted seed, so saved-object aidx references resolve to the identical
  // randarts (do_randart preserves indices). Off / seed 0: the standard set.
  //
  // This has to happen BEFORE the resolver below is built. An artifact's id is a
  // slug of its NAME (mod/ids.ts), and saveGame minted those ids from the RANDOM
  // names, so a resolver built over the standard set resolves none of them: the
  // aup_info created/seen/everseen flags and the artifact on every saved object
  // all resolve to nothing and are dropped without a word.
  //
  // The decision reads the UN-MIGRATED document, because the resolver a
  // migration needs does not exist until the set is chosen. Both fields have
  // existed since save version 1 and no migration rewrites either; the check
  // further down fails loudly if that ever stops being true.
  const randartSeed = savedRandartSeed(saveDocument);
  const wantRandarts = savedBirthRandarts(saveDocument) && randartSeed !== 0;
  if (wantRandarts) {
    swapRandartSet(
      reg,
      randartSeed,
      buildCurseTimedFoil(players.timed),
      buildActivationSummarizer(pack, reg),
    );
  }

  // The content-id resolver: every namespaced string id in the save resolves
  // back to a runtime index against this bound pack (mod/ids.ts).
  const ids = new ContentIdResolver(reg);

  // An OLDER save is converted forward, one version at a time, before anything
  // reads a field (session/save-migrate.ts). This used to be a throw, and the
  // web host's bare catch turned it into "Could not read the save; starting a
  // new game" - a permadeath game telling a player their character is gone when
  // nothing was wrong with the bytes. The only load this build genuinely cannot
  // do is one from the FUTURE, and migrateSave throws SaveFromFutureError for
  // that alone, so a host can say "update the game" instead of "it is damaged".
  const migration = migrateSave(saveDocument, ids);
  const saveIn = migration.save;

  // The mod-lifecycle blocks (P7.2). The manifest fingerprint is core-only for
  // saves written before the mod substrate. Reconcile the mod set against the
  // packs present now: first rehydrate any orphans whose pack has returned, then
  // quarantine live entities whose defining pack is missing or shadowed - so the
  // deserializers below only ever see ids the present packs can resolve, instead
  // of throwing on a removed mod. `present` defaults to core-only; a future mod
  // loader passes the actually-loaded namespace set.
  const manifest = {
    ...(saveIn.manifest ?? coreOnlyManifest()),
    /* Saves written before the gameplay-mod ratchet remain scoreable until a
     * gameplay-affecting mod is actually enabled. */
    modNoscore: saveIn.manifest?.modNoscore ?? false,
  };
  const isPresent = (ns: string): boolean => present.has(ns);

  /* Issue #20's sibling check: a pack that PATCHED a record (rather than only
   * adding one) leaves nothing for quarantine to catch when the patch changes
   * or the pack goes away, because the record still resolves under its own,
   * still-present namespace. Computed against the manifest AS RECORDED, before
   * folding in what the host can measure now, so a genuinely different hash is
   * what gets reported rather than something this call just overwrote.
   * `reconcilePackManifest` then carries today's hash forward for the NEXT
   * save - a namespace the host cannot measure keeps its old recorded entry,
   * exactly as if this option had not been passed. */
  const currentPacks = opts.currentPacks ?? [];
  const mismatchedPacks = mismatchedNamespaces(manifest, currentPacks);
  const reconciledManifest = reconcilePackManifest(manifest, currentPacks);

  const quarantine = quarantineSave(
    rehydrateSave(saveIn, isPresent),
    reconciledManifest,
    isPresent,
  );
  const save = quarantine.save;

  // The feature remap turns the save's terrain-legend indices into this pack's.
  const featRemap = buildFeatRemap(save.featLegend, ids);

  // Restore the option store (older saves lack it: table defaults).
  const options = save.options
    ? OptionState.restore(save.options)
    : new OptionState();

  /* The artifact-set swap near the top read the un-migrated document. If a
   * migration ever begins rewriting the option store or the randart seed, that
   * read goes stale and the character would load against the wrong artifact
   * set, quietly. Say so instead: the read belongs after the migration then. */
  const migratedWantsRandarts =
    options.get("birth_randarts") && savedRandartSeed(save) !== 0;
  if (migratedWantsRandarts !== wantRandarts) {
    throw new Error(
      "save: a migration rewrote the option store or the randart seed, so the " +
        "artifact set was chosen from stale data - move the birth_randarts " +
        "read in loadGame to after migrateSave",
    );
  }

  // aup_info[] (load.c): the artifact-created registry. The resolver was built
  // after the artifact-set swap, so these ids line up with the live set; older
  // saves predate the field and load with an all-false set (a fresh game's).
  const artifacts =
    save.artifactsCreated || save.artifactsSeen || save.artifactsEverseen
    ? ArtifactState.restore({
        created: deserializeArtifactsCreated(
          save.artifactsCreated,
          reg.objects.artifacts.length,
          ids,
        ),
        seen: deserializeArtifactFlags(
          save.artifactsSeen,
          reg.objects.artifacts.length,
          ids,
        ),
        everseen: deserializeArtifactFlags(
          save.artifactsEverseen,
          reg.objects.artifacts.length,
          ids,
        ),
      })
    : new ArtifactState(reg.objects.artifacts.length);

  const chunk = save.chunk
    ? deserializeChunk(save.chunk, reg.features, featRemap)
    : new Chunk(reg.features, 1, 1);
  if (!save.chunk && save.dungeonDepth !== undefined) {
    chunk.depth = save.dungeonDepth;
  }
  const player = deserializePlayer(
    save.player,
    players,
    reg.objects,
    ids,
    reg.quests,
  );
  const gear = deserializeGear(save.gear, reg.objects, ids);

  /* rd_gear (load.c L1179-1185): the carried-weight total is RE-SUMMED from the
   * restored gear, not trusted from the file. Upstream does this because its
   * gear list and the total are written separately; the port needs it for a
   * second reason - a character saved before this accounting existed carries a
   * stored total of 0, and reading that back would leave them weightless for
   * the rest of the game. It has to run before calcBonuses below, which reads
   * the total for the carrying-capacity speed penalty. */
  player.upkeep.totalWeight = gearTotalWeight(gear);

  const equipment = player.equipment.map((h) => (h ? gearGet(gear, h) : null));
  const weaponSlot = player.body.slots.findIndex((s) => s.type === "WEAPON");
  const weapon = weaponSlot >= 0 ? (equipment[weaponSlot] ?? null) : null;
  const pstate = calcBonuses(player, {
    equipment,
    timedEffects: players.timed,
    curses: reg.objects.curses,
    update: true,
  });
  /* cumber_armor is calc_mana's to set, and a resumed character's msp is
   * restored from the save rather than recomputed - so derive the flag alone,
   * without touching msp/csp. Skipping it would make the first refreshDerived
   * of the session diff false -> true and announce that a mage's armour had
   * just become too heavy, on a character who simply loaded their save. */
  pstate.cumberArmor = cumberArmorFrom(player, wornArmorWeight(player, equipment));
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
    /* p->known_state, seeded with the real state and replaced with the true
     * known derive at the end of wireGame - the flavour store and the rune env
     * it needs do not exist yet at this line. */
    knownCombat: combat,
    defense: toDefenderState(pstate),
    weapon,
    stealth: combat.skills[SKILL.STEALTH] ?? 0,
    light: pstate.curLight,
    unlight: pstate.pflags.has(PF.UNLIGHT),
  };

  /* load.c:1473-1505 marks cave->decoy while rd_traps reads the active cave. */
  let decoy: Loc | null = null;
  const loadedTraps = !save.isDead && reg.traps
    ? deserializeTraps(
        save.traps,
        reg.traps,
        chunk.width,
        ids,
        (grid) => {
          decoy = grid;
        },
      )
    : new Map();

  /* Hoisted: the remembered pile is saved as locators into these very piles,
   * so deserializeKnown must be handed the same map the state runs on. */
  const loadedFloor = !save.isDead && save.floor
    ? deserializeFloor(save.floor, reg.objects, chunk.width, ids)
    : new Map<number, GameObject[]>();

  const state: GameState = {
    rng,
    chunk,
    levelTopology: reg.topology,
    chestTraps: reg.chestTraps,
    actor,
    gear,
    decoy,
    monsters: (save.isDead ? [null] : (save.monsters ?? [null])).map((m) =>
      m ? deserializeMonster(m, reg.monsters, reg.objects, ids) : null,
    ),
    groups: (save.isDead ? [null] : (save.groups ?? [null])).map((g) =>
      g ? { index: g.index, leader: g.leader, members: [...g.members] } : null,
    ),
    floor: loadedFloor,
    traps: loadedTraps,
    known: save.isDead
      ? newKnownMap(chunk.width, chunk.height)
      : deserializeKnown(
          save.known,
          chunk.width,
          chunk.height,
          featRemap,
          ids,
          loadedFloor,
          reg.objects,
        ),
    /* birth_levels_persist (#30) frozen-level cache; empty in saves written
     * before the field or with the option off (back-compat). */
    levelCache: deserializeLevelCache(
      save.isDead ? undefined : save.levelCache,
      reg.features,
      reg.monsters,
      reg.objects,
      reg.traps,
      ids,
    ),
    /*
     * Terrain-only Town cache (wr_chunks / load.c:1701-1704): restore even when
     * birth_levels_persist is off so town re-entry keeps seed parity.
     */
    ...(() => {
      if (save.isDead || !save.townChunk) return {};
      const townRemap = buildFeatRemap(save.townFeatLegend, ids);
      return {
        townChunk: deserializeChunk(save.townChunk, reg.features, townRemap),
      };
    })(),
    /* The target is not persisted (as upstream: the savefile carries no
     * target and loading starts unset). */
    target: newTargetState(),
    ignore: new IgnoreSettings(),
    autoinscribe: new AutoinscriptionRegistry(),
    runeNotes: new RuneNoteRegistry(),
    options,
    artifacts,
    /* Effective mod-rule flags (declarative bundled-mod seam): the host
     * recomputes these from the enabled mods + saved choices and passes them on
     * load, so they are a client setting (like the enabled-mod set), not part of
     * the savefile. Absent/empty = faithful 4.2.6. */
    ...(opts.modRules ? { modRules: { ...opts.modRules } } : {}),
    /* And the composed behaviour, recomputed by the host on load for the same
     * reason the flags are: which mods are enabled is a client setting. */
    ...(opts.modHooks ? { modHooks: opts.modHooks } : {}),
    lore: deserializeLore(save.lore, ids),
    /* Town stores + accrued daycount (rd_stores, gaps 12.1/12.2/12.3). Restored
     * from the save (never re-rolled) so the home stash and shop stock survive;
     * deserializeStores draws no RNG, so the resumed stream stays exact. Absent
     * in older saves / saves taken before reaching town: left undefined here and
     * lazily created by refreshTownStores on the next town entry (back-compat). */
    ...(save.stores && reg.stores
      ? {
          stores: deserializeStores(
            reg.stores.stores,
            save.stores,
            reg.objects,
            ids,
            reg.constants.storeInvenMax,
          ),
        }
      : {}),
    ...(save.daycount ? { daycount: save.daycount } : {}),
    /* Player-side transient scalars (save.c: wr_player). Absent in older saves
     * / falsy defaults load as unset, matching a fresh character. */
    ...(save.restingTurn ? { restingTurn: save.restingTurn } : {}),
    ...(save.skipCmdCoercion ? { skipCmdCoercion: save.skipCmdCoercion } : {}),
    ...(save.unignoring ? { unignoring: save.unignoring } : {}),
    ...(save.nameSuffix ? { nameSuffix: save.nameSuffix } : {}),
    /* Running message log (rd_messages, load.c:471-495, gap 12.8): re-add each
     * saved entry oldest-first; older saves without the field load empty. */
    messages: deserializeMessages(save.messages),
    /* chunk->join of the level in play (gap 9.4/9.6): restore the stair
     * connectors so a first-visit persistent level still aligns after reload. */
    ...(!save.isDead && save.currentJoins
      ? {
          currentJoins: save.currentJoins.map((j) => ({
            grid: loc(j.x, j.y),
            feat: featRemap.get(j.feat) ?? j.feat,
            ...(j.info ? { info: [...j.info] } : {}),
          })),
        }
      : {}),
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
    curses: reg.objects.curses,
    /* player_has_temporary_brand / _slay (player-util.c), bound ONCE here from the
     * pack's timed records. The melee hooks used to build a private copy and
     * nothing else could reach one, so obj-info's brand/slay gathering carried a
     * "DEFERRED" note beside a predicate that already existed - PORT_TODO 3.20. */
    tempBrandSlay: buildTempBrandSlay(
      player,
      /* The RAW pack records, not players.timed - bindPlayer's TimedEffect has no
       * brand/slay code arrays, so passing the bound table silently mapped every
       * index to -1 and hasBrand answered false for everything. Measured: the
       * first draft of this did exactly that and the test caught it. */
      pack.player.timed as unknown as readonly TimedTempBrandSlayRecord[],
      reg.objects.brands,
      reg.objects.slays,
    ),
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
   * carries the monsters, not the registry-side counters). */
  countMonsterRaces(state);

  /* SV-01 (load.c:532-535 rd_monster_memory, "ensure dead uniques stay dead";
   * mon-make.c:257 refuses a unique whose max_num is exhausted):
   * a fresh registry starts every UNIQUE at maxNum=1, and countMonsterRaces
   * above only rebuilds curNum from the live monster list - so a unique the
   * player already killed (restored lore pkills>0, but no live copy) would bind
   * back at maxNum=1 and could respawn / be re-killed after a reload. Re-derive
   * maxNum=0 for those uniques, exactly as upstream does on load. */
  for (const race of reg.monsters.races) {
    if (!race) continue;
    if (
      race.flags.has(RF.UNIQUE) &&
      (state.lore.get(race.ridx)?.pkills ?? 0) > 0
    ) {
      race.maxNum = 0;
    }
  }

  /* savefile.c:647-651: loading a DEAD character with the wizard/cheat-death
   * launch flag set resurrects it (is_dead cleared, HP refilled) and flags it
   * NOSCORE_WIZARD, keeping it off the high-score table (gap 15.3). A normal
   * load (wizard off) leaves a dead character dead. */
  if (save.isDead && opts.wizard) {
    player.chp = player.mhp;
    player.chpFrac = 0;
    player.noscore = markNoscore(player.noscore, NOSCORE.WIZARD);
    state.isDead = false;
  }

  /* A save taken in single combat resumes it, INCLUDING the level it was
   * entered from - upstream keeps that in the chunk_list and the savefile
   * carries it. Rebuilt through the frozen-level cache deserializer, which is
   * the same code path the live level and the persistent cache use. A save
   * written before the stash was persisted has no `stash` key and reloads with
   * the old behaviour: winning exits to a fresh level of the same depth. */
  if (save.arena) {
    state.arenaLevel = true;
    state.oldGrid = loc(save.arena.oldGrid.x, save.arena.oldGrid.y);
    if (save.arena.stash) {
      const rebuilt = deserializeLevelCache(
        [save.arena.stash],
        reg.features,
        reg.monsters,
        reg.objects,
        reg.traps,
        ids,
      );
      const level = rebuilt.get(save.arena.stash.depth);
      if (level) {
        state.arenaStash = { ...level, monMidx: save.arena.monMidx ?? 0 };
      }
    }
  }

  /* seed_flavor from the save (load.c L960). Older saves predate it; fall
   * back to 0 so flavor_init still produces a stable per-load assignment. */
  const seedFlavor = save.seedFlavor ?? 0;
  const wired = wireGame(state, reg, players, pstate, seedFlavor);
  /* rd_gear's tail (load.c:1187). */
  buildGearViews(state, reg, pstate.ammoTval);
  /* restore() replaces the aware/tried sets, so it must run AFTER flavor_init's
   * aware-marking of non-flavoured kinds - the save is the source of truth for
   * what the player has actually identified. */
  wired.flavor.restore(deserializeFlavor(save.flavor, ids));
  /* kind/ego everseen (save.c L397/L533): absent in saves written before
   * everseen tracking, which load with an empty set. */
  if (save.everseen) wired.everseen.restore(deserializeEverseen(save.everseen, ids));
  if (save.ignore) state.ignore.restore(deserializeIgnore(save.ignore, ids));
  /* Per-kind autoinscriptions (obj-ignore.c note_aware/note_unaware): absent in
   * saves written before this block, which load with an empty registry. */
  if (save.autoinscriptions && state.autoinscribe) {
    deserializeAutoinscriptions(save.autoinscriptions, state.autoinscribe, ids);
  }
  /* Per-RUNE autoinscriptions (rd_ignore's rune block, load.c:934-945):
   * rd_s16b(runeid) + rd_string, straight into rune_set_note. The savefile keys
   * by runeKey, so resolve each back to its live buildRuneList index; a key the
   * running pack no longer builds is dropped. Absent in saves written before
   * this block, which load with no rune notes. */
  if (save.runeNotes && state.runeNotes) {
    const runes = buildRuneList(state.runeEnv);
    const byKey = new Map<string, number>();
    runes.forEach((rune, i) => byKey.set(runeKey(rune), i));
    for (const [key, note] of save.runeNotes) {
      const i = byKey.get(key);
      if (i !== undefined) state.runeNotes.set(i, note);
    }
  }

  // A renderer-facing view of the restored level (no generation ran).
  const booted: BootedLevel = {
    chunk,
    depth: chunk.depth,
    /* The restored level's connectors live on state.currentJoins, which the
     * savefile already carries; this view describes a level nothing
     * generated, so it reports none. */
    joins: [],
    playerSpot: actor.grid,
    monsters: [],
    objects: [],
    trapGrids: [],
    traps: [],
    lockedDoors: [],
    rng,
    registries: reg,
  };

  /* Resuming in town: re-stock the shops (store stock is not persisted). */
  refreshTownStores(state, reg);

  /* One level changer, shared with reincarnate - see the note at startGame's. */
  const changeLevel = makeChangeLevel(state, reg, wired.trapDeps, {
    inArena: !!save.arena,
  });

  return {
    state,
    registry: wired.registry,
    effects: wired.effects,
    booted,
    players,
    flavor: wired.flavor,
    everseen: wired.everseen,
    seedFlavor,
    manifest: reconciledManifest,
    mods: save.mods ?? {},
    orphans: quarantine.orphans,
    orphansAcknowledged: save.orphansAcknowledged ?? false,
    mismatchedPacks,
    ...(migration.applied.length > 0 || migration.notes.length > 0
      ? { saveMigration: { applied: migration.applied, notes: migration.notes } }
      : {}),
    options,
    randartSeed,
    changeLevel,
    reincarnate: makeReincarnate(
      state,
      reg,
      players,
      wired.flavor,
      wired.everseen,
      changeLevel,
    ),
    wizardBundles: wired.wizardBundles,
    ...makeStoreApi(state, reg, wired.flavor, options, wired.registry),
  };
}

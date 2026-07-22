/**
 * The mutable game state the turn loop operates on, plus the square-occupancy
 * helpers the AI and player turn read.
 *
 * struct player upstream carries grid/energy/speed/total_energy; the port's
 * Player (player/player.ts) deliberately omits the world/UI-only members, so
 * this module holds them in a PlayerActor wrapper alongside the Player. Live
 * monsters live in a flat array indexed by midx (index 0 unused, matching
 * cave_monster(cave, i) for i >= 1); Chunk.mon(grid) stores the occupant
 * (0 empty, > 0 a monster's midx, < 0 the player) exactly as upstream's
 * square(c, grid)->mon.
 *
 * The loop couples to the outside world only through injected hooks: a
 * command provider (so it never blocks on real input) and an FOV-update hook
 * (called after the player moves, as game code calls update_view).
 */

import { MON_TMD, RF, TMD } from "../generated";
import type { GameEvents } from "../events";
import type { MessageLog } from "../msg";
import type { Loc } from "../loc";
import { distance, locEq } from "../loc";
import type { Connector } from "../gen/util";
import type { Rng } from "../rng";
import type { Chunk } from "../world/chunk";
import type { Player } from "../player/player";
import type { Monster } from "../mon/monster";
import type { MeleeAttack, PlayerCombatState } from "../combat/melee";
import type { DefenderState } from "../combat/mon-melee";
import type { GameObject } from "../obj/object";
import type { Brand, Slay } from "../obj/types";
import type { FlavorAwareDeps, FlavorKnowledge } from "../obj/knowledge";
import type { Gear } from "./gear";
import type { Store } from "../store/store";
import { NORMAL_ENERGY } from "./energy";
/* Value import is safe: mon-group's imports from this module are type-only,
 * so there is no runtime cycle. */
import { monsterRemoveFromGroups } from "./mon-group";

/**
 * z_info fields the turn loop and monster AI read (defaults are the shipped
 * constants.txt values). Kept as a plain record so tests can override any
 * single field.
 */
export interface GameConstants {
  /** z_info->move_energy. */
  moveEnergy: number;
  /** z_info->max_sight (flee_range = max_sight + flee-range). */
  maxSight: number;
  /** z_info->max_range (the projectable / targeting range bound). */
  maxRange: number;
  /** z_info->flee_range. */
  fleeRange: number;
  /** z_info->turn_range (nearby monsters won't run away). */
  turnRange: number;
  /** z_info->repro_monster_max (mon-gen:repro-max): breeder cap per level. */
  reproMonsterMax: number;
  /** z_info->repro_monster_rate (mon-play:mult-rate): 1/(k*rate) breed chance. */
  reproMonsterRate: number;
  /** z_info->glyph_hardness (mon-play:break-glyph): monster glyph-break roll. */
  glyphHardness: number;
  /** z_info->day_length (is_daytime; the town day/night cycle). */
  dayLength: number;
  /** z_info->food_value. */
  foodValue: number;
  /** PY_FOOD_STARVE / _FAINT / _WEAK / _HUNGRY (food_value-scaled grade maxima). */
  foodStarve: number;
  foodFaint: number;
  foodWeak: number;
  /** PY_FOOD_HUNGRY (Hungry grade max, food_value-scaled): fast-metabolism cutoff. */
  foodHungry: number;
  /** z_info->alloc_monster_chance (mon-gen:chance): 1/N ambient spawn chance. */
  allocMonsterChance: number;
  /** z_info->store_turns (store:turns): dungeon turns per store day. */
  storeTurns: number;
  /** z_info->life_drain_percent (mon-play:life-drain): exp-drain scaling. */
  lifeDrainPercent: number;
  /** z_info->level_monster_max (level-max:monsters): monster-list capacity. */
  levelMonsterMax: number;
  /** z_info->floor_size (obj:floor-size): max objects in one floor pile. */
  floorSize: number;
  /** z_info->max_depth (world:max-depth): the trapdoor legality bound. */
  maxDepth: number;
  /** z_info->stair_skip (world:stair-skip): deep-descent increment scale. */
  stairSkip: number;
}

/** The shipped constants.txt values, food thresholds scaled by food_value. */
export const DEFAULT_GAME_CONSTANTS: GameConstants = {
  moveEnergy: NORMAL_ENERGY,
  maxSight: 20,
  maxRange: 20,
  fleeRange: 5,
  turnRange: 5,
  reproMonsterMax: 100,
  reproMonsterRate: 8,
  glyphHardness: 550,
  dayLength: 10000,
  foodValue: 100,
  foodStarve: 100,
  foodFaint: 400,
  foodWeak: 800,
  foodHungry: 1500,
  allocMonsterChance: 500,
  storeTurns: 1000,
  lifeDrainPercent: 2,
  levelMonsterMax: 1024,
  floorSize: 23,
  maxDepth: 128,
  stairSkip: 1,
};

/**
 * The player's world/turn-loop state (the struct player members the port's
 * Player omits), plus the combat/defence views combat needs. `combat` backs
 * py_attack (player-attack.c p->state) and `defense` backs make_attack_normal
 * (p->state.ac + p->state.to_a); calc_bonuses that would derive them is
 * deferred (player/calcs.ts), so they are supplied explicitly.
 */
export interface PlayerActor {
  player: Player;
  /** p->grid. */
  grid: Loc;
  /** p->energy. */
  energy: number;
  /** p->state.speed (net speed after effects; 110 = normal). */
  speed: number;
  /** p->total_energy (cumulative energy spent). */
  totalEnergy: number;
  /** player-attack.c reads this as p->state. */
  combat: PlayerCombatState;
  /** make_attack_normal reads ac + to_a from this. */
  defense: DefenderState;
  /** The wielded melee weapon, or null for unarmed (py_attack). */
  weapon: GameObject | null;
  /** p->state.skills[SKILL_STEALTH]; the AI's hearing math reads it. */
  stealth: number;
  /** p->state.cur_light (calc_light): the derived light radius. */
  light: number;
  /** state.pflags PF_UNLIGHT: the derived unlight status. */
  unlight: boolean;
}

/**
 * struct monster_group (mon-group.c): a pack of monsters sharing a leader.
 * `members` is the member midx list; its head is the most recently added
 * member, mirroring upstream's member_list (add prepends).
 */
export interface MonsterGroup {
  /** The group's index in state.groups. */
  index: number;
  /** midx of the group leader (0 = none). */
  leader: number;
  /** Member midx list, head-first (most recently added). */
  members: number[];
}

/**
 * A dungeon level frozen under birth_levels_persist (#30): the exact per-level
 * field-set changeLevel shuffles, plus the game turn it was frozen at. This is
 * the serializable, depth-keyed generalization of session/game.ts' in-memory
 * arena stash (upstream's cave_store into the chunk_list, generate.c L1017).
 * `turn` is the freeze turn (cave_store stamps chunk->turn, generate.c L1032),
 * read by restore_monsters (mon-move.c L2007) to recover the monsters over the
 * turns elapsed while the level was out of play.
 */
export interface StoredLevel {
  chunk: Chunk;
  monsters: Array<Monster | null>;
  groups: Array<MonsterGroup | null>;
  floor: Map<number, GameObject[]>;
  traps: Map<number, import("./trap").Trap[]>;
  known: import("./known").KnownMap;
  decoy: Loc | null;
  turn: number;
  /**
   * chunk->join (generate.c L1203-1214): the level's stair connectors, so a
   * re-entered / adjacent persistent level can align up/down stairs via
   * getJoinInfo. Empty when the level recorded no stairs (or for old saves).
   */
  join: Connector[];
}

/**
 * The full mutable game state. `turn` is the upstream int32 game-turn counter;
 * `monsters` is indexed by midx with index 0 unused. Signals mirror the
 * upstream player->upkeep flags the loop branches on.
 */
export interface GameState {
  rng: Rng;
  chunk: Chunk;
  actor: PlayerActor;
  /**
   * The player's gear store (obj-gear.c): a handle -> object map, the pack
   * (non-equipped handles) and the equipment[] handles on actor.player.
   * Populated at birth by outfitPlayer (game/gear.ts).
   */
  gear: Gear;
  /** cave_monster(cave, i): live monsters, index 0 unused (null). */
  monsters: Array<Monster | null>;
  /** cave->monster_groups[]: monster packs, index 0 unused (null). */
  groups: Array<MonsterGroup | null>;
  /**
   * Floor object piles (square(c, grid)->obj), keyed by grid index
   * (y * width + x). Each pile is head-first: pile_insert prepends, so
   * pile[0] is the newest drop, exactly as the upstream linked list.
   * Managed by game/floor.ts (floor_carry / drop_near / excise).
   */
  floor: Map<number, GameObject[]>;
  /**
   * Live traps (square(c, grid)->trap), keyed by grid index, newest
   * first. Managed by game/trap.ts (place_trap / hit_trap / locks).
   * The type import is erased, so no runtime cycle with game/trap.
   */
  traps: Map<number, import("./trap").Trap[]>;
  /**
   * The player's map knowledge (the upstream player->cave twin, reduced):
   * remembered terrain and floor objects, possibly stale. Managed by
   * game/known.ts (square_memorize / note_spot / detection).
   */
  known: import("./known").KnownMap;
  /**
   * The player's target (target.c's file-statics). Managed by
   * game/target.ts (target_set_monster / target_okay / fix / release).
   */
  target: import("./target").TargetState;
  /**
   * The player's ignore settings (obj-ignore.c's file-statics: quality tiers,
   * ego ignore, per-kind flags). Defaults to nothing ignored. Persists in the
   * save. Read through state.isIgnored (built by the session with flavor
   * awareness), so worldless code stays decoupled from flavor knowledge.
   */
  ignore: import("../obj/ignore").IgnoreSettings;
  /**
   * The per-kind autoinscription registry (obj-ignore.c note_aware/note_unaware,
   * obj/knowledge.ts AutoinscriptionRegistry). Notes registered through the
   * knowledge-menu manager are applied by game/obj-cmd.ts's applyAutoinscription
   * (wired via ObjCmdDeps.autoNote in session/game.ts) and persist in the save.
   * Optional so the worldless harness (game/harness.ts) stays total: absent,
   * autoinscribe is a no-op.
   */
  autoinscribe?: import("../obj/knowledge").AutoinscriptionRegistry;
  /**
   * ignore_item_ok(obj): whether an object is currently ignored. Installed by
   * the session (wireGame) with the flavor-awareness lookup baked in; absent,
   * nothing is ignored.
   */
  isIgnored?: (obj: GameObject) => boolean;
  /**
   * player->upkeep->notice's PN_IGNORE bit: object_flavor_aware's ignore fix
   * (obj-knowledge.c L2279) raises this when a newly-aware kind carries its
   * ignore-when-aware bit over, requesting an ignore_drop() re-check of the
   * pack. Set by FlavorAwareDeps.requestIgnoreNotice (obj/knowledge.ts) at
   * the in-play becomes-aware sites (store/transact.ts, game/obj-cmd.ts).
   * Consuming/clearing this (running ignore_drop, #25 UI) is a shell concern
   * and is not wired yet - ledgered like the rest of the ignore-drop UI.
   */
  noticeIgnore?: boolean;
  /**
   * object_flavor_is_aware(kind): whether the player has identified this
   * kind's flavour. Installed by the session (wireGame) from flavor
   * knowledge, so presentation code (obj-list.c, #25) stays decoupled from
   * the flavor store the same way isIgnored does; absent, treated as aware.
   */
  isAware?: (kind: import("../obj/types").ObjectKind) => boolean;
  /**
   * obj->kind->flavor != NULL: whether flavor_init assigned this kind a
   * flavour. Installed by the session (wireGame) from the per-game
   * FlavorAssignment; absent, presentation falls back to the tval-only test.
   */
  hasFlavor?: (kind: import("../obj/types").ObjectKind) => boolean;
  /**
   * obj->kind->flavor->text: the flavour adjective ("Smoky") or scroll title
   * shown for an unaware flavoured object. Installed by wireGame from the
   * FlavorAssignment; absent, no '#' modstr is produced.
   */
  flavorText?: (kind: import("../obj/types").ObjectKind) => string;
  /**
   * The player option store (option.c op_ptr->opt / hitpoint_warn). Built by
   * the session (startGame / loadGame) from OPTION_ENTRIES defaults and the
   * birth-option choices; persists in the save. Optional so worldless tests
   * (game/harness.ts) stay total - each deferred seam reads it as
   * `dep ?? state.options?.get(name) ?? <shipped default>`, so an absent store
   * reproduces the shipped defaults exactly.
   */
  options?: import("../player/options").OptionState;
  /**
   * aup_info[] (obj-make.c): the shared per-artifact created flags. The
   * session owns the single per-game instance and threads it into every
   * MakeDeps so no artifact spawns twice; it is serialized in the save.
   * Optional so the worldless harness (game/harness.ts) stays total.
   */
  artifacts?: import("../obj/make").ArtifactState;
  /**
   * kind->everseen / ego->everseen (object_kind/ego_item; save.c L397/L533):
   * the per-game "ever seen" flags for object kinds and egos, marked the first
   * time the player sees an item whose name they know (obj-desc.c L633-637) and
   * for each bought start item (player-birth.c L658). Read by the object/ego
   * knowledge browsers; installed by wireGame; serialized in the save. Optional
   * so the worldless harness stays total (absent = nothing ever seen).
   */
  everseen?: import("../obj/knowledge").EverseenKnowledge;
  /**
   * The per-game flavor-awareness store (FlavorKnowledge). Installed by wireGame
   * so the game-layer knowledge sweep (game/known.ts updatePlayerObjectKnowledge,
   * the port of update_player_object_knowledge) can flip a kind aware when a
   * rune-learn completes a carried jewel's non-curse runes. Absent in the
   * worldless harness, where the sweep is a no-op (no flavor store to mutate).
   */
  flavorKnown?: FlavorKnowledge;
  /**
   * The in-play FlavorAwareDeps object_flavor_aware needs (the ignore-fix
   * side-channel). Installed by wireGame alongside flavorKnown; absent, the
   * sweep passes the no-op deps.
   */
  flavorAwareDeps?: FlavorAwareDeps;
  /**
   * The live derived player state (upstream p->state), the result of the last
   * calc_bonuses. update_mon (game/known.ts) reads its OF flag set (telepathy /
   * see-invisible) and see_infra to compute monster visibility. Reassigned by
   * the session on every refreshDerived (equip / level / timed change); absent
   * in the worldless harness, where update_mon falls back to the bare race
   * infravision and an empty flag set.
   */
  playerState?: import("../player/calcs").PlayerState;
  /**
   * player->upkeep->health_who (health_track reduced to the tracked
   * monster; the health-bar redraw rides presentation, #25).
   */
  healthWho?: Monster | null;
  /**
   * Monster memory (upstream l_list), keyed by race.ridx and created
   * lazily by getLore (mon/lore.ts). Persists across levels and in the
   * save.
   */
  lore: import("../mon/lore").LoreStore;
  /** turn (game-world.c): the game-turn counter. */
  turn: number;
  /**
   * cave->num_repro (cave.h): the count of RF_MULTIPLY breeders on the current
   * level, the denominator gate of monster_turn_multiply's cap. Reset and
   * recounted by countMonsterRaces on level load, bumped by placeMonsterLive
   * and dropped by deleteMonster. Absent is treated as 0.
   */
  numRepro?: number;
  /**
   * daycount (game-world.c): the number of store turnovers accrued while in
   * the dungeon; the town stores restock this many days on return. Persists in
   * the save. Absent is treated as 0.
   */
  daycount?: number;
  /**
   * player->resting_turn (player.h:554, u32; save.c:507): the cumulative count
   * of player turns spent resting, shown on the character sheet (ui-player.c:836)
   * and reset only at birth (player-birth.c:449). DISTINCT from resting.turnsRested
   * (the per-session file-static player_turns_rested that gates the x2 regen):
   * resting_turn accumulates for the character's whole life. Bumped once per rested
   * turn (player-util.c:1487). Persists in the save; absent is treated as 0.
   * The live producer (the rest command) lives outside this module - see the
   * WIRING-NEEDED note in session/save.ts.
   */
  restingTurn?: number;
  /**
   * player->skip_cmd_coercion (player.h:560, u8; save.c:490): the bloodlust
   * command-coercion skip state (0/1/2) - set when a bloodlust-forced command was
   * cancelled so the next command is not re-coerced (cmd-core.c:367-385) and
   * decremented by the world clock (game-world.c:856-901). Persists in the save;
   * absent is treated as 0. Live producer is outside this module (WIRING-NEEDED).
   */
  skipCmdCoercion?: number;
  /**
   * player->unignoring (player.h:558, u8; save.c:491): the temporary "show
   * ignored items" toggle (ui-object.c:1841; consulted by obj-ignore.c:624-640
   * and the status line ui-display.c:1282). Persists in the save; absent is
   * treated as 0 (ignoring active). Live producer is outside this module
   * (the UI toggle - WIRING-NEEDED).
   */
  unignoring?: number;
  /**
   * player->opts.name_suffix (option.h:68, u8; save.c:432): the numeric suffix
   * appended to the character name for the high-score table when names collide.
   * Set at birth. Persists in the save; absent is treated as 0. Live producer is
   * outside this module (the birth/score path - WIRING-NEEDED).
   */
  nameSuffix?: number;
  /**
   * The rolling message log (message.c file-statics; msg.ts MessageLog),
   * persisted in the savefile (wr_messages/rd_messages, save.c:339-353 /
   * load.c:471-495). Upstream is a global; the port holds the live instance
   * here so it can be serialized. Absent in the worldless harness and in saves
   * written before message persistence, which load with an empty log. The live
   * append path (routing msg()/msgt() into this log) lives outside this module
   * (session wiring - WIRING-NEEDED).
   */
  messages?: MessageLog;
  z: GameConstants;
  /** Object domain tables for player melee brands/slays (index 0 = none). */
  brands: readonly (Brand | null)[];
  slays: readonly (Slay | null)[];
  /**
   * Rune-learning environment (obj-knowledge.c learn-by-use): registry
   * tables plus equipment access. Built by the session (wireGame); the
   * harness supplies an inert default so worldless tests stay total.
   */
  runeEnv: import("../obj/knowledge").RuneEnv;

  /* --- upkeep signals (player->upkeep) --- */
  playing: boolean;
  /** player->is_dead. */
  isDead: boolean;
  /** player->upkeep->generate_level (a stairs/recall level change). */
  generateLevel: boolean;
  /**
   * The depth the pending level change targets (dungeon_change_level's
   * argument). Set with generateLevel by stairs / trapdoors / deep
   * descent; consumed by the session's changeLevel.
   */
  targetDepth?: number;
  /**
   * player->upkeep->arena_level: the player is in (or headed to) single
   * combat. Set by EF_SINGLE_COMBAT; cleared by the arena exit.
   */
  arenaLevel?: boolean;
  /** player->old_grid: where to stand again after the arena. */
  oldGrid?: Loc;

  /**
   * The running engine's live state (player-path.c). Created lazily by the
   * run action (game/player-path.ts); absent until the player first runs.
   */
  run?: RunState;

  /**
   * player->upkeep->resting + the file-static player_turns_rested
   * (player-util.c:1417,1472). count mirrors upkeep->resting (>0 = timed turns
   * left, or a REST_ special: COMPLETE=-2, ALL_POINTS=-1, SOME_POINTS=-3);
   * turnsRested gates the x2 regen. Set/tracked by the web rest command
   * (packages/web main.ts driveRest); absent when not resting.
   */
  resting?: { count: number; turnsRested: number };

  /* --- injected hooks --- */
  /**
   * cmdq: the internal command queue (cmd-core.c). Self-continuing commands
   * (running re-queues CMD_RUN) push here; processPlayer drains it before
   * nextCommand so a run advances without new input. disturb() flushes it.
   */
  cmdQueue?: PlayerCommand[];
  /** cmdq_pop: the next queued player command, or null when input is needed. */
  nextCommand: () => PlayerCommand | null;
  /** update_view: refresh player FOV after the player moves. */
  updateFov?: (state: GameState) => void;
  /**
   * make_ranged_attack: a monster attempts a spell / breath on its turn,
   * returning true if it spent the turn casting. Installed by
   * installMonsterCasting (game/mon-ranged.ts); absent, monsters never cast.
   */
  monsterCast?: (mon: Monster, state: GameState) => boolean;
  /**
   * multiply_monster (mon-make.c L983): a breeder tries to spawn a copy in an
   * adjacent empty grid, returning true on success. Installed by wireGame
   * (session/game.ts) from game/mon-place.ts multiplyMonster; absent, breeders
   * never actually reproduce (monster_turn_multiply still draws its cap /
   * chance rolls, so the RNG stream is unchanged when it is wired).
   */
  monsterMultiply?: (mon: Monster) => boolean;
  /**
   * square_door_power (cave-square.c): the lock strength on a closed door
   * (0 = unlocked). Door locks are the "door lock" trap (#21), so this seams
   * back the trap system; installed by wireGame. Absent, every door reads as
   * unlocked - the RNG-free path monster_turn_can_move already takes when no
   * trap system is live.
   */
  doorLockPower?: (grid: Loc) => number;
  /** square_set_door_lock: set a closed door's lock strength (trap #21 seam). */
  setDoorLock?: (grid: Loc, power: number) => void;
  /**
   * player_best_digger (player-util.c L744) + the do_cmd_tunnel_aux /
   * compute_rubble_penalty swap: the DIGGING skill the dig should use, having
   * temporarily wielded the pack's best digger and recomputed calc_bonuses.
   * Installed by wireGame (it closes over the live calc_bonuses options).
   * RNG-free (input only). Absent (worldless harnesses), digging falls back to
   * the wielded state's DIGGING skill, as before.
   */
  bestDiggerDigging?: () => number;
  /**
   * square_open_door / square_smash_door remove the "door lock" trap before
   * changing the feature; this seams that removal back to the trap system.
   * Absent, the (harmless, feature-gated) lock trap is simply left in place.
   */
  removeDoorLock?: (grid: Loc) => void;
  /**
   * make_attack_normal's blow-effect environment (game/mon-side.ts): binds a
   * MonBlowEnv to an attacking monster so combat/mon-melee.ts applies the full
   * status / stat / theft / terrain consequences of a melee blow in upstream
   * RNG order. Installed by wireGame; absent, monster melee falls back to the
   * worldless stub-log intents (the physical HP slice only).
   */
  monBlowEnv?: (mon: Monster) => import("../combat/mon-melee").MonBlowEnv;
  /**
   * do_cmd_mon_command: while TMD_COMMAND runs, player commands drive the
   * commanded monster instead (upstream swaps the command list,
   * cmd-core.c L333). Installed by installMonCommand (game/mon-cmd.ts);
   * returns the energy spent.
   */
  monCommand?: (state: GameState, cmd: PlayerCommand) => number;
  /**
   * do_autopickup after a step: returns the energy the pickup cost (picked
   * * move_energy / 10, capped). Installed by installPickup (game/pickup.ts);
   * upstream queues CMD_AUTOPICKUP instead - the port folds the identical
   * cost into the step because the command provider is injected.
   */
  autoPickup?: (state: GameState) => number;
  /**
   * Runs after the player steps onto a new grid (move_player's trap /
   * terrain consequences). Installed by installTraps (game/trap.ts).
   */
  onPlayerMoved?: (state: GameState, grid: Loc) => void;
  /**
   * QoL auto-dig seam (the bundled `qol` mod, flag "qol.autoDig"): consulted by
   * walkAction (game/player-turn.ts) when a walk is blocked by a wall, BEFORE
   * the faithful no-energy bump. Returns the energy spent starting a dig (a full
   * move), or 0 to fall through to the bump. Installed by the session
   * (movementAutoDig, game/cave-cmd.ts); it itself returns 0 without drawing RNG
   * unless the "qol.autoDig" flag is on and the grid is diggable, so an absent
   * hook or an off flag keeps movement byte-identical to faithful 4.2.6.
   */
  autoDigStep?: (state: GameState, grid: Loc) => number;
  /**
   * player_kill_monster's reward slice: runs when the PLAYER kills a
   * monster, before it is deleted (experience now; drops/lore/quests join
   * it with their subsystems). Installed by the session (wireGame).
   */
  onPlayerKill?: (mon: Monster) => void;
  /**
   * become_aware (mon-util.c L711, game/known.ts): reveal a camouflaged
   * mimic - clears MFLAG_CAMOUFLAGE, learns RF_UNAWARE, and (once object-mimic
   * placement is ported) drops the fake floor item. Installed by the session
   * (wireGame) and threaded into every existing becomeAware? hook config
   * (mon/take-hit.ts, game/project-monster.ts, game/mon-ranged.ts) plus the
   * direct player/monster melee call sites (game/effect-melee.ts,
   * game/mon-cmd.ts) and the player-adjacent bump paths (game/player-turn.ts
   * walkAction, game/cave-cmd.ts attackBlocker). Absent, camouflaged monsters
   * are attacked instead of unmasked - matching pre-#31 behaviour.
   */
  becomeAware?: (mon: Monster) => void;
  /**
   * object_touch's history_find_artifact call (obj-knowledge.c L971): fires
   * when an artifact enters the pack for the first time. Installed by the
   * session (wireGame); pickup.ts's playerPickupAux calls it, keeping the
   * hook alive across a later installPickup re-registration (which only
   * replaces the message-hook env, not this state-level slot).
   */
  onArtifactFound?: (art: import("../obj/types").Artifact) => void;
  /**
   * history_lose_artifact (player-history.c L246): fires when a known artifact
   * is lost - destroyed by an effect (effect-handler-attack/general.c),
   * abandoned on a regenerated level (generate.c), or discarded by a store the
   * player sold it to (store.c do_cmd_sell / store_delete_random / store_maint).
   * Installed by the session (wireGame); marks the artifact's history entry
   * "Missed", or logs a fresh one.
   */
  onArtifactLost?: (art: import("../obj/types").Artifact) => void;
  /**
   * py_attack's message slice: runs after the player melees a monster, with
   * the full blow-by-blow result (hits, damage, crit HitType, and whether the
   * monster died). The combat code returns only HitType keys - the text is a UI
   * concern (combat/melee.ts) - so a shell installs this to render faithful
   * "You hit/miss/slay the X" messages. Called before the monster is deleted.
   */
  onMelee?: (mon: Monster, result: MeleeAttack) => void;
  /**
   * Monster-AI override hook (W2.2 mod seam). Consulted at the very top of
   * monsterTurn (monster-turn.ts): returning true takes the monster's whole
   * turn over (the ported AI is skipped for that monster this turn); returning
   * false falls through to the faithful AI. Absent by default, so core
   * behaviour is byte-identical. Installed by a trusted in-process plugin via
   * ModRegistryHost.monsters.setTurnHook (mod/registry-host.ts).
   */
  monsterTurnHook?: (mon: Monster, state: GameState) => boolean;
  /**
   * Named boolean "mod rule" flags (the declarative bundled-mod seam behind the
   * qol / bug-fixes mods). DEFAULT ABSENT/EMPTY, so faithful core reads every
   * flag as false and is byte-identical to 4.2.6 with no mod enabled. The HOST
   * resolves each enabled mod's manifest `rules` (PackManifest.rules: flag /
   * title / description / default) against the player's saved Fixes & tweaks
   * choices and seeds this map at startGame / loadGame (opts.modRules); the menu
   * can also toggle a flag live. Each ported core function keeps the faithful
   * 4.2.6 branch as the default and an off-by-default corrected/new branch guarded
   * by modRuleEnabled(state, "<flag>"). Disabling the mod (or a rule) drops the
   * flag and returns core to faithful behaviour. Read only through modRuleEnabled
   * so the "absent = faithful" contract is enforced in one place.
   */
  modRules?: Record<string, boolean>;
  /**
   * PU_BONUS | PU_HP | PU_MANA: recompute the derived state from the
   * current gear (equipment commands call this after changing what is
   * worn). Installed by the session (wireGame).
   */
  updateBonuses?: () => void;
  /**
   * state->stat_ind: the six internal stat indices from the last
   * calc_bonuses, kept live (updateBonuses refreshes it in place). The
   * casting math (spell_chance / spell_cast) reads it, and a shell reads it
   * to show live fail chances; absent only before the first bonus calc.
   */
  statInd?: readonly number[];
  /**
   * cave->decoy: the grid of the player's active decoy glyph (EF_GLYPH with
   * GLYPH_DECOY), or absent/null when none is deployed. Level state, like
   * traps; cleared when the decoy trap is destroyed or the level changes.
   */
  decoy?: Loc | null;
  /**
   * birth_levels_persist (#30) frozen-level cache, keyed by depth. The standard
   * dungeon has exactly one level per depth, so `depth` (a number) is the
   * faithful identity for upstream's level NAME key (chunk_find_name of
   * level_by_depth(depth)->name, generate.c L1414); town is depth 0. Populated
   * only while the option is on; the whole persist path in changeLevel is gated
   * on the option, so default play never reads or writes it. Serialized in the
   * save (session/save.ts); absent / empty means no frozen levels.
   */
  levelCache?: Map<number, StoredLevel>;
  /**
   * chunk->join for the level currently in play (generate.c L1203-1214),
   * captured from generateLevel / restored from the frozen cache. Frozen into
   * StoredLevel.join on level change and persisted (session/save.ts) so a
   * first-visit persistent level can seed its stairs from adjacent levels.
   * Only meaningful under birth_levels_persist; undefined otherwise.
   */
  currentJoins?: Connector[];
  /**
   * The preset target-item reference for an item-choosing effect (the port of
   * cmd_get_item's "tgtitem" command argument, cmd-core.c L1056). Set by the
   * object / spell command from cmd.args.tgtitem just before effect_do, read by
   * the getItem seam (session/game.ts resolveTargetItem), and cleared after the
   * run. Absent means the shell did not pre-resolve a pick, so the choosing
   * handler aborts (the upstream cancel path). One-shot: the getItem seam clears
   * it once consumed so a two-prompt effect cannot reuse the same object.
   */
  itemTarget?: ItemTargetRef | null;
  /**
   * The unfulfilled item request left behind when a choosing handler ran with no
   * (or a filter-failing) preset target - the shell's defensive fallback reads
   * it to re-prompt. Absent in the normal probe/pre-resolution flow.
   */
  itemRequest?: import("./effect-item").ItemRequest | null;
  /**
   * The preset curse index for EF_REMOVE_CURSE's get_curse selection (the port
   * of cmd_get_arg_choice on a multi-curse item). Set from cmd.args.tgtcurse;
   * read by the chooseCurse seam; cleared after the run. Absent picks the first
   * removable curse (upstream get_curse's default), never a random one.
   */
  curseTarget?: number | null;
  /**
   * The world-event message sink (the recall yank, the deep-descent floor
   * opening). Presentation (#25) installs it; absent, the messages drop.
   */
  msg?: (text: string) => void;
  /**
   * sound(msgt): play the sound bound to a MSG_* type (message.c sound()).
   * A front end wires it to its audio engine (the web build emits the core
   * EVENT_SOUND onto its sound bus); absent, sound is silent. The engine's
   * own message->sound map and dedup ride #26; this is only the emit seam.
   */
  sound?: (msgType: number) => void;
  /**
   * The game event bus (events.ts), when a host attaches one. Core-to-anything
   * seam: the host routes messages/sound through it and mods subscribe (the
   * capability-gated agent/events.ts subscribeEvents). Absent in the worldless
   * harness; core never requires it.
   */
  events?: GameEvents;
  /**
   * The live town stores (store.c `stores`), indexed however the session
   * instantiates them; a shell looks a store up by its entrance feature. Set
   * when the town level is generated; absent in the dungeon.
   */
  stores?: Store[];
  /**
   * process_world upkeep environment (game/world.ts): the bound timed-effect
   * table, take_hit / timed hooks, the ambient-spawn and cave-illuminate
   * hooks, and exp deps the once-every-ten-turns world clock needs. Installed
   * by the session (wireGame) and the test harness. Absent, decrease_timeouts
   * falls back to raw mutation and the damage-over-time / digestion / recharge
   * upkeep is skipped (the ambient-spawn roll is still drawn unconditionally).
   */
  world?: import("./world").WorldClockEnv;
}

/**
 * A reference to an item-choosing effect's pre-resolved target object: a gear
 * handle (a pack, equipped or quiver object - all live in gear.store) or an
 * index into the floor pile under the player. The shell resolves the pick
 * asynchronously and rides it on the command's args.tgtitem; the getItem seam
 * turns it back into the live object.
 */
export type ItemTargetRef = { handle: number } | { floor: number };

/** One queued player command (a keyed action plus optional direction/args). */
export interface PlayerCommand {
  /** The action-registry key (e.g. "walk", "hold", "descend"). */
  code: string;
  /** Keypad direction 1..9 for movement commands. */
  dir?: number;
  /** Free-form arguments a mod-registered action may read. */
  args?: Readonly<Record<string, unknown>>;
}

/**
 * The running engine's state (player-path.c file-statics plus the
 * player->upkeep running counter). Created lazily by the run action; a
 * `running` of 0 means the player is not running. `firstStep` mirrors
 * upstream's running_firststep (the disturb-suppressed first step).
 */
export interface RunState {
  /** run_cur_dir: the direction we are moving. */
  curDir: number;
  /** run_old_dir: the direction we are considered to have come from. */
  oldDir: number;
  /** run_open_area: in the open on at least one side. */
  openArea: boolean;
  /** run_break_right: wall on the right, stop if it opens. */
  breakRight: boolean;
  /** run_break_left: wall on the left, stop if it opens. */
  breakLeft: boolean;
  /** player->upkeep->running: steps remaining (0 = not running). */
  running: number;
  /** player->upkeep->running_firststep. */
  firstStep: boolean;
  /**
   * player->upkeep->steps: a pathfinding path as forward keypad directions
   * in reverse order (index stepCount-1 is the next step); absent for a
   * plain run. Freed by disturb().
   */
  steps?: number[];
  /** player->upkeep->step_count: steps of `steps` left to take. */
  stepCount: number;
  /** player->upkeep->path_dest: the travel destination (kept across disturb). */
  pathDest?: Loc;
}

/**
 * Whether a named "mod rule" flag is enabled (the bug-fixes mod seam). The
 * single reader for state.modRules: absent map or absent/false flag both mean
 * OFF, which is the faithful 4.2.6 branch everywhere it is consulted. A core
 * function reads it as `if (modRuleEnabled(state, "bugfix.x")) { corrected }
 * else { faithful 4.2.6 }`, so core is byte-identical when no mod set the flag.
 */
export function modRuleEnabled(state: GameState, name: string): boolean {
  return state.modRules?.[name] === true;
}

/** cave_monster_max(cave): one past the highest occupied monster slot. */
export function monsterMax(state: GameState): number {
  return state.monsters.length;
}

/** cave_monster(cave, i): the monster in slot i, or null. */
export function monsterAt(state: GameState, i: number): Monster | null {
  return state.monsters[i] ?? null;
}

/**
 * Add a monster to the state and mark its grid occupied, assigning the next
 * free midx. Mirrors the midx/square bookkeeping place_new_monster does.
 */
export function addMonster(state: GameState, mon: Monster): number {
  if (state.monsters.length === 0) state.monsters.push(null);
  const midx = state.monsters.length;
  mon.midx = midx;
  state.monsters.push(mon);
  state.chunk.setMon(mon.grid, midx);
  return midx;
}

/** square_monster(c, grid): the monster occupying a grid, or null. */
export function squareMonster(state: GameState, grid: Loc): Monster | null {
  if (!state.chunk.inBounds(grid)) return null;
  const idx = state.chunk.mon(grid);
  return idx > 0 ? (state.monsters[idx] ?? null) : null;
}

/** square_isplayer(c, grid): the player occupies this grid. */
export function squareIsPlayer(state: GameState, grid: Loc): boolean {
  return locEq(grid, state.actor.grid);
}

/**
 * square_isempty reduced to the loop's needs: passable feature, no monster
 * and not the player. (Player-trap / web / object refinements DEFERRED.)
 */
export function squareIsEmpty(state: GameState, grid: Loc): boolean {
  if (!state.chunk.inBounds(grid)) return false;
  if (!state.chunk.isPassable(grid)) return false;
  if (state.chunk.mon(grid) !== 0) return false;
  return !squareIsPlayer(state, grid);
}

/**
 * monster_swap(grid1, grid2) for the two cases the ported AI produces: a
 * monster stepping into an empty grid, and two monsters trading places. The
 * player is never swapped here (the AI attacks the player instead of moving
 * onto it).
 */
export function monsterSwap(state: GameState, grid1: Loc, grid2: Loc): void {
  const c = state.chunk;
  const m1 = c.mon(grid1);
  const m2 = c.mon(grid2);
  c.setMon(grid1, m2);
  c.setMon(grid2, m1);
  const mon1 = m1 > 0 ? state.monsters[m1] : null;
  const mon2 = m2 > 0 ? state.monsters[m2] : null;
  if (mon1) mon1.grid = grid2;
  if (mon2) mon2.grid = grid1;
}

/**
 * delete_monster_idx (mon-make.c): remove the monster from its groups
 * (leader succession / group split happen here), forget its racial
 * occurrence, clear its square and free its slot. The held-object drop,
 * mimic and targeting/redraw bookkeeping are DEFERRED with their subsystems
 * (floor objects, lore); the caller runs monster_death (drops) beforehand.
 */
export function deleteMonster(state: GameState, midx: number): void {
  const mon = state.monsters[midx];
  if (!mon) return;
  monsterRemoveFromGroups(state, mon);
  /* If the monster was the target, forget it (target_set_monster(NULL),
   * inlined to keep this module below game/target.ts): a fixed target
   * keeps its grid for the rest of the spell, otherwise fully reset. */
  const t = state.target;
  if (t.midx === midx) {
    t.midx = 0;
    if (!t.fixed) {
      t.set = false;
      t.grid = { x: 0, y: 0 };
    }
  }
  /* If the monster was tracked, forget it (health_track(NULL)). */
  if (state.healthWho === mon) state.healthWho = null;
  /* A commanded monster dying releases the player (mon-make.c L345). */
  if (mon.mTimed[MON_TMD.COMMAND]) {
    state.actor.player.timed[TMD.COMMAND] = 0;
  }
  /* Decrease the racial counter (clamped: test-harness monsters register
   * without counting, so a naked decrement could go negative). */
  const race = mon.originalRace ?? mon.race;
  if (race.curNum > 0) race.curNum--;
  /* Count the number of "reproducers" (mon-make.c L328): the current race's
   * MULTIPLY flag decides, clamped for the same harness reason as curNum. */
  if (mon.race.flags.has(RF.MULTIPLY) && (state.numRepro ?? 0) > 0) {
    state.numRepro = (state.numRepro ?? 0) - 1;
  }
  state.chunk.setMon(mon.grid, 0);
  state.monsters[midx] = null;
}

/**
 * Mark the player's starting grid occupied (square(c, grid)->mon = -1) and
 * set actor.grid, mirroring how the player is placed on a fresh level.
 */
export function placePlayer(state: GameState, grid: Loc): void {
  state.actor.grid = grid;
  state.chunk.setMon(grid, -1);
}

/**
 * Move the player to a new grid, updating the square-occupancy marker
 * (clear the old grid, mark the new one with the player sentinel -1).
 */
export function movePlayer(state: GameState, grid: Loc): void {
  state.chunk.setMon(state.actor.grid, 0);
  state.actor.grid = grid;
  state.chunk.setMon(grid, -1);
}

/**
 * The mon_take_hit arena branch (mon-util.c L1290) for the game-layer
 * kill sites: a lethal player blow in single combat signals the level
 * change (the arena exit finishes the monster) instead of killing.
 * Returns true when the death was intercepted (skip the kill).
 */
export function arenaInterceptDeath(state: GameState, mon: Monster): boolean {
  if (!state.arenaLevel) return false;
  state.generateLevel = true;
  state.healthWho = mon;
  return true;
}

/** Refresh mon->cdis for every live monster (update_mon does this upstream). */
export function updateMonsterDistances(state: GameState): void {
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    mon.cdis = distance(mon.grid, state.actor.grid);
  }
}

/**
 * The agent API contract (P7 phase 7): the three capability-gated facades a mod
 * agent - the bundled Borg first, any third-party or AI agent after - drives the
 * game through. This is the frozen surface BORG_AS_MOD.md section 5 calls for,
 * built over the existing read model (GameState / KnownMap), act model
 * (ActionRegistry / PlayerCommand) and the runGameLoop LOOP_STATUS.INPUT seam.
 *
 * Three facades:
 * - PERCEIVE (AgentView): a stable, READ-ONLY view of the world covering the
 *   BORG_AS_MOD section-3 read surface, plus the message stream and turn
 *   counter. Capability: state:*.read.
 * - ACT (AgentActions): the section-3 semantic verbs as command builders, plus
 *   set-target by monster id or grid. Capability: command:add.
 * - CONTROLLER (AgentController): a decision function invoked at the
 *   LOOP_STATUS.INPUT boundary each time the game needs a command.
 *
 * Design note - why perceive returns PLAIN DATA, not a live proxy: every view
 * accessor returns a fresh plain-data snapshot (no references into live engine
 * objects), so the view is read-only by construction AND already serializable
 * across a future Web Worker sandbox boundary. That sidesteps the
 * "snapshot vs read-only proxy" fork (P7 plan phase 7): the same facade shape
 * serves the in-process bundled Borg now and a sandboxed plugin later, with only
 * the transport (direct call vs postMessage) differing.
 *
 * FREEZE STATUS: FROZEN at AGENT_API_VERSION 1.0.0 (ratified 2026-07-14, the
 * P7 -> P8 gate). The sample agent (agent.test.ts) exercises the whole surface
 * end-to-end and the maintainer ratified it against the BORG_AS_MOD section-3
 * checklist. The contract is now stable: fields may be ADDED (a minor bump) but
 * existing fields/semantics must not change without a major bump. P8 (the Borg)
 * rides this facade as the completeness proof.
 */

import type { GameConstants, PlayerCommand } from "../game/context.js";
import type { ContentIdResolver } from "../mod/ids.js";
import type { ObjRegistry } from "../obj/bind.js";
import type { ObjectKind } from "../obj/types.js";
import type { GameObject } from "../obj/object.js";
import type { ObjectInfoExtras } from "../game/object-inspect.js";
import type { MonsterRace } from "../mon/types.js";
import type { LoreDeps } from "../mon/lore-describe.js";
import type { ProjectionInfo } from "../world/projection.js";
import type { BlastAreaResult, BookItemResult, GridInspectResult, InspectResult, ItemRulesResult, ItemTesterResult, LoadoutSlotsResult, SpellInspectResult, TerrainCatalogueResult, TileActionsResult, TravelPathResult } from "./inspect.js";

/**
 * The frozen agent-API version (ratified 2026-07-14). Add-only from here: a new
 * field is a minor bump (1.x), any change to an existing field/semantics is a
 * major bump (2.0).
 *
 * 1.1.0 (2026-07-31): the glyph layer - `AgentViewDeps.glyphs`, and the
 * `glyph` / `trapGlyph` / `objectGlyph` / `MonsterView.glyph` fields it
 * unlocks. Added because the MCP server had grown a SECOND renderer with a
 * hand-written feature->character map (24 features named, everything else
 * drawn as `?`), which is the shape of defect this contract exists to prevent:
 * an agent could not see the map the player sees, and the invented table would
 * drift from the gamedata with nothing to notice. Purely additive - every
 * field is absent without the dep, exactly as `featCode` is without a resolver.
 *
 * 1.2.0 (2026-08-21): `AgentView.simulateLoadout` and the `LoadoutChange` /
 * `LoadoutSimulation` shapes it speaks in. Added because the view could describe
 * the character it HAS and nothing else, so every decision of the form "would
 * this item be better than the one I am wearing" had to be answered by summing
 * the item's own bonuses - a second implementation of calc_bonuses, guaranteed to
 * drift from the first. The accessor runs the engine's own derive over a
 * hypothetical set of worn objects. Purely additive, and optional: a view that
 * cannot derive omits it rather than answering approximately.
 *
 * 1.3.0 (2026-08-23): `PlayerView.classFlags` - PF_* codes from the player
 * class's own flag set. Added because the view had object flags and derived
 * skills but no way to answer "does this class have flag X" (issue #34: the
 * Borg's `borg_check_rest` needs PF_COMBAT_REGEN), which is class-definition
 * data rather than anything derivable from gear or level. Purely additive.
 *
 * 1.4.0 (2026-08-26): `PlayerStatusView`'s thirteen buff-timer fields (fast,
 * sprint, protEvil, hero, shero, shield, stoneskin, blessed, fastcast,
 * resAcid, resElec, resFire, resCold, resPois). Added because the view
 * exposed the eight negative afflictions upstream's own buff-timer
 * cross-check (`borg-trait.c:3010`) reads player->timed[] against, but none
 * of the buffs it also reads - so a mod tracking its own buffs from game
 * messages (neostryder/neo-angband-mod-borg#32) had no engine state to
 * cross-check against and could only trust its own bookkeeping. Purely
 * additive.
 */
export const AGENT_API_VERSION = "1.4.0";

/**
 * A command an agent emits - identical to the engine's PlayerCommand (codes 1:1
 * with upstream). Aliased so the public contract does not leak the internal
 * type name and can diverge later if needed.
 */
export type AgentCommand = PlayerCommand;

/* ------------------------------------------------------------------ *
 * Capability guard (structurally compatible with mod-sdk CapabilitySet).
 * ------------------------------------------------------------------ */

/**
 * The capability check the facades consult. Structurally satisfied by mod-sdk's
 * CapabilitySet (which exposes has(capability)), so the plugin runtime can pass
 * its CapabilitySet directly without core depending on mod-sdk. Absent (in-process
 * trusted host, e.g. the bundled Borg before the sandbox lands) means all granted.
 */
export interface AgentCapabilities {
  has(capability: string): boolean;
}

/**
 * Thrown when a facade or controller is used without a capability it requires.
 * Lives here (not controller.ts) so perceive/act can throw it without importing
 * the controller (which imports them).
 */
export class AgentCapabilityError extends Error {}

/**
 * The perceive-facade domain each AgentView accessor reads, gated by
 * "state:<domain>.read" (the "state:*.read" wildcard covers all). A view built
 * with no AgentCapabilities is a trusted host and every domain is granted.
 */
export const AGENT_STATE_DOMAINS = {
  turn: "turn",
  player: "player",
  monsters: "monsters",
  map: "map",
  inventory: "inventory",
  floor: "floor",
  target: "target",
  messages: "messages",
  stores: "stores",
  spells: "spells",
  constants: "constants",
} as const;

/* ------------------------------------------------------------------ *
 * PERCEIVE - the read surface.
 * ------------------------------------------------------------------ */

/** The player's timed status afflictions (turns remaining, 0 = clear). */
export interface PlayerStatusView {
  blind: number;
  confused: number;
  afraid: number;
  poisoned: number;
  cut: number;
  stun: number;
  paralyzed: number;
  /** food store (p->timed[TMD_FOOD]). */
  food: number;
  /** Haste (p->timed[TMD_FAST]). */
  fast: number;
  /** The Ranger/Rogue sprint effect (p->timed[TMD_SPRINT]); upstream ORs this with `fast`. */
  sprint: number;
  /** Protection from evil (p->timed[TMD_PROTEVIL]). */
  protEvil: number;
  /** Heroism (p->timed[TMD_HERO]). */
  hero: number;
  /** Berserker strength (p->timed[TMD_SHERO]). */
  shero: number;
  /** Mystic shield (p->timed[TMD_SHIELD]). */
  shield: number;
  /** Stoneskin (p->timed[TMD_STONESKIN]); upstream ORs this with `shield`. */
  stoneskin: number;
  /** Blessed (p->timed[TMD_BLESSED]). */
  blessed: number;
  /** Fast spellcasting (p->timed[TMD_FASTCAST]). */
  fastcast: number;
  /** Temporary acid resistance (p->timed[TMD_OPP_ACID]). */
  resAcid: number;
  /** Temporary lightning resistance (p->timed[TMD_OPP_ELEC]). */
  resElec: number;
  /** Temporary fire resistance (p->timed[TMD_OPP_FIRE]). */
  resFire: number;
  /** Temporary cold resistance (p->timed[TMD_OPP_COLD]). */
  resCold: number;
  /** Temporary poison resistance (p->timed[TMD_OPP_POIS]). */
  resPois: number;
  /**
   * Whether the player is afraid by any source: timed fear, Terror, a cursed or
   * afraid item, a shape, or anything else that sets OF_AFRAID on the player.
   * This is what refuses a melee blow; `afraid` alone counts only timed fear.
   */
  fearful?: boolean;
  /** Terror (p->timed[TMD_TERROR]): afraid, and hasted. */
  terror?: number;
  /** Amnesia (p->timed[TMD_AMNESIA]), which stops reading scrolls. */
  amnesia?: number;
  /** Hallucination (p->timed[TMD_IMAGE]). */
  image?: number;
}

/** A read-only view of the player (BORG_AS_MOD section 3, Player). */
export interface PlayerView {
  race: string;
  cls: string;
  level: number;
  maxLevel: number;
  exp: number;
  maxExp: number;
  gold: number;
  /** player.upkeep.newSpells after calc_spells. */
  learnableSpells: number;
  depth: number;
  maxDepth: number;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  /** Net speed after effects (110 = normal). */
  speed: number;
  ac: number;
  toHit: number;
  toDam: number;
  /** Base stats (STAT order); length STAT_MAX. */
  stats: number[];
  /** Derived light radius. */
  light: number;
  grid: { x: number; y: number };
  status: PlayerStatusView;
  /**
   * `state.isDead`, set by take_hit the moment the player dies, before the fatal
   * message is acknowledged and the tombstone is shown. A death animation keys on
   * this rather than on hit points, since bloodlust lets hit points go negative.
   */
  dead: boolean;
  winner: boolean;
  /**
   * The low hit point warning threshold in hit points:
   * `trunc(maxHp * hitpoint_warn / 10)`, where `hitpoint_warn` is the option in
   * tenths (0 to 9). The warning applies while `hp` is strictly below it, and 0
   * means the warning is off.
   */
  hpWarning: number;
  /** Turns left on an active Word of Recall (`word_recall`), 0 when none is active. */
  recall: number;
  /** Turns left on an active Deep Descent (`deep_descent`), 0 when none is active. */
  descent: number;
  /** Namespaced player-race id, when a ContentIdResolver with player races is supplied. */
  playerRaceId?: string;
  /** Namespaced player-class id, when a ContentIdResolver with player classes is supplied. */
  playerClassId?: string;
  /** Derived skills (SKILL order); length SKILL_MAX. */
  skills: number[];
  /** Current shapechange name, or null in the normal shape. */
  shape: string | null;
  /** OF_* codes from the derived player state's flag set (empty if absent). */
  objectFlags: string[];
  /**
   * PF_* codes from the player CLASS's own flag set (`p.cls.pflags`, class.txt's
   * `player-flags:` lines) - e.g. COMBAT_REGEN for a Blackguard. This is the
   * class's declared flags, not the equipment-derived `objectFlags` above and
   * not upstream's full `player_has` union (race | class | shape): a caller
   * that needs the race's own player-flags reads `playerRaceId` and looks the
   * race up, exactly as `objectFlags` already requires a lookup for anything
   * equipment does not grant.
   */
  classFlags: string[];
  /** Infravision range in grids. */
  seeInfra: number;
  /** state->num_blows (hundredths of a blow; 0 if the combat state is absent). */
  blows: number;
  /** state->num_shots (tenths of a shot; 0 if the combat state is absent). */
  shots: number;
}

/** A read-only view of a monster (BORG_AS_MOD section 3, Monsters). */
export interface MonsterView {
  /** Stable in-level id (midx). */
  id: number;
  /** Race name and index (a namespaced race id is a documented follow-up). */
  race: string;
  raceIndex: number;
  grid: { x: number; y: number };
  visible: boolean;
  hp: number;
  maxHp: number;
  /** Net monster speed (110 = normal). */
  speed: number;
  asleep: boolean;
  afraid: boolean;
  confused: boolean;
  stunned: boolean;
  /** race->level. */
  level: number;
  /**
   * No MON_TMD_* poison timer exists upstream (monsters are never "poisoned"
   * as a timed status in 4.2.6); always false. Kept for section-3 parity.
   */
  poisoned: boolean;
  /** RF_* codes from race->flags. */
  raceFlags: string[];
  /** RF_UNIQUE. */
  unique: boolean;
  /** The race guards one of the character's quests (quest.txt). */
  questGuardian: boolean;
  /**
   * The race guards the character's LAST quest, whose death wins the game:
   * Morgoth in the shipped quest.txt. Read from the quest table rather than a
   * name, so a mod that changes the quests moves the flag with them.
   */
  finalGuardian: boolean;
  /** RSF_* codes from race->spellFlags. */
  spellFlags: string[];
  /** Namespaced race id, when a ContentIdResolver dep is supplied. */
  raceId?: string;
  /**
   * The character this monster draws as - `monster_x_char[ridx]` through the
   * host's live table. Present only with a `glyphs` dep.
   *
   * This is the RACE's character, which is ambiguous on purpose upstream (six
   * `d`s on a level are six different dragons). It is what the player sees, so
   * an agent rendering a map should draw it; identifying WHICH one is what `id`
   * and `grid` are for. The ATTR_CLEAR / CHAR_CLEAR arms of grid_data_as_text
   * (visuals/map-text.ts monsterGlyph) are not applied here - those need the
   * glyph already under the monster, which is the caller's layer.
   */
  glyph?: string;
}

/** A read-only view of one map cell (BORG_AS_MOD section 3, Dungeon grid). */
export interface CellView {
  x: number;
  y: number;
  /** Terrain feature index. */
  feat: number;
  passable: boolean;
  /** The player has this square in view right now. */
  inView: boolean;
  /** The player remembers this square (known map). */
  known: boolean;
  /**
   * The monster id standing here when the player perceives it (seen, detected
   * or sensed, and not a mimic posing as an object), 0 when the square is empty
   * or its occupant is unseen, and -1 on the player's own square, as upstream's
   * `square(c, grid)->mon` stores it. Check `> 0` before looking the id up.
   */
  monster: number;
  /** Objects the player remembers on the square, sensed ones included. */
  objectCount: number;
  /** SQUARE_GLOW: the square is self-illuminating. */
  glow: boolean;
  /**
   * `square_isdisarmabletrap` (cave-square.c:832): the square holds a VISIBLE
   * player trap that is not already disabled - the same predicate the `disarm`
   * command tests before it will spend a turn, and the same one the trap layer
   * draws from.
   *
   * NOT "any trap record exists", which is what this reported until 0.25.1. The
   * trap list is also where a closed door's lock lives (`square_set_door_lock`
   * stores a "door lock" trap, flagged LOCK | INVISIBLE) and where a glyph of
   * warding, a web and a decoy live. None of those is a trap a player can see or
   * disarm, so reporting them here contradicted this view's own rule that an
   * invisible trap is not in the view (see `trapGlyph`) - and it put a locked
   * door in front of an agent as something to disarm, which `disarm` then
   * refuses for free.
   */
  trap: boolean;
  /** Namespaced terrain-feature id, when a ContentIdResolver dep is supplied
   * and the feature index is bound (never present for an unset sentinel). */
  featCode?: string;
  /**
   * The TERRAIN character this square draws as - `feat_x_char[lighting][feat]`
   * read through the host's live table, so a pref file or the glyph picker is
   * honoured exactly as it is on screen. Present only with a `glyphs` dep.
   *
   * Terrain ONLY. The trap, object and monster layers are the three fields
   * below and `MonsterView.glyph`, kept apart rather than pre-composited
   * because an agent that draws a map wants to label the layers separately -
   * and because compositing them here would be a second copy of the shell's
   * render loop, which is the defect this field exists to remove.
   */
  glyph?: string;
  /**
   * The character the VISIBLE trap on this square draws as (get_trap_graphics,
   * ui-map.c:98), or absent when the square has no trap the player can see.
   * An invisible trap is deliberately not reported: it is not on the player's
   * screen, and an agent that could read it would be cheating.
   */
  trapGlyph?: string;
  /**
   * The character the top floor object draws as - the first object in the pile
   * that the player has not ignored (map_info's object loop, cave-map.c:156-170),
   * through the flavour table when the kind is flavoured and unidentified
   * (object_kind_char, ui-object.c:87-112).
   */
  objectGlyph?: string;
}

/**
 * A read-only view of an object (BORG_AS_MOD section 3, Items), as the player
 * knows it. Every field that says what the object is comes from its known twin
 * (upstream `obj->known`): an unidentified ego reads as `ego: false` with a null
 * `egoName`, an unassessed artifact as `artifact: false`, and bonuses,
 * modifiers, flags, brands, slays, resists, curses and value count only what the
 * player has learned. Kind and weight are known on sight.
 */
export interface ItemView {
  /** Gear handle when carried/worn; 0 for a floor object. */
  handle: number;
  /** Kind index and gear identity; a gear handle survives letter changes. */
  kindKey: string;
  itemKey?: string;
  /** The attr used by the inventory name renderer. */
  nameColor: string;
  label: string;
  tval: number;
  sval: number;
  pval: number;
  number: number;
  weight: number;
  ac: number;
  toA: number;
  toH: number;
  toD: number;
  dd: number;
  ds: number;
  ego: boolean;
  artifact: boolean;
  /** OF_* codes on obj.flags. */
  flags: string[];
  /** Nonzero obj.modifiers entries, by OBJ_MOD code. */
  modifiers: Array<{ code: string; value: number }>;
  /** Brand codes active on this object (obj.brands[i] true). */
  brands: string[];
  /** Slay codes active on this object (obj.slays[i] true). */
  slays: string[];
  /** Nonzero resistances/vulnerabilities, by element name. */
  resists: Array<{ element: string; level: number }>;
  /**
   * Names of active curses (power > 0). A curse whose name cannot be
   * resolved (no registry dep supplied) falls back to its numeric index
   * as a string.
   */
  curses: string[];
  egoName: string | null;
  artifactName: string | null;
  activation: boolean;
  timeout: number;
  inscription: string | null;
  /** A floor object's place in the pile under its grid, as a command's `args.floor` takes it. */
  floorIndex?: number;
  /**
   * The name the inventory shows (object_desc with its article and every detail
   * the player knows), present when the host supplies `describe`. `label` stays
   * the kind's raw name.
   */
  name?: string;
  /** Whether the game ignores this object now (ignore_item_ok), present when the host supplies `ignored`. */
  ignored?: boolean;
  /** Namespaced kind id, when a ContentIdResolver dep is supplied. */
  kindId?: string;
  /** objectValue for this stack, when a registry dep is supplied. */
  value?: number;
}

/** One item in a store's stock (ItemView plus its slot and buy price). */
export interface StoreItemView extends ItemView {
  /** Position in the store's stock array. */
  index: number;
  /**
   * The player's buy price (priceItem), when a registry dep is supplied.
   * Omitted for the home (nothing is for sale) and when no registry dep is
   * given.
   */
  price?: number;
}

/** A read-only view of a store (BORG_AS_MOD section 3, Stores). */
export interface StoreView {
  feat: number;
  featName: string;
  isHome: boolean;
  owner: { name: string; purse: number };
  stock: StoreItemView[];
}

/** A read-only view of one learnable/known spell. */
export interface SpellView {
  name: string;
  /** Class-wide spell index. */
  sidx: number;
  /** Index of the owning book in the class's books array. */
  bidx: number;
  /** Required level to learn. */
  level: number;
  mana: number;
  /** Base failure chance (before level/stat/status adjustments). */
  fail: number;
  /**
   * Live cast-failure percent (spell_chance: base fail adjusted by level,
   * casting stat, low mana, fear, stun, amnesia). Present only when the
   * derived stat indices (state.statInd) are available.
   */
  chance?: number;
  learned: boolean;
  worked: boolean;
  forgotten: boolean;
  studyEligible: boolean;
  /** get_spell_info's menu suffix for a worked spell. */
  infoLine: string;
}

/** A read-only view of one spellbook and its spells. */
export interface SpellbookView {
  tval: number;
  name: string;
  realm: string;
  spells: SpellView[];
}

/** The current target, if any (BORG_AS_MOD section 3, set-target). */
export interface TargetView {
  /** Targeted monster id, or 0 for a bare location target. */
  midx: number;
  grid: { x: number; y: number };
}

/**
 * The perceive facade: a read-only view of the world. Every accessor returns
 * fresh plain data (no live engine references). Capability: state:*.read.
 */
/* ------------------------------------------------------------------ *
 * PERCEIVE - a loadout the player is NOT wearing.
 * ------------------------------------------------------------------ */

/**
 * Where one item in a hypothetical loadout comes from.
 *
 * Three arms because the three questions have three different answers to "which
 * object is this". Something the character already has is a gear handle, which
 * is what every other item verb takes. A ware in a shop is NOT in the gear at
 * all, so it has no handle - `StoreItemView.index` inside `view.stores()[n]` is
 * its only address, and pricing a purchase is one of the two decisions this
 * whole capability exists for. The third arm is for a caller INSIDE the engine
 * that is holding the object itself (a floor pile, a freshly rolled drop, a
 * character-sheet comparison); an agent driving the frozen view has no
 * GameObject and will never use it.
 */
export type LoadoutItemRef =
  /** Something already in the gear, worn or packed. */
  | { readonly from: "gear"; readonly handle: number }
  /** Store stock: `store` indexes view.stores(), `index` the ware in it. */
  | { readonly from: "store"; readonly store: number; readonly index: number }
  /** An object in hand (engine-internal callers only). */
  | { readonly from: "object"; readonly object: import("../obj/object.js").GameObject };

/**
 * A hypothetical change to what the character carries and wears.
 *
 * Every field is optional and they compose, applied in the order
 * release -> remove -> wield -> carry, so "sell the ring I am wearing and put on
 * this one instead" is one change rather than two simulations. An empty change
 * derives the loadout the character is already in, which is what makes `before`
 * and `after` comparable rather than two different derives.
 */
export interface LoadoutChange {
  /**
   * Wear or wield these, each routed to the body slot wield_slot picks for its
   * tval (a ring goes to the first EMPTY ring slot, else the first ring slot).
   * Whatever was in the slot moves to the pack. An item from `store` or
   * `object` is being ACQUIRED, so its weight joins the carried total.
   */
  readonly wield?: readonly LoadoutItemRef[];
  /** Hypothetical placement into a named body slot, including a paired slot. */
  readonly wieldAt?: readonly { readonly item: LoadoutItemRef; readonly slot: number }[];
  /**
   * Take these into the pack without wearing them - a purchase of something the
   * character will carry rather than wield. `number` defaults to the whole
   * stack the reference names.
   */
  readonly carry?: readonly {
    readonly item: LoadoutItemRef;
    readonly number?: number;
  }[];
  /**
   * Empty these body slots. What is worn there goes into the pack, so the
   * carried weight does not change - this is taking something off, not
   * getting rid of it.
   */
  readonly remove?: readonly number[];
  /**
   * Give these up entirely: a sale, or a drop. `number` defaults to the whole
   * stack. A handle that names WORN gear empties its slot on the way out, so a
   * caller pricing "sell the amulet I have on" does not have to remove it first.
   */
  readonly release?: readonly {
    readonly handle: number;
    readonly number?: number;
  }[];
}

/** Where one wielded item landed, and what it pushed out of that slot. */
export interface LoadoutPlacement {
  /** The body slot index, as `equipment()` is indexed. */
  readonly slot: number;
  /** The item now in the slot. */
  readonly worn: ItemView;
  /** What was in the slot before, or null when it was empty. */
  readonly displaced: ItemView | null;
}

/** One complete loadout: what is worn and carried, and what it derives to. */
export interface LoadoutView {
  /**
   * The player as `player()` would report them wearing this loadout. Every
   * derived field (speed, ac, toHit, toDam, blows, shots, light, seeInfra,
   * objectFlags, maxHp, maxSp) is this loadout's; the rest of the character is
   * unchanged.
   */
  readonly player: PlayerView;
  /** Worn equipment by body slot; null for an empty slot. */
  readonly equipment: readonly (ItemView | null)[];
  /** The pack this loadout leaves behind, in pack order. */
  readonly inventory: readonly ItemView[];
  /**
   * The WHOLE derived surface for this loadout - every field of upstream's
   * player_state, plus max hitpoints, max mana, armour encumbrance and the
   * carried weight. This is the deep answer; `player` is the frozen-contract
   * projection of the same derive.
   */
  readonly stats: import("../player/loadout.js").DerivedStatsView;
}

/**
 * The answer to "what would this loadout do for me": the character as it stands,
 * the character with the change applied, and the difference between them.
 *
 * A BEFORE/AFTER/DELTA TRIPLE rather than a score, and deliberately. An
 * autoplayer reduces it to one number and a player wants to see which resist was
 * traded for which; a scalar can serve the first and never the second, and the
 * two must not be allowed to disagree about the underlying derive.
 */
export interface LoadoutSimulation {
  readonly before: LoadoutView;
  readonly after: LoadoutView;
  readonly delta: import("../player/loadout.js").DerivedStatsDelta;
  /** Where each wielded item landed (empty when the change wields nothing). */
  readonly placements: readonly LoadoutPlacement[];
  /**
   * References the change named that resolved to no object: a stale handle, a
   * store index past the end of the stock, a shop number with no shop. They are
   * SKIPPED rather than thrown for, and reported here, because a decision ladder
   * evaluating a hundred candidates must not die on one stale handle.
   */
  readonly unresolved: readonly LoadoutItemRef[];
}

export interface AgentView {
  readonly apiVersion: string;
  /** The int32 game-turn counter. */
  turn(): number;
  player(): PlayerView;
  /** Live monsters (index 0 unused slot omitted). */
  monsters(): MonsterView[];
  /** One map cell, or null when out of bounds. */
  cell(x: number, y: number): CellView | null;
  mapBounds(): { width: number; height: number };
  /** The player's whole known level, read separately from the small capture. */
  knownLevel?(): import("./known-level.js").KnownLevelView | null;
  /** The carried pack (non-equipped gear), in pack order. */
  inventory(): ItemView[];
  /** Computed quiver slots in display order. */
  quiver?(): ItemView[];
  /** Worn equipment by body slot; null for an empty slot. */
  equipment(): Array<ItemView | null>;
  /**
   * Floor objects on a grid that the player remembers exactly (head-first,
   * newest drop first). Each keeps its index in the live pile, which is what a
   * command's args.floor takes.
   */
  floorItems(x: number, y: number): ItemView[];
  /** The current target, or null when none is set. */
  target(): TargetView | null;
  /** Messages emitted since the previous decision (oldest first). */
  messages(): string[];
  /** Live town stores, or [] when none (dungeon levels, worldless harness). */
  stores(): StoreView[];
  /** The player class's spellbooks; [] for a non-caster. */
  spellbooks(): SpellbookView[];
  /** A plain clone of the bound game constants (z_info). */
  constants(): GameConstants;
  /**
   * What the character would derive to wearing a DIFFERENT loadout: the same
   * calc_bonuses the engine runs for the real one, over a hypothetical set of
   * worn objects, with nothing in the live game touched.
   *
   * This is the read that had no answer at all. Every other accessor here
   * reports the character as it is, so an agent deciding whether to wear, buy or
   * sell something had to sum the item's own bonuses itself - which is a second
   * implementation of calc_bonuses, and one that would drift from the first.
   *
   * OPTIONAL, and null-returning, for the honest reason: the derive needs the
   * session's own calc_bonuses options (the bound timed table, the curse
   * registry), so a view over a worldless harness cannot answer and says so
   * rather than deriving a thinner state that would look like an answer.
   * Capability: `state:player.read`.
   */
  simulateLoadout?(change: LoadoutChange): LoadoutSimulation | null;
  /**
   * The token for the current input wait (agent/boundary.ts). It changes when a
   * command is taken, the turn advances, the level changes or the target is
   * set, and only then. Hand it back with an action so the game can refuse one
   * chosen against a state that has since moved on. Optional because a view
   * built by something other than createAgentView may not track waits.
   */
  inputToken?(): import("./boundary.js").InputToken;
  /**
   * Every readable part of the game at this moment as one deep-frozen capture
   * stamped with the current token (agent/boundary.ts). Parts the caller has no
   * read capability for are null. Reading it changes nothing.
   */
  capture?(): import("./boundary.js").CoreSnapshot;
  /** Player-facing object inspection, without learning or changing the game. */
  inspectItem?(ref: number | { floor: { x: number; y: number; index: number } } | { store: number; index: number }): InspectResult | null;
  /** The class book and spell indices for one carried object. */
  bookForItem?(handle: number): BookItemResult | null;
  compareLoadoutSlots?(ref: Exclude<LoadoutItemRef, { from: "object" }>): LoadoutSlotsResult;
  /** The player's existing recall for a race; null if no lore is recorded. */
  monsterRecall?(raceIndex: number): InspectResult | null;
  /** The live spell description and casting status. */
  spellInfo?(spellIndex: number): SpellInspectResult | null;
  /** Item references accepted by the command's picker. */
  itemTester?(code: string): ItemTesterResult;
  /** Path through remembered terrain, stopping at visible monsters. */
  projectionPath?(to: { x: number; y: number }): GridInspectResult;
  /** Ball grids through remembered terrain. */
  blastArea?(to: { x: number; y: number }, radius: number, arc?: number): BlastAreaResult;
  /** The travel command's walking route over the remembered map. */
  travelPath?(to: { x: number; y: number }): TravelPathResult | null;
  /** Registered command codes eligible at one remembered grid. */
  tileActions?(to: { x: number; y: number }): TileActionsResult;
  /** Learned ignore and auto-inscription settings. */
  itemRules?(): ItemRulesResult;
  /** Every bound terrain feature with its flags, for a renderer that styles terrain. */
  terrainCatalogue?(): TerrainCatalogueResult;
}

/**
 * Optional dependencies that unlock the richer perceive fields (namespaced
 * ids, store pricing, object value). Every field degrades gracefully when
 * absent: the corresponding optional ItemView/CellView/MonsterView fields are
 * simply omitted, never thrown for.
 */
/**
 * The host's live attr/char table, as much of it as an agent needs to draw what
 * the player sees.
 *
 * WHY THIS IS A DEP AND NOT A LOOKUP. Upstream never draws an entity with its
 * gamedata `d_char`: every draw goes through the x_char table, which merely
 * STARTS at the gamedata default and is then rewritten by pref files, the glyph
 * picker and the active tile mode's graphics pref (see visuals/glyph-table.ts).
 * A renderer that read the gamedata directly would draw a map the player is not
 * looking at. So the glyphs come from the host that owns the table.
 *
 * Every method returns undefined for an index the table never bound, exactly as
 * the sparse arrays upstream do - callers fall back, they do not throw.
 */
export interface AgentGlyphSource {
  /** feat_x_char[lighting][fidx]; the caller picks the lighting. */
  featChar(lighting: number, fidx: number): string | undefined;
  /** trap_x_char[lighting][tidx]. */
  trapChar(lighting: number, tidx: number): string | undefined;
  /** kind_x_char[kidx]. */
  kindChar(kidx: number): string | undefined;
  /** flavor_x_char[fidx], for a flavoured kind the player has not identified. */
  flavorChar(fidx: number): string | undefined;
  /** monster_x_char[ridx]. */
  monsterChar(ridx: number): string | undefined;
}

export interface AgentViewDeps {
  /** The host's bound inspection data, shared with its own inspect screens. */
  inspect?: {
    objectInfo: ObjectInfoExtras;
    races: readonly MonsterRace[];
    loreDeps: () => LoreDeps;
    projections: readonly ProjectionInfo[];
    activeBlast?: () => { readonly radius: number; readonly arc?: number; readonly element: string; readonly wallsStop: boolean } | null;
    /** The command's door-lock predicate uses the bound trap kinds. */
    trapDeps?: import("../game/trap.js").TrapDeps;
  };
  /** Enables kindId / raceId / featCode namespaced-id fields. */
  resolver?: ContentIdResolver;
  /**
   * Enables CellView.glyph / trapGlyph / objectGlyph and MonsterView.glyph.
   *
   * Structural rather than `GlyphTable` so core's agent contract does not
   * depend on the visuals layer, and so a host whose glyphs come from somewhere
   * else can still supply them. `visuals/glyph-table.ts`'s GlyphTable satisfies
   * it through `agentGlyphs()`.
   */
  glyphs?: AgentGlyphSource;
  /** Enables ItemView.value and StoreItemView.price. */
  reg?: ObjRegistry;
  /** object_flavor_is_aware(kind), for object value/price dispatch. */
  aware?: (kind: ObjectKind) => boolean;
  /** object_desc for an ItemView's `name`; absent, views carry no name. */
  describe?: (obj: GameObject) => string;
  /**
   * object_desc with ODESC_STORE for a shop's wares (not the home's), which
   * names an unaware flavour the way the shop screen does. Absent, wares are
   * named by `describe`.
   */
  describeStore?: (obj: GameObject) => string;
  /** ignore_item_ok for an ItemView's `ignored`; absent, views carry no ignore mark. */
  ignored?: (obj: GameObject) => boolean;
  /** OPT(player, birth_no_selling), for store buy pricing. */
  noSelling?: boolean;
  /**
   * No longer has any effect: every view lists only the monsters the player
   * perceives (monster_is_obvious). Kept so existing callers still compile.
   */
  perceivedMonstersOnly?: boolean;
}

/* ------------------------------------------------------------------ *
 * ACT - the write surface (semantic verbs).
 * ------------------------------------------------------------------ */

/**
 * The act facade: the BORG_AS_MOD section-3 semantic verbs as command builders,
 * plus set-target (a direct state action, not a queued command). Capability:
 * command:add. Verbs build a typed AgentCommand; whether a given code is fully
 * implemented in the engine yet is orthogonal to the contract (the Borg port,
 * P8, drives the remaining ones as parity fills them in).
 */
export interface AgentActions {
  /* Movement / terrain. */
  move(dir: number): AgentCommand;
  /** Melee an adjacent monster (a walk into its grid). */
  melee(dir: number): AgentCommand;
  hold(): AgentCommand;
  /**
   * do_cmd_rest (cmd-cave.c:1619): rest for `count` game turns, or one of the
   * REST_ special modes (REST_COMPLETE / REST_ALL_POINTS / REST_SOME_POINTS,
   * player-util.h:53-55, exported from game/context.js). One command turn is
   * many game turns: the engine self-continues on its internal queue exactly
   * like a run, so a caller normally issues this ONCE and is not asked for
   * another command until the rest ends (disturbed, or its own condition met).
   * Omitting `count` rests as needed (REST_COMPLETE), matching the human UI's
   * own default prompt answer ("&").
   */
  rest(count?: number): AgentCommand;
  descend(): AgentCommand;
  ascend(): AgentCommand;
  tunnel(dir: number): AgentCommand;
  open(dir: number): AgentCommand;
  close(dir: number): AgentCommand;
  disarm(dir: number): AgentCommand;

  /* Items (by gear handle). */
  quaff(handle: number): AgentCommand;
  read(handle: number): AgentCommand;
  eat(handle: number): AgentCommand;
  wear(handle: number): AgentCommand;
  takeoff(handle: number): AgentCommand;
  drop(handle: number, number?: number): AgentCommand;
  pickup(): AgentCommand;
  destroy(handle: number): AgentCommand;
  aimWand(handle: number): AgentCommand;
  zapRod(handle: number): AgentCommand;
  useStaff(handle: number): AgentCommand;
  activate(handle: number): AgentCommand;

  /* Combat / magic. */
  fire(handle: number): AgentCommand;
  throw(handle: number): AgentCommand;
  cast(spell: number): AgentCommand;

  /* Targeting - direct state actions (target.c), return whether it took. */
  setTargetMonster(midx: number): boolean;
  setTargetLocation(x: number, y: number): void;

  /* Store. */
  shopBuy(index: number, number?: number): AgentCommand;
  shopSell(handle: number, number?: number): AgentCommand;
  shopExit(): AgentCommand;

  /**
   * Escape hatch: emit any command code with free-form args (for verbs not yet
   * given a typed builder, or mod-registered codes).
   */
  raw(code: string, args?: Record<string, unknown>): AgentCommand;
}

/* ------------------------------------------------------------------ *
 * CONTROLLER - the decision seam.
 * ------------------------------------------------------------------ */

/**
 * The decision function: given the current perceive view and the act facade,
 * return the next command, or null to yield control (the loop returns
 * LOOP_STATUS.INPUT, e.g. to hand back to a human or wait). Invoked once each
 * time the game needs a command.
 */
export type AgentController = (
  view: AgentView,
  act: AgentActions,
) => AgentCommand | null;

/** Options for installing a controller. */
export interface ControllerOptions {
  /**
   * The capability grant to enforce. Absent means an in-process trusted host
   * (all capabilities granted) - the bundled-Borg-before-sandbox case.
   */
  capabilities?: AgentCapabilities;
  /**
   * The controller draws nondeterministic sources (an AI agent, a wall clock, a
   * network). The runtime should flip the save's determinism mode via
   * onNondeterministic (the core-owned one-way ratchet, save-blocks.ts).
   */
  nondeterministic?: boolean;
  /** Called once at install when nondeterministic is true, to trip the ratchet. */
  onNondeterministic?: () => void;
  /** Optional deps threaded into createAgentView (namespaced ids, pricing). */
  viewDeps?: AgentViewDeps;
}

/** A live agent binding: its facades plus a teardown that restores the loop. */
export interface AgentSession {
  view: AgentView;
  act: AgentActions;
  /** Restore the previous nextCommand / message sink. */
  uninstall(): void;
}

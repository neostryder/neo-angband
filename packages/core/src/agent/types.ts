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
 */
export const AGENT_API_VERSION = "1.1.0";

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
  dead: boolean;
  winner: boolean;
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
   * `square(c, grid)->mon`, verbatim: a positive monster id, 0 for none, and
   * NEGATIVE for the player's own square (upstream stores -1 there, cave.h).
   *
   * The doc used to say "or 0 for none" and stop, which is how a caller ends up
   * writing `if (cell.monster !== 0) lookUpMonster(cell.monster)` and asking the
   * monster list for id -1 on the one square it is certain to examine. Corrected
   * rather than changed: the VALUE is upstream's and callers may already depend
   * on it, so making it 0 here would be the breaking half of the two options.
   */
  monster: number;
  /** Number of floor objects on the square. */
  objectCount: number;
  /** SQUARE_GLOW: the square is self-illuminating. */
  glow: boolean;
  /** A live trap pile occupies this square. */
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

/** A read-only view of an object (BORG_AS_MOD section 3, Items). */
export interface ItemView {
  /** Gear handle when carried/worn; 0 for a floor object. */
  handle: number;
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
  /** The carried pack (non-equipped gear), in pack order. */
  inventory(): ItemView[];
  /** Worn equipment by body slot; null for an empty slot. */
  equipment(): Array<ItemView | null>;
  /** Floor objects on a grid (head-first, newest drop first). */
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
  /** OPT(player, birth_no_selling), for store buy pricing. */
  noSelling?: boolean;
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
  rest(): AgentCommand;
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

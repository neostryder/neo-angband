/**
 * The in-process registry host (W2.2): the capability-gated seam through which a
 * TRUSTED, in-process plugin overrides game SYSTEMS - not just data. It opens
 * the four runtime registries the engine already exposes for extension:
 *
 * - effects  (EffectRegistry, effects/interpreter.ts): register a handler for a
 *   new string effect code, or replace a core numeric EF handler - overriding
 *   combat / healing / teleport / detection logic. Gated by "registry:effect".
 * - rooms    (RoomRegistry, gen/room.ts): register a room/level builder under
 *   any key, referenced from a (modded) dungeon profile - overriding level
 *   generation. Gated by "registry:room".
 * - profiles (DungeonProfiles, gen/cave.ts): register a whole-cave builder and
 *   add dungeon profiles, so a mod decides what KIND of level gets generated at
 *   a depth - not just what a room inside it looks like. Gated by
 *   "registry:profile". Without this, "registry:room" was a builder a mod could
 *   register and nothing could ever select: dun_profile records name a builder,
 *   and the profile list was fixed at boot from the gamedata pack.
 * - commands (ActionRegistry, game/player-turn.ts): register or replace the
 *   action a player command code runs - overriding what "walk", "cast", ... do.
 *   Gated by "registry:command". (This is the live player-command seam; the
 *   cmd.ts CommandQueue is a faithful port the web loop does not drive.)
 * - monsters (GameState.monsterTurnHook, game/monster-turn.ts): install a hook
 *   consulted at the top of every monster's turn; returning true takes the turn
 *   over entirely - overriding monster AI. Gated by "registry:monster".
 * - projections (ProjectionHandlerRegistry, game/projection-handlers.ts): install
 *   the handler for one projection CODE on any of the three sides - terrain
 *   (project_f), floor objects (project_o) or the player (project_p) - so a
 *   mod's own projection actually DOES something, and a core projection can be
 *   changed or wrapped. Gated by "registry:projection".
 * - glyphs   (GlyphRegistry, gen/glyph.ts): what one character of a room
 *   template or a vault means when the level is drawn. A mod can ship a vault
 *   with a glyph core never heard of and say what it does. Gated by
 *   "registry:glyph".
 * - effectInfo (EffectInfoRegistry, effects/effect-info-registry.ts): what the
 *   game SAYS about an effect - the menu row, the recall sentence, the object
 *   properties an activation summarises, the named subtypes it accepts, and
 *   which item it prompts for. "registry:effect" could always make a mod's
 *   effect DO something; this is what lets the game describe it instead of
 *   printing a blank row. Gated by "registry:effect-info".
 * - randart  (RandartRegistry, obj/randart-registry.ts): random ARTIFACT
 *   construction - what an ability does, what an item class starts with, which
 *   census bucket it counts toward, and whether an activation is redundant.
 *   artifact.json always accepted a new FIXED artifact; this is the GENERATOR.
 *   Gated by "registry:randart".
 * - tval     (TvalRegistry, obj/tval-registry.ts): every question core asks
 *   about an item CLASS - is it a weapon, can it be worn, can it be flavoured,
 *   is it good, what is it worth unidentified. object.json always accepted a new
 *   ITEM; this is the CLASS. Gated by "registry:tval".
 * - rune     (RuneRegistry, obj/rune-registry.ts): every question core asks
 *   about a RUNE - what it is called and described as, whether an item carries
 *   it, whether the player knows it, how it is learned, and the line a modifier
 *   prints on wield. Plus `contribute`, which is how a mod's rune gets into the
 *   list every consumer enumerates. Gated by "registry:rune".
 * - vocab    (VocabularyRegistry, mod/vocabulary.ts): declare genuinely NEW
 *   vocabulary terms (flags, stats, any mod-coined kind) and store per-entity
 *   values for them - extending the game's vocabulary, not just recombining it
 *   (W2.3). Mod-owned and persisted in the mod's save bag; core never reads it.
 *   Gated by "registry:vocab".
 *
 * WHY IN-PROCESS AND TRUSTED (the W2.2 architecture decision): every one of
 * these handlers executes SYNCHRONOUSLY with live access to the rng, the chunk,
 * the player and the monster - deep inside the turn. A Web Worker (the W2.1
 * sandbox) is async and isolated by construction and cannot supply such a
 * handler; the only browser primitive that could (SharedArrayBuffer +
 * Atomics.wait) needs cross-origin-isolation headers a static host cannot send,
 * and would freeze the main thread per effect regardless. So deep system
 * override is a TRUSTED, in-process capability - as it is in every real modding
 * system (SKSE, Forge, ...). Trust is still explicit: the plugin declares each
 * registry:* capability in its manifest, the user consents at install, and the
 * conflict report covers what it touches. The untrusted Worker tier keeps the
 * reactive perceive/act/event surface (W2.1) and none of this.
 *
 * Layering: core owns this facade because it gates access to core registries;
 * the HOST (web/cli) constructs it from the live registries and hands it to a
 * loaded trusted plugin. Capabilities are the same structural AgentCapabilities
 * the perceive/act facades use - satisfied by mod-sdk's CapabilitySet without
 * core depending on mod-sdk. Absent capabilities means a fully trusted host
 * (everything granted), matching the perceive/act/controller convention.
 */

import { AgentCapabilityError } from "../agent/types.js";
import type { AgentCapabilities } from "../agent/types.js";
import type { EffectCode } from "../effects/effect.js";
import type { EffectDefinition, EffectRegistry } from "../effects/interpreter.js";
import type { RoomBuilder, RoomRegistry } from "../gen/room.js";
import type { GlyphHandler, GlyphKind, GlyphRegistry } from "../gen/glyph.js";
import type { CaveBuilder, DunProfile, DungeonProfiles } from "../gen/cave.js";
import type { ActionRegistry, PlayerAction } from "../game/player-turn.js";
import type { GameState } from "../game/context.js";
import type { Monster } from "../mon/monster.js";
import type {
  BlowEffectHandler,
  BlowEffectSpec,
  BlowEffectRegistry,
} from "../combat/mon-melee.js";
import { blowEffect } from "../combat/mon-melee.js";
import type {
  MassProduceHandler,
  StoreBehaviourRegistry,
  WillBuyHandler,
} from "../store/store.js";
import { ANY_STORE } from "../store/store.js";
import type {
  ProjectionHandlerRegistry,
  ProjectionHandlerTable,
} from "../game/projection-handlers.js";
import type { ProjectFeatHandler } from "../game/project-feat.js";
import type { ProjectObjHandler } from "../game/project-obj.js";
import type { PlayerSideHandler } from "../game/player-side.js";
import type { JsonValue } from "./save-blocks.js";
import type { VocabKind, VocabTerm, VocabularyRegistry } from "./vocabulary.js";
import type {
  RandartAbilityHandler,
  RandartCensusHandler,
  RandartPrepHandler,
  RandartRedundancyHandler,
  RandartRegistry,
  RandartTable,
} from "../obj/randart-registry.js";
import type {
  TvalBasenameHandler,
  TvalClassPredicate,
  TvalGoodHandler,
  TvalRegistry,
  TvalTable,
  TvalValueBaseHandler,
} from "../obj/tval-registry.js";
import type {
  ModMessageHandler,
  RuneContributor,
  RuneDescHandler,
  RuneKnowsHandler,
  RuneLearnHandler,
  RuneNameHandler,
  RuneObjectHasHandler,
  RuneRegistry,
  RuneTable,
  RuneVariety,
} from "../obj/rune-registry.js";
import type {
  ActivationSummaryHandler,
  EffectInfoRegistry,
  EffectInfoTable,
  EffectRequestHandler,
  EffectSubtypeHandler,
  EffectTextHandler,
} from "../effects/effect-info-registry.js";

/** The capability each registry facade requires (registry:<domain>). */
export const REGISTRY_CAPABILITIES = {
  effect: "registry:effect",
  room: "registry:room",
  profile: "registry:profile",
  blow: "registry:blow",
  store: "registry:store",
  command: "registry:command",
  monster: "registry:monster",
  projection: "registry:projection",
  glyph: "registry:glyph",
  effectInfo: "registry:effect-info",
  randart: "registry:randart",
  tval: "registry:tval",
  rune: "registry:rune",
  vocab: "registry:vocab",
} as const;

export type RegistryDomain = keyof typeof REGISTRY_CAPABILITIES;

/**
 * A monster-AI override: run at the top of monsterTurn (game/monster-turn.ts).
 * Return true to consume the monster's whole turn (the default behaviour is
 * skipped); return false to fall through to the ported AI. Mutates state as the
 * ported turn code would - it runs in the same synchronous, live-state context.
 */
export type MonsterTurnHook = (mon: Monster, state: GameState) => boolean;

/** The live registries a host wires into the facade; any may be absent. */
export interface RegistryTargets {
  /** The effect interpreter; null when the pack has no projections. */
  effects?: EffectRegistry | null;
  /** The room/level builder registry (CoreRegistries.rooms). */
  rooms?: RoomRegistry | null;
  /** The dungeon-profile registry (CoreRegistries.profiles). */
  profiles?: DungeonProfiles | null;
  /** The monster blow-effect handler table (GameState.blowEffects). */
  blows?: BlowEffectRegistry | null;
  /** Store behaviour: what a shop buys, and how it stocks (GameState.storeBehaviour). */
  stores?: StoreBehaviourRegistry | null;
  /** The live player action registry (the decision-13 command seam). */
  commands?: ActionRegistry | null;
  /** The game state, for installing the monster-AI turn hook. */
  state?: GameState | null;
  /** The three projection handler tables (GameState.projectionHandlers). */
  projections?: ProjectionHandlerRegistry | null;
  /** The room-template / vault glyph decoders (RoomRegistry.glyphs). */
  glyphs?: GlyphRegistry | null;
  /** Everything the game says about an effect (the module-level registry). */
  effectInfo?: EffectInfoRegistry | null;
  /** Random artifact construction (the module-level registry). */
  randart?: RandartRegistry | null;
  /** Everything core asks about an item CLASS (the module-level registry). */
  tval?: TvalRegistry | null;
  /** Everything core asks about a RUNE (the module-level registry). */
  rune?: RuneRegistry | null;
  /** This mod's vocabulary registry (declared terms + per-entity values). */
  vocab?: VocabularyRegistry | null;
}

/** The effect-override facade (gated by registry:effect). */
export interface EffectFacade {
  /**
   * Register a handler for an effect code. A string code adds a brand-new
   * effect; a numeric EF code replaces the core handler for that effect. The
   * handler runs synchronously inside effect_do with the live EffectContext.
   */
  register(code: EffectCode, def: EffectDefinition): void;
  /** Whether a code currently has a handler. */
  isRegistered(code: EffectCode): boolean;
}

/** The room-builder facade (gated by registry:room). */
export interface RoomFacade {
  /** Register (or replace) a room/level builder under a key. */
  register(name: string, builder: RoomBuilder): void;
}

/**
 * The dungeon-profile facade (gated by registry:profile). A room builder makes a
 * ROOM; a profile decides which whole-cave builder runs at a depth and with what
 * parameters, so this is the seam for "my mod adds a new kind of level".
 *
 * `addProfile` appends, because choose_profile's weighted pass walks the list in
 * order and its running-total randint0 depends on that order (gen/cave.ts) - a
 * mod inserting into the middle would change which profile core itself picks
 * from the same seed, which is a parity break, not a mod.
 */
export interface ProfileFacade {
  /** Register (or replace) a whole-cave builder under a key. */
  registerBuilder(key: string, builder: CaveBuilder): void;
  /** Whether a cave-builder key is registered. */
  hasBuilder(key: string): boolean;
  /**
   * The builder registered under a key; throws when there is none. Exposed so a
   * mod can WRAP a core builder (generate the classic cave, then add its own
   * feature to it) instead of only replacing it wholesale - decorating is the
   * common case, and without this the only way to reach core's generation from
   * a mod builder would be to reimplement it.
   */
  builder(key: string): CaveBuilder;
  /**
   * Append a dungeon profile. Its `builder` must already be registered - a
   * profile naming an unknown builder would throw from inside generation, one
   * level change after the mistake, so it is refused here instead.
   */
  addProfile(profile: DunProfile): void;
  /** Look a profile up by name, or null. */
  find(name: string): DunProfile | null;
  /** Every profile, in selection order. */
  list(): readonly DunProfile[];
}

/**
 * The monster blow-effect facade (gated by registry:blow).
 *
 * `blow_effects.json` has always accepted a 31st record; until this facade
 * existed that record was data with no behaviour, because the behaviour lived in
 * a switch. This is the seam that makes a new blow effect actually hit.
 *
 * `define` is the one to reach for: it takes a single description and derives
 * both of the handlers the engine needs - the worldless recording path and the
 * live one. `register` is the escape hatch for an effect that genuinely differs
 * between the two, and `handlerFor` is what a wrapper calls through to.
 */
export interface BlowFacade {
  /**
   * Add or replace a blow effect from ONE description. The spec's side effects
   * are recorded as intents by the worldless path and applied through the blow
   * environment by the live one, from the same value - so the two cannot drift.
   */
  define(name: string, spec: BlowEffectSpec): void;
  /** Add or replace a blow effect by supplying both handlers explicitly. */
  register(name: string, handler: BlowEffectHandler): void;
  /**
   * The handler currently installed for an effect name, or null. This is how a
   * mod WRAPS core's behaviour - take POISON's handler, register one that calls
   * it and then does something extra - rather than reimplementing it.
   */
  handlerFor(name: string): BlowEffectHandler | null;
  /** Whether anything answers for this effect name. */
  has(name: string): boolean;
  /** Every registered effect name, in registration order. */
  names(): readonly string[];
}

/**
 * The store-behaviour facade (gated by registry:store).
 *
 * Two decisions used to be switches with nothing to register into: what a shop
 * will BUY, and how many of a thing it stocks. A mod could already add a store
 * record and its own object types; it could not make the shop deal in them.
 *
 * The keys follow how each decision is actually made upstream - stack size by
 * TVAL, the buy decision by store FEAT with a wildcard for "every store", which
 * is the single body upstream shares. `willBuyFor(ANY_STORE)` hands back core's
 * own rule so a mod can wrap it rather than reimplement the worthless-item and
 * buy-list logic.
 */
export interface StoreFacade {
  /** Install (or replace) the stack rule for a tval (mass_produce). */
  setMassProduce(tval: number, handler: MassProduceHandler): void;
  /** The stack rule currently installed for a tval, or null. */
  massProduceFor(tval: number): MassProduceHandler | null;
  /** Every tval that has a stack rule. */
  massProduceTvals(): readonly number[];
  /** Install the buy decision for one store feat, or for every store. */
  setWillBuy(feat: number | typeof ANY_STORE, handler: WillBuyHandler): void;
  /** The buy decision installed for that key, or null. Wrap by re-registering. */
  willBuyFor(feat: number | typeof ANY_STORE): WillBuyHandler | null;
}

/** The player-command facade (gated by registry:command). */
export interface CommandFacade {
  /** Register (or replace) the action a player command code runs. */
  register(code: string, action: PlayerAction): void;
  /** Whether a command code currently has an action. */
  has(code: string): boolean;
}

/** The monster-AI facade (gated by registry:monster). */
export interface MonsterFacade {
  /**
   * Install the monster-turn hook (replaces any previously installed one; pass
   * null to clear). Consulted at the top of every monster's turn.
   */
  setTurnHook(hook: MonsterTurnHook | null): void;
}

/**
 * One side of the projection family: terrain, floor objects or the player.
 *
 * ONE CODE AT A TIME, deliberately. The engine's override fields are whole
 * tables, and a whole table is not composable - two mods each handing over a
 * complete map means the second discards the first, along with its brand-new
 * projection. Writing per code makes the load order do what it says: the last
 * mod to set a code wins that code, and every other mod's codes survive.
 *
 * `handlerFor` is what makes EXTENDING possible as well as replacing. It hands
 * back whatever is installed at that moment - core's handler, or an earlier
 * mod's - so wrapping another mod's WATER works exactly as wrapping core's does.
 */
export interface ProjectionSideFacade<H> {
  /** Install (or replace) the handler for one projection code. */
  set(code: string, handler: H): void;
  /** The handler installed for a code right now, or null. Wrap by re-setting. */
  handlerFor(code: string): H | null;
  /** Whether anything answers for this code. */
  has(code: string): boolean;
  /** Every code with a handler, core's first. */
  codes(): readonly string[];
}

/**
 * The projection facade (gated by registry:projection).
 *
 * `projection.json` has always accepted a new record, and `registry:effect`
 * could already fire one. What none of that could do was say what the new
 * projection DOES when it reaches a wall, a floor pile or the player - those
 * three were switches, and then registries with no producer. This is the
 * producer.
 */
export interface ProjectionFacade {
  /** project_f: what a projection does to terrain. */
  readonly feat: ProjectionSideFacade<ProjectFeatHandler>;
  /** project_o: what a projection does to objects on the floor. */
  readonly obj: ProjectionSideFacade<ProjectObjHandler>;
  /** project_p: what a projection does to the player. */
  readonly player: ProjectionSideFacade<PlayerSideHandler>;
}

/**
 * The room-template / vault glyph facade (gated by registry:glyph).
 *
 * `room_template.json` and `vault.json` have always accepted a new record, so a
 * mod could always ship a vault - but only one drawn with the glyphs the two
 * decoders already knew, because they were closed switches. A glyph they do not
 * know is silently plain floor: no error, no effect. This is the seam that makes
 * a new glyph mean something.
 *
 * The two alphabets are separate on purpose, because upstream's are: `+` is a
 * closed door in a room template and a SECRET door in a vault.
 */
export interface GlyphFacade {
  /** Install (or replace) the handler for one glyph of one decoder. */
  set(kind: GlyphKind, glyph: string, handler: GlyphHandler): void;
  /**
   * The handler installed for a glyph right now, or null. Wrap core by keeping
   * this, installing your own, and calling through - `%` places the outer wall
   * AND records an entrance, and reimplementing that from scratch to add one
   * effect is how a mod comes to disagree with the level around it.
   */
  handlerFor(kind: GlyphKind, glyph: string): GlyphHandler | null;
  /** Whether anything decodes this glyph. */
  has(kind: GlyphKind, glyph: string): boolean;
  /** Every glyph a decoder knows, core's first. */
  glyphs(kind: GlyphKind): readonly string[];
}

/**
 * One table of the effect-info facade. Written once and applied four times
 * because the four differ only in their key and handler types - four
 * hand-copied blocks would be four places for the capability check to go
 * missing.
 */
export interface EffectInfoTableFacade<K, H> {
  /** Install (or replace) the handler for one key. */
  set(key: K, handler: H): void;
  /**
   * The handler installed for a key right now, or null. Wrap core by keeping
   * this, installing your own, and calling through - EFINFO_BREATH's
   * description is a projection name, a radius, a dice string AND a
   * device-skill damage tail, and reimplementing that from scratch to change
   * one word is how a mod comes to disagree with the rest of the recall.
   */
  handlerFor(key: K): H | null;
  /** Whether anything handles this key. */
  has(key: K): boolean;
  /** Every key handled, core's first. */
  keys(): readonly K[];
}

/**
 * The effect-info facade (gated by registry:effect-info).
 *
 * `registry:effect` has always let a mod register a handler for a new effect
 * code and have it DO something. What it could not do was let the game describe
 * it: four closed switches meant a mod's effect showed a blank menu row, said
 * nothing in object recall, could never be summarised as granting an object
 * property, and accepted no NAMED subtype. This is the seam that gives a mod's
 * effect a voice.
 *
 * Four tables under three keys, kept separate because upstream's keys are:
 * `text` is keyed on the EFINFO_* flag (twenty flags cover a hundred and twelve
 * effects), `summary` on the effect CODE, `subtype` and `request` on the effect
 * INDEX or a mod's string code.
 */
export interface EffectInfoFacade {
  /** The menu row and the object-recall sentence, keyed on the EFINFO_* flag. */
  readonly text: EffectInfoTableFacade<string, EffectTextHandler>;
  /** effect_summarize_properties' arms, keyed on the effect code. */
  readonly summary: EffectInfoTableFacade<string, ActivationSummaryHandler>;
  /** effect_subtype's arms, keyed on the effect index or a mod code. */
  readonly subtype: EffectInfoTableFacade<EffectCode, EffectSubtypeHandler>;
  /** Which item an effect prompts for, keyed on the effect index or a mod code. */
  readonly request: EffectInfoTableFacade<EffectCode, EffectRequestHandler>;
}

/**
 * One table of the randart facade. Same shape as the effect-info tables and for
 * the same reason: four hand-copied blocks would be four places for the
 * capability check to go missing.
 */
export interface RandartTableFacade<K, H> {
  /** Install (or replace) the handler for one key. */
  set(key: K, handler: H): void;
  /**
   * The handler installed for a key right now, or null. Wrapping matters more
   * here than almost anywhere else: an ability that draws a different NUMBER of
   * random values changes every artifact generated after it, so reimplementing
   * core's from scratch and getting the draw count wrong is a whole-set
   * divergence rather than a local one.
   */
  handlerFor(key: K): H | null;
  /** Whether anything handles this key. */
  has(key: K): boolean;
  /** Every key handled, core's first. */
  keys(): readonly K[];
}

/**
 * The random-artifact facade (gated by registry:randart).
 *
 * `artifact.json` has always accepted a new record, so a mod could always ship a
 * FIXED artifact. Reaching the RANDOM artifact generator is a different thing:
 * four closed switches decided every property a randart can have, and a
 * mod-coined ability index took the default arm - which is a bare `break`. The
 * design loop spent power on it and the artifact got nothing, silently.
 */
export interface RandartFacade {
  /** What an ability does, keyed on the ART_IDX index. */
  readonly abilities: RandartTableFacade<number, RandartAbilityHandler>;
  /** An item class's starting to-hit / to-dam / AC, keyed on tval. */
  readonly prep: RandartTableFacade<number, RandartPrepHandler>;
  /** Which census bucket an item class counts toward, keyed on tval. */
  readonly census: RandartTableFacade<number, RandartCensusHandler>;
  /** Whether an activation is redundant, keyed on the EFPROP kind. */
  readonly redundancy: RandartTableFacade<number, RandartRedundancyHandler>;
}

/**
 * One table of the tval facade. Same shape as the effect-info and randart
 * tables and for the same reason: three hand-copied blocks would be three
 * places for the capability check to go missing.
 */
export interface TvalTableFacade<K, H> {
  /** Install (or replace) the handler for one key. */
  set(key: K, handler: H): void;
  /**
   * The handler installed for a key right now, or null. WRAPPING is the normal
   * case here rather than the advanced one: a mod almost never wants to replace
   * "is this a weapon", it wants to add one tval to the answer.
   */
  handlerFor(key: K): H | null;
  /** Whether anything handles this key. */
  has(key: K): boolean;
  /** Every key handled, core's first. */
  keys(): readonly K[];
}

/**
 * The item-CLASS facade (gated by registry:tval).
 *
 * `object.json` has always accepted a new record, so a mod could always ship a
 * new ITEM. Making core recognise a new item CLASS was a different thing: 34
 * predicates and two dispatches decided every property a class has, all closed,
 * all failing by answering no. A mod-coined tval was not a weapon, could not be
 * worn, could not be flavoured, was never "good", and was worth nothing
 * unidentified - across 408 call sites, silently.
 */
export interface TvalFacade {
  /**
   * Class membership, keyed on the EXPORTED PREDICATE'S OWN NAME -
   * `"tvalIsWeapon"`, `"tvalCanHaveFlavor"` - so there is no translation table
   * between what a mod writes and what core calls. A mod may also coin a class
   * name core has never heard of and ask about it from its own code.
   */
  readonly classes: TvalTableFacade<string, TvalClassPredicate>;
  /** Whether a template is "good" for its class, keyed on tval. */
  readonly good: TvalTableFacade<number, TvalGoodHandler>;
  /** What an UNIDENTIFIED item of this class is worth, keyed on tval. */
  readonly valueBase: TvalTableFacade<number, TvalValueBaseHandler>;
  /**
   * What the item class is CALLED, keyed on tval. Without an entry every
   * message, menu row, shop line and recall header naming the class reads the
   * literal string "(nothing)" - upstream's own default arm. This is the single
   * most visible thing a mod adding an item class has to register.
   */
  readonly basename: TvalTableFacade<number, TvalBasenameHandler>;
}

/**
 * One table of the rune facade. Same shape as the tval, effect-info and randart
 * table facades, and gated the same way.
 */
export interface RuneTableFacade<K, H> {
  /** Install (or replace) the handler for a key. */
  set(key: K, handler: H): void;
  /**
   * What is installed right now, or null - the WRAP idiom. Wrapping matters
   * more here than anywhere else: a mod that wants its own rune understood
   * almost never wants to replace core's answer for `"brand"`.
   */
  handlerFor(key: K): H | null;
  /** Whether anything handles this key. */
  has(key: K): boolean;
  /** Every key handled, core's first. */
  keys(): readonly K[];
}

/**
 * The RUNE facade (gated by registry:rune).
 *
 * A rune is the unit of object knowledge. Before this seam, five of the six
 * decisions below dispatched on `rune.variety`, which was a CLOSED TYPESCRIPT
 * UNION - a harder closure than a switch, because a mod could not coin a
 * variety at all and no default arm was ever reached to fail. See
 * `obj/rune-registry.ts` for what each unregistered key costs.
 *
 * `contribute` is not an extra: nothing in core ever asks about a rune that is
 * not in `buildRuneList`, so without it the six tables would be a seam every
 * caller walks past.
 */
export interface RuneFacade {
  /** The recall description, keyed on variety. */
  readonly desc: RuneTableFacade<RuneVariety, RuneDescHandler>;
  /** Whether the player knows it, keyed on variety. */
  readonly knows: RuneTableFacade<RuneVariety, RuneKnowsHandler>;
  /** Whether an item carries it, keyed on variety. */
  readonly objectHas: RuneTableFacade<RuneVariety, RuneObjectHasHandler>;
  /** Learning it, keyed on variety. */
  readonly learn: RuneTableFacade<RuneVariety, RuneLearnHandler>;
  /** The display decoration, keyed on variety. Absent means the bare name. */
  readonly name: RuneTableFacade<RuneVariety, RuneNameHandler>;
  /** The "You feel stronger!" line, keyed on the OBJ_MOD index. */
  readonly modMessage: RuneTableFacade<number, ModMessageHandler>;
  /** Add runes to the list every consumer enumerates. */
  contribute(source: RuneContributor): void;
}

/**
 * The vocabulary-extension facade (gated by registry:vocab). Declares NEW terms
 * (flags / stats / any mod-coined kind) and stores per-entity values for them -
 * the W2.3 seam. Delegates to the mod's own VocabularyRegistry (mod/vocabulary.ts),
 * which the host persists into the mod's save bag; core never reads these terms.
 */
export interface VocabFacade {
  /** Declare a new term; throws on a duplicate (same kind + term). */
  define(term: VocabTerm): void;
  /** Whether a term is declared in a kind. */
  has(kind: VocabKind, term: string): boolean;
  /** All declared terms, optionally filtered to one kind. */
  list(kind?: VocabKind): VocabTerm[];
  /** Set an entity's value for a declared term (throws if undeclared). */
  setValue(entity: string, term: string, value: JsonValue): void;
  /** Get an entity's value for a term, or undefined when unset. */
  getValue(entity: string, term: string): JsonValue | undefined;
  /** A plain snapshot of one entity's term values. */
  valuesOf(entity: string): { [term: string]: JsonValue };
}

/**
 * The capability-gated registry host handed to a trusted in-process plugin.
 * Each facade throws AgentCapabilityError on first use if the corresponding
 * registry:<domain> capability was not granted, and a plain Error if the host
 * did not wire that registry (e.g. effects on a worldless boot).
 */
export interface ModRegistryHost {
  readonly effects: EffectFacade;
  readonly rooms: RoomFacade;
  readonly profiles: ProfileFacade;
  readonly blows: BlowFacade;
  readonly stores: StoreFacade;
  readonly commands: CommandFacade;
  readonly monsters: MonsterFacade;
  readonly projections: ProjectionFacade;
  readonly glyphs: GlyphFacade;
  readonly effectInfo: EffectInfoFacade;
  readonly randart: RandartFacade;
  readonly tval: TvalFacade;
  readonly rune: RuneFacade;
  readonly vocab: VocabFacade;
}

/** Absent capabilities => trusted host, all granted (perceive/act convention). */
function granted(caps: AgentCapabilities | undefined, capability: string): boolean {
  return !caps || caps.has(capability);
}

function requireCap(
  caps: AgentCapabilities | undefined,
  domain: RegistryDomain,
): void {
  const capability = REGISTRY_CAPABILITIES[domain];
  if (!granted(caps, capability)) {
    throw new AgentCapabilityError(
      `mod registry: "${domain}" override requires capability "${capability}" - grant it in the mod manifest`,
    );
  }
}

function requireTarget<T>(target: T | null | undefined, domain: RegistryDomain): T {
  if (target === null || target === undefined) {
    throw new Error(
      `mod registry: the "${domain}" registry is not available in this game (host did not wire it)`,
    );
  }
  return target;
}

/**
 * One side of the projection facade. Written once and applied three times
 * because terrain, objects and the player differ only in their handler type -
 * three hand-copied blocks would be three places for the capability check to go
 * missing from, and a facade that forgot its gate is a capability that does not
 * exist.
 *
 * The target is resolved per call, like every other facade here, so a host that
 * wired no registry fails at the call the mod made rather than at construction.
 */
function projectionSide<H>(
  capabilities: AgentCapabilities | undefined,
  targets: RegistryTargets,
  pick: (registry: ProjectionHandlerRegistry) => ProjectionHandlerTable<H>,
): ProjectionSideFacade<H> {
  const table = (): ProjectionHandlerTable<H> =>
    pick(requireTarget(targets.projections, "projection"));
  return {
    set(code, handler): void {
      requireCap(capabilities, "projection");
      table().set(code, handler);
    },
    handlerFor(code): H | null {
      requireCap(capabilities, "projection");
      return table().handlerFor(code);
    },
    has(code): boolean {
      requireCap(capabilities, "projection");
      return table().has(code);
    },
    codes(): readonly string[] {
      requireCap(capabilities, "projection");
      return table().codes();
    },
  };
}

/**
 * One table of the effect-info facade, gated. Same shape as projectionSide and
 * for the same reason: four hand-copied blocks would be four places for the
 * capability check to go missing.
 */
function effectInfoTable<K, H>(
  capabilities: AgentCapabilities | undefined,
  targets: RegistryTargets,
  pick: (registry: EffectInfoRegistry) => EffectInfoTable<K, H>,
): EffectInfoTableFacade<K, H> {
  const table = (): EffectInfoTable<K, H> =>
    pick(requireTarget(targets.effectInfo, "effectInfo"));
  return {
    set(key, handler): void {
      requireCap(capabilities, "effectInfo");
      table().set(key, handler);
    },
    handlerFor(key): H | null {
      requireCap(capabilities, "effectInfo");
      return table().handlerFor(key);
    },
    has(key): boolean {
      requireCap(capabilities, "effectInfo");
      return table().has(key);
    },
    keys(): readonly K[] {
      requireCap(capabilities, "effectInfo");
      return table().keys();
    },
  };
}

/** One table of the randart facade, gated. */
function randartTable<K, H>(
  capabilities: AgentCapabilities | undefined,
  targets: RegistryTargets,
  pick: (registry: RandartRegistry) => RandartTable<K, H>,
): RandartTableFacade<K, H> {
  const table = (): RandartTable<K, H> =>
    pick(requireTarget(targets.randart, "randart"));
  return {
    set(key, handler): void {
      requireCap(capabilities, "randart");
      table().set(key, handler);
    },
    handlerFor(key): H | null {
      requireCap(capabilities, "randart");
      return table().handlerFor(key);
    },
    has(key): boolean {
      requireCap(capabilities, "randart");
      return table().has(key);
    },
    keys(): readonly K[] {
      requireCap(capabilities, "randart");
      return table().keys();
    },
  };
}

/**
 * One table of the tval facade, gated.
 */
function tvalTable<K, H>(
  capabilities: AgentCapabilities | undefined,
  targets: RegistryTargets,
  pick: (registry: TvalRegistry) => TvalTable<K, H>,
): TvalTableFacade<K, H> {
  const table = (): TvalTable<K, H> => pick(requireTarget(targets.tval, "tval"));
  return {
    set(key, handler): void {
      requireCap(capabilities, "tval");
      table().set(key, handler);
    },
    handlerFor(key): H | null {
      requireCap(capabilities, "tval");
      return table().handlerFor(key);
    },
    has(key): boolean {
      requireCap(capabilities, "tval");
      return table().has(key);
    },
    keys(): readonly K[] {
      requireCap(capabilities, "tval");
      return table().keys();
    },
  };
}

/**
 * One table of the rune facade, gated.
 */
function runeTable<K, H>(
  capabilities: AgentCapabilities | undefined,
  targets: RegistryTargets,
  pick: (registry: RuneRegistry) => RuneTable<K, H>,
): RuneTableFacade<K, H> {
  const table = (): RuneTable<K, H> => pick(requireTarget(targets.rune, "rune"));
  return {
    set(key, handler): void {
      requireCap(capabilities, "rune");
      table().set(key, handler);
    },
    handlerFor(key): H | null {
      requireCap(capabilities, "rune");
      return table().handlerFor(key);
    },
    has(key): boolean {
      requireCap(capabilities, "rune");
      return table().has(key);
    },
    keys(): readonly K[] {
      requireCap(capabilities, "rune");
      return table().keys();
    },
  };
}

/**
 * Build the capability-gated registry host over the live registries. Pass the
 * plugin's AgentCapabilities (from CapabilitySet.fromManifest); omit for a fully
 * trusted host. The gate is checked at each call, so a plugin that never touches
 * a domain never needs its capability.
 */
export function createModRegistryHost(
  targets: RegistryTargets,
  capabilities?: AgentCapabilities,
): ModRegistryHost {
  return {
    effects: {
      register(code, def): void {
        requireCap(capabilities, "effect");
        requireTarget(targets.effects, "effect").register(code, def);
      },
      isRegistered(code): boolean {
        requireCap(capabilities, "effect");
        return requireTarget(targets.effects, "effect").isRegistered(code);
      },
    },
    rooms: {
      register(name, builder): void {
        requireCap(capabilities, "room");
        requireTarget(targets.rooms, "room").register(name, builder);
      },
    },
    profiles: {
      registerBuilder(key, builder): void {
        requireCap(capabilities, "profile");
        requireTarget(targets.profiles, "profile").registerBuilder(key, builder);
      },
      hasBuilder(key): boolean {
        requireCap(capabilities, "profile");
        return requireTarget(targets.profiles, "profile").hasBuilder(key);
      },
      builder(key): CaveBuilder {
        requireCap(capabilities, "profile");
        return requireTarget(targets.profiles, "profile").builder(key);
      },
      addProfile(profile): void {
        requireCap(capabilities, "profile");
        const reg = requireTarget(targets.profiles, "profile");
        if (!reg.hasBuilder(profile.builder)) {
          throw new Error(
            `mod registry: profile "${profile.name}" names cave builder ` +
              `"${profile.builder}", which is not registered - register the builder first`,
          );
        }
        reg.addProfile(profile);
      },
      find(name): DunProfile | null {
        requireCap(capabilities, "profile");
        return requireTarget(targets.profiles, "profile").find(name);
      },
      list(): readonly DunProfile[] {
        requireCap(capabilities, "profile");
        return requireTarget(targets.profiles, "profile").list();
      },
    },
    blows: {
      define(name, spec): void {
        requireCap(capabilities, "blow");
        requireTarget(targets.blows, "blow").register(name, blowEffect(spec));
      },
      register(name, handler): void {
        requireCap(capabilities, "blow");
        requireTarget(targets.blows, "blow").register(name, handler);
      },
      handlerFor(name): BlowEffectHandler | null {
        requireCap(capabilities, "blow");
        return requireTarget(targets.blows, "blow").handlerFor(name);
      },
      has(name): boolean {
        requireCap(capabilities, "blow");
        return requireTarget(targets.blows, "blow").has(name);
      },
      names(): readonly string[] {
        requireCap(capabilities, "blow");
        return requireTarget(targets.blows, "blow").names();
      },
    },
    stores: {
      setMassProduce(tval, handler): void {
        requireCap(capabilities, "store");
        requireTarget(targets.stores, "store").registerMassProduce(tval, handler);
      },
      massProduceFor(tval): MassProduceHandler | null {
        requireCap(capabilities, "store");
        return requireTarget(targets.stores, "store").massProduceFor(tval);
      },
      massProduceTvals(): readonly number[] {
        requireCap(capabilities, "store");
        return requireTarget(targets.stores, "store").massProduceTvals();
      },
      setWillBuy(feat, handler): void {
        requireCap(capabilities, "store");
        requireTarget(targets.stores, "store").registerWillBuy(feat, handler);
      },
      willBuyFor(feat): WillBuyHandler | null {
        requireCap(capabilities, "store");
        return requireTarget(targets.stores, "store").willBuyFor(feat);
      },
    },
    commands: {
      register(code, action): void {
        requireCap(capabilities, "command");
        requireTarget(targets.commands, "command").register(code, action);
      },
      has(code): boolean {
        requireCap(capabilities, "command");
        return requireTarget(targets.commands, "command").has(code);
      },
    },
    monsters: {
      setTurnHook(hook): void {
        requireCap(capabilities, "monster");
        const state = requireTarget(targets.state, "monster");
        if (hook) state.monsterTurnHook = hook;
        else delete state.monsterTurnHook;
      },
    },
    projections: {
      feat: projectionSide(capabilities, targets, (r) => r.feat),
      obj: projectionSide(capabilities, targets, (r) => r.obj),
      player: projectionSide(capabilities, targets, (r) => r.player),
    },
    glyphs: {
      set(kind, glyph, handler): void {
        requireCap(capabilities, "glyph");
        requireTarget(targets.glyphs, "glyph").set(kind, glyph, handler);
      },
      handlerFor(kind, glyph): GlyphHandler | null {
        requireCap(capabilities, "glyph");
        return requireTarget(targets.glyphs, "glyph").handlerFor(kind, glyph);
      },
      has(kind, glyph): boolean {
        requireCap(capabilities, "glyph");
        return requireTarget(targets.glyphs, "glyph").has(kind, glyph);
      },
      glyphs(kind): readonly string[] {
        requireCap(capabilities, "glyph");
        return requireTarget(targets.glyphs, "glyph").glyphs(kind);
      },
    },
    effectInfo: {
      text: effectInfoTable(capabilities, targets, (r) => r.text),
      summary: effectInfoTable(capabilities, targets, (r) => r.summary),
      subtype: effectInfoTable(capabilities, targets, (r) => r.subtype),
      request: effectInfoTable(capabilities, targets, (r) => r.request),
    },
    randart: {
      abilities: randartTable(capabilities, targets, (r) => r.abilities),
      prep: randartTable(capabilities, targets, (r) => r.prep),
      census: randartTable(capabilities, targets, (r) => r.census),
      redundancy: randartTable(capabilities, targets, (r) => r.redundancy),
    },
    tval: {
      classes: tvalTable(capabilities, targets, (r) => r.classes),
      good: tvalTable(capabilities, targets, (r) => r.good),
      valueBase: tvalTable(capabilities, targets, (r) => r.valueBase),
      basename: tvalTable(capabilities, targets, (r) => r.basename),
    },
    rune: {
      desc: runeTable(capabilities, targets, (r) => r.desc),
      knows: runeTable(capabilities, targets, (r) => r.knows),
      objectHas: runeTable(capabilities, targets, (r) => r.objectHas),
      learn: runeTable(capabilities, targets, (r) => r.learn),
      name: runeTable(capabilities, targets, (r) => r.name),
      modMessage: runeTable(capabilities, targets, (r) => r.modMessage),
      contribute(source): void {
        requireCap(capabilities, "rune");
        requireTarget(targets.rune, "rune").contribute(source);
      },
    },
    vocab: {
      define(term): void {
        requireCap(capabilities, "vocab");
        requireTarget(targets.vocab, "vocab").define(term);
      },
      has(kind, term): boolean {
        requireCap(capabilities, "vocab");
        return requireTarget(targets.vocab, "vocab").has(kind, term);
      },
      list(kind): VocabTerm[] {
        requireCap(capabilities, "vocab");
        return requireTarget(targets.vocab, "vocab").list(kind);
      },
      setValue(entity, term, value): void {
        requireCap(capabilities, "vocab");
        requireTarget(targets.vocab, "vocab").setValue(entity, term, value);
      },
      getValue(entity, term): JsonValue | undefined {
        requireCap(capabilities, "vocab");
        return requireTarget(targets.vocab, "vocab").getValue(entity, term);
      },
      valuesOf(entity): { [term: string]: JsonValue } {
        requireCap(capabilities, "vocab");
        return requireTarget(targets.vocab, "vocab").valuesOf(entity);
      },
    },
  };
}

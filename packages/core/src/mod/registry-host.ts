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
 *   cmd.ts CommandQueue is a faithful port the web loop does not drive.) The
 *   same facade names the command: setVerb writes GameState.commandVerbs, which
 *   is the verb the "Really <verb> <the object>? " inscription confirm reads.
 * - monsters (GameState.monsterTurnHook, game/monster-turn.ts): install a hook
 *   consulted at the top of every monster's turn; returning true takes the turn
 *   over entirely - overriding monster AI. Gated by "registry:monster".
 * - projections (ProjectionHandlerRegistry, game/projection-handlers.ts): install
 *   the handler for one projection CODE on any of the three sides - terrain
 *   (project_f), floor objects (project_o) or the player (project_p) - so a
 *   mod's own projection actually DOES something, and a core projection can be
 *   changed or wrapped. Gated by "registry:projection".
 * - uiEntry  (UiEntryRegistry, game/ui-entry-registry.ts): the second character
 *   screen's two closed tables - the value COMBINERS a resist / ability /
 *   modifier row reduces its per-slot values with, and the renderer BACKENDS
 *   that turn a (val, aux) pair into a cell symbol and colour. `ui_entry.json`
 *   always accepted a new row; what it could not do was say what a
 *   `combine: "MY_OR"` or `code: "MY_BARS"` on it MEANS. Gated by
 *   "registry:ui-entry".
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
 * - messages (MessageTypeRegistry + SoundPrefRegistry, sound/): declare a new
 *   MESSAGE TYPE (a `msgt:`) and bind sample names to it. One domain because
 *   they are one thing - a message type and the sound it plays - and because a
 *   mod's new spell needs both halves or neither. Gated by "registry:message".
 *   Additive only, and no game logic: this is vocabulary, like registry:vocab.
 *   Note the message half is not a missing feature but a CRASH - `checkMsgt`
 *   throws PARSE_ERROR_INVALID_MESSAGE for an unknown `msgt:`, and composition
 *   delivers a mod's record to the binder intact, so trying took the bind down.
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
 * WHAT THE GATE IS, SAID EXACTLY, because the difference decides what the
 * consent screen is allowed to promise. The gate is on the FACADE, not on the
 * registry behind it. Every target below is also reachable from the same plugin
 * with no capability check: `ctx.registries` carries the bound CoreRegistries
 * (so rooms, profiles and the glyph table), `ctx.state` carries the live
 * GameState (so blows, stores, projections, ui-entry, command verbs and the
 * monster hook) and `ctx.core` is the module namespace (so the module-level
 * tval, rune, randart, effect-info, message-type and sound-pref registries -
 * and this function, which grants everything when called with no capability
 * set). Those are the same objects by identity, not copies.
 *
 * That is inherent in running in-process rather than a hole to plug: nothing
 * reachable from inside the namespace can be withheld from code already inside
 * it, and a read-only view over one of the three doors would close a third of
 * the twins while reading as though it had closed the class. So the honest
 * account of what a registry:* capability buys is: the player sees the declared
 * list before consenting, the conflict report and the manager row are built from
 * it, and an author who forgot a domain gets a named throw instead of a silent
 * surprise. The boundary that actually holds is the INSTALL - a mod is code and
 * nothing reviews it (packages/web/src/mod-consent.ts). Both halves are measured
 * in packages/web/src/capability-gate-reach.test.ts, and the prose a mod author
 * reads is docs/modding/PLUGINS.md, "What a capability gates".
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
import type { CommandInfo, CommandVerbTable } from "../cmd.js";
import type { TileAtlas } from "../visuals/tile-prefs.js";
import type { GameState } from "../game/context.js";
import type { Monster } from "../mon/monster.js";
import type {
  BlowEffectHandler,
  BlowEffectSpec,
  BlowEffectRegistry,
} from "../combat/mon-melee.js";
import { blowEffect } from "../combat/mon-melee.js";
import type {
  DiscountRollHandler,
  MassProduceHandler,
  StoreBehaviourRegistry,
  WillBuyHandler,
} from "../store/store.js";
import { ANY_STORE } from "../store/store.js";
import type {
  ProjectionHandlerRegistry,
  ProjectionHandlerTable,
} from "../game/projection-handlers.js";
import type {
  UiEntryBackend,
  UiEntryNameTable,
  UiEntryRegistry,
} from "../game/ui-entry-registry.js";
import type { CombinerFuncs } from "../game/ui-entry.js";
import type { ProjectFeatHandler } from "../game/project-feat.js";
import type { ProjectObjHandler } from "../game/project-obj.js";
import type { PlayerSideHandler } from "../game/player-side.js";
import type { MonHandler } from "../mon/project-mon.js";
import { messageLookupByName } from "../sound/engine.js";
import { messageTypes } from "../sound/message-types.js";
import type {
  MessageTypeEntry,
  MessageTypeRegistryTarget,
} from "../sound/message-types.js";
import { soundPrefRegistry } from "../sound/sound-registry.js";
import type { SoundPrefRegistryTarget } from "../sound/sound-registry.js";
import type { SoundPrefEntry } from "../sound/sound-prefs-data.js";
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
  uiEntry: "registry:ui-entry",
  glyph: "registry:glyph",
  effectInfo: "registry:effect-info",
  randart: "registry:randart",
  tval: "registry:tval",
  rune: "registry:rune",
  vocab: "registry:vocab",
  message: "registry:message",
  /** Web-owned screen rows; kept here so the capability vocabulary has one source. */
  menu: "registry:menu",
  /** Web-owned tile maps, same reason. See TilesFacade. */
  tiles: "registry:tiles",
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
  /**
   * The verbs the inscription confirm reads (GameState.commandVerbs). Separate
   * target, same "command" capability: naming a command is part of adding one,
   * and a second capability string for one UI string would be noise.
   */
  commandVerbs?: CommandVerbTable | null;
  /** The game state, for installing the monster-AI turn hook. */
  state?: GameState | null;
  /** The three projection handler tables (GameState.projectionHandlers). */
  projections?: ProjectionHandlerRegistry | null;
  /** The character screen's combiner / renderer-backend tables (GameState.uiEntry). */
  uiEntry?: UiEntryRegistry | null;
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
  /**
   * Mod-supplied MSG_ types and `sound:` directives.
   *
   * These two default to core's module-level singletons when the field is
   * omitted, which the other targets do not. That is not laxity: both are
   * process-wide by construction - `messageLookupByName` is a free function
   * every BINDER calls before any game exists, and the sound engine is built
   * once per front end and outlives every character - so there is exactly one
   * of each and a host has nothing else it could pass. Passing `null`
   * explicitly still means "not available here" and still throws.
   */
  messages?: MessageTypeRegistryTarget | null;
  sounds?: SoundPrefRegistryTarget | null;
  /** The front end's menu transformer registry (web owns the live implementation). */
  menus?: MenuRegistryTarget | null;
  /** The front end's tile-filler registry (web owns the live implementation). */
  tiles?: TileRegistryTarget | null;
}

/**
 * A menu row's stable, presentation-independent meaning. `kind` identifies
 * the broad interaction (command, item, category, toggle, ...); `ref` names
 * the concrete target when there is one. Extra scalar data lets a front end
 * carry upstream details without inventing a type dependency on its renderer.
 */
export interface MenuSemantics {
  readonly kind: string;
  readonly ref?: string | number;
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
}

/** The declarative part of a selectable front-end row, safe for a plugin to rewrite. */
export interface MenuTransformRow {
  /** Stable per-row identity, never a localized display string. */
  readonly id: string;
  readonly semantic: MenuSemantics;
  readonly label: string;
  readonly color?: string;
  readonly disabled?: boolean;
  readonly tag?: string;
  readonly inscrip?: string | null;
  readonly hint?: string;
  readonly suffix?: { readonly text: string; readonly color: string; readonly col: number };
}

/** Transform every row of one stable menu id. */
export type MenuTransformer = (
  id: string,
  rows: readonly MenuTransformRow[],
) => readonly MenuTransformRow[];

/** Structural target implemented by the web front end, not by headless core. */
export interface MenuRegistryTarget {
  register(id: string, transformer: MenuTransformer, owner?: string): void;
  handlerFor(id: string): MenuTransformer | null;
}

/**
 * Which tile pack a fill is running for, so a filler can decline a pack it has
 * no business drawing for. A tileset mod's fill is right for ITS OWN packs and
 * a guess about anybody else's art.
 */
export interface TileFillPack {
  /** The engine drawing it: "tilesheet" for a fixed atlas, "linoleum" for a loose pack. */
  readonly engine: string;
  /** The pack's stable id - its directory name - or "" when the engine has none. */
  readonly id: string;
  /** The name the Graphics screen shows for it. */
  readonly menuname: string;
}

/**
 * What a tile filler is handed, and deliberately NOT the tile map itself.
 *
 * WHY A DOOR RATHER THAN THE MAP. The map is the pack author's work plus every
 * pref layer the player has. A filler exists for one narrow thing - content the
 * pack has never heard of, which is to say content a mod added - and handing it
 * the map would let it repaint the Balrog. `fillMonster` and `fillObject` write
 * only where NOTHING is assigned and return false otherwise, so the guarantee
 * that no filler can change what an existing rule draws is mechanical rather
 * than a promise each mod keeps separately. It also makes two fillers
 * order-independent: whoever asks first for a given index gets it, and neither
 * can undo the other.
 *
 * WHAT IS NOT HERE, on purpose. Who is kin to whom, who deserves a tile at all,
 * which donor to copy, and what colour to make it are all JUDGEMENTS, and the
 * game does not get to make them: 4.2.6 has no opinion about what a creature it
 * has never heard of should look like, and a rule invented here would be the
 * port adding something. A tileset mod holds the policy and reads the bound
 * registries through `ctx.registries` to apply it.
 *
 * `derive` is the one capability the game does supply, because it is mechanism
 * with no taste in it: give me a tile that draws `donor`'s asset with its hue
 * rotated `hue` degrees. It returns null when this engine cannot - a fixed
 * atlas has no spare cell to put a variant in, and even a loose pack cannot
 * recolour a donor it does not own the asset for - so a filler that wants a
 * plain copy instead has to say so.
 *
 * `transform` is the second, on the same terms: give me a tile that draws
 * `donor`'s asset mirrored, or with its colours replaced from a ramp I hand
 * over, or both. Which donor, which way round and which colours are all the
 * caller's - see TileTransform.
 */
export interface TileFill {
  /** The pack being filled. */
  readonly pack: TileFillPack;
  /** The tile assigned to a race (`ridx`) right now, or null. A donor to copy. */
  monsterTile(ridx: number): TileAtlas | null;
  /** The tile assigned to an object kind (`kidx`) right now, or null. */
  objectTile(kidx: number): TileAtlas | null;
  /** Supply a race's tile IF nothing has. False means something already had. */
  fillMonster(ridx: number, tile: TileAtlas): boolean;
  /** Supply an object kind's tile IF nothing has. False means something already had. */
  fillObject(kidx: number, tile: TileAtlas): boolean;
  /** A tile drawing `donor`'s asset with its hue rotated, or null if impossible. */
  derive(donor: TileAtlas, hue: number): TileAtlas | null;
  /**
   * A tile drawing `donor`'s asset mirrored and/or palette-swapped, or null if
   * impossible - the same three refusals `derive` has, for the same reasons.
   */
  transform(donor: TileAtlas, spec: TileTransform): TileAtlas | null;
}

/** One replacement colour in a palette remap: red, green, blue, each 0-255. */
export type TileRampColour = readonly [number, number, number];

/**
 * How a transformed tile differs from the donor whose picture it draws.
 *
 * A PALETTE REMAP RATHER THAN A HUE ROTATION, and the two are not variants of
 * one idea. `derive`'s rotation asks "the same picture, turned": it keeps the
 * donor's own colours and moves them around the wheel, which is why it is a
 * no-op on grey. A ramp remap asks for a DIFFERENT palette: every pixel is
 * indexed into the ramp by its luminance and replaced by the colour that index
 * names, so the result is in the caller's colours whatever the donor's were,
 * grey donors included. Alpha is carried through untouched, so the silhouette
 * is the donor's exactly.
 *
 * Fewer ramp entries read as flatter and more stylised; more preserve the
 * donor's shading. Two is a hard duotone. The caller picks, because how
 * stylised somebody's art should look is taste and the engine has none.
 *
 * A ramp of nothing (or of one colour) is not a palette, so it is treated as
 * "no colour change" and only `mirror` applies. A transform that asks for
 * neither is refused, the same way a rotation of nothing is: it would allocate
 * a tile indistinguishable from its donor.
 */
export interface TileTransform {
  /** Mirror the picture horizontally. */
  readonly mirror: boolean;
  /**
   * Replacement colours, DARKEST FIRST.
   *
   * There is a cap on how many, and it lives with the DOOR rather than here
   * (`TILE_RAMP_MAX`, the front end's tile-registry) because the reason for it is
   * the front end's: it caches one image per distinct spec, so what bounds a ramp
   * is what bounds that cache. Core describes the shape; the front end that pays
   * for it sets the limit.
   */
  readonly ramp: readonly TileRampColour[];
}

/**
 * What a player-tile provider is told about the character it is drawing.
 *
 * DELIBERATELY NOT THE PLAYER RECORD. A provider decides what picture to show,
 * and the five facts below are what any such decision can be made from; handing
 * over the live `Player` would make every field of it part of this contract and
 * let a render-time hook mutate the character. Names rather than indices,
 * because a mod's rule is written against "Druid", not against cidx 2, and an
 * index moves when a content mod inserts a class.
 */
export interface PlayerTileView {
  /**
   * The current shape's name ("fox", "werewolf", ...), or null in the normal
   * shape. Exactly player_is_shapechanged's question, answered with which shape.
   */
  readonly shape: string | null;
  /** player->lev, 1 to PY_MAX_LEVEL. */
  readonly level: number;
  /** The character's class name (player.cls.name). */
  readonly cls: string;
  /** The character's race name (player.race.name). */
  readonly race: string;
}

/**
 * A mod's player-tile provider: which tile the PLAYER's own cell draws.
 *
 * WHY THIS IS NOT A FILL. The player is race 0 in the monster tile table
 * (grid_data_as_text's is_player branch reads that slot for both the colour and
 * the character), and every tile set the game ships assigns it - so there is no
 * blank for `fillMonster` to write into, and there should not be: the pack's
 * player picture is the pack author's work. This asks a different question,
 * once per frame rather than once per map build: given who the character is
 * right now, is there a tile that fits better than the standing one? Null means
 * no, and the pack's own player tile is drawn, which is what happens with no
 * provider installed at all.
 *
 * It runs inside the render path, so it must be a lookup and not a computation:
 * allocate whatever tiles the answers need during the fill (where `transform`
 * lives) and read the table here. A provider that throws loses its answer for
 * that frame and nothing else.
 */
export type PlayerTileProvider = (view: PlayerTileView) => TileAtlas | null;

/**
 * A mod's tile filler: supply tiles for content this pack does not draw.
 *
 * Called once per built tile map, which is at graphics-mode change and at boot,
 * after every pref layer (the pack's own, then each mod's) has been applied - so
 * an author who named a specific tile has already won and the filler sees no
 * blank there.
 *
 * Only monsters and object kinds, because that is what the one consumer needs.
 * A terrain or trap filler would be a seam with nothing behind it, and this
 * repository has shipped enough of those.
 */
export type TileFiller = (fill: TileFill) => void;

/** Structural target implemented by the web front end, not by headless core. */
export interface TileRegistryTarget {
  register(filler: TileFiller, owner?: string): void;
  player(provider: PlayerTileProvider, owner?: string): void;
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
  /**
   * Install (or replace) the discount roll (mass_produce's discount arm,
   * dropped from this port's 4.2.6 baseline - see DiscountRollHandler). No
   * handler installed, the default, means no store ever discounts anything.
   */
  setDiscountRoll(handler: DiscountRollHandler): void;
  /** The discount roll currently installed, or null. */
  discountRollHandler(): DiscountRollHandler | null;
}

/**
 * Metadata for a command that exists only in the live action registry, not in
 * upstream's closed game_cmds[] table. CommandQueue needs this only to admit
 * the command to its dispatch path; the action itself still lives in
 * ActionRegistry and decides its own energy use.
 */
const REGISTERED_COMMAND_INFO: CommandInfo = {
  verb: "perform a registered command",
  repeatAllowed: false,
  canUseEnergy: true,
  autoRepeatN: 0,
};

/**
 * The CommandQueue fallback for a code that is absent from COMMAND_INFO.
 * ActionRegistry is the per-game registration table that every
 * registry:command facade writes, so this includes commands contributed by
 * every enabled mod without making the upstream metadata table mutable.
 */
export function registeredCommandInfo(
  commands: Pick<ActionRegistry, "has"> | null | undefined,
  code: string,
): CommandInfo | undefined {
  return commands?.has(code) ? REGISTERED_COMMAND_INFO : undefined;
}

/** The player-command facade (gated by registry:command). */
export interface CommandFacade {
  /** Register (or replace) the action a player command code runs. */
  register(code: string, action: PlayerAction): void;
  /** Whether a command code currently has an action. */
  has(code: string): boolean;
  /**
   * Name the command, for the one place the game says a command out loud: the
   * "Really <verb> <the object>? " an inscribed item demands
   * (get_item_allow, ui-object.c:664). Without this a mod's own command has no
   * entry in core's closed COMMAND_INFO and the player reads the generic "do
   * that with" for a named action.
   *
   * Lower case and no trailing space - it lands mid-sentence, so "dance with",
   * not "Dance with ". Core's own reads "quaff", "read", "take off".
   */
  setVerb(code: string, verb: string): void;
  /**
   * The verb currently installed for a code, or null. Core's verb until some
   * mod has replaced it, and that mod's afterwards - the wrap seam, as
   * elsewhere.
   */
  verbFor(code: string): string | null;
}

/** The front-end menu facade (gated by registry:menu). */
export interface MenuFacade {
  /** Install (or replace) the transformer for one stable menu id. */
  register(id: string, transformer: MenuTransformer): void;
  /** The currently installed transformer, for layering/wrapping an earlier mod. */
  handlerFor(id: string): MenuTransformer | null;
}

/**
 * The tile-filling facade (gated by registry:tiles).
 *
 * One filler per mod: registering twice replaces this mod's own and never
 * anybody else's, so there is nothing to wrap and no `handlerFor` here. Every
 * registered filler runs, in load order, and each can only write where nothing
 * has - see TileFill for why that is the whole safety argument.
 */
export interface TilesFacade {
  /** Install (or replace) this mod's tile filler. */
  register(filler: TileFiller): void;
  /**
   * Install (or replace) this mod's player-tile provider. One per mod for the
   * same reason as the filler, and first non-null in load order wins - so a
   * provider that answers null for everything it has no opinion about leaves
   * the next mod's answer, and the pack's own tile, both reachable.
   */
  player(provider: PlayerTileProvider): void;
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
  /**
   * project_m: what a projection does to a MONSTER - the resist / damage /
   * timed-effect computation, before the driver applies it.
   *
   * The fourth side, added 2026-08-14. Until then a mod's own projection could
   * burn terrain, burn floor items and hurt the player, and did literally
   * nothing to a monster: `MONSTER_HANDLERS` was a frozen 56-slot ARRAY indexed
   * by PROJ value, and a mod's projection is appended past the end of it. Rides
   * on `registry:projection` with the other three - it is the same consent.
   */
  readonly mon: ProjectionSideFacade<MonHandler>;
}

/**
 * One name-keyed ui-entry table: the combiners, or the renderer backends.
 *
 * Same shape and same two rules as ProjectionSideFacade. ONE NAME AT A TIME, so
 * two mods each adding a combiner both keep theirs; and `handlerFor` is the wrap
 * seam, so a mod that wants "RESIST_0 but treat a vulnerability as a resist"
 * takes core's, installs its own, and calls through - rather than reimplementing
 * a reduction whose NOT_PRESENT / UNKNOWN / RES_VUL handling is the whole
 * difference between a right cell and a plausible one.
 */
export interface UiEntryTableFacade<H> {
  /** Install (or replace) the handler for one name. */
  set(name: string, handler: H): void;
  /** The handler installed for a name right now, or null. Wrap by re-setting. */
  handlerFor(name: string): H | null;
  /** Whether anything answers for this name. */
  has(name: string): boolean;
  /** Every name with a handler, core's first. */
  names(): readonly string[];
}

/**
 * The ui-entry facade (gated by registry:ui-entry).
 *
 * TWO TABLES, NOT ONE, because the two halves are different kinds of thing. A
 * combiner is a pure numeric reduction over the (val, aux) pairs of one row -
 * nine of them, each a few lines. A backend is the UI algorithm that turns those
 * pairs into cell symbols and palette colours, and it carries default palettes
 * of its own that a renderer record inherits. A mod writing one is rarely
 * writing the other.
 *
 * ORDERING. Register in `register()`, which runs with a live game and before any
 * screen opens. `buildUiEntryConfig` reads the BACKEND table once, for the
 * palette defaults a renderer record inherits; everything else - which reduction
 * a row uses, which algorithm draws its cells - is resolved by name at the
 * moment the row is computed, so a later registration still takes effect the
 * next time the character sheet or the equip comparison is opened.
 */
export interface UiEntryFacade {
  /**
   * ui-entry-combiner.c's combiners: how a row's per-slot (val, aux) pairs
   * reduce to the single value that colours its label - "ADD", "LOGICAL_OR",
   * "RESIST_0", or a mod's own, named by a `combine:` line in `ui_entry.json`.
   */
  readonly combiners: UiEntryTableFacade<CombinerFuncs>;
  /**
   * ui-entry-renderers.c's backends: how one (val, aux) pair becomes a cell
   * symbol and colour, named by an `entry-renderer:` record's `code:` field. A
   * backend supplies its own default palettes, so a renderer record naming it
   * need only override what it wants to differ.
   */
  readonly backends: UiEntryTableFacade<UiEntryBackend>;
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
 * The message-vocabulary facade (gated by registry:message).
 *
 * Two halves of one thing. `define` appends a MSG_ type after the 153 compiled
 * ones, so a mod's spell / blow method / summon / projection may carry its own
 * `msgt:` instead of taking the bind down with PARSE_ERROR_INVALID_MESSAGE.
 * `addSounds` appends `sound:` directives after the compiled 149, so that
 * message type - or a core one - actually plays something.
 *
 * ORDER MATTERS, and only one way round: register the type before the sound
 * pref that names it, and both before the front end loads prefs. A pref naming
 * an unknown type is DROPPED, silently, exactly as upstream drops such a prf
 * line - so a mod that gets the order wrong loses its sound rather than
 * crashing, and `addSounds` is deliberately not the place that reports it.
 */
export interface MessageFacade {
  /**
   * Declare a new MSG_ type; returns the index it was appended at. Throws on a
   * name that is already compiled in (case-insensitively), a name that parses
   * as a decimal number, or a duplicate - all three are registrations that
   * could never be reached, not preferences.
   */
  define(name: string, sound?: string): number;
  /** The MSG index for any name, core's or a mod's - message_lookup_by_name. */
  lookup(name: string): number;
  /** Every mod-supplied message type so far, in registration order. */
  types(): readonly MessageTypeEntry[];
  /**
   * Append `sound:` directives. Last writer wins PER MESSAGE, because
   * message_sound_define clears a message's sample list before assigning - so
   * this is how a sound-pack mod re-points a core message, and a mod that means
   * to ADD to core's samples repeats core's names alongside its own.
   */
  addSounds(entries: readonly SoundPrefEntry[]): void;
  /** Every mod-supplied `sound:` directive so far, in registration order. */
  sounds(): readonly SoundPrefEntry[];
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
  readonly uiEntry: UiEntryFacade;
  readonly glyphs: GlyphFacade;
  readonly effectInfo: EffectInfoFacade;
  readonly randart: RandartFacade;
  readonly tval: TvalFacade;
  readonly rune: RuneFacade;
  readonly vocab: VocabFacade;
  readonly messages: MessageFacade;
  readonly menus: MenuFacade;
  readonly tiles: TilesFacade;
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
/**
 * The message / sound targets, defaulting to core's module-level singletons.
 * Only `undefined` defaults; an explicit `null` is still "the host did not wire
 * it" and throws through requireTarget. See RegistryTargets.messages.
 */
function messageTarget(targets: RegistryTargets): MessageTypeRegistryTarget {
  return requireTarget(
    targets.messages === undefined ? messageTypes : targets.messages,
    "message",
  );
}

function soundTarget(targets: RegistryTargets): SoundPrefRegistryTarget {
  return requireTarget(
    targets.sounds === undefined ? soundPrefRegistry : targets.sounds,
    "message",
  );
}

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
 * One ui-entry table of the facade, gated. Written once and applied twice, for
 * the reason projectionSide gives: a hand-copied second block is a second place
 * for the capability check to go missing from.
 */
function uiEntryTable<H>(
  capabilities: AgentCapabilities | undefined,
  targets: RegistryTargets,
  pick: (registry: UiEntryRegistry) => UiEntryNameTable<H>,
): UiEntryTableFacade<H> {
  const table = (): UiEntryNameTable<H> =>
    pick(requireTarget(targets.uiEntry, "uiEntry"));
  return {
    set(name, handler): void {
      requireCap(capabilities, "uiEntry");
      table().set(name, handler);
    },
    handlerFor(name): H | null {
      requireCap(capabilities, "uiEntry");
      return table().handlerFor(name);
    },
    has(name): boolean {
      requireCap(capabilities, "uiEntry");
      return table().has(name);
    },
    names(): readonly string[] {
      requireCap(capabilities, "uiEntry");
      return table().names();
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
      setDiscountRoll(handler): void {
        requireCap(capabilities, "store");
        requireTarget(targets.stores, "store").registerDiscountRoll(handler);
      },
      discountRollHandler(): DiscountRollHandler | null {
        requireCap(capabilities, "store");
        return requireTarget(targets.stores, "store").discountRollHandler();
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
      setVerb(code, verb): void {
        requireCap(capabilities, "command");
        requireTarget(targets.commandVerbs, "command").set(code, verb);
      },
      verbFor(code): string | null {
        requireCap(capabilities, "command");
        return requireTarget(targets.commandVerbs, "command").verbFor(code);
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
      mon: projectionSide(capabilities, targets, (r) => r.mon),
    },
    uiEntry: {
      combiners: uiEntryTable(capabilities, targets, (r) => r.combiners),
      backends: uiEntryTable(capabilities, targets, (r) => r.backends),
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
    messages: {
      define(name, sound): number {
        requireCap(capabilities, "message");
        return messageTarget(targets).add(name, sound);
      },
      lookup(name): number {
        requireCap(capabilities, "message");
        return messageLookupByName(name);
      },
      types(): readonly MessageTypeEntry[] {
        requireCap(capabilities, "message");
        return messageTarget(targets).added();
      },
      addSounds(entries): void {
        requireCap(capabilities, "message");
        soundTarget(targets).add(entries);
      },
      sounds(): readonly SoundPrefEntry[] {
        requireCap(capabilities, "message");
        return soundTarget(targets).added();
      },
    },
    menus: {
      register(id, transformer): void {
        requireCap(capabilities, "menu");
        requireTarget(targets.menus, "menu").register(id, transformer);
      },
      handlerFor(id): MenuTransformer | null {
        requireCap(capabilities, "menu");
        return requireTarget(targets.menus, "menu").handlerFor(id);
      },
    },
    tiles: {
      register(filler): void {
        requireCap(capabilities, "tiles");
        if (typeof filler !== "function") {
          throw new Error("mod registry: a tile filler must be a function");
        }
        requireTarget(targets.tiles, "tiles").register(filler);
      },
      player(provider): void {
        requireCap(capabilities, "tiles");
        if (typeof provider !== "function") {
          throw new Error("mod registry: a player-tile provider must be a function");
        }
        requireTarget(targets.tiles, "tiles").player(provider);
      },
    },
  };
}

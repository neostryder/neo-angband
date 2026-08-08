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
import type { JsonValue } from "./save-blocks.js";
import type { VocabKind, VocabTerm, VocabularyRegistry } from "./vocabulary.js";

/** The capability each registry facade requires (registry:<domain>). */
export const REGISTRY_CAPABILITIES = {
  effect: "registry:effect",
  room: "registry:room",
  profile: "registry:profile",
  blow: "registry:blow",
  store: "registry:store",
  command: "registry:command",
  monster: "registry:monster",
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

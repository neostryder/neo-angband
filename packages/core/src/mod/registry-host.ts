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

import { AgentCapabilityError } from "../agent/types";
import type { AgentCapabilities } from "../agent/types";
import type { EffectCode } from "../effects/effect";
import type { EffectDefinition, EffectRegistry } from "../effects/interpreter";
import type { RoomBuilder, RoomRegistry } from "../gen/room";
import type { ActionRegistry, PlayerAction } from "../game/player-turn";
import type { GameState } from "../game/context";
import type { Monster } from "../mon/monster";
import type { JsonValue } from "./save-blocks";
import type { VocabKind, VocabTerm, VocabularyRegistry } from "./vocabulary";

/** The capability each registry facade requires (registry:<domain>). */
export const REGISTRY_CAPABILITIES = {
  effect: "registry:effect",
  room: "registry:room",
  command: "registry:command",
  monster: "registry:monster",
  vocab: "registry:vocab",
  rules: "registry:rules",
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
 * The core "mod rule" facade (gated by registry:rules). Toggles the named
 * boolean flags on GameState.modRules that switch a ported core function from
 * its faithful 4.2.6 branch to a corrected one (the bundled bug-fixes mod,
 * decision 24). Delegates to the live GameState the host wired in, so a flag a
 * plugin sets here is read by core through modRuleEnabled(state, name); with no
 * plugin setting any flag, state.modRules is absent and core is byte-identical
 * to 4.2.6. It operates on the same `state` target the monster-AI facade uses.
 */
export interface RulesFacade {
  /** Turn a named core rule flag on. */
  enable(name: string): void;
  /** Turn a named core rule flag off (back to the faithful 4.2.6 branch). */
  disable(name: string): void;
  /** Whether a named rule flag is currently on. */
  isEnabled(name: string): boolean;
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
  readonly commands: CommandFacade;
  readonly monsters: MonsterFacade;
  readonly vocab: VocabFacade;
  readonly rules: RulesFacade;
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
    rules: {
      enable(name): void {
        requireCap(capabilities, "rules");
        const state = requireTarget(targets.state, "rules");
        (state.modRules ??= {})[name] = true;
      },
      disable(name): void {
        requireCap(capabilities, "rules");
        const state = requireTarget(targets.state, "rules");
        if (state.modRules) delete state.modRules[name];
      },
      isEnabled(name): boolean {
        requireCap(capabilities, "rules");
        const state = requireTarget(targets.state, "rules");
        return state.modRules?.[name] === true;
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

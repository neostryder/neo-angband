/**
 * Effect dispatch machinery, ported from reference/src/effects.c
 * (effect_do, effect_simple, effect_aim, effect_valid) and
 * effect-handler.h (effect_handler_context_t), Angband 4.2.6.
 *
 * Divergences by design:
 * - The compiled effect_kind[] table becomes EffectRegistry, keyed by
 *   `number | string` so mods can register brand-new effect codes at
 *   runtime (a ratified project pillar). Upstream numeric EF codes keep
 *   their exact semantics.
 * - Handlers receive an explicit environment (EffectContext) instead of
 *   reading globals (player, cave, z_info, ...). Slots for domains not
 *   yet ported are typed narrowly against what the implemented handlers
 *   need and widen later.
 * - The C file-static `set_value` (effect-handler-general.c) becomes
 *   per-registry state with the same lifetime shape: one registry is one
 *   interpreter, as one compiled program is one static.
 * - EF_SELECT's player prompt (cmd_get_effect_from_list) is an injected
 *   chooser on the context; without one, selection falls back to the
 *   random branch (documented in the parity ledger).
 */

import type { Rng, RandomValue } from "../rng";
import type { GameEvents } from "../events";
import { Dice } from "../dice";
import { EF, EFFECT_ENTRIES } from "../generated";
import type { Effect, EffectCode } from "./effect";
import { EF_MAX, effectNew } from "./effect";

/** cave.h DIR_TARGET. */
export const DIR_TARGET = 5;

/* ------------------------------------------------------------------ *
 * Effect sources (source.h struct source).
 * ------------------------------------------------------------------ */

export type Source =
  | { what: "none" }
  | { what: "trap"; trap: unknown }
  | { what: "player" }
  | { what: "monster"; monster: number }
  | { what: "object"; object: unknown }
  | { what: "chestTrap"; chestTrap: unknown };

export function sourceNone(): Source {
  return { what: "none" };
}

export function sourcePlayer(): Source {
  return { what: "player" };
}

export function sourceMonster(who: number): Source {
  return { what: "monster", monster: who };
}

export function sourceTrap(trap: unknown): Source {
  return { what: "trap", trap };
}

export function sourceObject(object: unknown): Source {
  return { what: "object", object };
}

export function sourceChestTrap(chestTrap: unknown): Source {
  return { what: "chestTrap", chestTrap };
}

/* ------------------------------------------------------------------ *
 * Narrow interfaces for what the implemented handlers need. Later
 * domains (player, monsters, world) widen or replace these.
 * ------------------------------------------------------------------ */

/** Anything that emits game messages (msg() in the C). */
export interface EffectMessages {
  msg(text: string): void;
}

/** Hitpoint holder for EF_HEAL_HP (player->chp / mhp / chp_frac). */
export interface HasHp {
  chp: number;
  mhp: number;
  chpFrac: number;
}

/**
 * Timed-effect host for the EF_TIMED_* family, EF_CURE and EF_NOURISH.
 * Signatures mirror player-timed.h: player_set_timed(p, idx, v, notify,
 * can_disturb), player_inc_timed(..., check), player_dec_timed,
 * player_clear_timed.
 */
export interface TimedHost {
  timed(idx: number): number;
  setTimed(idx: number, v: number, notify: boolean, canDisturb: boolean): boolean;
  incTimed(
    idx: number,
    v: number,
    notify: boolean,
    canDisturb: boolean,
    check: boolean,
  ): boolean;
  decTimed(idx: number, v: number, notify: boolean, canDisturb: boolean): boolean;
  clearTimed(idx: number, notify: boolean, canDisturb: boolean): boolean;
}

/** The player slot: only what implemented handlers touch, all optional. */
export interface EffectPlayer {
  hp?: HasHp;
  timed?: TimedHost;
  /** player_apply_damage_reduction. */
  applyDamageReduction?: (dam: number) => number;
  /** take_hit(player, dam, killer). */
  takeHit?: (dam: number, killer: string) => void;
}

/** A stub handler invocation, recorded so dispatch coverage is testable. */
export interface StubCall {
  code: EffectCode;
  name: string;
  value: RandomValue;
  subtype: number;
  radius: number;
  other: number;
  y: number;
  x: number;
  dir: number;
  beam: number;
  boost: number;
}

/**
 * The execution environment for effects. rng is mandatory; everything
 * else is an optional slot that handlers check for. player/chunk/target
 * are typed-but-opaque until their domains land.
 */
export interface EffectContext {
  rng: Rng;
  events?: GameEvents;
  messages?: EffectMessages;
  player?: EffectPlayer;
  /** The current level (struct chunk); opaque until world handlers land. */
  chunk?: unknown;
  /** Targeting slot; opaque until the monster domain lands. */
  target?: unknown;
  /**
   * Attack-projection environment for the EF_BOLT/BEAM/BALL/... handlers,
   * opaque here (it references game-layer state); game/effect-attack.ts casts
   * it to AttackEffectEnv. Absent for a worldless interpreter, in which case
   * the attack handlers no-op.
   */
  attack?: unknown;
  /** Dungeon depth, for handlers/expressions that need it. */
  level?: number;
  /** z_info->food_value (constants.txt player:food-value, 100 upstream). */
  foodValue?: number;
  /** OPT(player, show_damage). */
  showDamage?: boolean;
  /**
   * EF_SELECT chooser (upstream cmd_get_effect_from_list /
   * get_effect_from_list): given the first sub-effect and the count,
   * return the 0-based choice, -1 to abort, or -2 for "random".
   */
  chooseEffect?: (first: Effect | null, count: number) => number;
  /** get_aim_dir for effect_simple on aimed effects. */
  getAimDir?: () => number;
  /** When present, stub handlers record their invocations here. */
  stubLog?: StubCall[];
}

/* ------------------------------------------------------------------ *
 * Handler context (effect_handler_context_t).
 * ------------------------------------------------------------------ */

export interface EffectHandlerContext {
  readonly effect: EffectCode;
  readonly origin: Source;
  readonly obj: unknown;
  readonly aware: boolean;
  readonly dir: number;
  readonly beam: number;
  readonly boost: number;
  readonly value: RandomValue;
  readonly subtype: number;
  readonly radius: number;
  readonly other: number;
  readonly y: number;
  readonly x: number;
  readonly msg: string | null;
  /** Mutable, as upstream: handlers set it, effect_do copies it back. */
  ident: boolean;
  readonly cmd: unknown;
  /** The execution environment (upstream globals). */
  readonly env: EffectContext;
  /** SET_VALUE/CLEAR_VALUE shared box (upstream file-static set_value). */
  readonly shared: { value: number };
}

export type EffectHandler = (context: EffectHandlerContext) => boolean;

/**
 * effect_calculate_value: a chain-wide SET_VALUE overrides everything;
 * otherwise base + damroll(dice, sides), optionally device-boosted.
 * Note the handler re-rolls the dice itself; the roll made by effect_do
 * only feeds RANDOM/SELECT choice counts.
 */
export function effectCalculateValue(
  context: EffectHandlerContext,
  useBoost: boolean,
): number {
  if (context.shared.value) return context.shared.value;

  let final = 0;
  if (
    context.value.base > 0 ||
    (context.value.dice > 0 && context.value.sides > 0)
  ) {
    final =
      context.value.base +
      context.env.rng.damroll(context.value.dice, context.value.sides);
  }

  if (useBoost) {
    final = Math.trunc((final * (100 + context.boost)) / 100);
  }

  return final;
}

/* ------------------------------------------------------------------ *
 * The registry and effect_do.
 * ------------------------------------------------------------------ */

/** Implementation status, surfaced for the parity ledger and manifests. */
export type EffectHandlerStatus = "implemented" | "partial" | "stub";

export interface EffectDefinition {
  handler: EffectHandler;
  /** Whether the effect requires aiming (list-effects.h aim column). */
  aim?: boolean;
  /** Effect info label for spell tips. */
  info?: string | null;
  /** Effect description. */
  desc?: string | null;
  /** Coverage status; defaults to "implemented". */
  status?: EffectHandlerStatus;
}

interface RegisteredEffect {
  code: EffectCode;
  handler: EffectHandler;
  aim: boolean;
  info: string | null;
  desc: string | null;
  status: EffectHandlerStatus;
}

/** Parameters of effect_do beyond the chain and the environment. */
export interface EffectDoParams {
  origin: Source;
  /** The object making the effect happen, if any. */
  obj?: unknown;
  /**
   * Updated like the upstream bool *ident out-parameter (no effect ever
   * sets it back to false). Optional; pass a box to observe it.
   */
  ident?: { value: boolean };
  /** Whether the player is already aware of the effect. */
  aware?: boolean;
  /** Direction the effect goes in. */
  dir?: number;
  /** Base chance out of 100 that a BOLT_OR_BEAM effect beams. */
  beam?: number;
  /** Skill-over-difficulty percentage boost (0..138). */
  boost?: number;
  /** Invoking command, passed through to handlers opaquely. */
  cmd?: unknown;
}

/** Parameters of effect_simple. */
export interface EffectSimpleParams {
  origin: Source;
  diceString?: string;
  subtype?: number;
  radius?: number;
  other?: number;
  y?: number;
  x?: number;
  ident?: { value: boolean };
}

/**
 * The runtime effect registry and interpreter. Upstream's compiled
 * effects[] table plus effect_do, as one object. Register handlers for
 * the upstream EF codes with registerCoreHandlers (handlers.ts), then
 * add mod effects under string codes as needed.
 */
export class EffectRegistry {
  private defs = new Map<EffectCode, RegisteredEffect>();

  /** Upstream file-static set_value; see module doc for the lifetime. */
  private sharedValue = { value: 0 };

  /**
   * Register a handler for an effect code. Numeric codes should be
   * upstream EF values; string codes are the mod extension surface.
   * Re-registering a code replaces it (mods may override core effects).
   */
  register(code: EffectCode, def: EffectDefinition): void {
    if (typeof code === "number" && (code <= EF.NONE || !Number.isInteger(code))) {
      throw new Error(`invalid numeric effect code ${code}`);
    }
    if (typeof code === "string" && code.length === 0) {
      throw new Error("empty string effect code");
    }
    const entry =
      typeof code === "number" && code > EF.NONE && code < EF_MAX
        ? (EFFECT_ENTRIES[code - 1] as {
            aim: boolean;
            info: string | null;
            description: string;
          })
        : null;
    this.defs.set(code, {
      code,
      handler: def.handler,
      aim: def.aim ?? entry?.aim ?? false,
      info: def.info !== undefined ? def.info : (entry?.info ?? null),
      desc: def.desc !== undefined ? def.desc : (entry?.description ?? null),
      status: def.status ?? "implemented",
    });
  }

  lookup(code: EffectCode): RegisteredEffect | null {
    return this.defs.get(code) ?? null;
  }

  isRegistered(code: EffectCode): boolean {
    return this.defs.has(code);
  }

  /** All registered codes (for coverage counting). */
  codes(): EffectCode[] {
    return [...this.defs.keys()];
  }

  /** Coverage counts by status, for the parity ledger. */
  coverage(): { implemented: number; partial: number; stub: number } {
    const counts = { implemented: 0, partial: 0, stub: 0 };
    for (const def of this.defs.values()) counts[def.status]++;
    return counts;
  }

  /**
   * effect_valid, registry-aware: upstream numeric codes are valid in
   * (EF_NONE, EF_MAX) even if unregistered (their handler slot is then
   * NULL-equivalent); other codes are valid only when registered.
   */
  isValidEffect(effect: Effect | null): boolean {
    if (!effect) return false;
    if (
      typeof effect.index === "number" &&
      effect.index > EF.NONE &&
      effect.index < EF_MAX
    ) {
      return true;
    }
    return this.defs.has(effect.index);
  }

  /** effect_aim: true when any effect in the chain requires aiming. */
  effectAim(effect: Effect | null): boolean {
    if (!this.isValidEffect(effect)) return false;
    for (let e = effect; e; e = e.next) {
      const def = this.defs.get(e.index);
      if (def) {
        if (def.aim) return true;
      } else if (
        typeof e.index === "number" &&
        e.index > EF.NONE &&
        e.index < EF_MAX
      ) {
        const entry = EFFECT_ENTRIES[e.index - 1] as { aim: boolean };
        if (entry.aim) return true;
      }
    }
    return false;
  }

  /** effect_info. */
  effectInfo(effect: Effect | null): string | null {
    if (!this.isValidEffect(effect) || !effect) return null;
    const def = this.defs.get(effect.index);
    return def ? def.info : null;
  }

  /** effect_desc. */
  effectDesc(effect: Effect | null): string | null {
    if (!this.isValidEffect(effect) || !effect) return null;
    const def = this.defs.get(effect.index);
    return def ? def.desc : null;
  }

  /**
   * effect_do: execute an effect chain. Returns whether any effect
   * completed; params.ident is updated as the upstream out-parameter.
   */
  effectDo(
    effect: Effect | null,
    env: EffectContext,
    params: EffectDoParams,
  ): boolean {
    let completed = false;
    const ident = params.ident ?? { value: false };
    const aware = params.aware ?? false;
    const dir = params.dir ?? 0;
    const beam = params.beam ?? 0;
    const boost = params.boost ?? 0;
    const obj = params.obj ?? null;
    const cmd = params.cmd ?? null;
    const value: RandomValue = { base: 0, dice: 0, sides: 0, mBonus: 0 };

    do {
      let choiceCount = 0;
      let leftover = 1;

      if (!this.isValidEffect(effect) || !effect) {
        env.messages?.msg(
          "Bad effect passed to effect_do(). Please report this bug.",
        );
        return false;
      }

      if (effect.dice !== null) {
        choiceCount = effect.dice.roll(env.rng, value);
      }

      /* Deal with special random and select effects */
      if (effect.index === EF.RANDOM || effect.index === EF.SELECT) {
        let choice: number;

        /*
         * If it has no subeffects, act as if it completed
         * successfully and go to the next effect.
         */
        if (choiceCount <= 0) {
          completed = true;
          effect = effect.next;
          continue;
        }

        /*
         * Treat select effects like random ones if they aren't from
         * a player or if there's really no choice to be made.
         */
        if (
          effect.index === EF.RANDOM ||
          params.origin.what !== "player" ||
          choiceCount < 2
        ) {
          choice = env.rng.randint0(choiceCount);
        } else {
          /*
           * Since a choice is presented, allow identification,
           * even if no choice is made.
           */
          ident.value = true;
          if (env.chooseEffect) {
            choice = env.chooseEffect(effect.next, choiceCount);
            if (choice === -1) return false;
          } else {
            /*
             * No UI is injected: fall back to a random pick
             * (upstream would prompt the player here).
             */
            choice = -2;
          }

          /* If the player chose to use a random effect, roll it. */
          if (choice === -2) {
            choice = env.rng.randint0(choiceCount);
          }
          if (choice < 0 || choice >= choiceCount) {
            throw new RangeError(
              `EF_SELECT choice ${choice} out of range 0..${choiceCount - 1}`,
            );
          }
        }

        leftover = choiceCount - choice;

        /* Skip to the chosen effect */
        effect = effect.next;
        while (choice-- > 0 && effect) effect = effect.next;
        if (!effect) {
          /*
           * There's fewer subeffects than expected. Act as if it
           * ran successfully.
           */
          completed = true;
          break;
        }

        /* Roll the damage, if needed */
        if (effect.dice !== null) {
          effect.dice.roll(env.rng, value);
        }
      }

      /* Handle the effect */
      const def = this.defs.get(effect.index);
      if (def) {
        const context: EffectHandlerContext = {
          effect: effect.index,
          origin: params.origin,
          obj,
          aware,
          dir,
          beam,
          boost,
          value: { ...value },
          subtype: effect.subtype,
          radius: effect.radius,
          other: effect.other,
          y: effect.y,
          x: effect.x,
          msg: effect.msg,
          ident: ident.value,
          cmd,
          env,
          shared: this.sharedValue,
        };

        completed = def.handler(context) || completed;
        ident.value = context.ident;
      }

      /* Get the next effect, if there is one */
      while (leftover-- > 0 && effect) effect = effect.next;
    } while (effect);

    return completed;
  }

  /**
   * effect_simple: perform a single effect from a dice string and bare
   * parameters. Aimed effects ask env.getAimDir (upstream get_aim_dir),
   * defaulting to DIR_TARGET.
   */
  effectSimple(
    index: EffectCode,
    env: EffectContext,
    params: EffectSimpleParams,
  ): boolean {
    const effect = effectNew(index);
    const dice = new Dice();
    dice.parseString(params.diceString ?? "");
    effect.dice = dice;
    effect.diceString = params.diceString ?? null;
    effect.subtype = params.subtype ?? 0;
    effect.radius = params.radius ?? 0;
    effect.other = params.other ?? 0;
    effect.y = params.y ?? 0;
    effect.x = params.x ?? 0;

    let dir = DIR_TARGET;
    if (this.effectAim(effect) && env.getAimDir) {
      dir = env.getAimDir();
    }

    const ident = params.ident ?? { value: false };
    return this.effectDo(effect, env, {
      origin: params.origin,
      ident,
      aware: true,
      dir,
      beam: 0,
      boost: 0,
    });
  }
}

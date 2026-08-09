/**
 * The EFFECT INFO registry: everything the game SAYS about an effect, and how a
 * gamedata `type:` name becomes its integer subtype.
 *
 * WHY THIS IS A REGISTRY. `registry:effect` already let a mod register a handler
 * for a brand-new effect code and have it DO something. What it could not do was
 * let the game describe it. Four closed `switch` statements stood in the way,
 * and each failed silently rather than loudly:
 *
 *   - `effectMenuName` (effect-info.ts, keyed on the EFINFO_* flag) returned ""
 *     for an unknown flag, so a mod's effect showed a BLANK ROW in the "Activate
 *     which item?" and spell menus.
 *   - `formatEffectDesc` (effect-info.ts, same key) returned "" as well, so
 *     object recall and spell descriptions said nothing at all about it.
 *   - the activation summary walker (obj/effects-info.ts, keyed on the effect
 *     CODE) counted it "unsummarized", so a randart activation built from a mod
 *     effect could never be recognised as duplicating an intrinsic property.
 *   - `effectSubtype` (effect.ts, keyed on the EF index) returned -1 for every
 *     name, so a mod's effect could take NO named subtype - only a bare integer.
 *
 * FOUR TABLES, THREE KEYS, and they are separate because upstream's keys are.
 * The EFINFO_* flag is a property of the effect's ENTRY (many effects share one
 * flag: twenty flags cover a hundred and twelve effects), the summary walker
 * keys on the effect's own code, and subtype decoding keys on the effect index.
 * Collapsing them would force a mod to register the same behaviour three times
 * under three spellings.
 *
 * WHY MODULE-LEVEL. Ruled 2026-08-09: disabling a mod always takes effect on the
 * next RELOAD (exiting mod management prompts to save and reload). A toggle can
 * therefore never need to apply to a running session, so a module-level table
 * cannot violate the mod default policy.
 *
 * What actually clears it is the reload itself: a fresh page is a fresh module
 * instance, and the host installs each plugin at most once per realm
 * (`installedPluginIds` in web/main.ts is never cleared). So a disabled mod's
 * registrations are gone on the next boot because the table they lived in is.
 * `resetEffectInfoRegistry()` is the same restoration WITHOUT a fresh realm -
 * core's arms back, every mod registration dropped - which is what a test needs
 * in order to prove the mod default policy holds here rather than assert it.
 * It has no production caller and is not meant to acquire one: calling it
 * mid-session would strip a running mod's handlers, which is precisely the
 * live-toggle behaviour the ruling says must not happen.
 *
 * ORDER AND RNG. Core's handlers are the case bodies lifted unchanged. Nothing
 * here draws: upstream's `effect_describe` calls `dice_roll()` to populate the
 * random_value it formats, and the port substitutes `Dice.randomValue()` at
 * every such site precisely so that rendering a menu row cannot perturb the
 * stream (see effect-info.ts's header). A mod handler receives the already
 * computed value and has no Rng to reach, so that property survives the seam.
 */

import type { RandomValue } from "../rng.js";
import type { ProjectionInfo } from "../world/projection.js";
import type { EffectObjectProperty } from "../obj/randart-build.js";
import type { EffectRecordJson } from "../obj/types.js";
import type { GameState } from "../game/context.js";
import type { ItemRequest } from "../game/effect-item.js";
import type { Effect, EffectCode, SubtypeInjections } from "./effect.js";

/* ------------------------------------------------------------------ *
 * Table 1 and 2: the two text handlers, keyed on the EFINFO_* flag.
 * ------------------------------------------------------------------ */

/** The projection strings an effect's subtype selects, "" when out of range. */
export interface EffectProjectionText {
  /** projections[subtype].desc - EFINFO_SEEN / _BOLT / _BOLTD / _TOUCH. */
  readonly desc: string;
  /** projections[subtype].player_desc - EFINFO_BALL / _SPOT / _BREATH / _SHORT. */
  readonly playerDesc: string;
  /** projections[subtype].lash_desc - EFINFO_LASH. */
  readonly lashDesc: string;
}

/** What a menu-name handler is given (effect_get_menu_name, effects-info.c L583). */
export interface EffectMenuContext {
  /** The effect being named. */
  readonly effect: Effect;
  /** base_descs[index].menu_name: the raw format string. */
  readonly fmt: string;
  /** sprintf(fmt, ...) - the format string with its arguments filled in. */
  format(...args: Array<string | number>): string;
  /** The effect's dice as a random_value, zeroed when it has none. */
  readonly value: RandomValue;
  /** randcalc(value, level, AVERAGE) - no RNG is drawn. */
  average(level?: number): number;
  /** projections[subtype], with "" for an out-of-range subtype. */
  readonly proj: EffectProjectionText;
  /** timed_effects[subtype].desc, "" when the host supplied no lookup. */
  timedDesc(): string;
  /** The stat property name for the subtype, "" when unavailable. */
  statName(): string;
  /** summon_desc(subtype), "" when unavailable. */
  summonDesc(): string;
  /** z_info->food_value scaled full / hungry thresholds (EFINFO_FOOD). */
  readonly foodFull: number;
  readonly foodHungry: number;
}

/** What a description handler is given (effect_describe's body, L384-548). */
export interface EffectDescContext {
  /** The effect being described. */
  readonly effect: Effect;
  /** base_descs[index].desc: the raw format string. */
  readonly desc: string;
  /** sprintf(desc, ...) - the format string with its arguments filled in. */
  format(...args: Array<string | number>): string;
  /** The random_value in force (an earlier SET_VALUE's, or the effect's own). */
  readonly value: RandomValue;
  /** format_dice_string(value) as the caller already computed it. */
  readonly diceString: string;
  /** format_dice_string(value, multiplier) - EFINFO_FOOD's turn count. */
  diceStringTimes(multiplier: number): string;
  /** The device-skill boost percentage in force. */
  readonly devSkillBoost: number;
  /** append_damage(value, boost) - defaults to the boost in force. */
  appendDamage(boost?: number): string;
  /** randcalc(value, level, AVERAGE) - no RNG is drawn. */
  average(level?: number): number;
  /** projections[subtype], with "" for an out-of-range subtype. */
  readonly proj: EffectProjectionText;
  /** timed_effects[subtype].desc, "" when the host supplied no lookup. */
  timedDesc(): string;
  /** The stat property name for the subtype, "" when unavailable. */
  statName(): string;
  /** summon_desc(subtype), "" when unavailable. */
  summonDesc(): string;
  /** player->lev, 0 when the host supplied none (EFINFO_SHORT). */
  readonly playerLevel: number;
  /** z_info->food_value, 100 upstream (EFINFO_FOOD). */
  readonly foodValue: number;
}

/**
 * What one EFINFO_* flag means. Both halves are optional, and an absent half
 * is upstream's own behaviour for an unhandled flag: "" - which is why a mod
 * that supplies only `describe` still gets a blank menu row, and should say so
 * to itself rather than be surprised.
 */
export interface EffectTextHandler {
  /** The row text in the activate / cast menus. */
  menuName?(ctx: EffectMenuContext): string;
  /** The sentence in object recall and spell descriptions. */
  describe?(ctx: EffectDescContext): string;
}

/* ------------------------------------------------------------------ *
 * Table 3: the activation summary walker, keyed on the effect CODE.
 * ------------------------------------------------------------------ */

/** EFPROP kinds and the resolved timed data, as the walker sees them. */
export interface ActivationSummaryContext {
  /** The compiled effect record being walked. */
  readonly record: EffectRecordJson;
  /** Append one summarized object property. */
  add(idx: number, reslevelMin: number, reslevelMax: number, kind: number): void;
  /** summarize_cure for the record's `type` (a no-op for an unknown name). */
  summarizeCure(name: string | undefined): void;
  /** The temp-resist / brand / slay / conflict half of an increase. */
  summarizeTimedInc(name: string | undefined): void;
  /** dice_evaluate(dice, 0, MAXIMISE) for this record, honouring SET_VALUE. */
  timedValue(): number;
  /** Whether the pack has a player_timed record under this name. */
  knownTimed(name: string | undefined): boolean;
  /** OF_NO_TELEPORT's index, for the teleport family. */
  readonly ofNoTeleport: number;
  /** Remember (or forget) the dice a later timed effect reads: SET/CLEAR_VALUE. */
  setRememberedDice(dice: string | undefined): void;
  /** Count this record as contributing no object property. */
  markUnsummarized(): void;
}

/**
 * One arm of effect_summarize_properties. Returning nothing is "this effect
 * relates to no object property", which the walker records as unsummarized -
 * so a handler that means "deliberately nothing" must still say so by calling
 * `markUnsummarized()`, exactly as the ported default arm does.
 */
export type ActivationSummaryHandler = (ctx: ActivationSummaryContext) => void;

/** The shape the walker produces, re-exported so a caller need not reach in. */
export type ActivationSummaryResult = {
  props: EffectObjectProperty[];
  unsummarizedCount: number;
};

/* ------------------------------------------------------------------ *
 * Table 4 and 5: subtype decoding and the item prompt, keyed on the index.
 * ------------------------------------------------------------------ */

/**
 * How one effect turns a gamedata `type:` NAME into its integer subtype.
 * Return null (not -1) for "this name means nothing to me", so the caller can
 * tell a handler that declined from one that resolved the name to -1.
 */
export type EffectSubtypeHandler = (
  type: string,
  inject: SubtypeInjections,
) => number | null;

/**
 * Which item an effect prompts for, when it consumes one. Return null for
 * "this effect chooses no item" - which is what BRAND_WEAPON, CURSE_ARMOR,
 * CURSE_WEAPON and ACQUIRE do, because they pick their own target.
 */
export type EffectRequestHandler = (
  subtype: number,
  state: GameState,
) => ItemRequest | null;

/* ------------------------------------------------------------------ *
 * The tables.
 * ------------------------------------------------------------------ */

/**
 * One keyed table. Written once and used five times, because the five differ
 * only in their key and handler types - five hand-copied blocks would be five
 * places for `handlerFor` to drift from `set`.
 */
export class EffectInfoTable<K, H> {
  private readonly table = new Map<K, H>();

  /** Install (or replace) the handler for one key. */
  set(key: K, handler: H): void {
    this.table.set(key, handler);
  }

  /**
   * The handler installed for a key right now, or null. This is what a mod
   * calls to WRAP core - keep the returned handler, install its own, and call
   * through - instead of only replacing it.
   */
  handlerFor(key: K): H | null {
    return this.table.get(key) ?? null;
  }

  /** Whether anything handles this key. */
  has(key: K): boolean {
    return this.table.has(key);
  }

  /** Every key handled, in registration order (core's first). */
  keys(): readonly K[] {
    return [...this.table.keys()];
  }
}

/**
 * Everything the game says about an effect, in five tables under three keys.
 *
 * `text` is keyed on the EFINFO_* flag because that is what upstream's two
 * switches key on: twenty flags describe a hundred and twelve effects, and an
 * effect that behaves like an existing one for display purposes reuses its
 * flag rather than repeating it. `summary` is keyed on the effect CODE, and
 * `subtype` / `request` on the effect INDEX (or a mod's string code).
 */
export class EffectInfoRegistry {
  /** The menu row and the recall sentence, keyed on the EFINFO_* flag. */
  readonly text = new EffectInfoTable<string, EffectTextHandler>();
  /** effect_summarize_properties' arms, keyed on the effect code. */
  readonly summary = new EffectInfoTable<string, ActivationSummaryHandler>();
  /** effect_subtype's arms, keyed on the effect index (or a mod code). */
  readonly subtype = new EffectInfoTable<EffectCode, EffectSubtypeHandler>();
  /** requestForEffect's arms, keyed on the effect index (or a mod code). */
  readonly request = new EffectInfoTable<EffectCode, EffectRequestHandler>();
}

/** ProjectionInfo as the text handlers read it. */
export type ProjectionTextSource = readonly Pick<
  ProjectionInfo,
  "desc" | "playerDesc" | "lashDesc"
>[];

/* ------------------------------------------------------------------ *
 * The live registry.
 * ------------------------------------------------------------------ */

/**
 * Core's own seeders. Each of the four modules that OWNS a table registers its
 * arms here at import time, and each is also the only module that READS its
 * table - so "the module is loaded" and "core's arms are installed" cannot come
 * apart. That is the point: a seeder somebody has to remember to call is a
 * seeder that gets forgotten on one path, and the failure mode here is silent
 * (every effect describes itself as "").
 */
const seeders: Array<(reg: EffectInfoRegistry) => void> = [];

let live = new EffectInfoRegistry();

/**
 * Install a set of core arms, now and on every reset. Called at module scope by
 * effect-info.ts, obj/effects-info.ts, effects/effect.ts and
 * game/effect-item.ts; a MOD never calls this - it registers through the
 * capability-gated facade, whose registrations a reset deliberately drops.
 */
export function seedEffectInfo(seed: (reg: EffectInfoRegistry) => void): void {
  seeders.push(seed);
  seed(live);
}

/** The live registry. Module-level; see this file's header for why that is safe. */
export function effectInfoRegistry(): EffectInfoRegistry {
  return live;
}

/**
 * Back to core's arms alone, dropping every mod registration - the same state a
 * reload produces, without needing a fresh realm. No production caller by
 * design; see this file's header.
 */
export function resetEffectInfoRegistry(): void {
  live = new EffectInfoRegistry();
  for (const seed of seeders) seed(live);
}

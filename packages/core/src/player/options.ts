/**
 * The player option store, ported from reference/src/option.c (Angband 4.2.6).
 *
 * option.c owns the option table (list-options.h, codegen'd to
 * generated/options.ts as OPTION_ENTRIES) plus a small amount of runtime
 * behaviour: options_init_defaults (each option's `normal` value, the
 * delay_factor = 40 and hitpoint_warn = 3 defaults) and the cheat/score
 * coupling in option_set (turning a cheat_* option on forces its score_*
 * twin, which suppresses scoring). This module is the pure data half of
 * that; the option MENU (ui-options.c, the keypress screens) is DEFERRED as
 * a platform-native menu concern (see parity/ledger/options.yaml).
 *
 * Faithful notes:
 * - Defaults are read straight from OPTION_ENTRIES (do not hand-copy the
 *   table): each option is seeded from its `normal` field.
 * - hitpoint_warn is the 0..9 integer op_ptr->hitpoint_warn (DEFAULT 3), kept
 *   alongside the booleans. delay_factor (default 40) is carried too.
 * - Birth options (type BIRTH) are chosen at character creation and then
 *   locked: an immutable snapshot is captured at construction, and set()
 *   refuses to change a birth option afterwards (upstream shows them
 *   read-only in-game; only the birth process sets them).
 * - The cheat/score linkage keys off the table order (each cheat_X is
 *   immediately followed by score_X), reproduced by name (cheat_X -> score_X).
 *
 * Pure: no DOM, no filesystem. The session wires an OptionState onto the
 * GameState and each deferred seam reads it through state.options.
 */

import { OPTION_ENTRIES } from "../generated/options";

/** Every option name in the table (the `name` field of OPTION_ENTRIES). */
export type OptionName = (typeof OPTION_ENTRIES)[number]["name"];

/** option.c options_init_defaults: op_ptr->hitpoint_warn default (0..9). */
export const DEFAULT_HITPOINT_WARN = 3;

/** option.c options_init_defaults: op_ptr->delay_factor default (ms). */
export const DEFAULT_DELAY_FACTOR = 40;

/** A plain map of option name -> boolean value (the serialized form). */
export type OptionValues = Record<string, boolean>;

/** The serialized OptionState (save format). */
export interface OptionStateData {
  /** Every option's live boolean value. */
  values: OptionValues;
  /** op_ptr->hitpoint_warn (0..9). */
  hitpointWarn: number;
  /** op_ptr->delay_factor. */
  delayFactor: number;
  /** The immutable birth-option snapshot (birth_* only). */
  birth: OptionValues;
}

/** Options that can be preset at construction / character creation. */
export interface OptionInit {
  /** Preset values (birth or interface). Applied over the table defaults. */
  overrides?: Partial<Record<OptionName, boolean>>;
  /** op_ptr->hitpoint_warn (0..9). Default 3. */
  hitpointWarn?: number;
  /** op_ptr->delay_factor. Default 40. */
  delayFactor?: number;
}

/** The set of option names, and the birth subset, derived once from the table. */
const ALL_NAMES: readonly string[] = OPTION_ENTRIES.map((e) => e.name);
const BIRTH_NAMES: ReadonlySet<string> = new Set(
  OPTION_ENTRIES.filter((e) => e.type === "BIRTH").map((e) => e.name),
);
const CHEAT_NAMES: ReadonlySet<string> = new Set(
  OPTION_ENTRIES.filter((e) => e.type === "CHEAT").map((e) => e.name),
);
const SCORE_NAMES: ReadonlySet<string> = new Set(
  OPTION_ENTRIES.filter((e) => e.type === "SCORE").map((e) => e.name),
);

/** clamp hitpoint_warn into the legal 0..9 band. */
function clampWarn(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_HITPOINT_WARN;
  return Math.max(0, Math.min(9, Math.trunc(v)));
}

/**
 * The option store: a name -> boolean map seeded from OPTION_ENTRIES.normal,
 * with the hitpoint_warn / delay_factor scalars and the immutable birth
 * snapshot. Mutable in play through set(), except birth options.
 */
export class OptionState {
  private readonly values: OptionValues = {};
  /** op_ptr->hitpoint_warn (0..9). */
  hitpointWarn: number;
  /** op_ptr->delay_factor. */
  delayFactor: number;
  /** The birth_* values chosen at creation, frozen (immutable after birth). */
  private readonly birth: OptionValues;

  constructor(init: OptionInit = {}) {
    /* options_init_defaults: seed every option from its table `normal`. */
    for (const entry of OPTION_ENTRIES) {
      this.values[entry.name] = entry.normal;
    }
    /* Apply the birth/interface presets chosen at creation. Cheat presets
     * still couple to their score twins (as option_set would). */
    for (const [name, value] of Object.entries(init.overrides ?? {})) {
      if (value === undefined) continue;
      this.applyRaw(name, value);
    }
    this.hitpointWarn = clampWarn(init.hitpointWarn ?? DEFAULT_HITPOINT_WARN);
    this.delayFactor = init.delayFactor ?? DEFAULT_DELAY_FACTOR;
    /* Freeze the birth-option snapshot: the birth_* values are locked now. */
    const birth: OptionValues = {};
    for (const name of BIRTH_NAMES) birth[name] = this.values[name] ?? false;
    this.birth = Object.freeze(birth);
  }

  /** Set a value with the cheat->score coupling, ignoring the birth lock. */
  private applyRaw(name: string, value: boolean): void {
    if (!(name in this.values)) return;
    this.values[name] = value;
    /* option_set: turning a cheat_* option on forces its score_* twin on. */
    if (value && CHEAT_NAMES.has(name)) {
      const twin = "score" + name.slice("cheat".length); // cheat_X -> score_X
      if (twin in this.values) this.values[twin] = true;
    }
  }

  /** OPT(player, name): the current value of a boolean option. */
  get(name: OptionName | string): boolean {
    return this.values[name] ?? false;
  }

  /**
   * option_set (option.c L153): set a boolean option, applying the cheat->score
   * coupling. Birth options are locked after creation (return false, no
   * change), mirroring the in-game read-only birth options. Returns whether
   * the option exists and was writable.
   */
  set(name: OptionName | string, value: boolean): boolean {
    if (!(name in this.values)) return false;
    if (BIRTH_NAMES.has(name)) return false; // locked after birth
    this.applyRaw(name, value);
    return true;
  }

  /** Whether `name` is a birth option (type BIRTH). */
  isBirth(name: string): boolean {
    return BIRTH_NAMES.has(name);
  }

  /** Whether `name` is a cheat option (type CHEAT). */
  isCheat(name: string): boolean {
    return CHEAT_NAMES.has(name);
  }

  /** Whether `name` is a score option (type SCORE). */
  isScore(name: string): boolean {
    return SCORE_NAMES.has(name);
  }

  /**
   * The immutable birth-option value chosen at character creation. Unlike
   * get(), this never changes after construction.
   */
  birthValue(name: OptionName | string): boolean {
    return this.birth[name] ?? false;
  }

  /**
   * Whether any OP_SCORE option is set (enter_score's "cheating" gate, score.c
   * L277). A cheat_* option forces its score_* twin, so a cheated game trips
   * this even after the cheat option itself is turned back off.
   */
  anyScoreSet(): boolean {
    for (const name of SCORE_NAMES) {
      if (this.values[name]) return true;
    }
    return false;
  }

  /** The list of option names in table order. */
  names(): readonly string[] {
    return ALL_NAMES;
  }

  /** Serialize to plain JSON (the save format). */
  snapshot(): OptionStateData {
    return {
      values: { ...this.values },
      hitpointWarn: this.hitpointWarn,
      delayFactor: this.delayFactor,
      birth: { ...this.birth },
    };
  }

  /**
   * Rebuild an OptionState from serialized data. Missing options fall back to
   * their table default (back-compat with saves written before a new option
   * was added). The birth snapshot is restored verbatim.
   */
  static restore(data: OptionStateData): OptionState {
    const state = new OptionState();
    for (const name of ALL_NAMES) {
      if (name in data.values) state.values[name] = data.values[name]!;
    }
    state.hitpointWarn = clampWarn(data.hitpointWarn ?? DEFAULT_HITPOINT_WARN);
    state.delayFactor = data.delayFactor ?? DEFAULT_DELAY_FACTOR;
    /* Restore the frozen birth snapshot (default table values if absent). */
    const birth = data.birth ?? {};
    const restored: OptionValues = {};
    for (const name of BIRTH_NAMES) {
      restored[name] =
        name in birth ? birth[name]! : (state.values[name] ?? false);
    }
    // Replace the frozen snapshot via defineProperty (birth is readonly).
    Object.defineProperty(state, "birth", {
      value: Object.freeze(restored),
      writable: false,
      configurable: false,
      enumerable: false,
    });
    return state;
  }
}

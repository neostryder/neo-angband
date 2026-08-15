/**
 * Mod-supplied MONSTER SPELLS, appended after the 92 compiled-in RSF_ slots.
 *
 * WHY THIS IS A CRASH, NOT A MISSING FEATURE, which is the same shape rows 20
 * and 21 turned out to have. `monster_spell.json` is already a composed pack
 * file, so a mod can ship the record today and composition merges it by key.
 * It then reaches `bindSpells` (mon/bind.ts), which resolves the name through
 * the generated `RSF` object and THROWS `mon: invalid spell name: X` on
 * anything not compiled in - taking the whole bind, and therefore `startGame`,
 * down with it. A mod that adds a monster spell does not get a spell that does
 * nothing; it gets a game that will not boot. The answer is the one
 * `bindProjections` and `declareModMessageTypes` already give: append after the
 * compiled slots, and resolve BY NAME at the point of use.
 *
 * THE SENTINEL SITS IN THE FIRST MOD SLOT, and this is the trap in this table
 * that no other one has. `MON_SPELL_ENTRIES` has 93 rows but only 91 spells:
 * row 0 is upstream's `RSF_NONE` and row 92 is `RSF_MAX`, the end marker, which
 * `RSF_FLAG_NAMES` (the INVERTED enum) reports as the name `"MAX"`. So the
 * first index a mod spell can occupy is 92 - the slot the sentinel's NAME
 * already answers for. Any resolution that goes on reading `RSF_FLAG_NAMES` by
 * position will hand back `"MAX"` for a mod's first spell and set a bit no
 * spell owns on the way back. That is why `spellIndexOf` / `spellNameAt` below
 * are the chokepoints and why callers must stop indexing the inverted enum
 * directly. `RSF.MAX` stays what upstream means by it - the count of compiled
 * spells - and `rsfMax()` is the live count including a mod's.
 *
 * NOT #159's handler-registry shape, because there is no handler to register. A
 * monster spell is a NAME plus the RST_ type expression that decides which
 * masks it belongs to (`create_mon_spell_mask`); everything else about it -
 * effects, dice, lore, messages - already arrives as pack DATA on the
 * `monster_spell` record itself. So this is a name table with a fixed compiled
 * prefix, exactly like `MessageTypeRegistry`.
 *
 * NO SAVE IMPACT, because #269 already removed it. `SavedLore.spellsKnown` is
 * `string[]` of RSF names at SAVE_VERSION 5, so a mod's spell persists by name,
 * a build without that mod drops the name rather than landing it on whatever
 * now occupies index 92, and nothing a save holds is renumbered. That was the
 * whole reason row 22 stayed shut while rows 20 and 21 opened; the reason is
 * gone, and this is what walks through the door it left open.
 *
 * THREE REFUSALS, each the analogue of one the message table keeps:
 *  1. A name that already exists compiled-in is refused. The compiled scan runs
 *     first, so such a registration would be silently dead rather than an
 *     override - and a mod that means to CHANGE an upstream spell does that by
 *     patching the `monster_spell` record, which is the thing that composes.
 *  2. `NONE` and `MAX` are refused by name. Both are sentinels rather than
 *     spells, and a mod taking either would be writing a name the serializer
 *     deliberately skips.
 *  3. A duplicate mod-supplied name is refused, matching
 *     `projection: duplicate code X`.
 *
 * NOTHING HERE THROWS. A refusal loses one spell and reports it. A function
 * reached from inside `bindCore` that threw would be the same crash one layer
 * up, which is the thing this module exists to remove.
 */

import { flagSize } from "../bitflag.js";
import { MON_SPELL_ENTRIES, RSF } from "../generated/index.js";

/** One mod-supplied RSF_ entry - the same shape as a `MON_SPELL_ENTRIES` row. */
export interface MonSpellEntry {
  /** The RSF_ name, as a monster's `spells:` line would spell it. */
  readonly name: string;
  /**
   * The `list-mon-spells.h` type expression, kept as written
   * ("RST_BREATH | RST_INNATE"). Decides which `create_mon_spell_mask` masks
   * the spell joins; "" joins none of them, which is legal and means the spell
   * is cast rather than breathed or thrown.
   */
  readonly type: string;
  /** The mod that registered it, or null for an unattributed host call. */
  readonly owner: string | null;
}

/**
 * The first index a mod spell can take: `RSF.MAX`, which is the sentinel's own
 * slot. See the header - this is the one number in this file worth checking
 * twice, because `MON_SPELL_ENTRIES.length` is one MORE than it and reads just
 * as plausibly.
 */
export const FIRST_MOD_SPELL_INDEX = RSF.MAX;

/** The compiled name at `index`, or null - sentinels included, as upstream has them. */
function compiledNameAt(index: number): string | null {
  const entry = MON_SPELL_ENTRIES[index];
  return entry === undefined ? null : entry.name;
}

/** Names a mod may not take, because they are end markers rather than spells. */
const SENTINELS: ReadonlySet<string> = new Set(["NONE", "MAX"]);

/** What a registration did, so a caller can report a refusal by name. */
export interface MonSpellAddResult {
  /** The index taken, or -1 when refused. */
  readonly index: number;
  /** Null on success; a full sentence naming the reason otherwise. */
  readonly refused: string | null;
}

export class MonSpellRegistry {
  readonly #entries: MonSpellEntry[] = [];
  readonly #byName = new Map<string, number>();

  /**
   * Append one spell. Returns the index it took, or a refusal explaining why
   * it took none. Never throws: see the header.
   */
  add(name: string, type = "", owner: string | null = null): MonSpellAddResult {
    const refuse = (refused: string): MonSpellAddResult => ({ index: -1, refused });
    if (name === "") return refuse("a monster spell needs a name");
    if (SENTINELS.has(name)) {
      return refuse(
        `monster spell "${name}" is an end marker in list-mon-spells.h, not a spell`,
      );
    }
    if ((RSF as Record<string, number>)[name] !== undefined) {
      return refuse(
        `monster spell "${name}" is already one of Angband's own; ` +
          `patch the monster_spell record to change it instead of redeclaring it`,
      );
    }
    if (this.#byName.has(name)) {
      return refuse(`duplicate monster spell ${name}`);
    }
    const index = FIRST_MOD_SPELL_INDEX + this.#entries.length;
    this.#entries.push({ name, type, owner });
    this.#byName.set(name, index);
    return { index, refused: null };
  }

  /** The index for `name`, compiled slots first, or -1. */
  lookup(name: string): number {
    const compiled = (RSF as Record<string, number>)[name];
    if (compiled !== undefined) return compiled;
    return this.#byName.get(name) ?? -1;
  }

  /** The name at `index`, compiled slots first, or null. */
  nameAt(index: number): string | null {
    if (index < FIRST_MOD_SPELL_INDEX) return compiledNameAt(index);
    return this.#entries[index - FIRST_MOD_SPELL_INDEX]?.name ?? null;
  }

  /** The RST_ type expression at `index`, or "" when the index is unknown. */
  typeAt(index: number): string {
    if (index < FIRST_MOD_SPELL_INDEX) {
      const entry = MON_SPELL_ENTRIES[index];
      return entry !== undefined && typeof entry.type === "string" ? entry.type : "";
    }
    return this.#entries[index - FIRST_MOD_SPELL_INDEX]?.type ?? "";
  }

  /** Only the mod-supplied entries, in registration order. */
  added(): readonly MonSpellEntry[] {
    return this.#entries;
  }

  /** The live spell count: upstream's RSF_MAX plus whatever mods added. */
  get max(): number {
    return FIRST_MOD_SPELL_INDEX + this.#entries.length;
  }

  /** A facade that stamps `owner` on everything it registers. */
  forOwner(owner: string): Pick<MonSpellRegistry, "lookup" | "nameAt" | "added"> & {
    add(name: string, type?: string): MonSpellAddResult;
  } {
    return {
      add: (name: string, type = ""): MonSpellAddResult => this.add(name, type, owner),
      lookup: (name: string): number => this.lookup(name),
      nameAt: (index: number): string | null => this.nameAt(index),
      added: (): readonly MonSpellEntry[] => this.added(),
    };
  }

  /** Drop every mod-supplied entry, so one character's mods cannot reach the next. */
  clear(): void {
    this.#entries.length = 0;
    this.#byName.clear();
  }
}

/**
 * The live table. Module-level for the same reason `messageTypes` is: the
 * consumers below are called from binders that have no game to hang it on yet.
 * `clear()` at the head of each bind is what keeps it per-game.
 */
export const monSpells = new MonSpellRegistry();

/**
 * The live spell count. Upstream's `RSF_MAX`, plus a mod's.
 *
 * Callers that used to read `RSF.MAX` want THIS, with one exception: code
 * asserting a fact about Angband 4.2.6 itself - a parity test, or the count of
 * compiled rows - still means `RSF.MAX`, and should say so.
 */
export function rsfMax(): number {
  return monSpells.max;
}

/**
 * Byte size of a spell FlagSet, live (upstream `RSF_SIZE = FLAG_SIZE(RSF_MAX)`).
 *
 * A FUNCTION, not a constant, and deliberately so: every `new FlagSet(...)` for
 * spells happens at or after `bindCore`, which is after declarations land, so
 * reading the size at call time is both correct and the only thing that can be.
 * It replaced an exported `RSF_SIZE` const - a value captured at module
 * evaluation, which is strictly before any mod exists.
 */
export function rsfSize(): number {
  return flagSize(rsfMax());
}

/** The index for an RSF name, or -1. The one door: see the header's sentinel note. */
export function spellIndexOf(name: string): number {
  return monSpells.lookup(name);
}

/** The RSF name at an index, or null. The one door, for the same reason. */
export function spellNameAt(index: number): string | null {
  return monSpells.nameAt(index);
}

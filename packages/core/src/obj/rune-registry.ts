/**
 * The RUNE registry: every question core asks about a rune, plus the "You feel
 * stronger!" line a modifier prints on wield.
 *
 * WHY THIS IS A REGISTRY, and why it is a harder closure than the four before
 * it. A rune is the unit of object knowledge - what the player learns, what an
 * item is found to carry, what the recall screen names and describes. Six
 * places in `knowledge.ts` decided all of it, and five of them dispatched on
 * `rune.variety`, which was a CLOSED TYPESCRIPT UNION of seven string literals.
 *
 * A union is closed in a way a switch is not. A switch has a `default` arm that
 * a mod's key reaches and fails at, which is at least a place to stand; a union
 * refuses the key at the type level, so a mod could not coin a variety at all
 * and no arm was ever reached to fail. `tools/switch-census.json` saw none of
 * this - it counts `switch` statements, all five of these are under its 8-case
 * threshold, and it counts neither a union type's existence nor its size. The
 * census recorded ONE row for this file, `modMessage`. That is the same lesson
 * gap 28 charged for in a new shape: the census measures SYNTAX, a gap is about
 * REACH.
 *
 * The six closed decisions, and what each cost a mod-coined rune:
 *
 *   - `runeDesc` - the recall line. No arm meant no description at all.
 *   - `runeName` - the display decoration ("<x> brand", "slay <x>"). Upstream's
 *     own `default` returns the bare name, so this one had a real fallback and
 *     still does; it is the only one of the six that did.
 *   - `playerKnowsRune` / `playerLearnRune` - the knowledge pair. A mod's rune
 *     was unknowable AND unlearnable, which is worse than either alone: it
 *     could never appear as learned, and `objectRunesKnown` therefore treated
 *     any object carrying one as permanently un-assessed.
 *   - `objectHasRune` - whether an item carries it. Always no.
 *   - `modMessage` - the flavour line on noticing a modifier. The only OBJ_MOD
 *     switch in the tree, out of 114 `OBJ_MOD.*` references. A mod-coined
 *     modifier was learned in silence.
 *
 * WHERE A MOD'S RUNE KNOWLEDGE LIVES, which is the question that made this
 * conversion different from the four before it. `playerKnowsRune` reads typed
 * stores on `p.objKnown` - `modifiers[]`, `elInfo[]`, `flags` - all sized from
 * core's fixed-arity enums, so there is no slot for a mod's rune and growing
 * that arity is exactly what `mod/vocabulary.ts` was built to avoid (see its
 * header for the W2.3 architecture decision). The answer is that this registry
 * needs NO new store: `knows` and `learn` are handed the player, and a mod
 * keeps its own per-entity values in its own `VocabularyRegistry`, which
 * already persists into that mod's opaque save bag. So the seam stays a pure
 * dispatch table and there is one mechanism for mod-owned per-entity state, not
 * two.
 *
 * THE PRODUCER IS PART OF THE SEAM, not an extra. `buildRuneList` is what every
 * consumer enumerates - the knowledge screens, `objectRunesKnown`, and
 * EF_IDENTIFY's random unknown rune - so six handler tables with no way to get
 * a rune INTO that list would be a seam its own callers walk past, which is the
 * failure three of the five previous conversions each turned up in a different
 * place. `contribute` is the door: core builds its list, then every contributor
 * appends.
 *
 * RNG: `objectFindUnknownRune` draws `randint0(poss.length)` over the list, so
 * a contributor that adds runes DOES move that draw - by design, since the mod
 * is adding content and its rune is now genuinely a candidate. With no mod
 * loaded the list is byte-identical to before, which is what the parity claim
 * needs; `rune-vectors.json` holds all 99 rows.
 *
 * WHY MODULE-LEVEL. The same 2026-08-09 ruling behind `EffectInfoRegistry`,
 * `RandartRegistry` and `TvalRegistry`: disabling a mod always takes effect on
 * the next RELOAD, so a module-level table cannot violate the mod default
 * policy. `resetRuneRegistry()` restores core's arms without a fresh realm and
 * has no production caller by design.
 */

import type { GameObject } from "./object.js";
import type { Player } from "../player/player.js";
import type { Rune, RuneEnv } from "./knowledge.js";

/* ------------------------------------------------------------------ *
 * The variety key.
 * ------------------------------------------------------------------ */

/**
 * The seven varieties core defines (`enum rune_variety`, obj-knowledge.h).
 * Named separately so core's own code keeps exhaustive checking against the
 * real set, and so this file can say which seven it seeds.
 */
export type CoreRuneVariety =
  | "combat"
  | "mod"
  | "resist"
  | "brand"
  | "slay"
  | "curse"
  | "flag";

/**
 * A rune variety. Core's seven, or any string a mod coins.
 *
 * `(string & {})` rather than a bare `string`: it keeps the seven core names as
 * editor completions and as the thing a typo is checked against in core's own
 * code, while admitting a mod's `"demo:attunement"`. A bare `string` would have
 * silently accepted `"resiste"` everywhere in this package.
 */
export type RuneVariety = CoreRuneVariety | (string & {});

/* ------------------------------------------------------------------ *
 * The handler types, one per closed decision.
 * ------------------------------------------------------------------ */

/**
 * `rune_desc` (obj-knowledge.c L344-403): the recall description. Unregistered
 * returns `""`, which is upstream's own fall-through for a rune it cannot
 * describe (the C default reaches NULL).
 */
export type RuneDescHandler = (env: RuneEnv, rune: Rune) => string;

/**
 * `player_knows_rune`. Unregistered returns false - honest, and the reason a
 * mod that adds a variety must register this one: without it the rune can never
 * read as learned, and `objectRunesKnown` will hold every object carrying it
 * permanently un-assessed.
 */
export type RuneKnowsHandler = (p: Player, rune: Rune) => boolean;

/** `object_has_rune`: whether this item carries it. Unregistered returns false. */
export type RuneObjectHasHandler = (
  env: RuneEnv,
  obj: GameObject,
  rune: Rune,
) => boolean;

/**
 * `player_learn_rune`: learn it, optionally printing. Returns whether anything
 * was newly learned - a second learn of the same rune must return false, which
 * is what the vectors' `learnedAgain` column holds core to. Unregistered
 * returns false.
 */
export type RuneLearnHandler = (
  p: Player,
  env: RuneEnv,
  rune: Rune,
  message: boolean,
) => boolean;

/**
 * `rune_name` (obj-knowledge.c:325): the variety's display decoration.
 * Unregistered returns the bare `rune.name`, which is upstream's own `default`
 * arm rather than a hole - only four of the seven varieties decorate at all.
 */
export type RuneNameHandler = (rune: Rune) => string;

/**
 * `mod_message` (obj-knowledge.c L1492): the line printed on noticing a
 * modifier, given its signed value. Returns null for "say nothing", which is
 * both upstream's `default` and what a zero value produces on an arm that has
 * one. Keyed on the OBJ_MOD index.
 */
export type ModMessageHandler = (value: number) => string | null;

/**
 * A source of extra runes for `buildRuneList` (`init_rune`). Runs after core
 * has built its own list, in registration order, and appends.
 *
 * Contributing is what makes the six tables above reachable: nothing in core
 * ever asks about a rune that is not in this list.
 */
export type RuneContributor = (env: RuneEnv) => readonly Rune[];

/* ------------------------------------------------------------------ *
 * The tables.
 * ------------------------------------------------------------------ */

/**
 * One keyed table. The same shape as `TvalTable` and for the same reason: six
 * hand-copied blocks would be six places for a capability check to go missing.
 */
export class RuneTable<K, H> {
  private readonly table = new Map<K, H>();

  /** Install (or replace) the handler for one key. */
  set(key: K, handler: H): void {
    this.table.set(key, handler);
  }

  /**
   * The handler installed right now, or null. This is what a mod calls to WRAP
   * core rather than shadow it - keep what is returned, install its own, call
   * through.
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

/** Everything core asks about a rune, in six tables plus one producer. */
export class RuneRegistry {
  /** `rune_desc`, keyed on variety. */
  readonly desc = new RuneTable<RuneVariety, RuneDescHandler>();
  /** `player_knows_rune`, keyed on variety. */
  readonly knows = new RuneTable<RuneVariety, RuneKnowsHandler>();
  /** `object_has_rune`, keyed on variety. */
  readonly objectHas = new RuneTable<RuneVariety, RuneObjectHasHandler>();
  /** `player_learn_rune`, keyed on variety. */
  readonly learn = new RuneTable<RuneVariety, RuneLearnHandler>();
  /** `rune_name`'s decoration, keyed on variety. Absent means the bare name. */
  readonly name = new RuneTable<RuneVariety, RuneNameHandler>();
  /** `mod_message`, keyed on the OBJ_MOD index. */
  readonly modMessage = new RuneTable<number, ModMessageHandler>();

  /** Extra runes for `buildRuneList`, in registration order. */
  private readonly contributors: RuneContributor[] = [];

  /** Add a source of runes to the list every consumer enumerates. */
  contribute(source: RuneContributor): void {
    this.contributors.push(source);
  }

  /** Every contributed rune, in registration order. Core's list comes first. */
  contributed(env: RuneEnv): Rune[] {
    const out: Rune[] = [];
    for (const source of this.contributors) out.push(...source(env));
    return out;
  }

  /** How many contributors are installed (for tests and the conflict report). */
  contributorCount(): number {
    return this.contributors.length;
  }
}

/* ------------------------------------------------------------------ *
 * The live registry.
 * ------------------------------------------------------------------ */

/**
 * Core's own seeders. `knowledge.ts` both OWNS these tables and is the only
 * module that reads them, so "the module is loaded" and "core's arms are
 * installed" cannot come apart - a seeder somebody has to remember to call is
 * one that gets forgotten on a path, and the failure here would be silent and
 * total: no rune knowable, nothing learnable, every object permanently
 * un-assessed.
 */
const seeders: Array<(reg: RuneRegistry) => void> = [];

let live = new RuneRegistry();

/** Install a set of core arms, now and on every reset. A MOD never calls this. */
export function seedRune(seed: (reg: RuneRegistry) => void): void {
  seeders.push(seed);
  seed(live);
}

/** The live registry. Module-level; see this file's header for why that is safe. */
export function runeRegistry(): RuneRegistry {
  return live;
}

/**
 * Back to core's arms alone, dropping every mod registration - the same state a
 * reload produces, without a fresh realm. No production caller by design.
 */
export function resetRuneRegistry(): void {
  live = new RuneRegistry();
  for (const seed of seeders) seed(live);
}

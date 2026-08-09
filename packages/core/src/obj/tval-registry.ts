/**
 * The TVAL registry: every question core asks about an item CLASS.
 *
 * WHY THIS IS A REGISTRY. A mod has always been able to add an item to
 * `object.json`, and `object_base.json` has always accepted a new base type.
 * What it could not do was make core recognise a new **tval** - the item class
 * itself - because thirty-four predicates in `obj-tval.c` and two dispatches
 * elsewhere decided every property a class has, all of them closed, all of them
 * failing by answering NO:
 *
 *   - the thirty-four class predicates (`object.ts`, ported from `obj-tval.c`).
 *     A mod-coined tval was not a weapon, could not be worn, could not be
 *     flavoured, could not be browsed as a book, had no charges, no timeout, no
 *     nourishment. **408 call sites** across `core` and `web` asked, and every
 *     one got `false`.
 *   - `kindIsGood` (`make.ts`, `kind_is_good`) - whether a template counts as
 *     "good" for the good/great allocation path. An unlisted tval fell through
 *     to the `KF_GOOD` flag alone, so a new class could never be good on the
 *     strength of its own plusses.
 *   - `objectValueBase` (`value.ts`, `object_value_base`) - the flat guess at an
 *     unaware item's worth, which is what a shop shows before the flavour is
 *     known. An unlisted tval was worth **zero**.
 *
 * THE CENSUS COULD NOT SEE MOST OF THIS. `tools/switch-census.json` counts
 * `switch` statements, so it recorded five of the thirty-four - the ones that
 * happen to be written as switches - and missed the twenty-nine written as
 * `tval === TV.STAFF`. A single-comparison predicate is exactly as closed to a
 * mod as a fifteen-case switch. The census measures SYNTAX; a gap is about
 * REACH, and the two only look alike from a distance.
 *
 * KEYED ON THE PREDICATE'S OWN NAME, and that is deliberate rather than lazy.
 * `classes` is one table under `"tvalIsWeapon"`, `"tvalCanHaveFlavor"` and so
 * on - the exact exported function name, so there is no translation table
 * between what a mod writes and what core calls, and no second list to fall out
 * of step. `tval-registry.test.ts` derives its expectations from the module's
 * own exports, so a predicate added to `object.ts` and forgotten here fails
 * rather than silently answering `false` forever, which is the exact failure
 * this registry exists to remove.
 *
 * WRAPPING IS THE NORMAL CASE HERE. A mod almost never wants to REPLACE
 * "is this a weapon" - it wants to add one tval to the answer. `handlerFor`
 * hands back what is installed right now, so the idiom is:
 *
 *     const inner = host.tval.classes.handlerFor("tvalIsWeapon");
 *     host.tval.classes.set("tvalIsWeapon", (t) => t === MY_TVAL || inner(t));
 *
 * A mod may also coin a class name core has never heard of and ask about it
 * from its own code; nothing in core will consult it, which is the honest
 * behaviour rather than a silent no-op.
 *
 * NO RNG ANYWHERE IN HERE, and that is measured rather than assumed: every
 * predicate is a pure function of one small integer, `kindIsGood` reads three
 * fields of a kind, and `objectValueBase` reads a tval and a cost. So the
 * 2026-08-09 relaxation to gameplay parity buys this conversion nothing - there
 * is no stream to move. What these decide is whether the player can wield the
 * item, which is as player-visible as the game gets, and
 * `tval-vectors.json` / `tval-kind-vectors.json` - 1,224 predicate answers and
 * 389 real object kinds, recorded before this file existed - are what hold it.
 *
 * WHY MODULE-LEVEL. The same 2026-08-09 ruling that justified
 * `EffectInfoRegistry` and `RandartRegistry`: disabling a mod always takes
 * effect on the next RELOAD, so a module-level table cannot violate the mod
 * default policy. A fresh page is a fresh module instance and the host installs
 * each plugin at most once per realm, so a disabled mod's registrations are gone
 * on the next boot because the table they lived in is. `resetTvalRegistry()` is
 * the same restoration without a fresh realm; it has no production caller by
 * design.
 */

import type { ObjectKind } from "./types.js";

/* ------------------------------------------------------------------ *
 * Table 1: class membership, keyed on the predicate's name.
 * ------------------------------------------------------------------ */

/**
 * Whether a tval belongs to one class. The port of one `obj-tval.c` predicate.
 * Total on tval: there is no "don't know" answer, because every call site
 * branches on a boolean.
 */
export type TvalClassPredicate = (tval: number) => boolean;

/* ------------------------------------------------------------------ *
 * Table 2: kind_is_good, keyed on tval.
 * ------------------------------------------------------------------ */

/**
 * Whether a template counts as "good" for its item class (`kind_is_good`,
 * obj-make.c). Upstream's three arms read three different fields - armour
 * checks `randcalcMin(toA) >= 0`, weapons check `toH` and `toD`, ammo is
 * unconditionally true - so this is a handler over the KIND, not a set of
 * tvals.
 *
 * An unregistered tval takes upstream's own fallthrough, `kindFlags.has(GOOD)`,
 * which is a real default rather than a hole: a mod's class is good exactly
 * when its record says so, until the mod says more.
 */
export type TvalGoodHandler = (kind: ObjectKind) => boolean;

/* ------------------------------------------------------------------ *
 * Table 3: object_value_base, keyed on tval.
 * ------------------------------------------------------------------ */

/**
 * The flat guess at an UNAWARE item's worth (`object_value_base`, obj-power.c).
 * This is the number a shop shows before the flavour is known, so an item class
 * with no entry is displayed as worthless - upstream's `default: return 0`.
 * Registering one is how a mod's unidentified potion stops looking like litter.
 */
export type TvalValueBaseHandler = (kind: ObjectKind) => number;

/* ------------------------------------------------------------------ *
 * The tables.
 * ------------------------------------------------------------------ */

/**
 * One keyed table. Written once and used three times, because the three differ
 * only in their key and handler types - three hand-copied blocks would be three
 * places for a capability check to go missing.
 */
export class TvalTable<K, H> {
  private readonly table = new Map<K, H>();

  /** Install (or replace) the handler for one key. */
  set(key: K, handler: H): void {
    this.table.set(key, handler);
  }

  /**
   * The handler installed for a key right now, or null. This is what a mod
   * calls to WRAP core rather than shadow it - keep the returned handler,
   * install its own, and call through. See this file's header: for the class
   * predicates, wrapping is the normal case, not the advanced one.
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

/** Everything core asks about an item class, in three tables. */
export class TvalRegistry {
  /** Class membership, keyed on the exported predicate's own name. */
  readonly classes = new TvalTable<string, TvalClassPredicate>();
  /** `kind_is_good`, keyed on tval. */
  readonly good = new TvalTable<number, TvalGoodHandler>();
  /** `object_value_base`, keyed on tval. */
  readonly valueBase = new TvalTable<number, TvalValueBaseHandler>();
}

/* ------------------------------------------------------------------ *
 * The live registry.
 * ------------------------------------------------------------------ */

/**
 * Core's own seeders. The modules that OWN a table register their arms here at
 * import time, and each is also the only module that READS its table - so "the
 * module is loaded" and "core's arms are installed" cannot come apart. A seeder
 * somebody has to remember to call is a seeder that gets forgotten on one path,
 * and the failure mode here is silent and total: every predicate answers `false`
 * and nothing in the game is a weapon.
 */
const seeders: Array<(reg: TvalRegistry) => void> = [];

let live = new TvalRegistry();

/** Install a set of core arms, now and on every reset. A MOD never calls this. */
export function seedTval(seed: (reg: TvalRegistry) => void): void {
  seeders.push(seed);
  seed(live);
}

/** The live registry. Module-level; see this file's header for why that is safe. */
export function tvalRegistry(): TvalRegistry {
  return live;
}

/**
 * Ask one class question. The single lookup every ported predicate delegates
 * to, so the "unregistered means no" rule is written once.
 */
export function tvalInClass(name: string, tval: number): boolean {
  return tvalRegistry().classes.handlerFor(name)?.(tval) ?? false;
}

/**
 * Back to core's arms alone, dropping every mod registration - the same state a
 * reload produces, without needing a fresh realm. No production caller by
 * design; see this file's header.
 */
export function resetTvalRegistry(): void {
  live = new TvalRegistry();
  for (const seed of seeders) seed(live);
}

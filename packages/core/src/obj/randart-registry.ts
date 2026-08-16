/**
 * The RANDOM ARTIFACT registry: what an ability does, what an item class starts
 * with, which bucket it counts toward, and whether an activation is redundant.
 *
 * WHY THIS IS A REGISTRY. `artifact.json` has always accepted a new record, so a
 * mod could always ship a fixed artifact. What it could not do was reach the
 * RANDOM artifact generator, which is a different thing entirely: four closed
 * `switch` statements decided every property a randart can have, and each failed
 * silently rather than loudly.
 *
 *   - `addAbilityAux` (randart-build.ts, keyed on the `ART_IDX` ability, 87
 *     cases) - the largest dispatch in the port. A mod-coined ability index took
 *     the default arm, which is `break`: the design loop spent power on it and
 *     the artifact got NOTHING.
 *   - `artifactPrep` (randart-build.ts, keyed on the base item's tval, 15) - the
 *     starting to-hit / to-dam / AC an item class is given. An unlisted tval got
 *     zero of each, so a mod's new item class produced randarts that started
 *     blank and could never be told apart from a bug.
 *   - the item-class census (randart-data.ts, keyed on tval, 14) - which
 *     `data.*Total` bucket a standard artifact counts toward. That census feeds
 *     the frequency table the design loop SPENDS, so a mod's item class landing
 *     in `otherTotal` skews what every randart in the game becomes.
 *   - the redundancy test (randart-build.ts, keyed on the `EFPROP` kind, 9) -
 *     whether an activation only duplicates something the artifact already has.
 *     An unknown kind takes upstream's conservative default (keep it), which is
 *     right for core and useless to a mod that coined a new property kind.
 *
 * FOUR TABLES, THREE KEYS, kept separate because upstream's keys are: the
 * ability index, the tval, and the EFPROP kind name three different things and
 * collapsing them would force a mod to register the same behaviour twice.
 *
 * WHAT A HANDLER GETS, AND WHY IT IS NOT A PILE OF CALLBACKS. Every primitive
 * core's own arms use - `addFlag`, `addMod`, `addResist`, `addBrand`, `addSlay`,
 * `addToHit`, `addToDam`, `addToAC`, `addLowResist`, `addHighResist`,
 * `addImmunity`, `addStat`, `addSustain`, `addDamageDice`, `addWeightMod`,
 * `addActivation` - is exported and reachable through `ctx.core`. So the context
 * carries STATE (the registry, the artifact, the base kind, the target power,
 * the set data, the rng) and nothing else. A mod's handler is written exactly
 * the way core's arms are written.
 *
 * That reachability was NOT free, and it is the trap this seam nearly shipped
 * with. The helpers were exported from `randart-build.ts` but the module was
 * never re-exported from core's index, so none of them were in `ctx.core` - a
 * mod could register a handler and had no way to write its body. `index.ts` now
 * exports `randart-build.js` and `randart-data.js` for exactly that reason. A
 * seam whose primitives a mod cannot reach is a seam a mod cannot use.
 *
 * ORDER AND RNG. Core's handlers are the case bodies lifted unchanged, so the
 * draw sequence is identical - which is what `randart-vectors.json` exists to
 * prove, 834 vectors recorded before this file existed, the per-arm families
 * carrying an RNG probe because a changed draw count is invisible in the
 * artifact and diverges every artifact after it. A MOD's handler draws from the
 * same `rng`, so it changes the stream from that ability onward. That is
 * inherent in adding behaviour to generation and is why a modded game is not
 * seed-compatible with an unmodded one.
 *
 * WHY MODULE-LEVEL. The same 2026-08-09 ruling that justified
 * `EffectInfoRegistry`: disabling a mod always takes effect on the next RELOAD,
 * so a module-level table cannot violate the mod default policy. A fresh page is
 * a fresh module instance and the host installs each plugin at most once per
 * realm, so a disabled mod's registrations are gone on the next boot because the
 * table they lived in is. `resetRandartRegistry()` is the same restoration
 * without a fresh realm; it has no production caller by design.
 */

import type { Rng } from "../rng.js";
import type { ObjRegistry } from "./bind.js";
import type { EffectObjectProperty } from "./randart-build.js";
import type { ArtifactSetData } from "./randart-data.js";
import type { Artifact, ObjectKind } from "./types.js";

/* ------------------------------------------------------------------ *
 * Table 1: what an ability does, keyed on the ART_IDX index.
 * ------------------------------------------------------------------ */

/** The state one `add_ability_aux` arm is given (obj-randart.c L2150). */
export interface RandartAbilityContext {
  /** The object registry, for the flag / brand / slay / element tables. */
  readonly reg: ObjRegistry;
  /** The artifact being built. Handlers mutate this. */
  readonly art: Artifact;
  /** The base item kind, or null when the tval/sval pair names none. */
  readonly kind: ObjectKind | null;
  /** The power the design loop is aiming at (gates AGGRAVATE, sizes ACTIV). */
  readonly targetPower: number;
  /** The measured profile of the standard set: increments, powers, frequencies. */
  readonly data: ArtifactSetData;
  /** The generation stream. Drawing from it moves every later artifact. */
  readonly rng: Rng;
}

/**
 * What one ability does to an artifact. Write it the way core's arms are
 * written: call the exported `addFlag` / `addMod` / `addResist` / ... helpers,
 * which handle the "already has it" case and the randart.log line.
 */
export type RandartAbilityHandler = (ctx: RandartAbilityContext) => void;

/* ------------------------------------------------------------------ *
 * Table 2: an item class's starting stats, keyed on tval.
 * ------------------------------------------------------------------ */

/** The state one `artifact_prep` item-class arm is given. */
export interface RandartPrepContext {
  readonly reg: ObjRegistry;
  /** The artifact, already given the base kind's own values. */
  readonly art: Artifact;
  /** The base item kind this artifact was built from. */
  readonly kind: ObjectKind;
  readonly data: ArtifactSetData;
  readonly rng: Rng;
}

/**
 * The basic stats an item class starts with. Upstream gives weapons to-hit and
 * to-dam, armour to-AC, and everything else nothing at all - an unregistered
 * tval takes that last arm, which is upstream's own default rather than a hole.
 */
export type RandartPrepHandler = (ctx: RandartPrepContext) => void;

/* ------------------------------------------------------------------ *
 * Table 3: the item-class census, keyed on tval.
 * ------------------------------------------------------------------ */

/**
 * Which `data.*Total` bucket a standard artifact counts toward. This feeds the
 * frequency table the design loop spends, so it is not bookkeeping: a class in
 * the wrong bucket changes what every randart in the game becomes.
 *
 * `TV.NULL` is registered as an explicit no-op rather than left to the default,
 * because upstream distinguishes "an empty artifact slot" from "an item class I
 * have no bucket for" - the first counts toward nothing, the second toward
 * `otherTotal`.
 */
export type RandartCensusHandler = (data: ArtifactSetData) => void;

/* ------------------------------------------------------------------ *
 * Table 4: activation redundancy, keyed on the EFPROP kind.
 * ------------------------------------------------------------------ */

/** The state one redundancy arm is given (obj-randart.c L2420). */
export interface RandartRedundancyContext {
  readonly reg: ObjRegistry;
  /** The artifact whose activation is on trial. */
  readonly art: Artifact;
  /** The summarized property this arm is judging. */
  readonly prop: EffectObjectProperty;
}

/**
 * Whether the activation is STILL redundant after considering this property.
 * Return false the moment the activation does something the artifact does not
 * already do - upstream stops at the first `false` and keeps the activation.
 * An unregistered kind takes upstream's conservative default (not redundant),
 * which is the safe direction: a kept activation is a weaker artifact than
 * intended, a dropped one is a missing power.
 */
export type RandartRedundancyHandler = (
  ctx: RandartRedundancyContext,
) => boolean;

/* ------------------------------------------------------------------ *
 * The tables.
 * ------------------------------------------------------------------ */

/**
 * One keyed table. Written once and used four times, because the four differ
 * only in their key and handler types.
 */
export class RandartTable<K, H> {
  private readonly table = new Map<K, H>();

  /** Install (or replace) the handler for one key. */
  set(key: K, handler: H): void {
    this.table.set(key, handler);
  }

  /**
   * The handler installed for a key right now, or null. This is what a mod
   * calls to WRAP core - keep the returned handler, install its own, and call
   * through. Wrapping matters more here than almost anywhere else: an ability
   * that draws a different NUMBER of random values changes every artifact
   * generated after it, so a handler that reimplements core's from scratch and
   * gets the draw count wrong is a whole-set divergence, not a local one.
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

/** Random artifact construction, in four tables under three keys. */
export class RandartRegistry {
  /** What an ability does, keyed on the ART_IDX index. */
  readonly abilities = new RandartTable<number, RandartAbilityHandler>();
  /** An item class's starting stats, keyed on tval. */
  readonly prep = new RandartTable<number, RandartPrepHandler>();
  /** The item-class census bucket, keyed on tval. */
  readonly census = new RandartTable<number, RandartCensusHandler>();
  /** Activation redundancy, keyed on the EFPROP kind. */
  readonly redundancy = new RandartTable<number, RandartRedundancyHandler>();
}

/* ------------------------------------------------------------------ *
 * The live registry.
 * ------------------------------------------------------------------ */

/**
 * Core's own seeders. The modules that OWN a table register their arms here at
 * import time, and each is also the only module that READS its table - so "the
 * module is loaded" and "core's arms are installed" cannot come apart. A seeder
 * somebody has to remember to call is a seeder that gets forgotten on one path,
 * and the failure mode here is silent: every randart comes out blank.
 */
const seeders: Array<(reg: RandartRegistry) => void> = [];

let live = new RandartRegistry();

/** Install a set of core arms, now and on every reset. A MOD never calls this. */
export function seedRandart(seed: (reg: RandartRegistry) => void): void {
  seeders.push(seed);
  seed(live);
}

/** The live registry. Module-level; see this file's header for why that is safe. */
export function randartRegistry(): RandartRegistry {
  return live;
}

/**
 * Back to core's arms alone, dropping every mod registration - the same state a
 * reload produces, without needing a fresh realm. No production caller by
 * design; see this file's header.
 */
export function resetRandartRegistry(): void {
  live = new RandartRegistry();
  for (const seed of seeders) seed(live);
}

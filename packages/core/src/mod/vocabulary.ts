/**
 * Mod vocabulary extension (W2.3): the seam by which a pack introduces
 * genuinely NEW vocabulary terms at runtime - new flags, new stats/attributes,
 * new tags of any mod-defined kind - and stores per-entity VALUES for them.
 *
 * WHY THIS SHAPE, NOT CORE-ARITY EXTENSION (the W2.3 architecture decision):
 * the faithful engine stores flags in fixed-capacity bitsets (bitflag.ts, sized
 * from RF_MAX/OF_MAX at bind time) and stats in fixed-arity arrays (STAT_MAX = 5,
 * with the OBJ_MOD enum offset and str/int/wis/dex/con field names baked across
 * calcs, char-sheet, randart and birth). Growing that arity to admit a mod flag
 * or a sixth stat would (a) fight the byte-identical faithfulness guarantee the
 * port is built on and (b) be bounded by whatever headroom was reserved. So mod
 * vocabulary lives in a PARALLEL, mod-owned store instead: unbounded, and
 * byte-identical to core whenever no mod declares anything. The trade is honest:
 * unmodified core code paths do not read a mod term - but core cannot know what
 * a brand-new stat MEANS without mod logic anyway, so the mod supplies both the
 * term AND its behaviour, consuming its own values through the W2.2 registry
 * hooks (monster AI, effects, commands) it already controls.
 *
 * Persistence: a VocabularyRegistry serialises to plain JSON (toJSON/fromJSON)
 * so a host folds it into that mod's opaque save bag (mod/save-blocks.ts,
 * ModBag) - the engine never interprets it, exactly as the bag contract requires.
 *
 * Layering: core owns the registry type so the capability-gated facade
 * (mod/registry-host.ts) can expose it; the host creates one, hands it to the
 * trusted plugin, and persists it. Nothing here touches GameState or the
 * faithful data model.
 */

import type { JsonValue } from "./save-blocks.js";

/**
 * The category of a vocabulary term. "flag" and "stat" are the two families the
 * W2.3 brief names; the kind is a free string so a mod may coin its own
 * families (e.g. "attribute", "resource", "faction") without a core change.
 */
export type VocabKind = string;

/** One declared vocabulary term: a namespaced name within a kind, plus metadata. */
export interface VocabTerm {
  /** The family this term belongs to ("flag", "stat", or any mod-coined kind). */
  kind: VocabKind;
  /** The term itself, namespaced like every mod id (e.g. "demo:luck"). */
  term: string;
  /** A human label for UIs (char sheet, mod manager); defaults to the term. */
  label?: string;
  /** Opaque per-term metadata (e.g. default value, min/max, display group). */
  meta?: { [key: string]: JsonValue };
}

/** The serialised form of a VocabularyRegistry (folds into a mod's save bag). */
export interface VocabularySnapshot {
  /** Every declared term, in declaration order. */
  terms: VocabTerm[];
  /** entity ref -> (term -> value); only entities with values appear. */
  values: { [entity: string]: { [term: string]: JsonValue } };
}

/** Join a kind and term into the internal map key (a space cannot occur in a kind or a namespaced id). */
function termKey(kind: VocabKind, term: string): string {
  return `${kind}\u0000${term}`;
}

/**
 * A mod's declared vocabulary plus the per-entity values for those terms. One
 * instance per mod (so terms are namespaced by the owning pack and persistence
 * is one bag). Entity refs are opaque strings the mod chooses - conventionally
 * "player", `mon:${midx}`, `obj:${handle}` - and are never interpreted here.
 */
export class VocabularyRegistry {
  /** kind\0term -> VocabTerm, insertion-ordered. */
  private readonly terms = new Map<string, VocabTerm>();
  /** entity -> (term -> value). */
  private readonly values = new Map<string, Map<string, JsonValue>>();

  /**
   * Declare a new term. Throws on a duplicate (same kind + term) so a mod
   * cannot silently redeclare, and callers see conflicts. Returns nothing; the
   * term is now usable with setValue.
   */
  define(term: VocabTerm): void {
    const key = termKey(term.kind, term.term);
    if (this.terms.has(key)) {
      throw new Error(
        `mod vocabulary: term "${term.term}" already declared in kind "${term.kind}"`,
      );
    }
    this.terms.set(key, { ...term });
  }

  /** Whether a term is declared in a given kind. */
  has(kind: VocabKind, term: string): boolean {
    return this.terms.has(termKey(kind, term));
  }

  /** Look up a declared term's record, or undefined. */
  get(kind: VocabKind, term: string): VocabTerm | undefined {
    return this.terms.get(termKey(kind, term));
  }

  /** All declared terms, optionally filtered to one kind, in declaration order. */
  list(kind?: VocabKind): VocabTerm[] {
    const out: VocabTerm[] = [];
    for (const t of this.terms.values()) {
      if (kind === undefined || t.kind === kind) out.push({ ...t });
    }
    return out;
  }

  /** True when `term` is declared in ANY kind (the setValue precondition). */
  private isDeclared(term: string): boolean {
    for (const t of this.terms.values()) if (t.term === term) return true;
    return false;
  }

  /**
   * Set an entity's value for a term. Throws if the term was never declared -
   * vocabulary must be declared before it is used, which is what makes the
   * store a vocabulary and not an arbitrary property bag.
   */
  setValue(entity: string, term: string, value: JsonValue): void {
    if (!this.isDeclared(term)) {
      throw new Error(
        `mod vocabulary: cannot set undeclared term "${term}" (declare it first)`,
      );
    }
    let bag = this.values.get(entity);
    if (!bag) {
      bag = new Map<string, JsonValue>();
      this.values.set(entity, bag);
    }
    bag.set(term, value);
  }

  /** Get an entity's value for a term, or undefined when unset. */
  getValue(entity: string, term: string): JsonValue | undefined {
    return this.values.get(entity)?.get(term);
  }

  /** A plain snapshot of one entity's term values (empty object when none). */
  valuesOf(entity: string): { [term: string]: JsonValue } {
    const out: { [term: string]: JsonValue } = {};
    const bag = this.values.get(entity);
    if (bag) for (const [k, v] of bag) out[k] = v;
    return out;
  }

  /** Drop all values for an entity (e.g. a monster that died / an item consumed). */
  clearEntity(entity: string): void {
    this.values.delete(entity);
  }

  /** Serialise to plain JSON for a mod save bag. Declaration order is preserved. */
  toJSON(): VocabularySnapshot {
    const values: { [entity: string]: { [term: string]: JsonValue } } = {};
    for (const [entity, bag] of this.values) {
      const inner: { [term: string]: JsonValue } = {};
      for (const [k, v] of bag) inner[k] = v;
      values[entity] = inner;
    }
    return { terms: this.list(), values };
  }

  /** Rebuild from a snapshot (a mod restoring its bag on load). */
  static fromJSON(snapshot: VocabularySnapshot): VocabularyRegistry {
    const reg = new VocabularyRegistry();
    for (const t of snapshot.terms) reg.define(t);
    for (const [entity, inner] of Object.entries(snapshot.values)) {
      for (const [term, value] of Object.entries(inner)) {
        reg.setValue(entity, term, value);
      }
    }
    return reg;
  }
}

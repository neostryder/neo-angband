/**
 * Item classes (tvals) declared by a pack, appended after the compiled ones.
 *
 * Angband's tvals come from list-tvals.h, compiled into `TVAL_ENTRIES`. A pack
 * could always add an object kind or an `object_base`, but both name their class
 * by its text name, and `tvalFindIdx` only knew the compiled names, so a kind of
 * a class Angband 4.2 no longer has (the 3.x skeletons, bottles and junk) failed
 * the bind with `object: unknown tval`. A pack now declares such a class in
 * `tval.json`, one record per class, and it takes the next number after the
 * compiled ones.
 *
 * A declared class answers `false` to every class predicate until a mod wires
 * one through `registry:tval` (obj/tval-registry.ts): it cannot be worn, wielded,
 * flavoured, read, eaten or aimed. That is exactly what junk needs, and a mod
 * that wants more wraps the predicates it needs.
 *
 * A declared class offers kind ignoring only when its record opts in with
 * `ignoreMenu`, the category label the ignore menus show for it. Angband's own
 * categories are a fixed list in the front end (sval_dependent, ui-options.c),
 * and without an opt-in a player could never un-ignore a class that a mod
 * ignored for them.
 *
 * Numbers are not stable across mod sets, so nothing persists one. Kinds are
 * saved by id (`<class>:<name>`), and a saved object of a declared class takes
 * its tval from its kind on load (session/save.ts).
 *
 * Like `monSpells`, the table is module-level because the binders that read it
 * have no game to hang it on, and bindCore clears it before declaring a pack's
 * classes. Nothing here throws: a refused record is reported by name.
 */

import { TVAL_ENTRIES } from "../generated/index.js";
import { provenanceOf } from "../mod/extension.js";

/** The first tval a pack can declare: one past the compiled list-tvals.h rows. */
export const FIRST_MOD_TVAL = TVAL_ENTRIES.length;

/** One declared class. */
export interface ModTvalEntry {
  /** The text name `object.json`'s `type` and `object_base.json`'s name use, e.g. "junk". */
  readonly textName: string;
  /** The mod that declared it, or null for an unattributed call. */
  readonly owner: string | null;
  /** The ignore-menu category label, or null when the class does not offer kind ignoring. */
  readonly ignoreMenu: string | null;
}

/** One category a declared class adds to the ignore menus. */
export interface ModIgnoreCategory {
  readonly tval: number;
  readonly desc: string;
}

/** What a declaration did: the tval taken, or -1 and a sentence saying why not. */
export interface ModTvalAddResult {
  readonly tval: number;
  readonly refused: string | null;
}

function compiledIndex(textName: string): number {
  return TVAL_ENTRIES.findIndex((e) => e.textName === textName);
}

export class DeclaredTvalTable {
  readonly #entries: ModTvalEntry[] = [];
  readonly #byName = new Map<string, number>();

  /** Declare one class. Never throws. */
  add(textName: string, owner: string | null = null, ignoreMenu: string | null = null): ModTvalAddResult {
    const refuse = (refused: string): ModTvalAddResult => ({ tval: -1, refused });
    const name = textName.trim().toLowerCase();
    if (name === "") return refuse("an item class needs a name");
    if (/^\d+$/.test(name)) return refuse(`item class "${name}" is a number, and tval names cannot be`);
    if (compiledIndex(name) >= 0) {
      return refuse(`item class "${name}" is already one of Angband's own`);
    }
    if (this.#byName.has(name)) return refuse(`duplicate item class ${name}`);
    const tval = FIRST_MOD_TVAL + this.#entries.length;
    this.#entries.push({ textName: name, owner, ignoreMenu });
    this.#byName.set(name, tval);
    return { tval, refused: null };
  }

  /** The tval for a text name, compiled classes first, or -1. */
  lookup(textName: string): number {
    const name = textName.toLowerCase();
    const compiled = compiledIndex(name);
    return compiled >= 0 ? compiled : (this.#byName.get(name) ?? -1);
  }

  /** The text name of a tval, compiled classes first, or null. */
  nameAt(tval: number): string | null {
    if (tval < FIRST_MOD_TVAL) return TVAL_ENTRIES[tval]?.textName ?? null;
    return this.#entries[tval - FIRST_MOD_TVAL]?.textName ?? null;
  }

  /** Only the declared classes, in declaration order. */
  added(): readonly ModTvalEntry[] {
    return this.#entries;
  }

  /** The classes that opted into kind ignoring, in declaration order. */
  ignoreCategories(): ModIgnoreCategory[] {
    const out: ModIgnoreCategory[] = [];
    this.#entries.forEach((entry, i) => {
      if (entry.ignoreMenu !== null) out.push({ tval: FIRST_MOD_TVAL + i, desc: entry.ignoreMenu });
    });
    return out;
  }

  /** The live tval count: the compiled classes plus the declared ones. */
  get max(): number {
    return FIRST_MOD_TVAL + this.#entries.length;
  }

  /** Drop every declared class, so one game's mods cannot reach the next. */
  clear(): void {
    this.#entries.length = 0;
    this.#byName.clear();
  }
}

/** The live table. bindCore clears it at the head of each bind. */
export const tvals = new DeclaredTvalTable();

/** What declareModTvals did with a file's records. */
export interface TvalDeclarationResult {
  readonly declared: readonly string[];
  readonly refused: readonly string[];
}

/**
 * Declare the classes in a composed `tval.json`. Each record is
 * `{ "name": "<text name>" }`, with an optional `"ignoreMenu": "<label>"`; the
 * owner comes from the provenance composition stamps on it. A malformed
 * `ignoreMenu` is refused on its own and the class is still declared, because
 * dropping the class would stop the bind over a menu label.
 */
export function declareModTvals(records: readonly unknown[] | undefined | null): TvalDeclarationResult {
  const declared: string[] = [];
  const refused: string[] = [];
  if (records === undefined || records === null) return { declared, refused };
  if (!Array.isArray(records)) {
    refused.push("tval declaration: the file's records must be an array");
    return { declared, refused };
  }
  for (const raw of records) {
    if (typeof raw !== "object" || raw === null) {
      refused.push("tval declaration: each record must be an object");
      continue;
    }
    const rec = raw as { name?: unknown; ignoreMenu?: unknown };
    if (typeof rec.name !== "string") {
      refused.push("tval declaration: name must be a string");
      continue;
    }
    let ignoreMenu: string | null = null;
    if (rec.ignoreMenu !== undefined) {
      if (typeof rec.ignoreMenu === "string" && rec.ignoreMenu.trim() !== "") ignoreMenu = rec.ignoreMenu.trim();
      else refused.push(`item class ${rec.name.trim().toLowerCase()}: ignoreMenu must be a non-empty string`);
    }
    const result = tvals.add(rec.name, provenanceOf(raw)?.owner ?? null, ignoreMenu);
    if (result.refused !== null) refused.push(result.refused);
    else declared.push(rec.name.trim().toLowerCase());
  }
  return { declared, refused };
}

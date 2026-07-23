/**
 * Thematic monster-knowledge grouping for the '~' -> Monsters browser, ported
 * from reference/src/ui-knowledge.c (Angband 4.2.6):
 *   - the ui_knowledge.txt categories (init_ui_knowledge_parser, L3380-3390)
 *   - the reserved "***Unclassified***" catch-all appended last
 *     (finish_ui_knowledge_parser, L3437-3445)
 *   - the per-race group assignment (do_cmd_knowledge_monsters, L1397-1449):
 *     a race joins EVERY category it matches (so a unique dragon appears under
 *     both "Uniques" and "Dragons"), falling back to Unclassified only when it
 *     matches nothing
 *   - the within-group ordering (m_cmp_race, L1216-1263): for a category that
 *     lists monster bases, order by base position (non-base members last), then
 *     by level, then by name.
 *
 * This is display grouping only: the set of selectable races is identical to
 * the flat list, exactly as upstream partitions the same membership.
 */

import { RF } from "../generated";
import type { MonsterRace } from "./types";

/** struct ui_monster_category (one parsed ui_knowledge.txt category). */
export interface MonsterCategory {
  /** monster-category:name */
  readonly name: string;
  /** mcat-include-base names (monster_base names), in file order. */
  readonly incBases: readonly string[];
  /** mcat-include-flag flag indices (RF_*). */
  readonly incFlags: readonly number[];
  /** mcat-include-other:fully-known */
  readonly includeFullyKnown: boolean;
  /** mcat-include-other:not-fully-known */
  readonly includeNotFullyKnown: boolean;
}

/** A compiled pack/ui_knowledge.json record. */
export interface UiKnowledgeRecordJson {
  "monster-category": string;
  "mcat-include-base"?: string[];
  /** Each entry is a " | "-separated flag list (may hold several flags). */
  "mcat-include-flag"?: string[];
  /** "fully-known" / "not-fully-known". */
  "mcat-include-other"?: string[];
}

/** The reserved catch-all category name (finish_ui_knowledge_parser L3439). */
export const UNCLASSIFIED_CATEGORY = "***Unclassified***";

/** Parse the compiled ui_knowledge records into MonsterCategory objects. */
export function bindMonsterCategories(
  records: readonly UiKnowledgeRecordJson[],
): MonsterCategory[] {
  return records.map((r) => {
    const incFlags: number[] = [];
    for (const line of r["mcat-include-flag"] ?? []) {
      for (const tok of String(line).split("|")) {
        const name = tok.trim();
        if (!name) continue;
        const idx = (RF as Record<string, number>)[name];
        if (idx !== undefined) incFlags.push(idx);
      }
    }
    const other = (r["mcat-include-other"] ?? []).map(String);
    return {
      name: r["monster-category"],
      incBases: (r["mcat-include-base"] ?? []).map(String),
      incFlags,
      includeFullyKnown: other.includes("fully-known"),
      includeNotFullyKnown: other.includes("not-fully-known"),
    };
  });
}

/** A displayed group: a category name plus its ordered member rows. */
export interface MonsterKnowledgeGroup<T> {
  readonly name: string;
  readonly members: T[];
}

/** strcmp: byte-order name compare (ASCII monster names). */
function strcmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * m_cmp_race within a single group (ui-knowledge.c:1234-1262): base position
 * first (members outside the listed bases sort last), then level, then name.
 */
function compareInGroup(
  category: MonsterCategory | null,
  a: MonsterRace,
  b: MonsterRace,
): number {
  if (category && category.incBases.length > 0) {
    const pos = (race: MonsterRace): number => {
      const i = category.incBases.indexOf(race.base?.name ?? "");
      return i < 0 ? category.incBases.length : i;
    };
    const c = pos(a) - pos(b);
    if (c) return c;
  }
  const c = a.level - b.level;
  if (c) return c;
  return strcmp(a.name, b.name);
}

/** Does a race match a category by flag or by the fully-/not-fully-known other? */
function matchesFlagOrOther(
  category: MonsterCategory,
  race: MonsterRace,
  allKnown: boolean,
): boolean {
  for (const flag of category.incFlags) {
    if (race.flags.has(flag)) return true;
  }
  if (category.includeFullyKnown && allKnown) return true;
  if (category.includeNotFullyKnown && !allKnown) return true;
  return false;
}

/**
 * Assign each known monster row to every category it matches (Unclassified if
 * none), then order each category's members and drop empty categories, exactly
 * as do_cmd_knowledge_monsters + display_knowledge do. `known` is the flat
 * membership (race + whether its lore is fully known); the returned groups hold
 * the SAME row objects so the caller keeps any extra lore it carries.
 */
export function monsterKnowledgeGroups<T extends { race: MonsterRace; allKnown: boolean }>(
  categories: readonly MonsterCategory[],
  known: readonly T[],
): MonsterKnowledgeGroup<T>[] {
  const buckets: T[][] = categories.map(() => []);
  const unclassified: T[] = [];

  for (const row of known) {
    let classified = false;
    for (let j = 0; j < categories.length; j++) {
      const cat = categories[j]!;
      const hasBase =
        cat.incBases.length > 0 && cat.incBases.includes(row.race.base?.name ?? "");
      if (hasBase) {
        buckets[j]!.push(row);
        classified = true;
      } else if (matchesFlagOrOther(cat, row.race, row.allKnown)) {
        buckets[j]!.push(row);
        classified = true;
      }
    }
    if (!classified) unclassified.push(row);
  }

  const groups: MonsterKnowledgeGroup<T>[] = [];
  for (let j = 0; j < categories.length; j++) {
    const members = buckets[j]!;
    if (members.length === 0) continue;
    members.sort((a, b) => compareInGroup(categories[j]!, a.race, b.race));
    groups.push({ name: categories[j]!.name, members });
  }
  if (unclassified.length > 0) {
    unclassified.sort((a, b) => compareInGroup(null, a.race, b.race));
    groups.push({ name: UNCLASSIFIED_CATEGORY, members: unclassified });
  }
  return groups;
}

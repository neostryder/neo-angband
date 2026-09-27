/**
 * `ctx.knowledge`: the knowledge menu's contents as data, for a mod that draws
 * its own knowledge browser (tabs, a side panel, sprites beside each row). Needs
 * `state:knowledge.read`.
 *
 * Every category comes from the same builder the game's own browser uses
 * (knowledge.ts), so a mod lists exactly what the player would see there: known
 * members only, in the game's group order, with the same labels and colours. A
 * recall is the same frozen `ScreenView` the game shows for that row.
 *
 * A read changes nothing. Upstream's artifact recall builds its throwaway object
 * off the game's random stream (desc_art_fake -> make_fake_artifact), so the
 * game's own browser advances that stream when the player opens a page. A mod
 * reading the same page must not, or drawing a tab would change what the next
 * dungeon level looks like. Every recall here runs between a save and a restore
 * of the generator.
 */

import type { Rng } from "@rpgm-tools/neo-angband-core";
import type { KnowledgeGroup, KnowledgeRow } from "./knowledge";
import type { ScreenView } from "./screen-view";

/** The knowledge menu's categories, in the menu's own order (ui-knowledge.c:3487-3503). */
export const KNOWLEDGE_CATEGORIES = [
  "objects",
  "runes",
  "artifacts",
  "egos",
  "monsters",
  "features",
  "traps",
  "shapes",
] as const;

export type KnowledgeCategoryId = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeCategoryView {
  readonly id: KnowledgeCategoryId;
  /** The browser's own title ("runes (3 unknown)", "known objects"). */
  readonly title: string;
  /** How many entries the category lists. The game greys a category at 0 where it has a gate. */
  readonly count: number;
}

export interface KnowledgeEntryView {
  /** Stable within the category for the session: pass it to `recall`. */
  readonly id: string;
  readonly name: string;
  /** CSS colour the game draws the name in. */
  readonly color: string;
  /** Extra fields the game prints after the name: a rune's note, a monster's symbol, kills and "Full". */
  readonly cells?: readonly { readonly text: string; readonly color: string }[];
}

export interface KnowledgeGroupView {
  readonly name: string;
  readonly entries: readonly KnowledgeEntryView[];
}

export interface KnowledgeListView {
  readonly title: string;
  readonly groups: readonly KnowledgeGroupView[];
}

export interface ModKnowledge {
  categories(): readonly KnowledgeCategoryView[];
  /** The known members of one category, grouped as the game groups them. Null for an unknown category id. */
  list(category: string): KnowledgeListView | null;
  /**
   * The recall page for one entry, as the game shows it. Null when the id is not
   * in the category's current list: an entry the player does not know yet has no
   * page to read. A monster's page grows as its lore does, so read it again after
   * the snapshot changes rather than keeping an old one.
   */
  recall(category: string, id: string): ScreenView | null;
}

/**
 * One category, as main.ts wires it: the grouped rows, an id for a member, and
 * the recall page. `groups` is called on every read so it always reflects the
 * live game.
 */
export interface KnowledgeCategorySource<T> {
  groups(): { title: string; groups: readonly KnowledgeGroup<T>[] };
  /** `groupName` too, because an ego lists once under each kind of item it can appear on. */
  key(member: T, groupName: string): string;
  recall(member: T, groupName: string): ScreenView;
}

export type KnowledgeSources = {
  readonly [K in KnowledgeCategoryId]?: KnowledgeCategorySource<never>;
};

/**
 * Run `read` and put the game's random stream back exactly as it was. A quick
 * (LCRNG) generator carries only its value, and setState would switch it to
 * the WELL stream, so that mode restores through reseed instead.
 */
export function withRngRestored<T>(rng: Rng | undefined, read: () => T): T {
  if (!rng) return read();
  const saved = rng.getState();
  try {
    return read();
  } finally {
    if (saved.quick) rng.reseed(saved.value);
    else rng.setState(saved);
  }
}

function entryOf<T>(source: KnowledgeCategorySource<T>, row: KnowledgeRow<T>, groupName: string): KnowledgeEntryView {
  return Object.freeze({
    id: source.key(row.member, groupName),
    name: row.label,
    color: row.color,
    ...(row.cells && row.cells.length > 0
      ? { cells: Object.freeze(row.cells.map((c) => Object.freeze({ text: c.text, color: c.color }))) }
      : {}),
  });
}

function isCategory(id: string): id is KnowledgeCategoryId {
  return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(id);
}

export function createModKnowledge(
  sources: KnowledgeSources,
  rng: () => Rng | undefined,
): ModKnowledge {
  const sourceOf = (id: string): KnowledgeCategorySource<unknown> | undefined =>
    isCategory(id) ? (sources[id] as KnowledgeCategorySource<unknown> | undefined) : undefined;

  const listOf = (source: KnowledgeCategorySource<unknown>): KnowledgeListView => {
    const { title, groups } = source.groups();
    return Object.freeze({
      title,
      /* A group with no known members is left out, as the game's browser
       * leaves it out of its group column. */
      groups: Object.freeze(
        groups
          .filter((g) => g.rows.length > 0)
          .map((g) => Object.freeze({
            name: g.name,
            entries: Object.freeze(g.rows.map((row) => entryOf(source, row, g.name))),
          })),
      ),
    });
  };

  return Object.freeze({
    categories: () =>
      Object.freeze(
        KNOWLEDGE_CATEGORIES.filter((id) => sources[id]).map((id) => {
          const view = listOf(sourceOf(id)!);
          const count = view.groups.reduce((n, g) => n + g.entries.length, 0);
          return Object.freeze({ id, title: view.title, count });
        }),
      ),
    list: (category: string) => {
      const source = sourceOf(category);
      return source ? listOf(source) : null;
    },
    recall: (category: string, id: string) => {
      const source = sourceOf(category);
      if (!source) return null;
      for (const group of source.groups().groups) {
        for (const row of group.rows) {
          if (source.key(row.member, group.name) !== id) continue;
          return withRngRestored(rng(), () => source.recall(row.member, group.name));
        }
      }
      return null;
    },
  });
}

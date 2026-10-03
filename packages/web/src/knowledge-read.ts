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
import type { KnowledgeCategoryId, KnowledgeEntryView, KnowledgeListView, ModKnowledge } from "@rpgm-tools/neo-angband-core";
export type { KnowledgeCategoryId, KnowledgeCategoryView, KnowledgeEntryView, KnowledgeGroupView, KnowledgeListView, ModKnowledge } from "@rpgm-tools/neo-angband-core";

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
    known: row.known ?? true,
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

/**
 * The stash MODEL: what the orphans store looks like to a player
 * (MOD_LIFECYCLE.md decisions 7 and 8).
 *
 * `save-blocks.ts` owns the storage half. An entity whose defining pack is
 * absent is frozen verbatim into `orphans:<id>@<version>` with its content id
 * and its group / equipment-slot relationships intact, and reinstalling the
 * pack rehydrates it exactly where it was. That half is complete, tested, and
 * invisible: a player who uninstalls a mod watches their items disappear from
 * the pack with nothing anywhere saying where they went.
 *
 * This module is the other half's DATA. It reads the store and answers the
 * three questions decision 7's stash view asks - what is set aside, which mod
 * owned it, and what would bring it back - as a structure a front end renders.
 * The wording is deliberately NOT here: a screen owns its own sentences, the
 * same split `screens.ts` keeps against the core's UI models.
 *
 * READ-ONLY, AND THAT IS THE DESIGN. Nothing in this file writes to a store or
 * to a save. `purgeOrphans` is the single exception decision 8 requires, and it
 * is a pure function that returns an empty store rather than editing one, so
 * the caller's own assignment is the only mutation and it happens in one place.
 *
 * WHAT IT CANNOT SAY. Quarantine is keyed on namespace PRESENCE, so the store
 * records that `frost` was missing and never why. This module therefore derives
 * the reason from what the host can see NOW - the pack is not installed, or it
 * is installed and switched off - rather than reading a reason the store does
 * not carry. A caller that knows neither gets `"unknown"`, which is honest,
 * where guessing "uninstalled" would not be. The SHADOWED case (a later mod's
 * `removes`/`replaces` overriding a record the save depends on) reaches the same
 * store by the same route the moment quarantine learns to produce it; it needs
 * nothing here, because a shadowed entity's namespace is present and this
 * already has a state for that.
 */

import { namespaceOf, orphanCount } from "./save-blocks.js";
import type { OrphanEntry, OrphanKind, OrphanStore } from "./save-blocks.js";

/* ------------------------------------------------------------------ *
 * Categories: what a quarantined entity WAS, in the player's terms.
 * ------------------------------------------------------------------ */

/**
 * What one quarantined entity is, as a player would name it.
 *
 * A category rather than a re-spelling of `OrphanKind`, because two kinds can
 * be the same thing to a player (`gearObject` in an equipment slot and one in
 * the pack differ only in where they were) and one kind can be two things
 * (`gearObject` is exactly that case). `link` is the one that is NOT a thing
 * the player owns: it is the group bookkeeping quarantine keeps so a mod's
 * monster pack returns as a pack, and a screen that listed those as items would
 * be showing a player a row per internal relationship.
 */
export type OrphanCategory =
  | "worn"
  | "carried"
  | "floor"
  | "held"
  | "monster"
  | "trap"
  | "lore"
  | "artifact"
  | "cached"
  | "link";

/** Whether a `gearObject` orphan was quarantined out of an equipment slot. */
function wasWorn(entry: OrphanEntry): boolean {
  const locus = entry.locus;
  if (typeof locus !== "object" || locus === null || Array.isArray(locus)) return false;
  const slots = (locus as { equipSlots?: unknown }).equipSlots;
  return Array.isArray(slots) && slots.length > 0;
}

/** The player-facing category of one quarantined entity. */
export function orphanCategory(entry: OrphanEntry): OrphanCategory {
  switch (entry.kind) {
    case "gearObject":
      return wasWorn(entry) ? "worn" : "carried";
    case "heldObject":
      return "held";
    case "floorObject":
      return "floor";
    case "monster":
      return "monster";
    case "trap":
      return "trap";
    case "lore":
      return "lore";
    case "artifactCreated":
      return "artifact";
    /* The frozen-level cache (birth_levels_persist): a level the player has
     * been to and can return to, which is one fact rather than four. */
    case "cacheMonster":
    case "cacheHeldObject":
    case "cacheFloorObject":
    case "cacheTrap":
      return "cached";
    case "group":
    case "groupMembership":
    case "cacheGroup":
    case "cacheGroupMembership":
      return "link";
  }
}

/* ------------------------------------------------------------------ *
 * The model.
 * ------------------------------------------------------------------ */

/** One quarantined entity, as the stash view lists it. */
export interface OrphanStashItem {
  /** The storage kind, for a presenter that wants the exact collection. */
  readonly kind: OrphanKind;
  /** What it is to a player. See `OrphanCategory`. */
  readonly category: OrphanCategory;
  /** The content id that could not resolve, e.g. `frost:ice-brand`. */
  readonly ref: string;
  /**
   * The id with its namespace stripped, e.g. `ice-brand`.
   *
   * The BEST NAME THERE IS, and worth saying why it is not a real one. A frozen
   * object carries its `kindId` and nothing else - the record that would give it
   * a printable name came from the mod, which is the thing that is missing - so
   * `describeObject` has nothing to work from. The id is what the player has,
   * and it is what `OrphanEntry.ref` was documented to be for.
   */
  readonly name: string;
}

/**
 * Whether the mod that owns a group of orphans can be found on this machine.
 *
 * `absent` and `disabled` are different sentences to a player: one needs a
 * download and the other needs a switch. `present` means the pack composed and
 * the entity still could not be put back, which `rehydrateSave` reports by
 * leaving the entry in the store rather than by throwing.
 */
export type OrphanAvailability = "absent" | "disabled" | "present" | "unknown";

/** Everything quarantined under one pack, at the version the save used. */
export interface OrphanStashGroup {
  /** The store's own key, `<namespace>@<version>`. */
  readonly key: string;
  /** The pack that owned this content, e.g. `frost`. */
  readonly namespace: string;
  /** The version that pack was at when the save was written. */
  readonly version: string;
  /** What the host can see of that pack right now. */
  readonly availability: OrphanAvailability;
  /** The entities, in store order (which is quarantine order). */
  readonly items: readonly OrphanStashItem[];
  /**
   * How many `link` entries this group carries, counted rather than listed.
   *
   * Counted BECAUSE the count is the honest number and the rows are not: these
   * are monster-group relationships, one per member of every quarantined pack,
   * so a mod with a dozen monsters in groups would fill the screen with rows a
   * player cannot act on. `total` below is what decision 8's prompt counts, and
   * it includes these, so the screen and the prompt cannot disagree.
   */
  readonly links: number;
  /** `items.length + links` - every entry under this key. */
  readonly total: number;
}

/** The whole stash: every pack with something quarantined under it. */
export interface OrphanStash {
  /** Groups sorted by namespace then version, so the screen is stable. */
  readonly groups: readonly OrphanStashGroup[];
  /** Every entry in the store, matching `orphanCount`. */
  readonly total: number;
}

/** What the host knows about the packs it can see. All optional. */
export interface OrphanStashDeps {
  /** Namespaces whose content composed into the running game. */
  readonly present?: ReadonlySet<string>;
  /** Namespaces installed on this machine, whether or not they are enabled. */
  readonly installed?: ReadonlySet<string>;
}

/**
 * Split a store key back into the namespace and version that made it.
 *
 * The FIRST `@` is the separator, which is what `rehydrateSave` already treats
 * as the separator when it decides whether a key's pack is present. A namespace
 * cannot contain one, so the two can only disagree on a version that does, and
 * disagreeing there would mean this screen naming a pack that rehydrate would
 * never match.
 */
export function parseOrphanKey(key: string): { namespace: string; version: string } {
  const at = key.indexOf("@");
  if (at <= 0) return { namespace: key, version: "" };
  return { namespace: key.slice(0, at), version: key.slice(at + 1) };
}

function availabilityOf(namespace: string, deps: OrphanStashDeps): OrphanAvailability {
  const { present, installed } = deps;
  if (present?.has(namespace)) return "present";
  if (installed?.has(namespace)) return "disabled";
  /* Absent is a claim, so it needs evidence: a caller that supplied neither set
   * knows nothing about this pack and must not be reported as having looked. */
  if (present === undefined && installed === undefined) return "unknown";
  return "absent";
}

function itemOf(entry: OrphanEntry): OrphanStashItem {
  const namespace = namespaceOf(entry.ref);
  return {
    kind: entry.kind,
    category: orphanCategory(entry),
    ref: entry.ref,
    name:
      namespace !== null && entry.ref.startsWith(`${namespace}:`)
        ? entry.ref.slice(namespace.length + 1)
        : entry.ref,
  };
}

/**
 * The stash view's model: every quarantined entity, grouped by the pack that
 * owned it, with what the host can currently see of that pack.
 *
 * Pure and total. An empty or absent store gives an empty stash rather than
 * null, so a caller renders "nothing is set aside" from the same value it
 * renders a full list from.
 */
export function orphanStash(
  store: OrphanStore | undefined,
  deps: OrphanStashDeps = {},
): OrphanStash {
  const groups: OrphanStashGroup[] = [];
  for (const [key, entries] of Object.entries(store ?? {})) {
    const { namespace, version } = parseOrphanKey(key);
    const items: OrphanStashItem[] = [];
    let links = 0;
    for (const entry of entries) {
      if (orphanCategory(entry) === "link") links++;
      else items.push(itemOf(entry));
    }
    groups.push({
      key,
      namespace,
      version,
      availability: availabilityOf(namespace, deps),
      items,
      links,
      total: items.length + links,
    });
  }
  groups.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.version.localeCompare(b.version));
  return { groups, total: orphanCount(store) };
}

/* ------------------------------------------------------------------ *
 * Decision 8: the one-time keep/purge question.
 * ------------------------------------------------------------------ */

/**
 * Whether the one-time per-save keep/purge prompt is due (decision 8).
 *
 * Due exactly once: something is quarantined and this save has not been asked
 * yet. Keeping is the default and answering either way sets `acknowledged`, so
 * a player who declines is never nagged and a save that later quarantines more
 * content is not re-asked - which is what "one-time per-save" means.
 */
export function orphanPromptDue(
  store: OrphanStore | undefined,
  acknowledged: boolean,
): boolean {
  return !acknowledged && orphanCount(store) > 0;
}

/**
 * Decision 8's purge: every quarantined entity, gone permanently.
 *
 * A pure function returning the EMPTY store rather than one that empties the
 * caller's, so the only write is the caller's own assignment. That matters more
 * than it looks: this is the one destructive act in the whole orphan path, and
 * the guarantee it breaks - nothing a player earned vanishes without a trace -
 * is only allowed to break behind an explicit, counted, one-time confirmation.
 * Quarantine remains the default; nothing calls this without an answer.
 */
export function purgeOrphans(): OrphanStore {
  return {};
}

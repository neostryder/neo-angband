/**
 * The stash view (MOD_LIFECYCLE.md decision 7) and the one-time keep/purge
 * question (decision 8): the player-facing half of the quarantine store.
 *
 * Core freezes an entity whose defining pack is absent into
 * `orphans:<id>@<version>` and puts it back, in the slot it came out of, the
 * moment that pack returns. Until this screen existed none of that was visible:
 * uninstalling a mod removed items from the pack with nothing anywhere saying
 * they still existed, so the "nothing a player earned vanishes without a trace"
 * guarantee was true of the save file and false of the game.
 *
 * READ-ONLY BY DEFAULT. This screen lists and explains; it does not edit the
 * store. There are two writes and both are behind a counted confirmation -
 * decision 8's one-time, all-or-nothing keep/purge prompt (`orphanPurgeMenu`)
 * and the per-item permanent delete added for issue 76 (`deleteOrphanItem`,
 * `deleteOrphanConfirmMenu`), so a deletion always names the thing it takes and
 * says out loud that the taking is forever.
 *
 * THE MODEL IS CORE'S (`orphanStash`, mod/orphan-stash.ts) and the WORDING is
 * here, the same split `screens.ts` keeps against the core's UI models: core
 * answers what is set aside, which pack owned it, and whether that pack can be
 * found now; this file turns those three into sentences.
 *
 * WHY THE ITEM NAMES ARE IDS. A frozen object carries its `kindId` and nothing
 * else, because the record that would give it a printable name came from the
 * mod that is missing. `describeObject` therefore has nothing to work from, and
 * the id is the best name there is. It is also the name the player will type
 * into a search when they go looking for the mod again, which is the action
 * this screen exists to enable.
 */

import {
  orphanStash,
  t,
  type OrphanAvailability,
  type OrphanCategory,
  type OrphanStash,
  type OrphanStashGroup,
  type OrphanStashItem,
  type OrphanStore,
} from "@rpgm-tools/neo-angband-core";
import {
  freezeView,
  SCREEN_FOOTER,
  type ScreenBlock,
  type ScreenView,
} from "./screen-view";
import { selectFromMenu, showTextScreen, type MenuItem, type ScreenLine } from "./overlay";
import type { GridPointerInput, GridSurface } from "./term";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_GOOD, UI_BAD } from "./ui-colors";

const C_FG = UI_TEXT;
const C_DIM = UI_DIM;
const C_WARN = UI_GOLD;
const C_GOOD = UI_GOOD;
const C_DANGER = UI_BAD;

/** What the mod manager and the boot prompt read to build this screen. */
export interface OrphanViewDeps {
  /** The live game's quarantine store. */
  store: () => OrphanStore | undefined;
  /** Namespaces whose content composed into the running game (pack.ts). */
  present?: () => ReadonlySet<string>;
  /** Namespaces installed on this machine, enabled or not. */
  installed?: () => ReadonlySet<string>;
  /**
   * Apply a new quarantine store. The host handles the game-side write and the
   * save: `viewOrphanStash` only computes the next store, the same way
   * `offerOrphanChoice` only calls `purgeOrphans` and lets the host assign.
   *
   * Absent on read-only callers (the boot prompt, anything showing the stash
   * without intending to let the player edit it). When it is missing,
   * `viewOrphanStash` falls back to the same one-way display the screen used
   * to be, so an older host does not silently lose the delete affordance.
   *
   * `next` is always an `OrphanStore`, possibly empty - the same shape
   * `purgeOrphans` returns and the same one the running game's `orphans` slot
   * keeps, so the host does not have to reconcile undefined with its own
   * type.
   */
  setStore?: (next: OrphanStore) => void;
}

/** Build the core model from whatever the host can currently see. */
export function stashOf(deps: OrphanViewDeps): OrphanStash {
  return orphanStash(deps.store(), {
    ...(deps.present ? { present: deps.present() } : {}),
    ...(deps.installed ? { installed: deps.installed() } : {}),
  });
}

/* ------------------------------------------------------------------ *
 * Wording.
 * ------------------------------------------------------------------ */

/** Where one quarantined entity was when its mod went away. */
export function categoryText(category: OrphanCategory): string {
  switch (category) {
    case "worn":
      return t("orphans.where.worn", "you were wearing it");
    case "carried":
      return t("orphans.where.carried", "you were carrying it");
    case "held":
      return t("orphans.where.held", "a monster was carrying it");
    case "floor":
      return t("orphans.where.floor", "it was on the floor");
    case "monster":
      return t("orphans.where.monster", "it was on the level with you");
    case "trap":
      return t("orphans.where.trap", "it was a trap on the level");
    case "lore":
      return t("orphans.where.lore", "what you had learned about it");
    case "artifact":
      return t("orphans.where.artifact", "this game had already made it");
    case "cached":
      return t("orphans.where.cached", "it was on a level you had left");
    case "link":
      return t("orphans.where.link", "it kept a monster pack together");
  }
}

/** Why everything under one pack is inert right now. */
export function whyInert(group: OrphanStashGroup): string {
  const mod = group.namespace;
  switch (group.availability) {
    case "absent":
      return t("orphans.why.absent", "{mod} is not installed.", { mod });
    case "disabled":
      return t("orphans.why.disabled", "{mod} is installed but switched off.", { mod });
    case "present":
      return t(
        "orphans.why.present",
        "{mod} is loaded, but the game could not put these back where they were.",
        { mod },
      );
    case "unknown":
      return t("orphans.why.unknown", "{mod} did not load with this character.", { mod });
  }
}

/** What would bring everything under one pack back. */
export function howToRestore(group: OrphanStashGroup): string {
  const mod = group.namespace;
  const version = group.version;
  switch (group.availability) {
    case "disabled":
      return t(
        "orphans.restore.disabled",
        "Turn {mod} back on in Mods, and every one of these returns to where it was.",
        { mod },
      );
    case "present":
      return t(
        "orphans.restore.present",
        "They stay here, untouched, until {mod} can place them again.",
        { mod },
      );
    case "absent":
    case "unknown":
      return version
        ? t(
            "orphans.restore.absent",
            "Install {mod} again (this character was played with {mod} {version}) and every one of these returns to where it was.",
            { mod, version },
          )
        : t(
            "orphans.restore.absentNoVersion",
            "Install {mod} again, and every one of these returns to where it was.",
            { mod },
          );
  }
}

function availabilityColor(availability: OrphanAvailability): string {
  return availability === "present" ? C_GOOD : C_WARN;
}

/** "frost 1.2.0 - 7 things set aside", the caption over one pack's table. */
export function groupCaption(group: OrphanStashGroup): string {
  const mod = group.version ? `${group.namespace} ${group.version}` : group.namespace;
  return t("orphans.group.caption", "{mod} - {count, plural, one {# thing} other {# things}} set aside", {
    mod,
    count: group.total,
  });
}

/**
 * The mods-menu row.
 *
 * It carries the COUNT, unlike the mod-updates row beside it, and for the
 * opposite reason: this number is a local read of the save the player already
 * has open, not a question that costs a request per mod. A player whose items
 * vanished needs to see that something is being held before they open anything.
 */
export function orphanRowLabel(total: number): string {
  return total === 0
    ? t("orphans.row.none", "Set aside by a missing mod...")
    : t("orphans.row.some", "Set aside by a missing mod...  {count, plural, one {# thing} other {# things}}", {
        count: total,
      });
}

/* ------------------------------------------------------------------ *
 * The screen.
 * ------------------------------------------------------------------ */

function itemRow(group: OrphanStashGroup, item: OrphanStashItem, index: number) {
  return {
    id: `${group.key}:${index}:${item.ref}`,
    /* The whole point of the row, published for a presenter: which pack owns
     * it, what the game called it, and what it was doing when the pack left. */
    semantic: {
      kind: "mod-orphan",
      ref: item.ref,
      data: {
        mod: group.namespace,
        version: group.version,
        availability: group.availability,
        storage: item.kind,
        category: item.category,
      },
    },
    color: C_FG,
    cells: {
      name: { text: item.name },
      where: { text: categoryText(item.category), color: C_DIM },
    },
  };
}

/**
 * Everything currently quarantined, grouped by the pack that owned it, with why
 * it is inert and what would restore it (decision 7's third bullet).
 *
 * A TABLE per pack rather than one table over everything, because the pack is
 * the unit of the answer: every row under a caption shares one reason and one
 * fix, and repeating both on every row would bury the list they belong to. The
 * two sentences between tables stay `lines` for the reason `modConflictsScreen`
 * keeps its prose there - they are the screen's own layout, not record data.
 */
export function orphanStashScreen(stash: OrphanStash): ScreenView {
  const blocks: ScreenBlock[] = [];

  if (stash.groups.length === 0) {
    blocks.push({
      kind: "lines",
      lines: [
        {
          text: t(
            "orphans.screen.empty",
            "Nothing is set aside. Every item, monster and level this character has belongs to content the game can still read.",
          ),
          color: C_GOOD,
        },
      ],
    });
  }

  for (const group of stash.groups) {
    blocks.push({
      kind: "table",
      key: group.key,
      tagged: false,
      caption: { text: groupCaption(group), color: availabilityColor(group.availability) },
      columns: [{ key: "name" }, { key: "where", pad: false }],
      rows: group.items.map((item, i) => itemRow(group, item, i)),
      empty: {
        text: t("orphans.group.linksOnly", "(nothing you can name - only the links below)"),
        color: C_DIM,
      },
    });
    const lines: ScreenLine[] = [
      { text: whyInert(group), color: C_FG },
      { text: howToRestore(group), color: C_FG },
    ];
    /* Counted, not listed. These are the monster-group relationships quarantine
     * keeps so a mod's pack comes back as a pack; a row each would be a screen
     * of bookkeeping a player cannot act on, and saying nothing would make this
     * screen's count disagree with the one the purge prompt offers. */
    if (group.links > 0) {
      lines.push({
        text: t(
          "orphans.group.links",
          "Also held: {count, plural, one {# link that keeps} other {# links that keep}} {mod}'s monster packs together.",
          { count: group.links, mod: group.namespace },
        ),
        color: C_DIM,
      });
    }
    lines.push({ text: "", color: C_DIM });
    blocks.push({ kind: "lines", lines });
  }

  if (stash.total > 0) {
    blocks.push({
      kind: "lines",
      lines: [
        {
          text: t(
            "orphans.screen.safe",
            "None of this is lost and none of it is in your way: it takes no pack slot, no weight and no home slot while it waits.",
          ),
          color: C_DIM,
        },
      ],
    });
  }

  return freezeView({
    id: "core:mod-orphans",
    title: t("orphans.screen.title", "Set aside by a missing mod"),
    footer: stash.total > 0 ? stashActionsFooter() : SCREEN_FOOTER,
    /* The screen publishes NO actions: the interactive delete flow lives in
     * `viewOrphanStash`, which drives `showTextScreen`/`selectFromMenu`
     * directly and never goes through `ScreenHost.invoke`. The footer
     * carries the prompt so a player still sees there is something to do;
     * the action's existence is local to the loop, not a property of the
     * view itself. The prompt-census tripwire in screens.test.ts is
     * exactly what makes that distinction visible. */
    blocks,
  });
}

/**
 * Footer that tells the player there is something to act on and what the
 * follow-up menu's first row is. Plain prose, not a model property.
 */
export function stashActionsFooter(): string {
  return t("orphans.screen.actions", "[ Any key: return to Mods ]");
}

/* ------------------------------------------------------------------ *
 * Decision 8: the one-time keep/purge question.
 * ------------------------------------------------------------------ */

/** The read shown above the keep/purge choice. */
export function orphanPurgeLines(stash: OrphanStash): ScreenLine[] {
  const mods = stash.groups.map((g) => g.namespace).join(", ");
  return [
    {
      text: t(
        "orphans.purge.body1",
        "{count, plural, one {# thing from this character has} other {# things from this character have}} been set aside, because the content that defined {count, plural, one {it} other {them}} is not loaded: {mods}.",
        { count: stash.total, mods },
      ),
      color: C_WARN,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "orphans.purge.body2",
        "Nothing has been destroyed. It is frozen in your save, costs you nothing, and comes straight back if the content returns.",
      ),
      color: C_FG,
    },
    {
      text: t(
        "orphans.purge.body3",
        "You are asked this once for this character. Keeping is the answer if you are not sure - it can be undone and throwing them away cannot.",
      ),
      color: C_FG,
    },
  ];
}

/** The keep/purge rows. Keep is first, so the default answer is the safe one. */
export function orphanPurgeMenu(stash: OrphanStash): MenuItem[] {
  return [
    {
      label: t("orphans.purge.keep", "Keep them frozen"),
      color: C_GOOD,
      hint: t("orphans.purge.keepHint", "They wait in your save until the content that made them is back."),
    },
    {
      label: t("orphans.purge.purge", "Throw away {count, plural, one {# thing} other {all # things}}, permanently", {
        count: stash.total,
      }),
      color: C_DANGER,
      hint: t("orphans.purge.purgeHint", "They are gone from the save for good. Reinstalling the content will not bring them back."),
    },
  ];
}

/** The title over the keep/purge choice. */
export function orphanPurgeTitle(): string {
  return t("orphans.purge.title", "Content set aside from this character");
}

/** The footer under the keep/purge read. */
export function orphanPurgeFooter(): string {
  return t("orphans.purge.footer", "[ Press ESC to read on, then choose ]");
}

/** The line said after keeping, so the answer is visibly recorded. */
export function orphanKeptMessage(total: number): string {
  return t(
    "orphans.kept",
    "{count, plural, one {# thing stays} other {# things stay}} frozen in your save. Mods, then Set aside, lists them.",
    { count: total },
  );
}

/** The line said after purging, naming what is gone and that it is gone. */
export function orphanPurgedMessage(total: number): string {
  return t(
    "orphans.purged",
    "{count, plural, one {# thing was} other {# things were}} thrown away permanently.",
    { count: total },
  );
}

/* ------------------------------------------------------------------ *
 * Per-item permanent delete (issue 76, follow-up to decision 8).
 *
 * The one-time prompt is the wrong tool when a player wants to clean out one
 * specific thing: it takes everything or nothing, and a player who wants to
 * discard a single worn piece before trying a different mod has no way to do
 * that short of purging the lot. The action here removes one entry from the
 * store and nothing else, behind the same counted, named confirmation the
 * all-purge path uses, so the "nothing vanishes without a trace" guarantee
 * only bends where the player has clearly chosen.
 *
 * The function is pure and returns the new store, exactly like
 * `purgeOrphans`; the caller's own assignment is the only write. The caller is
 * then responsible for autosave, the same way `offerOrphanChoice` is for purge.
 * ------------------------------------------------------------------ */

/**
 * Permanently delete one entry from the orphans store, returning the new
 * store. The same shape `purgeOrphans` returns (an empty record, never
 * undefined), so the running game's `orphans` slot - which `purgeOrphans`
 * already writes as `{}` rather than as missing - can be assigned directly
 * by the host without a save-side optional to wrestle with.
 *
 * Returns the SAME store unchanged when the requested item is not present, so
 * the caller can detect "nothing changed" with a reference compare and skip
 * autosave on a no-op press. The store is treated as immutable: a shallow copy
 * of the affected key is made before the entry is filtered out, and an empty
 * key is removed entirely so the count kept in `orphanCount` agrees with what
 * the player sees on the stash screen.
 */
export function deleteOrphanItem(
  store: OrphanStore,
  group: OrphanStashGroup,
  item: OrphanStashItem,
): OrphanStore {
  const entries = store[group.key];
  if (!entries) return store;
  const filtered = entries.filter((e) => e.ref !== item.ref);
  /* Same-store return is the no-op signal: either the entry was already gone,
   * or the ref simply never existed in this group. The caller can rely on it
   * to skip the autosave it would otherwise trigger on every confirm. */
  if (filtered.length === entries.length) return store;
  const next: OrphanStore = { ...store };
  if (filtered.length === 0) {
    delete next[group.key];
  } else {
    next[group.key] = filtered;
  }
  return next;
}

/** The read shown above the per-item delete choice, naming the item plainly. */
export function deleteOrphanConfirmLines(item: OrphanStashItem, group: OrphanStashGroup): ScreenLine[] {
  return [
    {
      text: t(
        "orphans.delete.body1",
        "Throw away {name} from {mod} permanently?",
        { name: item.name, mod: group.namespace },
      ),
      color: C_WARN,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "orphans.delete.body2",
        "It came from {mod}, and removing it deletes it from this save. Reinstalling the mod will not bring it back.",
        { mod: group.namespace },
      ),
      color: C_FG,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "orphans.delete.body3",
        "Nothing else is touched. The rest of {mod}'s things stay frozen in your save.",
        { mod: group.namespace },
      ),
      color: C_DIM,
    },
  ];
}

/** The choice offered after the read: keep it (the default) or throw it away. */
export function deleteOrphanConfirmMenu(): MenuItem[] {
  return [
    {
      label: t("orphans.delete.keep", "Keep it"),
      color: C_GOOD,
      hint: t("orphans.delete.keepHint", "It stays frozen until the mod that made it is back."),
    },
    {
      label: t("orphans.delete.throw", "Throw it away, permanently"),
      color: C_DANGER,
      hint: t("orphans.delete.throwHint", "Gone from the save for good."),
    },
  ];
}

/** Footer under the per-item delete read, mirroring the all-purge copy. */
export function deleteOrphanConfirmFooter(): string {
  return t("orphans.delete.footer", "[ Press ESC to read on, then choose ]");
}

/** Title for the per-item delete confirmation - the item's own name, plain. */
export function deleteOrphanConfirmTitle(item: OrphanStashItem): string {
  return item.name;
}

/** The line said after a successful per-item delete, naming what is gone. */
export function orphanDeletedMessage(item: OrphanStashItem): string {
  return t("orphans.deleted", "{name} was thrown away permanently.", { name: item.name });
}

/* ------------------------------------------------------------------ *
 * The interactive per-item delete flow.
 *
 * `showTextScreen` resolves on any key, so the screen cannot itself tell
 * "press d to throw one away" apart from "press anything to return". The
 * follow-up `selectFromMenu` is what surfaces that affordance: the screen
 * describes what is held, the menu names the only two things a player can
 * then do (return or pick one to delete), and the rest of the flow sits
 * behind the same counted, named confirmation the all-purge path uses.
 *
 * REBUILT EACH ROUND. The stash is rebuilt after every mutation, so what the
 * screen shows on the next iteration is what is actually in the store -
 * a deletion never leaves a stale "1 thing" over an empty list.
 * ------------------------------------------------------------------ */

/**
 * Run the stash view, optionally offering a per-item delete.
 *
 * When `deps.setStore` is missing (read-only callers: the boot prompt, an
 * older host that has not been updated) the function degrades to the same
 * one-way display the stash screen used to be. When it is present the
 * caller picks up the new store and is responsible for the save, exactly
 * the way `offerOrphanChoice` handles `purgeOrphans`.
 */
export async function viewOrphanStash(
  term: GridSurface & GridPointerInput,
  deps: OrphanViewDeps,
): Promise<void> {
  for (;;) {
    const stash = stashOf(deps);
    /* The screen is shown even on the empty store so a player who deleted the
     * last entry still gets the confirmation that the stash is empty - the
     * same "nothing is set aside" prose the open path shows. */
    await showTextScreen(term, orphanStashScreen(stash));
    if (!deps.setStore) return;
    if (stash.total === 0) return;
    const action = await selectFromMenu(
      term,
      "core:mod-orphan-stash-action",
      t("orphans.stash.action.title", "Set aside by a missing mod"),
      [
        {
          label: t("orphans.stash.action.return", "Return to Mods"),
          color: C_FG,
          hint: t("orphans.stash.action.returnHint", "Nothing was changed."),
        },
        {
          label: t("orphans.stash.action.deleteOne", "Throw one thing away..."),
          color: C_DANGER,
          hint: t(
            "orphans.stash.action.deleteOneHint",
            "Permanently delete one item from the stash.",
          ),
        },
      ],
      t(
        "orphans.stash.action.footer",
        "[ Pick an action, or press ESC to return ]",
      ),
    );
    if (action !== 1) return;
    const picked = await pickOrphanItemToDelete(term, stash);
    if (!picked) continue;
    const confirmed = await confirmOrphanDelete(term, picked.group, picked.item);
    if (!confirmed) continue;
    /* The save-side store may be undefined when the field is absent; the
     * running game always has at least `{}`. Fall back to an empty store so
     * a delete still reduces to "remove this one entry from nothing" - the
     * same-store compare below catches the no-op. */
    const current = deps.store() ?? {};
    const next = deleteOrphanItem(current, picked.group, picked.item);
    /* The same-store return is the no-op signal: either the entry was already
     * gone between the screen build and the confirm (rare, but possible if a
     * rehydrate ran in the gap) or the ref never matched. Skipping the write
     * avoids a save on a delete that destroyed nothing. */
    if (next === current) continue;
    deps.setStore(next);
  }
}

/**
 * Lettered submenu over every item the stash currently holds, so the player
 * picks one by name rather than by table row. The list flattens every pack
 * into one menu; an entry's pack is shown in parentheses next to its name so
 * two items with the same id (rare, but possible when two packs name
 * different things `potion-of-healing`) do not become indistinguishable.
 */
async function pickOrphanItemToDelete(
  term: GridSurface & GridPointerInput,
  stash: OrphanStash,
): Promise<{ group: OrphanStashGroup; item: OrphanStashItem } | null> {
  const flat: { group: OrphanStashGroup; item: OrphanStashItem }[] = [];
  for (const group of stash.groups) {
    for (const item of group.items) flat.push({ group, item });
  }
  if (flat.length === 0) return null;
  const menuItems: MenuItem[] = flat.map(({ group, item }) => ({
    label: `${item.name}  (${categoryText(item.category)}, ${group.namespace})`,
    color: C_FG,
  }));
  const pick = await selectFromMenu(
    term,
    "core:mod-orphan-stash-pick",
    t("orphans.delete.pick.title", "Throw one thing away"),
    menuItems,
    t(
      "orphans.delete.pick.footer",
      "[ Pick a thing, or press ESC to cancel ]",
    ),
  );
  if (pick === null || pick < 0 || pick >= flat.length) return null;
  return flat[pick]!;
}

/**
 * The confirmation step for one item: a read naming the thing and stating
 * permanence, then a counted choice whose default is KEEP. Kept here so the
 * wording stays with the menu and the screen; the loop in `viewOrphanStash`
 * only has to react to whether the destructive row was picked.
 */
async function confirmOrphanDelete(
  term: GridSurface & GridPointerInput,
  group: OrphanStashGroup,
  item: OrphanStashItem,
): Promise<boolean> {
  await showTextScreen(
    term,
    deleteOrphanConfirmTitle(item),
    deleteOrphanConfirmLines(item, group),
    deleteOrphanConfirmFooter(),
  );
  const pick = await selectFromMenu(
    term,
    "core:mod-orphan-stash-confirm",
    t("orphans.delete.confirm.title", "Confirm?"),
    deleteOrphanConfirmMenu(),
    deleteOrphanConfirmFooter(),
  );
  /* 1 is the destructive row by construction (see deleteOrphanConfirmMenu);
   * null is ESC, which the existing keep/purge flow also treats as "the safe
   * answer" so a player who backs out with ESC never destroys anything. */
  return pick === 1;
}

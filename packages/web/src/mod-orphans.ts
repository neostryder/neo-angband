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
 * READ-ONLY, DELIBERATELY. This screen lists and explains; it does not edit the
 * store. The only write in the whole orphan path is decision 8's one-time
 * answer, which is a separate prompt with a counted confirmation behind it -
 * see `orphanPurgeMenu` and main.ts's boot chain.
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
import { freezeView, SCREEN_FOOTER, type ScreenBlock, type ScreenView } from "./screen-view";
import type { MenuItem, ScreenLine } from "./overlay";
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
    footer: SCREEN_FOOTER,
    blocks,
  });
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

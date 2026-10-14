import { classicBrowser, confirmationMod } from "./classic-service";
import { type MenuItem, showTextScreen, screenRegionSpec, selectFromMenu } from "../overlay";
import { type BrowseEntry, type ModBrowseDeps } from "./browse-types";
import { browseRow, browseDetail, aboutLines, sourceLabel } from "./browse-views";
import { t } from "@rpgm-tools/neo-angband-core";
import { C_WARN, C_FG, C_DIM, C_BAD } from "./browse-colors";
import { type GridSurface, type GridPointerInput } from "../term";
import { type ModOrigin } from "../mod-consent";
import { type RepoRef } from "../mod-source";
import { pushRegion, regionSurface, popRegion } from "../ui-stack";
import { showRecommendedActions, askConsent, installOne } from "./classic-browse-install";
import { showModBrowse } from "./classic-browse";
import { confirmCommunityUpdate } from "./classic-update-views";
import { type ModRegistry } from "../mod-curated";

/** The mod rows of one source, and which entry each row shows. */
export interface SourceRows {
  readonly items: MenuItem[];
  /** The entry row `i` shows, or null for a row that is not a mod (the heading). */
  readonly rowEntries: readonly (BrowseEntry | null)[];
  /** Whether row `i` is a community mod, which installs and updates as third-party. */
  readonly rowCommunity: readonly boolean[];
}

/**
 * The curated entries, then the community entries under a "Community mods"
 * heading. With no community entries there is no heading and the rows are the
 * curated ones alone, as they were before community mods existed.
 *
 * The heading is a `disabled` row (the field selectFromMenu skips) with no tag
 * letter, so the cursor and the letter keys pass over it.
 */
export function sourceRows(
  curated: readonly BrowseEntry[],
  community: readonly BrowseEntry[],
  installedTag: (entry: BrowseEntry) => string | null,
): SourceRows {
  const items: MenuItem[] = [];
  const rowEntries: (BrowseEntry | null)[] = [];
  const rowCommunity: boolean[] = [];
  for (const e of curated) {
    items.push(browseRow(e, installedTag(e)));
    rowEntries.push(e);
    rowCommunity.push(false);
  }
  if (community.length > 0) {
    items.push({
      label: t("modBrowse.source.communityHeading", "Community mods"),
      color: C_WARN,
      disabled: true,
      tag: "",
    });
    rowEntries.push(null);
    rowCommunity.push(false);
    for (const e of community) {
      items.push(browseRow(e, installedTag(e)));
      rowEntries.push(e);
      rowCommunity.push(true);
    }
  }
  return { items, rowEntries, rowCommunity };
}

/**
 * Show one source's mods, discovering each as the list is built.
 *
 * Discovery is per repository and the results are kept for the life of this screen:
 * a list of twenty mods is twenty pairs of API calls, and rebuilding it every time a
 * player presses ESC out of a detail pane would spend a rate limit on nothing.
 */
export async function showSource(
  term: GridSurface & GridPointerInput,
  title: string,
  origin: ModOrigin,
  refs: readonly RepoRef[],
  communityRefs: readonly RepoRef[],
  problems: readonly string[],
  deps: ModBrowseDeps,
): Promise<boolean> {
  let changed = false;
  const authors = await deps.authors();

  if (refs.length === 0 && communityRefs.length === 0) {
    await showTextScreen(term, title, [
      {
        text: t("modBrowse.source.empty", "This list names no mods this game can install."),
        color: C_FG,
      },
      { text: "", color: C_FG },
      ...problems.map((p) => ({ text: `  ${p}`, color: C_WARN })),
    ]);
    return false;
  }

  /* A REGION for the length of the discovery round (#253): one pair of API calls
   * per repository, so this screen can be up for many seconds. */
  const handle = pushRegion(screenRegionSpec(), term.size());
  const waiting = regionSurface(term, handle.cells);
  waiting.clear();
  waiting.print(0, 1, title, C_FG);
  waiting.print(
    0,
    3,
    t("modBrowse.source.asking", "Asking {count} repositories what they hold...", {
      count: refs.length + communityRefs.length,
    }),
    C_DIM,
  );
  waiting.flush?.();

  const entries: BrowseEntry[] = [];
  const communityEntries: BrowseEntry[] = [];
  try {
    for (const ref of refs) entries.push(await deps.discover(ref));
    for (const ref of communityRefs) communityEntries.push(await deps.discover(ref));
  } finally {
    /* Popped even when a discovery throws: the menu below never runs in that
     * case, and a wait screen that outlives its wait is a phantom occluder. */
    popRegion(handle);
  }

  for (;;) {
    const installed = await deps.installed();
    const { items, rowEntries, rowCommunity } = sourceRows(entries, communityEntries, (e) =>
      e.ok ? (installed.get(e.mod.id) ?? null) : null,
    );
    const recommendedActionsAt = origin === "curated" ? items.length : -1;
    if (recommendedActionsAt >= 0) {
      items.push({
        label: t("modBrowse.recommended.actionsRow", "Recommended mod actions..."),
        color: C_WARN,
        hint: t(
          "modBrowse.recommended.actionsRowHint",
          "Install, update, or enable the whole recommended set without repeating each mod's menu.",
        ),
      });
    }
    const otherSourcesAt = origin === "curated" ? items.length : -1;
    if (otherSourcesAt >= 0) {
      items.push({
        label: t("modBrowse.source.otherSources", "Get a mod another way..."),
        color: C_DIM,
        hint: t(
          "modBrowse.source.otherSourcesHint",
          "A registry, one repository, or a file. These can need third-party-mod consent.",
        ),
      });
    }
    const aboutAt = items.length;
    items.push({
      label: t("modBrowse.common.whatIsThis", "What is this?"),
      color: C_DIM,
      hint: t("modBrowse.source.whatIsThisHint", "Where these come from."),
    });
    const problemsAt = problems.length > 0 ? items.length : -1;
    if (problems.length > 0) {
      items.push({
        label: t(
          "modBrowse.source.unreadableCount",
          "{count} entry(s) in this list could not be read",
          { count: problems.length },
        ),
        color: C_WARN,
        hint: t(
          "modBrowse.source.unreadableHint",
          "A problem with the list itself, not with your setup.",
        ),
      });
    }

    const pick = await selectFromMenu(
      term,
      "core:mod-browse",
      title,
      items,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
      {
        detail: (i) => {
          const e = rowEntries[i];
          if (!e) return [];
          /* The REAL width, asked at paint time. The pane is resizable and the
           * function's default is only there so the pure tests need no terminal. */
          const width = Math.max(20, term.size().cols - 2);
          return browseDetail(
            e,
            e.ok ? (installed.get(e.mod.id) ?? null) : null,
            authors,
            width,
          );
        },
        detailToggleKey: "?",
        detailInitiallyShown: true,
      },
    );
    if (pick === null) return changed;

    if (pick === recommendedActionsAt) {
      /* The first-party entries only. Installing every community mod in one
       * action would install code by several authors without a look at any of
       * them, so each community mod is installed from its own row. */
      if (await showRecommendedActions(term, entries, deps)) changed = true;
      continue;
    }
    if (pick === otherSourcesAt) {
      if (await showModBrowse(term, deps)) changed = true;
      continue;
    }
    if (pick === aboutAt) {
      await showTextScreen(term, title, aboutLines());
      continue;
    }
    if (pick === problemsAt) {
      await showTextScreen(term, title, [
        {
          text: t("modBrowse.source.unreadableList", "These entries are in the list and are not offered:"),
          color: C_FG,
        },
        { text: "", color: C_FG },
        ...problems.map((p) => ({ text: `  ${p}`, color: C_WARN })),
      ]);
      continue;
    }

    const entry = rowEntries[pick];
    if (!entry) continue;
    if (!entry.ok) {
      await showTextScreen(term, entry.ref.repo, browseDetail(entry, null, authors));
      continue;
    }
    if (!entry.mod.compatible) {
      /* Refused BEFORE the action menu, not after it. Offering "Install" on a mod
       * that cannot run and failing afterwards wastes a download and reads as a bug. */
      const checked = entry.mod.versionsChecked ?? 1;
      await showTextScreen(term, entry.mod.name, [
        {
          text: t("modBrowse.incompatible.wontRun", "{name} will not run on this version of the game.", {
            name: entry.mod.name,
          }),
          color: C_BAD,
        },
        { text: "", color: C_FG },
        {
          text:
            entry.mod.engineNote ??
            t("modBrowse.incompatible.needsEngine", "It needs engine {engine}.", {
              engine: entry.mod.engine ?? "?",
            }),
          color: C_WARN,
        },
        { text: "", color: C_FG },
        /* Said out loud, because the alternative reads as "the game did not even
         * look". It did: discovery walks back through a mod's versions and offers
         * the newest one that runs, so reaching this screen means none of them
         * does - which is a different situation, and different advice. */
        {
          text:
            checked > 1
              ? t(
                  "modBrowse.incompatible.checkedNone",
                  "The last {count} versions of it were checked, and none of them runs here.",
                  { count: checked },
                )
              : t("modBrowse.incompatible.noOlder", "No older version of it was available to try."),
          color: C_DIM,
        },
        { text: "", color: C_FG },
        {
          text: t("modBrowse.incompatible.updateGame", "Updating the game may be all it needs."),
          color: C_DIM,
        },
      ]);
      continue;
    }

    const at = installed.get(entry.mod.id) ?? null;
    const actions: MenuItem[] =
      at === null
        ? [
            {
              /* The detail pane is already visible before this action is chosen,
               * so this is an explicit decision to install AND stage this one
               * mod for the next reload. It replaces the old second, generic
               * "turn it on now?" question. Plugin capabilities, declared
               * conflicts, and the no-score warning remain their own gates
               * after the verified files have been stored and before anything
               * can run. */
              label: t("modBrowse.actions.installEnable", "Install and enable {version}", { version: entry.mod.version }),
              color: C_FG,
              hint: t(
                "modBrowse.actions.installEnableHint",
                "Download, check, and turn it on for the next reload. Permissions are still asked separately.",
              ),
            },
            {
              label: t("modBrowse.actions.installOnly", "Install only {version}", { version: entry.mod.version }),
              color: C_DIM,
              hint: t(
                "modBrowse.actions.installOnlyHint",
                "Download and check it, but leave it off.",
              ),
            },
          ]
        : at === entry.mod.tag
          ? [
              {
                label: t("modBrowse.actions.reinstall", "Reinstall"),
                color: C_FG,
                hint: t("modBrowse.actions.reinstallHint", "Download it again."),
              },
              {
                label: t("modBrowse.actions.remove", "Remove"),
                color: C_BAD,
                hint: t("modBrowse.actions.removeHint", "Delete its files."),
              },
            ]
          : [
              {
                label: t("modBrowse.actions.changeTo", "Change to {version}", { version: entry.mod.version }),
                color: C_WARN,
                hint: t("modBrowse.actions.youHave", "You have {tag}.", { tag: at }),
              },
              {
                label: t("modBrowse.actions.remove", "Remove"),
                color: C_BAD,
                hint: t("modBrowse.actions.removeHint", "Delete its files."),
              },
            ];

    const what = await classicBrowser(deps).core.drawConfirmation({ operation: at === null ? "install" : "update", mods: [confirmationMod(entry.mod)] }, () => selectFromMenu(
      term,
      "core:mod-browse-actions",
      entry.mod.name,
      actions,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    ));
    if (what === null) continue;
    if (at !== null && what === 1) {
      const gone = await classicBrowser(deps).core.removeConfirmed(entry.mod.id);
      changed = changed || gone;
      await showTextScreen(term, entry.mod.name, [
        gone
          ? { text: t("modBrowse.actions.removed", "{name} removed.", { name: entry.mod.name }), color: C_FG }
          : {
              text: t("modBrowse.actions.removeFailed", "{name} could not be removed.", {
                name: entry.mod.name,
              }),
              color: C_BAD,
            },
        { text: "", color: C_FG },
        { text: t("modBrowse.actions.reloadToStop", "Reload to stop loading it."), color: C_FG },
      ]);
      continue;
    }
    /* A community row is third-party whatever list it sits on: listing it is not
     * the maintainer vouching for it, so the player opts in to its code the same
     * way as to a repository typed into door 3. The disclaimer is offered here,
     * when the player has chosen to install, rather than as a bare refusal from
     * the installer, which checks the same origin again. */
    const community = rowCommunity[pick] === true;
    if (community && !deps.consent.read() && !(await askConsent(term, deps))) continue;
    /* Replacing an installed community mod, by "Change to" or "Reinstall", is
     * asked about by name and version first, the same question every update path
     * asks (confirmCommunityUpdate). A first install is not: choosing Install on
     * the row, with its detail pane open, is already that answer. */
    if (
      community &&
      at !== null &&
      !(await confirmCommunityUpdate(term, {
        name: entry.mod.name,
        from: at,
        to: entry.mod.tag,
        repo: entry.mod.repo,
      }))
    ) {
      continue;
    }
    const rowOrigin: ModOrigin = community ? "third-party" : origin;
    if (await installOne(term, entry, rowOrigin, deps, { offerEnable: at === null && what === 0 })) {
      changed = true;
      if (deps.leaveAfterEnabledInstall?.()) return changed;
    }
  }
}

/** Read a registry, then show it. Shared by doors 1 and 2. */
export async function openRegistry(
  term: GridSurface & GridPointerInput,
  origin: ModOrigin,
  read: () => Promise<{ registry: ModRegistry | null; problem: string | null }>,
  deps: ModBrowseDeps,
): Promise<boolean> {
  /* A REGION for the length of the fetch (#253); see `showSource`. */
  const handle = pushRegion(screenRegionSpec(), term.size());
  const waiting = regionSurface(term, handle.cells);
  waiting.clear();
  waiting.print(0, 1, t("modBrowse.registry.reading", "Reading the list..."), C_DIM);
  waiting.flush?.();
  const { registry, problem } = await read().finally(() => {
    popRegion(handle);
  });
  if (!registry) {
    await showTextScreen(term, t("modBrowse.registry.couldNotRead", "Could not read that list"), [
      {
        text: problem ?? t("modBrowse.registry.couldNotReadFallback", "The list could not be read."),
        color: C_BAD,
      },
      { text: "", color: C_FG },
      {
        text: t("modBrowse.registry.unaffected", "Mods you have already installed are unaffected."),
        color: C_DIM,
      },
    ]);
    return false;
  }
  return await showSource(
    term,
    sourceLabel(origin, registry.name),
    origin,
    registry.mods,
    registry.community,
    registry.problems,
    deps,
  );
}

import { classicCatalog, classicManager } from "./classic-service";
import { type GridSurface, type GridPointerInput } from "../term";
import { type ModManagerDeps } from "./classic-types";
import { offerDelveSyncArrival, runSaveDelve, runLoadDelve } from "./classic-delve";
import { type MenuItem, selectFromMenu, MENU_REFRESH, showTextScreen } from "../overlay";
import { rowLabel, modFolderRow, wrapped, rowDetail } from "./classic-mod-views";
import { problemsFor, unattributedProblems } from "../mod-problems";
import { C_FG, C_ENABLED, C_WARN, C_DIM, C_DANGER, C_TITLE } from "./classic-colors";
import { t } from "@rpgm-tools/neo-angband-core";
import { modUpgradeRowLabel } from "../mod-refresh";
import { stashOf, orphanRowLabel, viewOrphanStash } from "../mod-orphans";
import { enableMod, manageMod, autoSortLoadOrder, enableAfterInstall, enableRecommendedMods, applyModChanges } from "./classic-actions";
import { viewConflicts, modProfilerScreen } from "./classic-conflict-views";
import { showRecommendedMods, showModUpgrades } from "../mod-browse";
import { showModSources, manageModFolder, manageDelveSyncFolder } from "./classic-sources";

/**
 * Run the mod manager. Loops on the top list (mods + actions) until the user
 * leaves; if changes were made it offers to reload so they take effect.
 */
export async function runModManager(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  opts?: { fromTitle?: boolean },
): Promise<void> {
  const arrivalOutcome = await offerDelveSyncArrival(term, deps);
  if (arrivalOutcome === "reloaded") return;
  let dirty = arrivalOutcome === "dirty";
  /* Which tile-contributing mods were already on when this screen opened. Any id
   * that is enabled at the end and absent here was turned ON here, which is
   * exactly when the reboot should land on the Graphics screen - see
   * newTileModEnabled below. */
  const tileModsAtEntry = enabledTileModIds(deps);
  /* THE CURSOR SURVIVES A PASS.
   *
   * This loop rebuilds the whole screen every time round, which is what lets a
   * toggle change a row's label, its colour and whether the Apply row exists at
   * all. It also re-opened the menu with the cursor back at the top, so turning
   * three mods on in a row meant scrolling back down twice. selectFromMenu takes
   * an initialCursor; the only thing missing was somewhere to keep it. */
  let cursor = 0;
  /**
   * WHICH MOD the cursor is on, not just which row.
   *
   * The catalogue is sorted enabled-first, so turning one on MOVES it - press
   * space on the fourth row and it becomes the first, while a plain index would
   * leave the cursor pointing at whatever slid into fourth place. Going down a
   * list ticking boxes then means the cursor drifts up the list behind you. The
   * id is restored each pass and the index is the fallback for the action rows,
   * which have no id and do not move.
   */
  let cursorId: string | null = null;
  /* Set by the space-to-toggle command key, consumed after the menu closes:
   * enabling a mod can put up a consent prompt and a non-scoring warning, and a
   * command handler runs synchronously inside the menu's own key listener. */
  let toggleId: string | null = null;
  for (;;) {
    const catalog = classicCatalog(deps);
    /* Read ONCE per pass, not once per row: diskPackStatus recomposes and re-reads
     * every source, and calling it inside a map over thirty mods would do that thirty
     * times for one screen. */
    const trouble = deps.diskPackStatus?.();
    const problems = trouble?.problems ?? [];
    const skipped = trouble?.skipped ?? [];
    const items: MenuItem[] = catalog.map((m) =>
      rowLabel(m, problemsFor(problems, m.id)),
    );
    type ActionKind =
      | "conflicts"
      | "profiler"
      | "orphans"
      | "autosort"
      | "install"
      | "download"
      | "modupdates"
      | "folder"
      | "saveDelve"
      | "loadDelve"
      | "delveSyncFolder"
      | "reload"
      | "done";
    type RowKind = { kind: "mod"; id: string } | { kind: ActionKind };
    const rowKinds: RowKind[] = catalog.map((m) => ({
      kind: "mod" as const,
      id: m.id,
    }));

    /* Action rows below the list, each with a FIXED tag.
     *
     * Positional lettering put these on whatever letter followed the last mod,
     * so every install shifted them: `f) Recommended mods...` became `g)` the
     * moment a mod appeared above it, and a player - or a scripted test, which
     * is how this was caught - pressing the letter they used yesterday landed on
     * Auto-sort. The mods keep a, b, c...; the actions never move. Upstream does
     * exactly this for the rows that must stay put (option_actions[]' a/b/d/h in
     * ui-options.c), and MenuItem.tag is that mechanism. */
    const ACTION_TAG: Record<ActionKind, string> = {
      download: "1",
      modupdates: "7",
      folder: "2",
      conflicts: "3",
      /* Every digit is taken, so this is another punctuation tag, as "+" and
       * "-" are. */
      profiler: "*",
      autosort: "4",
      orphans: "5",
      install: "6",
      /* Digits 0-9 are what every OTHER action row already uses, deliberately:
       * `menuLetter` (overlay.ts) hands out positional a-z/A-Z to the mods
       * ABOVE these rows, and a digit can never collide with that - which is
       * exactly why every fixed tag here has always been a digit rather than
       * a mnemonic letter. Only "8" was still free; the second new row uses a
       * punctuation mark rather than a second letter for the same reason a
       * letter would eventually collide with a long enough mod list (the
       * alphabet is only 52 rows deep; a punctuation mark never appears in
       * `menuLetter`'s output at all). */
      saveDelve: "8",
      loadDelve: "+",
      /* A third punctuation tag, for the same reason "+" is one: every digit
       * is spoken for and a letter would eventually collide with a long
       * enough mod list (menuLetter's own a-z/A-Z range). */
      delveSyncFolder: "-",
      reload: "9",
      done: "0",
    };
    const addAction = (
      label: string,
      kind: ActionKind,
      color = C_FG,
      hint = "",
    ): void => {
      items.push({ label, color, tag: ACTION_TAG[kind], ...(hint ? { hint } : {}) });
      rowKinds.push({ kind });
    };
    /* GETTING A MOD IS THE FIRST ROW.
     *
     * The list above it is the mods you already have; on a fresh install that
     * list is EMPTY, because the game bundles none. So the row directly under
     * an empty list has to be the one that ends the emptiness. It used to be
     * fourth, under conflicts, auto-sort and profiles - three screens that are
     * only meaningful once you have several mods, offered to a player who has
     * none. */
    const diskStatus = trouble;
    /* Gated on the BROWSE screen, which is the only one there is. It used to be
     * gated on the compiled-in catalogue's deps, and when that was deleted these
     * two rows would have vanished from every host - the mod manager with no way
     * to get a mod. */
    if (deps.modBrowse) {
      addAction(
        catalog.length === 0
          ? t("modsScreen.run.installStart", "Recommended mods...  (start here)")
          : t("modsScreen.run.install", "Recommended mods..."),
        "download",
        C_ENABLED,
        t("modsScreen.run.installHint", "Pick a curated mod; the game downloads, checks, and can enable it."),
      );
      /* KEEPING A MOD IS A SEPARATE JOB FROM GETTING ONE, and it had no row.
       *
       * The browse screen can update a mod - its row says so - but it is called
       * "Recommended mods", which is not where anyone looks for something they
       * already installed. So the job has its own row here.
       *
       * THE COUNT IS NOT ON THIS ROW ANY MORE, and that is the honest shape. It
       * used to be, because the answer was a local comparison against the
       * catalogue compiled into the build - instant, offline, and wrong in the
       * one way that matters: its silence meant "nothing newer shipped HERE" and
       * it said "all up to date". The answer now comes from each mod's own
       * repository, which means a request per mod, and there is no truthful way
       * to put a number here without making them. Nothing is cached either: a
       * cached freshness check is a stale answer wearing a fresh answer's
       * wording, which is the same defect one layer down.
       *
       * So the row says what pressing it does. The screen behind it says what it
       * found, including what it could not reach. */
      addAction(
        modUpgradeRowLabel(null, catalog.length),
        "modupdates",
        C_FG,
        t(
          "modsScreen.run.updatesHint",
          "Asks each installed mod's own repository whether there is a newer version.",
        ),
      );
    }
    /* Save/Load a Delve (docs/MOD_PROFILES.md, #87): a portable, shareable
     * snapshot of the enabled mod set. Loading one needs the same
     * discover/install door "Recommended mods..." uses (a version-mismatch
     * walk, and the ordinary third-party consent gate on a fresh install),
     * so it is gated on `deps.modBrowse` the same way those two rows are;
     * saving needs only the store and is offered alongside it rather than
     * behind a second, separately-gated condition. */
    if (deps.modBrowse) {
      addAction(
        t("modsScreen.run.saveDelve", "Save a Delve..."),
        "saveDelve",
        C_FG,
        t(
          "modsScreen.run.saveDelveHint",
          "Write your mod set, flags, and (optionally) options to a file you can share.",
        ),
      );
      addAction(
        t("modsScreen.run.loadDelve", "Load a Delve..."),
        "loadDelve",
        C_FG,
        t(
          "modsScreen.run.loadDelveHint",
          "Read someone else's mod set, flags, and options from a file or pasted text.",
        ),
      );
    }
    /* The saved folder's name is read fresh each pass, because picking or
     * forgetting one changes it and the row has to follow. */
    const savedFolder = deps.modFolder ? await deps.modFolder.savedName() : null;
    if (deps.modFolder) {
      const row = modFolderRow(savedFolder, diskStatus?.available === true);
      addAction(
        row.label,
        "folder",
        row.color,
        savedFolder === null
          ? t("modsScreen.run.folderHintNone", "Already have a mod on disk? Point the game at its folder.")
          : row.lapsed
            ? t("modsScreen.run.folderHintLapsed", "Your browser needs permission again before it will read it.")
            : t("modsScreen.run.folderHintNormal", "Choose another, reconnect, or stop using it."),
      );
    }
    /* The sync folder (#158): where this device writes a mod-profile snapshot
     * on Apply, and reads one back from at menu-open. Independent of the
     * mods-SOURCE folder above; offered whenever this front end can supply
     * one at all (desktop's own bridge, or a browser that can pick a
     * directory), never gated on `modBrowse` the way Save/Load a Delve are -
     * choosing a folder needs neither. */
    const savedSyncFolder = deps.delveSync ? await deps.delveSync.name() : null;
    if (deps.delveSync) {
      addAction(
        savedSyncFolder === null
          ? t("modsScreen.run.delveSyncChoose", "Mod profile sync folder...")
          : t("modsScreen.run.delveSyncNamed", 'Mod profile sync folder: "{name}"', {
              name: savedSyncFolder,
            }),
        "delveSyncFolder",
        savedSyncFolder === null ? C_FG : C_ENABLED,
        t(
          "modsScreen.run.delveSyncHint",
          "A folder this device writes its mod set to on Apply, and checks for a newer one from another device.",
        ),
      );
    }
    // No pooled "Fixes & tweaks" row: a mod's patches live under that mod
    // (manageMod -> manageModOptions), because they arrive with it and cannot
    // exist without it.
    addAction(
      t("modsScreen.run.viewConflicts", "View conflicts"),
      "conflicts",
      C_FG,
      t("modsScreen.run.viewConflictsHint", "Where two mods change the same thing, and which one wins."),
    );
    if (deps.profiler) {
      addAction(
        t("modsScreen.run.profiler", "Mod performance"),
        "profiler",
        C_FG,
        t("modsScreen.run.profilerHint", "How much time each mod's code takes, and how often it fails."),
      );
    }
    addAction(
      t("modsScreen.run.autoSort", "Auto-sort load order..."),
      "autosort",
      C_FG,
      t(
        "modsScreen.run.autoSortHint",
        "Work out an order from what the mods ask for. Your own moves are kept.",
      ),
    );
    /* THE STASH ROW CARRIES ITS COUNT (MOD_LIFECYCLE decision 7). Unlike the
     * update row above it, the number is a local read of the character already
     * open rather than a request per mod, and the player this row is for is one
     * whose items disappeared with no explanation: a row that says nothing until
     * it is opened would leave them exactly where they were. It is offered even
     * at zero once a game is running, because "nothing is set aside" is the
     * answer to the question that brought them here. */
    const stash = deps.orphans ? stashOf(deps.orphans) : null;
    if (stash) {
      addAction(
        orphanRowLabel(stash.total),
        "orphans",
        stash.total > 0 ? C_WARN : C_DIM,
        stash.total > 0
          ? t(
              "modsScreen.run.orphansHint",
              "Items and creatures frozen in your save because the mod that made them is gone.",
            )
          : t(
              "modsScreen.run.orphansHintEmpty",
              "Nothing of yours is waiting on a mod that is no longer loaded.",
            ),
      );
    }
    /* The problems belonging to no ROW - a folder whose manifest would not validate
     * never becomes a catalogue entry, so there is nowhere else in this screen they
     * can appear. Badged onto the row that shows them, because the failure this whole
     * change is about is a diagnosis nobody could find: leaving them behind an
     * unremarkable "Where mods come from..." row was how the pack reader's list stayed
     * effectively invisible even though it was, technically, rendered. */
    const orphans = unattributedProblems(problems, new Set(catalog.map((m) => m.id)));
    addAction(
      orphans.length > 0
        ? t(
            "modsScreen.run.sourcesRowProblems",
            "Where mods come from...  ! {count, plural, one {# problem} other {# problems}}",
            { count: orphans.length },
          )
        : t("modsScreen.run.sourcesRow", "Where mods come from..."),
      "install",
      orphans.length > 0 ? C_DANGER : C_DIM,
      orphans.length > 0
        ? t("modsScreen.run.sourcesHintOrphans", "A mod could not be read at all, so it has no row above.")
        : diskStatus?.available === true
          ? t("modsScreen.run.sourcesHintAvailable", "Your mods folder: path, contents, and anything unreadable.")
          : deps.modFolder
            ? t("modsScreen.run.sourcesHintFolder", "The folder layout, and how one is read.")
            : t("modsScreen.run.sourcesHintNoFolder", "Why this build has no mods folder."),
    );
    if (dirty) {
      addAction(
        t("modsScreen.run.applyReload", "Apply changes and reload"),
        "reload",
        C_WARN,
        t("modsScreen.run.applyReloadHint", "Nothing you changed is in effect until the game restarts."),
      );
    }
    addAction(
      t("modsScreen.common.done", "Done"),
      "done",
      C_DIM,
      opts?.fromTitle
        ? t("modsScreen.run.doneHintTitle", "Close this and go back to the title screen.")
        : t("modsScreen.run.doneHint", "Close this and go back to the game."),
    );

    // A live ?mods= override outranks the store for this session, so the boxes
    // below describe what is SAVED, not what is loaded. Say so; the row list is
    // too narrow to spell out both sets.
    const override = deps.urlModsOverride?.() ?? null;
    const footer = override
      ? dirty
        ? t("modsScreen.run.footer.overrideDirty", "[ ?mods= live; changes pending - Apply to reload; ESC ]")
        : t(
            "modsScreen.run.footer.override",
            "[ ?mods= override is live; boxes show the SAVED set; ESC ]",
          )
      : dirty
        ? t("modsScreen.run.footer.dirty", "[ Space on/off, Enter opens; Apply to reload; ESC = back ]")
        : catalog.length === 0
          ? /* An empty list with "Enter a mod to manage it" underneath is the
             * screen telling a player to do something there is nothing to do. */
            t(
              "modsScreen.run.footer.empty",
              "[ No mods installed - Recommended mods... to get one; ESC to go back ]",
            )
          : t("modsScreen.run.footer.normal", "[ Space turns one on or off, Enter opens it; ESC to go back ]");
    const pick = await selectFromMenu(term, "core:mods", t("modsScreen.run.title", "Mods"), items, footer, {
      initialCursor: cursorId === null ? cursor : (() => {
        const at = rowKinds.findIndex((r) => r.kind === "mod" && "id" in r && r.id === cursorId);
        return at >= 0 ? at : Math.min(cursor, items.length - 1);
      })(),
      onHighlight: (i) => {
        cursor = i;
        const row = rowKinds[i];
        cursorId = row && row.kind === "mod" && "id" in row ? row.id : null;
      },
      /* SPACE IS THE TOGGLE, on the row you are looking at.
       *
       * The list is a column of checkboxes and the only way to tick one was to
       * open the mod, choose Enable, and come back out - three keys and two
       * screens for the single thing this screen is for. Enter keeps its meaning
       * (open the mod), because everything else about a mod lives in there.
       *
       * This is port-only UI and does not collide with parity: upstream's menus
       * give space to "page down" (menu_handle_keypress, ui-menu.c), and there is
       * no mod manager upstream to disagree with.
       *
       * The handler cannot do the work itself - enabling can raise a consent
       * prompt and a permanent-non-scoring warning, both of which are awaited -
       * so it records the id and asks for a rebuild. */
      commands: {
        " ": (cur) => {
          const row = rowKinds[cur];
          if (!row || row.kind !== "mod" || !("id" in row)) return null;
          toggleId = row.id;
          return MENU_REFRESH;
        },
      },
      // Shown by default (not behind the '?' toggle): what a mod IS is the thing
      // a player needs in order to decide whether to turn it on.
      detail: (i) => {
        const rk = rowKinds[i];
        /* The one action row that gets a pane of its own. On a fresh install the
         * whole screen is this row, and "Recommended mods..." alone does not answer
         * the question a player has, which is where these come from and whether
         * running one is safe. */
        if (rk?.kind === "download" && catalog.length === 0) {
          const w = term.size().cols - 1;
          return [
            { text: t("modsScreen.run.emptyTitle", "You have no mods installed."), color: C_TITLE },
            { text: "", color: C_FG },
            ...wrapped(
              t(
                "modsScreen.run.emptyBody1",
                "That is the normal starting state - Neo Angband ships as " +
                  "Vanilla Angband and nothing else, and every mod, including the " +
                  "ones written here, is something you choose to add.",
              ),
              w,
            ),
            { text: "", color: C_FG },
            /* REWRITTEN because it described a model that no longer exists. It
             * said every file is checked against "a fingerprint that shipped
             * inside your copy of the game" - which was true of the compiled-in
             * catalogue and is now false: a shipped digest cannot survive a mod
             * releasing a new version, which is why the game asks the repository
             * instead and pins the ORIGIN on first install. Prose describing a
             * deleted mechanism is worse than no prose, because a player trusts
             * it. */
            ...wrapped(
              t(
                "modsScreen.run.emptyBody2",
                "Open this row for the list. The game holds no list of what a mod " +
                  "contains - it asks each mod's own repository, so a mod can " +
                  "release an update without waiting for a new version of the game.",
              ),
              w,
            ),
            { text: "", color: C_FG },
            ...wrapped(
              t(
                "modsScreen.run.emptyBody3",
                "On first install a mod is pinned to the repository it came from " +
                  "and can only be updated from that same place. Nothing here " +
                  "reviews a mod's code, including the recommended ones.",
              ),
              w,
            ),
          ];
        }
        if (!rk || !("id" in rk)) return [];
        const m = catalog.find((x) => x.id === rk.id);
        if (!m) return [];
        // Budget: keep at least MIN_LIST_ROWS rows of the LIST on screen (it
        // scrolls to the cursor, and ESC always closes) and hand the rest to the
        // description. The cap only bites on a mod whose blurb is longer than the
        // pane; the bundled ones fit, and opening the mod shows the full text.
        //
        // The floor used to be written `Math.max(8, ...)` - a floor on the PANE,
        // which overrides the list floor it sits next to rather than protecting
        // it. On a 14-row terminal it claimed 8 of them and left the mod list
        // two rows deep. A pane is the thing that can afford to be short here,
        // because opening the mod shows all of it; the list is not.
        const MIN_LIST_ROWS = 5;
        const { cols, rows } = term.size();
        const CHROME = 4; // title, blank, hint line, footer
        const budget = Math.max(0, rows - CHROME - Math.min(items.length, MIN_LIST_ROWS));
        const detail = rowDetail(
          m,
          cols,
          budget - 1,
          problemsFor(problems, m.id),
          problemsFor(skipped, m.id),
        );
        /* Where in the list this row is. With five rows of a thirty-mod catalogue
         * on screen there is otherwise nothing that says the list continues -
         * upstream's menu draws no scroll indicator (display_scrolling has none)
         * and this pane is the port's own text, so the count goes here rather
         * than as new chrome on a faithful menu. Only when it is worth saying. */
        const total = catalog.length;
        return total > 1 && detail.length < budget
          ? [
              {
                text: t("modsScreen.run.modOfTotal", "Mod {index} of {total}", {
                  index: i + 1,
                  total,
                }),
                color: C_DIM,
              },
              ...detail,
            ]
          : detail;
      },
      detailToggleKey: "?",
      detailInitiallyShown: true,
    });

    /* The space toggle asked for a rebuild rather than choosing a row. Do the
     * work the command handler could not await, then fall through to the top of
     * the loop - which redraws with `cursor` still where the player left it. */
    if (pick === MENU_REFRESH) {
      const id = toggleId;
      toggleId = null;
      const m = id === null ? undefined : catalog.find((x) => x.id === id);
      if (m) {
        if (m.enabled) {
          classicManager(deps).core.setEnabled(m.id, false);
          /* A disable within this same visit makes tileModsAtEntry stale for
           * this id: re-enabling it later in the visit must be treated as
           * newly available again, exactly like a mod that was off when the
           * screen opened (#208). */
          tileModsAtEntry.delete(m.id);
          dirty = true;
        } else if (await enableMod(term, deps, m)) {
          dirty = true;
        }
      }
      continue;
    }

    const rk: RowKind | undefined =
      pick === null ? { kind: "done" } : rowKinds[pick];
    if (!rk || rk.kind === "done") break;
    if (rk.kind === "mod" && "id" in rk) {
      if (await manageMod(term, deps, rk.id, tileModsAtEntry)) dirty = true;
    } else if (rk.kind === "conflicts") {
      await viewConflicts(term, deps);
    } else if (rk.kind === "profiler") {
      const stats = deps.profiler?.() ?? [];
      await showTextScreen(
        term,
        modProfilerScreen(stats, (id) => catalog.find((m) => m.id === id)?.name),
      );
    } else if (rk.kind === "orphans") {
      /* Rebuilt on open rather than reusing the row's read: enabling a mod in
       * this same screen does not rehydrate anything until the reload, but the
       * pack sets behind `availability` can move, and a screen showing a stale
       * "frost is not installed" over a frost that is now installed would be
       * the one sentence on it a player would act on.
       *
       * `viewOrphanStash` runs the per-item delete flow when the host has
       * provided a write callback on `deps.orphans.setStore`; without it the
       * function falls back to the same one-way display the stash screen used
       * to be, so an older host does not silently lose the affordance. */
      if (deps.orphans) await viewOrphanStash(term, deps.orphans);
    } else if (rk.kind === "autosort") {
      if (await autoSortLoadOrder(term, deps)) dirty = true;
    } else if (rk.kind === "download") {
      if (deps.modBrowse) {
        let enabledThroughInstall = false;
        const touched = await showRecommendedMods(term, {
          ...deps.modBrowse,
          offerEnable: async (id) => {
            if (await enableAfterInstall(term, deps, id)) {
              dirty = true;
              enabledThroughInstall = true;
              return true;
            }
            return false;
          },
          leaveAfterEnabledInstall: () => enabledThroughInstall,
          applyRecommended: async (ids, enableAllOptions) => {
            const applied = await enableRecommendedMods(term, deps, ids, enableAllOptions);
            if (applied) dirty = true;
            return applied;
          },
        });
        if (touched) dirty = true;
        if (enabledThroughInstall) {
          await applyModChanges(term, deps, tileModsAtEntry);
          return;
        }
      }
    } else if (rk.kind === "modupdates") {
      if (deps.modBrowse) {
        const touched = await showModUpgrades(term, {
          ...deps.modBrowse,
          offerEnable: async (id) => {
            if (await enableAfterInstall(term, deps, id)) {
              dirty = true;
              return true;
            }
            return false;
          },
        });
        if (touched) dirty = true;
      }
    } else if (rk.kind === "install") {
      await showModSources(term, deps.diskPackStatus?.(), deps.modFolder !== undefined);
    } else if (rk.kind === "folder") {
      if (
        deps.modFolder &&
        (await manageModFolder(term, deps.modFolder, diskStatus, savedFolder))
      ) {
        dirty = true;
      }
    } else if (rk.kind === "saveDelve") {
      await runSaveDelve(term, deps);
    } else if (rk.kind === "loadDelve") {
      if (await runLoadDelve(term, deps)) dirty = true;
    } else if (rk.kind === "delveSyncFolder") {
      /* Never sets `dirty`: choosing or forgetting a sync destination is a
       * preference, not a change to the mod set - nothing here warrants the
       * "Apply changes and reload" prompt. */
      if (deps.delveSync) await manageDelveSyncFolder(term, deps.delveSync, savedSyncFolder);
    } else if (rk.kind === "reload") {
      deps.requestReload();
      return; // reload takes over
    }
  }

  if (dirty) await applyModChanges(term, deps, tileModsAtEntry, opts?.fromTitle);
}

/**
 * Ids of the ENABLED mods that contribute tile packs.
 *
 * A `tiles`-shape mod need not declare tilePacks (it could re-skin via records),
 * and a mod of any shape may declare them, so this asks the manifest what it
 * actually contributes rather than trusting `shape`.
 */
export function enabledTileModIds(deps: ModManagerDeps): Set<string> {
  const out = new Set<string>();
  for (const m of classicCatalog(deps)) {
    if (m.enabled && (m.manifest.tilePacks?.length ?? 0) > 0) out.add(m.id);
  }
  return out;
}

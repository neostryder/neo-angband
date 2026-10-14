import { type GridSurface, type GridPointerInput } from "../term";
import { type DiskPackStatus, type ModFolderPicker } from "./classic-types";
import { type ScreenLine, showTextScreen, type MenuItem, selectFromMenu } from "../overlay";
import { t } from "@rpgm-tools/neo-angband-core";
import { C_FG, C_GOLD_TEXT, C_DIM, C_DANGER, C_WARN, C_ENABLED } from "./classic-colors";
import { noFolderPickerLines, modSourceLine } from "./classic-mod-views";
import { type ModProblem, problemLine } from "../mod-problems";
import { type HostFolder } from "../host-folder";

/**
 * Where mods come from, and how to add one.
 *
 * On a front end WITH a mods directory this is the real answer: the path, what
 * is in it, and what could not be read. On one without, it says so - which is
 * the same honesty the old "Install from URL" row had, arrived at from the other
 * side now that the directory actually works.
 *
 * Neither surface has a runtime code loader, so neither can fetch and RUN a mod
 * from a URL. A folder you copied in is a different thing: its records are data,
 * composed at load time by the same pipeline the bundled mods use.
 */
export async function showModSources(
  term: GridSurface & GridPointerInput,
  status: DiskPackStatus | undefined,
  canPick: boolean,
): Promise<void> {
  const lines: ScreenLine[] = [];
  if (!status || !status.available) {
    if (canPick) {
      /* An engine that CAN be given a folder has not been given one yet. Saying
       * "this build has no mods folder" here would be a false statement about the
       * program, which is the exact failure mode PLATFORM.md was written about. */
      lines.push(
        { text: t("modsScreen.sources.notChosen.title", "No mods folder chosen yet."), color: C_FG },
        { text: "", color: C_FG },
        {
          text: t(
            "modsScreen.sources.notChosen.body1",
            "This build can read one: choose a folder on your computer and it",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modsScreen.sources.notChosen.body2",
            "is remembered for every later visit. The mods in it are read the",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modsScreen.sources.notChosen.body3",
            "same way the desktop build reads its own folder, by the same",
          ),
          color: C_FG,
        },
        {
          text: t("modsScreen.sources.notChosen.body4", "validator, so a mod behaves identically on both."),
          color: C_FG,
        },
        { text: "", color: C_FG },
        {
          text: t(
            "modsScreen.sources.notChosen.pick",
            "Pick either a folder of mods, or a single mod's folder.",
          ),
          color: C_GOLD_TEXT,
        },
      );
    } else {
      lines.push(...noFolderPickerLines());
    }
  } else if (status.kind === "installed") {
    /* Mods installed from their own repositories and NO folder at all. There is no
     * directory to name - nobody put these anywhere - so saying "Mods folder:
     * (unknown)" would be a sentence about a folder that does not exist. */
    lines.push(
      {
        text: t("modsScreen.sources.installed.title", "Mods installed from their own repositories."),
        color: C_FG,
      },
      { text: "", color: C_FG },
      {
        text: modSourceLine(
          status.bundledCount,
          status.count,
          t("modsScreen.folder.source.installed", "installed"),
        ),
        color: C_FG,
      },
      { text: "", color: C_FG },
      {
        text: t(
          "modsScreen.sources.installed.body1",
          "An installed mod's files are kept in this browser's storage, not in",
        ),
        color: C_FG,
      },
      {
        text: t(
          "modsScreen.sources.installed.body2",
          "a folder, so there is no path to show. Each was checked against a",
        ),
        color: C_FG,
      },
      {
        text: t(
          "modsScreen.sources.installed.body3",
          "digest before a byte of it was unpacked, and the mod manager names",
        ),
        color: C_FG,
      },
      {
        text: t("modsScreen.sources.installed.body4", "the repository and tag it came from."),
        color: C_FG,
      },
      { text: "", color: C_FG },
      {
        text: t(
          "modsScreen.sources.installed.alsoFolder",
          "You can also give this browser a mods FOLDER, and use both.",
        ),
        color: C_DIM,
      },
    );
  } else {
    lines.push(
      {
        text:
          status.kind === "picked"
            ? t("modsScreen.sources.folder.headingPicked", "Mods folder you chose:")
            : t("modsScreen.sources.folder.heading", "Mods folder:"),
        color: C_FG,
      },
      { text: `  ${status.dir ?? t("modsScreen.sources.folder.unknown", "(unknown)")}`, color: C_GOLD_TEXT },
      { text: "", color: C_FG },
      /* The folder count is always given, even at zero: "0 mods found in it." is TRUE
       * and reads as "this game has no mods" while others are listed one screen away.
       * A player with an empty folder needs to see that the FOLDER is the empty part. */
      {
        text: modSourceLine(
          status.bundledCount,
          status.count,
          t("modsScreen.folder.source.fromFolder", "from this folder"),
        ),
        color: C_FG,
      },
      ...(status.count === 0
        ? [
            {
              text: t("modsScreen.sources.folder.empty", "Nothing has been copied into it yet."),
              color: C_DIM,
            },
          ]
        : []),
      { text: "", color: C_FG },
      {
        text: t("modsScreen.sources.folder.addBody1", "To add one, copy its folder in and restart. A mod folder holds"),
        color: C_FG,
      },
      {
        text: t(
          "modsScreen.sources.folder.addBody2",
          "manifest.json plus one .json per kind of record it changes -",
        ),
        color: C_FG,
      },
      { text: t("modsScreen.sources.folder.addBody3", "exactly the layout a bundled mod has."), color: C_FG },
      { text: "", color: C_FG },
      {
        text: t("modsScreen.sources.folder.loadOrderBody1", "load-order.json in that folder is owned by an external mod"),
        color: C_FG,
      },
      {
        text: t(
          "modsScreen.sources.folder.loadOrderBody2",
          "manager: the ids it lists are loaded, in that order. Turning a",
        ),
        color: C_FG,
      },
      {
        text: t("modsScreen.sources.folder.loadOrderBody3", "mod on or off here overrides it for that mod."),
        color: C_FG,
      },
    );
    if (status.kind === "picked") {
      lines.push(
        { text: "", color: C_FG },
        {
          text: t(
            "modsScreen.sources.folder.pickedPrivacy1",
            "Your browser is not told where that folder is on disk, only its",
          ),
          color: C_DIM,
        },
        {
          text: t("modsScreen.sources.folder.pickedPrivacy2", "name, so only the name can be shown here."),
          color: C_DIM,
        },
      );
    }
    /* Mods can arrive from more than one source at once - a folder AND repositories
     * the player installed from - and the block above describes only the first. Every
     * other source gets its own line, because "2 from this folder" was otherwise a
     * true sentence that read as the whole answer while other mods loaded unmentioned. */
    for (const origin of status.origins.slice(1)) {
      lines.push(
        { text: "", color: C_FG },
        {
          text:
            origin.kind === "installed"
              ? t(
                  "modsScreen.sources.extraOrigin.installed",
                  "{count} installed from {count, plural, one {its own repository} other {their own repositories}}.",
                  { count: origin.count },
                )
              : t("modsScreen.sources.extraOrigin.folder", "{count} from {dir}.", {
                  count: origin.count,
                  dir: origin.dir ?? t("modsScreen.sources.extraOrigin.anotherSource", "another source"),
                }),
          color: C_FG,
        },
        ...(origin.kind === "installed"
          ? [
              {
                /* Where they physically are, honestly: nobody put them anywhere. */
                text: t(
                  "modsScreen.sources.extraOrigin.storageBody1",
                  "  Kept in this browser's storage, not in a folder - the mod",
                ),
                color: C_DIM,
              },
              {
                text: t(
                  "modsScreen.sources.extraOrigin.storageBody2",
                  "  manager names the repository and tag each came from.",
                ),
                color: C_DIM,
              },
            ]
          : []),
      );
    }
  }
  /* HOISTED OUT OF THE BRANCHES (2026-07-31). Two of the three said this and the
   * first did not, so a problem collected while no folder was attached - a bundled
   * plugin that failed validation, a hooks() that threw - was computed, carried all
   * the way here, and then fell down the one branch that never printed it. */
  lines.push(...problemBlock(status?.problems ?? []));
  /* LEFT AT `lines`, DELIBERATELY, and the two lists here are why rather than an
   * oversight.
   *
   * The extra-origin loop is one to THREE rows per origin - the count sentence, and
   * two more only when the mods came from browser storage rather than a folder - so
   * an origin is not a table row.
   *
   * `problemBlock` is a genuine one-line-per-record list and is the one thing on
   * this screen that wants to be a table. It cannot become one without a lie: an
   * attributed problem renders `  id: why` and an unattributed one renders `  why`,
   * and no fixed column can produce both, because the separator is conditional. The
   * only byte-identical table puts `"id: "` - colon, trailing space and all - inside
   * the id cell, which is the rendering back in the data. It stays `lines` until the
   * separator can be a fact about the column instead of a fact about the row. */
  await showTextScreen(term, t("modsScreen.sources.title", "Where mods come from"), lines);
}

/**
 * The "could not be used" block, or nothing.
 *
 * Exported and pure because the CAP is the interesting part. This used to
 * `slice(0, 8)` and print nothing about the rest, so nine problems looked like
 * eight - a truncation that reads as completeness is worse than a long list, and it
 * hid exactly the case where a lot has gone wrong. The cap stays and now says what
 * it dropped.
 *
 * WHY THE CAP IS KEPT IS NOT WHY IT WAS WRITTEN. This said "a text screen has one
 * page and no scroll", and that is simply not true: `showViewOnTerminal` (overlay.ts)
 * scrolls with the arrows, the numpad, PageUp/PageDown and Home/End, and prints its
 * own `(1-23/57)` position footer. What the cap is actually worth is the sentence
 * under it - a hundred problems on one page buries the mod list's own per-mod
 * reasons, which are the ones a player can act on. Lifting it is a change to what
 * this screen SHOWS and belongs to whoever wants that, not to a modelling pass.
 */
export function problemBlock(problems: readonly ModProblem[]): ScreenLine[] {
  if (problems.length === 0) return [];
  const CAP = 8;
  const out: ScreenLine[] = [
    { text: "", color: C_FG },
    { text: t("modsScreen.problemBlock.heading", "Could not be used:"), color: C_DANGER },
  ];
  for (const p of problems.slice(0, CAP)) {
    out.push({ text: `  ${problemLine(p)}`, color: C_DANGER });
  }
  if (problems.length > CAP) {
    const rest = problems.length - CAP;
    out.push({
      text: t(
        "modsScreen.problemBlock.more",
        "  ...and {rest} more (each mod's own are on its row in the Mods list)",
        { rest },
      ),
      color: C_DANGER,
    });
  }
  return out;
}

/**
 * Choose, reconnect, or forget the mods folder.
 *
 * Returns whether anything changed, so the caller can offer the reload that makes
 * it take effect. Every branch is reported: a cancelled picker and a refused
 * permission look identical from here otherwise, and silence after a folder failed
 * to attach is how a player concludes the feature is broken.
 */
export async function manageModFolder(
  term: GridSurface & GridPointerInput,
  picker: ModFolderPicker,
  status: DiskPackStatus | undefined,
  savedName: string | null,
): Promise<boolean> {
  /* A saved folder that produced no readable directory is the lapsed-permission
   * case: the handle is still remembered, the browser just will not read it until
   * the player says so from a keypress. */
  const lapsed = savedName !== null && status?.available !== true;

  type Row = "pick" | "reconnect" | "forget" | "about";
  const items: MenuItem[] = [];
  const rows: Row[] = [];
  const add = (label: string, row: Row, color: string, hint: string): void => {
    items.push({ label, color, hint });
    rows.push(row);
  };

  if (lapsed) {
    add(
      t("modsScreen.manageFolder.reconnect", 'Reconnect "{name}"', { name: savedName }),
      "reconnect",
      C_WARN,
      t(
        "modsScreen.manageFolder.reconnectHint",
        "Your browser needs permission again before it will read that folder.",
      ),
    );
  }
  add(
    savedName === null
      ? t("modsScreen.folder.choose", "Choose a mods folder...")
      : t("modsScreen.manageFolder.chooseDifferent", "Choose a different folder..."),
    "pick",
    C_FG,
    t("modsScreen.manageFolder.pickHint", "A folder of mods, or one mod's own folder."),
  );
  if (savedName !== null) {
    add(
      t("modsScreen.manageFolder.stopUsing", 'Stop using "{name}"', { name: savedName }),
      "forget",
      C_DIM,
      t("modsScreen.manageFolder.stopUsingHint", "The bundled mods stay; nothing on your disk is touched."),
    );
  }
  add(
    t("modsScreen.common.whatIsThis", "What is this?"),
    "about",
    C_DIM,
    t("modsScreen.manageFolder.aboutHint", "Where mods come from, and the folder layout."),
  );

  for (;;) {
    const pick = await selectFromMenu(
      term,
      "core:mods-folder",
      t("modsScreen.manageFolder.title", "Mods folder"),
      items,
      t("modsScreen.common.footer.escBack", "[ ESC to go back ]"),
    );
    if (pick === null) return false;
    const row = rows[pick];
    if (row === "about") {
      await showModSources(term, status, true);
      continue;
    }
    if (row === "pick") {
      const name = await picker.pick();
      if (name === null) return false; /* cancelled: not a failure, no message */
      await showTextScreen(term, t("modsScreen.manageFolder.title", "Mods folder"), [
        { text: t("modsScreen.manageFolder.using", 'Using "{name}".', { name }), color: C_ENABLED },
        { text: "", color: C_FG },
        {
          text: t(
            "modsScreen.manageFolder.usingBody1",
            "Reload to read it. Any mod in it appears in this list, off until",
          ),
          color: C_FG,
        },
        {
          text: t("modsScreen.manageFolder.usingBody2", "you turn it on - the same as a bundled one."),
          color: C_FG,
        },
      ]);
      return true;
    }
    if (row === "reconnect") {
      const ok = await picker.reconnect();
      await showTextScreen(term, t("modsScreen.manageFolder.title", "Mods folder"), [
        ok
          ? {
              text: t("modsScreen.manageFolder.reconnected", 'Reconnected to "{name}".', {
                name: savedName ?? "",
              }),
              color: C_ENABLED,
            }
          : {
              text: t(
                "modsScreen.manageFolder.reconnectFailed",
                "Permission was not granted, so that folder stays unread.",
              ),
              color: C_DANGER,
            },
        { text: "", color: C_FG },
        ok
          ? { text: t("modsScreen.manageFolder.reloadToRead", "Reload to read it."), color: C_FG }
          : {
              text: t(
                "modsScreen.manageFolder.tryAgain",
                "You can try again, or choose a different folder.",
              ),
              color: C_FG,
            },
      ]);
      if (ok) return true;
      continue;
    }
    /* forget */
    await picker.forget();
    await showTextScreen(term, t("modsScreen.manageFolder.title", "Mods folder"), [
      {
        text: t("modsScreen.manageFolder.noLongerUsing", 'No longer using "{name}".', {
          name: savedName ?? "",
        }),
        color: C_FG,
      },
      { text: "", color: C_FG },
      {
        text: t(
          "modsScreen.manageFolder.noLongerUsingBody",
          "Nothing on your disk was changed. Reload to drop its mods.",
        ),
        color: C_FG,
      },
    ]);
    return true;
  }
}

/**
 * "Mod profile sync folder..." (#158): choose, replace, or stop using the
 * folder this device writes a mod-profile snapshot to on Apply and reads one
 * back from at menu-open. Simpler than `manageModFolder` above: `HostFolder`
 * has no separate lapsed-permission/reconnect step of its own (`choose()`
 * both picks and (re)grants in one call on the browser, and the desktop
 * bridge has no permission concept to lapse), so there is nothing here to
 * distinguish from an ordinary first choice.
 */
export async function manageDelveSyncFolder(
  term: GridSurface & GridPointerInput,
  folder: HostFolder,
  savedName: string | null,
): Promise<void> {
  const TITLE = t("modsScreen.delveSyncFolder.title", "Mod profile sync folder");
  type Row = "pick" | "forget";
  const items: MenuItem[] = [
    {
      label:
        savedName === null
          ? t("modsScreen.delveSyncFolder.choose", "Choose a folder...")
          : t("modsScreen.delveSyncFolder.chooseDifferent", "Choose a different folder..."),
      color: C_FG,
      hint: t(
        "modsScreen.delveSyncFolder.pickHint",
        "Point two installs at the same folder (a synced drive, say) to share a mod set.",
      ),
    },
  ];
  const rows: Row[] = ["pick"];
  if (savedName !== null) {
    items.push({
      label: t("modsScreen.delveSyncFolder.stopUsing", 'Stop using "{name}"', { name: savedName }),
      color: C_DIM,
      hint: t("modsScreen.delveSyncFolder.stopUsingHint", "Nothing already written there is deleted."),
    });
    rows.push("forget");
  }
  const pick = await selectFromMenu(
    term,
    "core:delve-sync-folder",
    TITLE,
    items,
    t("modsScreen.common.footer.escBack", "[ ESC to go back ]"),
  );
  if (pick === null) return;
  const row = rows[pick];
  if (row === "pick") {
    const name = await folder.choose();
    if (name === null) return; /* cancelled: not a failure, no message */
    await showTextScreen(term, TITLE, [
      { text: t("modsScreen.delveSyncFolder.using", 'Using "{name}".', { name }), color: C_ENABLED },
      { text: "", color: C_FG },
      {
        text: t(
          "modsScreen.delveSyncFolder.usingBody",
          "Your mod set is written here the next time you apply changes.",
        ),
        color: C_FG,
      },
    ]);
    return;
  }
  /* forget */
  await folder.forget();
  await showTextScreen(term, TITLE, [
    {
      text: t("modsScreen.delveSyncFolder.noLongerUsing", 'No longer using "{name}".', {
        name: savedName ?? "",
      }),
      color: C_FG,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modsScreen.delveSyncFolder.noLongerUsingBody",
        "Nothing already written there is deleted, and it stops being checked for a newer set.",
      ),
      color: C_FG,
    },
  ]);
}

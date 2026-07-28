/**
 * The pref-file screens, ported from reference/src/ui-options.c (Angband
 * 4.2.6): `get_pref_path` / `dump_pref_file` (L44-98),
 * `do_cmd_pref_file_hack` (L1202-1241), the visuals menu (`do_cmd_visuals`
 * and visual_menu_items[], L765-852) and the colours menu's own three rows
 * (color_events[], L988-993).
 *
 * These were the rows the options menu used to excuse away. The blocker was
 * never the browser: it was that the port had no user directory (now
 * userdir.ts) and no runtime x_attr/x_char layer for the four "Save ...
 * attr/chars" rows to serialise (now core's GlyphTable). The format itself -
 * prefs_save, remove_old_dump and the dump_* writers - lives in core
 * (visuals/prefs.ts) because the CLI needs it too; this module is only the
 * prompts, the file layer and the messages.
 *
 * The file layer is the virtual ANGBAND_DIR_USER: upstream writes
 * path_build(ANGBAND_DIR_USER, ftmp) and later READS the same path back, which
 * is exactly what a Downloads-folder-only sink could not do.
 */

import {
  dumpAutoinscriptions,
  dumpColors,
  dumpFeatures,
  dumpFlavors,
  dumpMonsters,
  dumpObjects,
  dumpUiEntryRenderers,
  glyphTableSink,
  optionDump,
  playerSafeName,
  prefErrorMessage,
  prefsSave,
  processPrefText,
} from "@neo-angband/core";
import type { DumpDeps, GlyphTable, PrefDeps, PrefSink } from "@neo-angband/core";
import { getString, selectFromMenu } from "./overlay";
import type { MenuItem } from "./overlay";
import type { GlyphTerm } from "./term";
import { UI_TEXT } from "./ui-colors";
import { readUserFile, userPath, writeUserFile } from "./userdir";

/** What the pref screens need from the running game. */
export interface PrefsUiCtx {
  term: GlyphTerm;
  /** msg() + EVENT_MESSAGE_FLUSH. */
  say: (text: string) => void;
  /** player->full_name, for the default `<name>.prf` filename. */
  playerName: () => string;
  /** The live x_attr/x_char tables the visuals dumps serialise. */
  glyphs: GlyphTable;
  /** Registries a pref line resolves names against. */
  prefDeps: PrefDeps;
  /** Gamedata + live table a dump writer walks. */
  dumpDeps: () => DumpDeps;
  /** The non-glyph sink halves (autoinscriptions, message colours, ...). */
  extraSink?: Partial<PrefSink>;
  /** Repaint after a load changed colours (Term_xtra REACT + redraw_all). */
  afterLoad?: () => void;
}

/** prefs_save's file layer over the virtual user directory. */
const IO = {
  read: (path: string): string | null => readUserFile(path),
  write: (path: string, text: string): boolean => writeUserFile(path, text),
};

/**
 * get_pref_path (ui-options.c L44-79): a full-screen prompt showing
 * "<what> to a pref file" and a "File: " row, defaulting to the
 * filesystem-safe player name with `.prf` appended. Returns the filename, or
 * null on ESC.
 *
 * DIVERGENCE (re-derived, not an excuse): upstream's arg_force_name branch,
 * which replaces the prompt with "Confirm writing to %s? ", is reachable only
 * from main.c's `-f` switch. A browser has no argv, so that branch has no way
 * to be taken - the same finding already recorded for the birth screen's
 * force-name refusal.
 */
async function getPrefPath(ctx: PrefsUiCtx, what: string, row: number): Promise<string | null> {
  const { term } = ctx;
  term.clear();
  if (row > 0) term.print(0, row - 1, "", UI_TEXT);
  term.print(0, row, `${what} to a pref file`, UI_TEXT);
  /* player_safe_name(..., true) strips the Roman-numeral suffix (player.c:389). */
  const ftmp = `${playerSafeName(ctx.playerName(), 80, true)}.prf`;
  /* prt("File: ", row + 2, 0) then askfor_aux(ftmp, sizeof ftmp) - which draws
   * where that prt left the cursor, so the answer echoes on row + 2. */
  return getString(term, "File: ", ftmp, 80, row + 2);
}

/**
 * dump_pref_file (ui-options.c L81-98): ask for the path, save, and report.
 * The message names the title's text AFTER its first space
 * (`strstr(title, " ") + 1`), so "Save monster attr/chars" reports
 * "Saved monster attr/chars.".
 */
export async function dumpPrefFile(
  ctx: PrefsUiCtx,
  dump: () => string,
  title: string,
  row: number,
): Promise<void> {
  const name = await getPrefPath(ctx, title, row);
  if (name === null) return;
  const shortTitle = title.slice(title.indexOf(" ") + 1);
  if (prefsSave(IO, name, dump, title)) {
    ctx.say(`Saved ${shortTitle}.`);
  } else {
    ctx.say(`Failed to save ${shortTitle}.`);
  }
}

/**
 * process_pref_file_named (ui-prefs.c L1212-1262) against the user directory:
 * read, parse, print every parse error, and report a missing file. Returns
 * false when the file is absent or any line failed, which is what
 * do_cmd_pref_file_hack turns into "Failed to load '%s'!".
 *
 * DIVERGENCE (measured): upstream's process_pref_file also searches
 * ANGBAND_DIR_CUSTOMIZE and the active graphics mode's directory, then layers
 * the user copy on top (L1264-1349). The port ships no lib/customize tree - a
 * default pref file there would be build data, and the port's equivalents
 * (default keymaps, the bundled graf prefs) are loaded by their own subsystems -
 * so only the user location is searched here.
 */
export function processPrefFile(
  ctx: PrefsUiCtx,
  name: string,
  quiet = false,
): boolean {
  const text = readUserFile(name);
  if (text === null) {
    if (!quiet) ctx.say(`Cannot open '${userPath(name)}'.`);
    return false;
  }
  const sink = glyphTableSink(ctx.glyphs, {
    loadFile: (n) => readUserFile(n),
    ...ctx.extraSink,
  });
  const errors = processPrefText(text, ctx.prefDeps, sink);
  for (const e of errors) ctx.say(prefErrorMessage(userPath(name), e));
  ctx.afterLoad?.();
  return errors.length === 0;
}

/**
 * do_cmd_pref_file_hack (ui-options.c L1202-1241): the "Command: Load a user
 * pref file" screen, its "File: " prompt, and the two outcome messages.
 */
export async function loadPrefFileHack(ctx: PrefsUiCtx, row: number): Promise<void> {
  const { term } = ctx;
  term.clear();
  if (row > 0) term.print(0, row - 1, "", UI_TEXT);
  term.print(0, row, "Command: Load a user pref file", UI_TEXT);
  const ftmp = `${playerSafeName(ctx.playerName(), 80, true)}.prf`;
  const name = await getString(term, "File: ", ftmp, 80, row + 2);
  if (name === null) return;
  if (!processPrefFile(ctx, name)) {
    ctx.say(`Failed to load '${name}'!`);
  } else {
    ctx.say(`Loaded '${name}'.`);
  }
}

/**
 * visual_menu_items[] (ui-options.c L814-822) with do_cmd_visuals' own header.
 * Upstream gives these rows no explicit tags (`selections = lower_case`), so
 * they letter positionally a..f.
 */
const VISUAL_ROWS: readonly string[] = [
  "Load a user pref file",
  "Save monster attr/chars",
  "Save object attr/chars",
  "Save feature attr/chars",
  "Save flavor attr/chars",
  "Reset visuals",
];

/** do_cmd_visuals (ui-options.c L831-852). */
export async function runVisualsMenu(ctx: PrefsUiCtx, title: string): Promise<void> {
  const items: MenuItem[] = VISUAL_ROWS.map((label) => ({ label }));
  for (;;) {
    const idx = await selectFromMenu(
      ctx.term,
      title,
      items,
      "[ a-f to choose, ESC to return ]",
      /* visual_menu->header (L845): the one-line note above the rows. */
      { subtitle: "To edit visuals, use the knowledge menu" },
    );
    if (idx === null) return;
    const row = VISUAL_ROWS[idx];
    switch (idx) {
      case 0:
        await loadPrefFileHack(ctx, 15);
        break;
      case 1:
        await dumpPrefFile(ctx, () => dumpMonsters(ctx.dumpDeps()), row!, 15);
        break;
      case 2:
        await dumpPrefFile(ctx, () => dumpObjects(ctx.dumpDeps()), row!, 15);
        break;
      case 3:
        await dumpPrefFile(ctx, () => dumpFeatures(ctx.dumpDeps()), row!, 15);
        break;
      case 4:
        await dumpPrefFile(ctx, () => dumpFlavors(ctx.dumpDeps()), row!, 15);
        break;
      case 5:
        /* visuals_reset (L806-813): reset_visuals(true) then the message. The
         * `true` half re-loads the active graphics pref, which in this port is
         * the tile pipeline's own job and already survives the reset (the
         * TileMap is a separate table). */
        ctx.glyphs.reset();
        ctx.say("Visual attr/char tables reset.");
        ctx.afterLoad?.();
        break;
    }
  }
}

/**
 * The three rows the port's '=' -> 'c' screen used to skip straight past
 * (color_events[], ui-options.c L988-993). "Modify colors" is the editor the
 * port already had.
 */
export async function runColorsMenu(
  ctx: PrefsUiCtx,
  title: string,
  modify: () => Promise<void>,
): Promise<void> {
  const items: MenuItem[] = [
    { label: "Load a user pref file" },
    { label: "Dump colors" },
    { label: "Modify colors" },
  ];
  for (;;) {
    const idx = await selectFromMenu(
      ctx.term,
      title,
      items,
      "[ a-c to choose, ESC to return ]",
    );
    if (idx === null) return;
    if (idx === 0) {
      /* colors_pref_load (L859-869): the load, then a full redraw. */
      await loadPrefFileHack(ctx, 8);
      ctx.afterLoad?.();
    } else if (idx === 1) {
      await dumpPrefFile(ctx, () => dumpColors(), "Dump colors", 15);
    } else {
      await modify();
    }
  }
}

/** do_dump_options (ui-options.c L1247-1251): the subwindow flag dump. */
export function dumpWindowSettings(ctx: PrefsUiCtx): Promise<void> {
  return dumpPrefFile(ctx, () => optionDump(), "Dump window settings", 20);
}

/** do_dump_autoinsc (ui-options.c L1254-1258). */
export function dumpAutoinscriptionsRow(ctx: PrefsUiCtx): Promise<void> {
  return dumpPrefFile(
    ctx,
    () => dumpAutoinscriptions(ctx.dumpDeps()),
    "Dump autoinscriptions",
    20,
  );
}

/** do_dump_charscreen_opt (ui-options.c L1261-1265). */
export function dumpCharScreenOptions(ctx: PrefsUiCtx): Promise<void> {
  return dumpPrefFile(
    ctx,
    () => dumpUiEntryRenderers(ctx.dumpDeps()),
    "Dump char screen options",
    20,
  );
}

/** options_load_pref_file (ui-options.c L1268-1272): the '=' -> 'p' row. */
export function loadUserPrefFileRow(ctx: PrefsUiCtx): Promise<void> {
  return loadPrefFileHack(ctx, 20);
}

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
  t,
} from "@rpgm-tools/neo-angband-core";
import { HostDir, host } from "@rpgm-tools/neo-angband-core";
import type { DumpDeps, GlyphTable, PrefDeps, PrefSink } from "@rpgm-tools/neo-angband-core";
import { getCheck, getString, selectFromMenu, screenRegionSpec } from "./overlay";
import { popRegion, pushRegion, regionSurface } from "./ui-stack";
import { argForceName } from "./launch";
import type { MenuItem } from "./overlay";
import type { GridPointerInput, GridSurface } from "./term";
import { UI_TEXT } from "./ui-colors";

/** What the pref screens need from the running game. */
export interface PrefsUiCtx {
  term: GridSurface & GridPointerInput;
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

/**
 * prefs_save's file layer, over whatever host is installed.
 *
 * This goes through core's HostIo rather than straight at the virtual user
 * directory so the pref screens are host-agnostic: on the desktop build the
 * same code writes a real file into ANGBAND_DIR_USER, and on the web build the
 * BrowserHost still lands it in localStorage. See parity/PLATFORM.md - the
 * front end must not be the thing that decides what a file IS.
 */
const IO = {
  read: (path: string): string | null => host().read(HostDir.USER, path),
  write: (path: string, text: string): boolean =>
    host().write(HostDir.USER, path, text) === "ok",
};

/**
 * get_pref_path (ui-options.c L44-79): a full-screen prompt showing
 * "<what> to a pref file" and a "File: " row, defaulting to the
 * filesystem-safe player name with `.prf` appended. Returns the filename, or
 * null on ESC.
 *
 * Under arg_force_name (L65-69) the name is not typed: the host has pinned it,
 * so the same default is offered as "Confirm writing to %s? " and the player
 * either takes it or cancels. Reachable via main.c's `-f`, so only on a front
 * end with a command line - the web build has no argv and always asks.
 */
async function getPrefPath(ctx: PrefsUiCtx, what: string, row: number): Promise<string | null> {
  const { term: host } = ctx;
  const handle = pushRegion(screenRegionSpec(), host.size());
  const term = regionSurface(host, handle.cells);
  try {
  term.clear();
  /* prt("", row - 1, 0) (ui-options.c:53) is an ERASE of that row; print("") drew
   * nothing at all, so the call was a no-op. */
  if (row > 0) term.prt(0, row - 1, "", UI_TEXT);
  term.prt(0, row, t("prefsUi.pathPrompt", "{what} to a pref file", { what }), UI_TEXT); // prt (ui-options.c:55)
  /* player_safe_name(..., true) strips the Roman-numeral suffix (player.c:389). */
  const ftmp = `${playerSafeName(ctx.playerName(), 80, true)}.prf`;
  if (argForceName()) {
    return (await getCheck(term, t("prefsUi.confirmWrite", "Confirm writing to {ftmp}? ", { ftmp })))
      ? ftmp
      : null;
  }
  /* prt("File: ", row + 2, 0) then askfor_aux(ftmp, sizeof ftmp) - which draws
   * where that prt left the cursor, so the answer echoes on row + 2. */
  return getString(term, t("prefsUi.fileLabel", "File: "), ftmp, 80, row + 2);
  } finally {
    popRegion(handle);
  }
}

/**
 * dump_pref_file (ui-options.c L81-98): ask for the path, save, and report.
 * The message names the title's text AFTER its first space
 * (`strstr(title, " ") + 1`), so "Save monster attr/chars" reports
 * "Saved monster attr/chars.".
 *
 * `title` is expected to keep upstream's "<verb> <noun...>" shape, because
 * `shortTitle` below still derives by slicing off everything up to the first
 * space, exactly as upstream's own `strstr` does - a signature this function
 * cannot change without breaking `launch.test.ts`'s calls, which pin the
 * current four-parameter shape. A translated title that reorders those words
 * gets a shortTitle that no longer names the right noun; that is upstream's
 * own fragility carried over, not a new one, and it stays undocumented risk
 * rather than a rewrite until this function's shape can move.
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
    ctx.say(t("prefsUi.saved", "Saved {shortTitle}.", { shortTitle }));
  } else {
    ctx.say(t("prefsUi.saveFailed", "Failed to save {shortTitle}.", { shortTitle }));
  }
}

/**
 * process_pref_file_named (ui-prefs.c L1212-1262) against the user directory:
 * read, parse, print every parse error, and report a missing file. Returns
 * false when the file is absent (upstream's PARSE_ERROR_INTERNAL, L1219) or one
 * of ITS OWN lines failed, which is what do_cmd_pref_file_hack turns into
 * "Failed to load '%s'!". A line that failed inside a `%:` include does not
 * make it false - see the two comments in the body, and #275.
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
  const io = host();
  const text = io.read(HostDir.USER, name);
  if (text === null) {
    if (!quiet) {
      ctx.say(
        t("prefsUi.cannotOpen", "Cannot open '{path}'.", {
          path: io.displayPath(HostDir.USER, name),
        }),
      );
    }
    return false;
  }
  const sink = glyphTableSink(ctx.glyphs, {
    /* The nested `%:file` include resolves against the same directory. */
    loadFile: (n) => io.read(HostDir.USER, n),
    ...ctx.extraSink,
  });
  const errors = processPrefText(text, ctx.prefDeps, sink);
  /* Both `%:`-include divergences, closed together (#275). An error raised
   * inside an included file is named by the INCLUDE's path, because upstream's
   * print_error runs inside the nested process_pref_file_named; and the file's
   * own name is what the display path is built from, so the include's name is
   * resolved the same way rather than printed raw. */
  for (const e of errors) {
    const at = io.displayPath(HostDir.USER, e.fromInclude ?? name);
    ctx.say(prefErrorMessage(at, e.fromInclude === undefined ? e : { ...e, fromInclude: at }));
  }
  ctx.afterLoad?.();
  /* AND AN INCLUDE'S ERROR DOES NOT FAIL THIS FILE. `parse_prefs_load` discards
   * the nested read - `(void)process_pref_file(file, true, d->user)`, ui-prefs.c
   * L438 - and returns PARSE_ERROR_NONE, so `process_pref_file_named`'s
   * `return e == PARSE_ERROR_NONE` (L1240) is about this file's OWN lines. The
   * errors are still collected and still said above; only the failure changes,
   * which is the half that is easy to "fix" by throwing them away. */
  return !errors.some((e) => e.fromInclude === undefined);
}

/**
 * How a caller reads one `%:`-included file. Async, because a mod's files are
 * reached through a resolver that may mint a blob URL or read IndexedDB. Null
 * means "no such file", which is a quiet skip, exactly as it is for the user
 * directory above (parse_prefs_load discards the nested read, ui-prefs.c L438).
 */
export type PrefIncludeLoader = (name: string) => Promise<string | null>;

/**
 * The recursion cap `processPrefText` applies to `%` (`depth < 8`, prefs.ts).
 * Named here because a pre-load that stopped shallower than the parse would
 * hand the parser a file it is willing to read and cannot find.
 */
const PREF_INCLUDE_DEPTH = 8;

/**
 * The `%:` names one pref text asks for, tokenised EXACTLY as
 * `processPrefText`'s loop does (prefs.ts: strip a trailing `\r`, skip empty and
 * `#` lines, split on `:`, directive is field 0 and the file name is the rest
 * rejoined). Written out rather than regexed so the two cannot drift on a name
 * that contains a colon or a trailing space.
 *
 * IT OVER-COLLECTS, deliberately: a `%:` inside a `?:`-bypassed block is named
 * here and fetched, then never loaded by the parse. Evaluating the bypass would
 * mean a second copy of the expression loop, and this file has held "one parse
 * loop" since the parser was ported. The cost is a fetch of a file the mod does
 * ship; the alternative cost is a grammar in two places.
 */
function prefIncludeNames(text: string): string[] {
  const names: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.length === 0 || line.startsWith("#")) continue;
    const parts = line.split(":");
    if (parts[0] !== "%") continue;
    names.push(parts.slice(1).join(":"));
  }
  return names;
}

/**
 * Read every file `text` includes, transitively, so a SYNCHRONOUS `loadFile` can
 * answer from memory. This is the whole trick, and it is not a new one: it is
 * what `loadTilePrefs` already does for a graphics pack's own `graf-*.prf`
 * (tiles.ts), which is how a pack's `%:flvr-*.prf` line has always worked.
 *
 * A name is fetched once however many files ask for it, which is also what stops
 * a cycle: `a.prf` including `b.prf` including `a.prf` visits each once and the
 * frontier empties. The depth bound is the parser's own, so the last level this
 * loads is the last level the parse will read.
 *
 * A loader that throws is a missing file. It is a mod's asset resolver on the
 * other end, and one unreachable include must not cost the mod every line of the
 * pref file that does resolve.
 */
export async function preloadPrefIncludes(
  text: string,
  load: PrefIncludeLoader,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let frontier = prefIncludeNames(text);
  for (let depth = 0; depth < PREF_INCLUDE_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const name of frontier) {
      if (files.has(name)) continue;
      let nested: string | null;
      try {
        nested = await load(name);
      } catch {
        nested = null;
      }
      if (nested === null) continue;
      files.set(name, nested);
      next.push(...prefIncludeNames(nested));
    }
    frontier = next;
  }
  return files;
}

/**
 * What one `applyPrefText` produced. Two things, because two callers need them:
 * the faults belong on the contributing mod's row, and the includes belong to
 * whoever must replay the same text later (see the note on `applyPrefText`).
 */
export interface AppliedPrefText {
  /** One line per parse error, already formatted for the mod's row. */
  readonly faults: readonly string[];
  /** Every `%:` file that was read, for a caller that must replay this text. */
  readonly includes: ReadonlyMap<string, string>;
}

/**
 * Apply pref-file TEXT that did not come from the user directory - a mod's
 * `prefs` resource (MOD_REACH gap 7).
 *
 * The same grammar, the same sink and the same deps as `processPrefFile`: one
 * parse loop, which is the rule this file has held since the parser was ported.
 * What differs is where the bytes came from and what happens to the errors -
 * they are RETURNED rather than said, because these are applied during boot,
 * before there is a message line to say them on, and they belong on the
 * contributing mod's row rather than in the player's message history.
 *
 * `%:` INCLUDES ARE FOLLOWED (#278). They were not until now, and the reason
 * given was that the grammar's `loadFile` is synchronous while a mod's files
 * resolve asynchronously - true, and not a reason: the fix is to do the reading
 * BEFORE the parse rather than during it, which `loadTilePrefs` has done for a
 * graphics pack since tiles were ported. So this is async and takes the loader,
 * and `preloadPrefIncludes` walks the text for `%:` names, reads them
 * transitively, and hands the parse a map it can answer from.
 *
 * THE LOADER IS REQUIRED, not optional with a silent fallback. An optional one
 * would put the old no-op back one forgetful caller later, and a skipped
 * directive reports nothing by construction - `processPrefText`'s `%` branch
 * treats a null the way upstream treats a file it could not open under `quiet`
 * (ui-prefs.c L438's discarded result), so there is no error for the author to
 * see. Every caller here has a resolver: the mod pref loop already skips a
 * resource whose `resolve` is null before it gets this far.
 *
 * An include whose name does not resolve is still a quiet skip, because that is
 * what upstream does and what `processPrefFile` does two functions up. Errors
 * raised by the LINES of an include are returned like any other, named by the
 * include rather than by this file - `prefErrorMessage` reads `fromInclude`
 * (#275).
 *
 * THE INCLUDES COME BACK OUT with the errors, because this is not the last thing
 * that reads them: a mod's pref text is latched and replayed into every freshly
 * built tile map (#153), and a replay without the includes is the very no-op
 * this closes, one function over. Handing them back is what stops the caller
 * either reading every include a second time or - worse, because it is silent -
 * replaying the text alone.
 */
export async function applyPrefText(
  ctx: PrefsUiCtx,
  text: string,
  source: string,
  load: PrefIncludeLoader,
): Promise<AppliedPrefText> {
  const includes = await preloadPrefIncludes(text, load);
  const sink = glyphTableSink(ctx.glyphs, {
    loadFile: (n) => includes.get(n) ?? null,
    ...ctx.extraSink,
  });
  const errors = processPrefText(text, ctx.prefDeps, sink);
  ctx.afterLoad?.();
  return { faults: errors.map((e) => prefErrorMessage(source, e)), includes };
}

/**
 * do_cmd_pref_file_hack (ui-options.c L1202-1241): the "Command: Load a user
 * pref file" screen, its "File: " prompt, and the two outcome messages.
 *
 * arg_force_name (L1222-1225) replaces the prompt with a confirmation here too,
 * for the same reason: the host chose the name.
 */
export async function loadPrefFileHack(ctx: PrefsUiCtx, row: number): Promise<void> {
  const { term: host } = ctx;
  const handle = pushRegion(screenRegionSpec(), host.size());
  const term = regionSurface(host, handle.cells);
  try {
  term.clear();
  /* prt("", row - 1, 0) (ui-options.c:1211) - an erase, not a no-op print(""). */
  if (row > 0) term.prt(0, row - 1, "", UI_TEXT);
  term.prt(0, row, t("prefsUi.loadTitle", "Command: Load a user pref file"), UI_TEXT); // prt (ui-options.c:1213)
  const ftmp = `${playerSafeName(ctx.playerName(), 80, true)}.prf`;
  const name = argForceName()
    ? (await getCheck(term, t("prefsUi.confirmLoad", "Confirm loading {ftmp}? ", { ftmp })))
      ? ftmp
      : null
    : await getString(term, t("prefsUi.fileLabel", "File: "), ftmp, 80, row + 2);
  if (name === null) return;
  if (!processPrefFile(ctx, name)) {
    ctx.say(t("prefsUi.loadFailed", "Failed to load '{name}'!", { name }));
  } else {
    ctx.say(t("prefsUi.loaded", "Loaded '{name}'.", { name }));
  }
  } finally {
    popRegion(handle);
  }
}

/**
 * visual_menu_items[] (ui-options.c L814-822) with do_cmd_visuals' own header.
 * Upstream gives these rows no explicit tags (`selections = lower_case`), so
 * they letter positionally a..f.
 */
/**
 * A FUNCTION, not a constant: the rows are player-visible text and a locale
 * can change mid-session, so a `const` computed at import time would freeze
 * whichever language happened to be active first.
 */
function visualRows(): readonly string[] {
  return [
    t("prefsUi.visuals.loadPrefFile", "Load a user pref file"),
    t("prefsUi.visuals.saveMonster", "Save monster attr/chars"),
    t("prefsUi.visuals.saveObject", "Save object attr/chars"),
    t("prefsUi.visuals.saveFeature", "Save feature attr/chars"),
    t("prefsUi.visuals.saveFlavor", "Save flavor attr/chars"),
    t("prefsUi.visuals.reset", "Reset visuals"),
  ];
}

/** do_cmd_visuals (ui-options.c L831-852). */
export async function runVisualsMenu(ctx: PrefsUiCtx, title: string): Promise<void> {
  for (;;) {
    const rows = visualRows();
    const items: MenuItem[] = rows.map((label) => ({ label }));
    const idx = await selectFromMenu(
      ctx.term,
      "core:visuals",
      title,
      items,
      t("prefsUi.visuals.footer", "[ a-f to choose, ESC to return ]"),
      /* visual_menu->header (L845): the one-line note above the rows. */
      { subtitle: t("prefsUi.visuals.subtitle", "To edit visuals, use the knowledge menu") },
    );
    if (idx === null) return;
    const row = rows[idx];
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
        ctx.say(t("prefsUi.visuals.resetDone", "Visual attr/char tables reset."));
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
  const dumpColorsLabel = t("prefsUi.colors.dumpColors", "Dump colors");
  const items: MenuItem[] = [
    { label: t("prefsUi.colors.loadPrefFile", "Load a user pref file") },
    { label: dumpColorsLabel },
    { label: t("prefsUi.colors.modify", "Modify colors") },
  ];
  for (;;) {
    const idx = await selectFromMenu(
      ctx.term,
      "core:pref-options",
      title,
      items,
      t("prefsUi.colors.footer", "[ a-c to choose, ESC to return ]"),
    );
    if (idx === null) return;
    if (idx === 0) {
      /* colors_pref_load (L859-869): the load, then a full redraw. */
      await loadPrefFileHack(ctx, 8);
      ctx.afterLoad?.();
    } else if (idx === 1) {
      await dumpPrefFile(ctx, () => dumpColors(), dumpColorsLabel, 15);
    } else {
      await modify();
    }
  }
}

/** do_dump_options (ui-options.c L1247-1251): the subwindow flag dump. */
export function dumpWindowSettings(ctx: PrefsUiCtx): Promise<void> {
  return dumpPrefFile(ctx, () => optionDump(), t("prefsUi.dumpWindowSettings", "Dump window settings"), 20);
}

/** do_dump_autoinsc (ui-options.c L1254-1258). */
export function dumpAutoinscriptionsRow(ctx: PrefsUiCtx): Promise<void> {
  return dumpPrefFile(
    ctx,
    () => dumpAutoinscriptions(ctx.dumpDeps()),
    t("prefsUi.dumpAutoinscriptions", "Dump autoinscriptions"),
    20,
  );
}

/** do_dump_charscreen_opt (ui-options.c L1261-1265). */
export function dumpCharScreenOptions(ctx: PrefsUiCtx): Promise<void> {
  return dumpPrefFile(
    ctx,
    () => dumpUiEntryRenderers(ctx.dumpDeps()),
    t("prefsUi.dumpCharScreenOptions", "Dump char screen options"),
    20,
  );
}

/** options_load_pref_file (ui-options.c L1268-1272): the '=' -> 'p' row. */
export function loadUserPrefFileRow(ctx: PrefsUiCtx): Promise<void> {
  return loadPrefFileHack(ctx, 20);
}

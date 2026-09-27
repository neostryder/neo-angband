/** JSON preference export and import screens, plus the mod pref resource bridge. */

import { autoinscriptionFormat, entryRendererFormat, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  glyphTableSink,
  objectShortName,
  playerSafeName,
  prefErrorMessage,
  processPrefText,
  t,
  tvalFindName,
} from "@rpgm-tools/neo-angband-core";
import { HostDir, host } from "@rpgm-tools/neo-angband-core";
import type { DumpDeps, GlyphTable, PrefDeps, PrefSink } from "@rpgm-tools/neo-angband-core";
import { loadColorPrefs } from "./colors";
import { exportColorDocument } from "./colors";
import { exportUserFile } from "./user-io";
import {
  clearVisualDocument,
  exportVisualSection,
  importPreferenceDocument,
} from "./pref-documents";
import { getCheck, getString, selectFromMenu, screenRegionSpec } from "./overlay";
import { pickTextFile } from "./userdir";
import { popRegion, pushRegion, regionSurface } from "./ui-stack";
import { argForceName } from "./launch";
import type { MenuItem } from "./overlay";
import type { GridPointerInput, GridSurface } from "./term";
import { UI_TEXT } from "./ui-colors";
import { applyStoredSoundMappings } from "./sound";

/** What the pref screens need from the running game. */
export interface PrefsUiCtx {
  term: GridSurface & GridPointerInput;
  /** msg() + EVENT_MESSAGE_FLUSH. */
  say: (text: string) => void;
  /** Player name used for the default JSON export filenames. */
  playerName: () => string;
  /** The live x_attr/x_char tables the visuals dumps serialise. */
  glyphs: GlyphTable;
  /** Registries a visual document or mod pref resource resolves names against. */
  prefDeps: PrefDeps;
  /** Gamedata + live table a dump writer walks. */
  dumpDeps: () => DumpDeps;
  /** The non-glyph sink halves (autoinscriptions, message colours, ...). */
  extraSink?: Partial<PrefSink>;
  /** Repaint after a load changed colours (Term_xtra REACT + redraw_all). */
  afterLoad?: () => void;
  /** The current subwindow layout as a JSON document, including mod blocks. */
  layoutDocument?: () => string;
  /** Apply a layout document the player imported. A bad document does nothing. */
  applyLayoutDocument?: (text: string) => void;
}

/**
 * The JSON export file layer, over whatever host is installed.
 *
 * This goes through core's HostIo rather than straight at the virtual user
 * directory so the pref screens are host-agnostic: on the desktop build the
 * same code writes a real file into ANGBAND_DIR_USER, and on the web build the
 * BrowserHost still lands it in localStorage. See parity/PLATFORM.md - the
 * front end must not be the thing that decides what a file IS.
 */
const IO = {
  write: (path: string, text: string): boolean =>
    host().write(HostDir.USER, path, text) === "ok",
};

/**
 * A full-screen JSON export prompt with a filesystem-safe default name.
 *
 * Under arg_force_name (L65-69) the name is not typed: the host has pinned it,
 * so the same default is offered as "Confirm writing to %s? " and the player
 * either takes it or cancels. Reachable via main.c's `-f`, so only on a front
 * end with a command line - the web build has no argv and always asks.
 */
async function getJsonPath(ctx: PrefsUiCtx, what: string, fileName: string, row: number): Promise<string | null> {
  const { term: host } = ctx;
  const handle = pushRegion(screenRegionSpec(), host.size());
  const term = regionSurface(host, handle.cells);
  try {
  term.clear();
  /* prt("", row - 1, 0) (ui-options.c:53) is an ERASE of that row; print("") drew
   * nothing at all, so the call was a no-op. */
  if (row > 0) term.prt(0, row - 1, "", UI_TEXT);
  term.prt(0, row, t("prefsUi.pathPrompt", "{what} to a JSON file", { what }), UI_TEXT);
  const ftmp = fileName;
  if (argForceName()) {
    return (await getCheck(term, t("prefsUi.confirmWrite", "Confirm writing to {ftmp}? ", { ftmp })))
      ? ftmp
      : null;
  }
  /* prt("File: ", row + 2, 0) then askfor_aux(ftmp, sizeof ftmp) - which draws
   * where that prt left the cursor, so the answer echoes on row + 2. */
  const requested = await getString(term, t("prefsUi.fileLabel", "File: "), ftmp, 80, row + 2);
  if (requested === null) return null;
  if (requested.toLowerCase().endsWith(".json")) return requested;
  return `${requested.replace(/\.prf$/iu, "")}.json`;
  } finally {
    popRegion(handle);
  }
}

/**
 * Ask for the JSON path, save, and report.
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
function preferenceFileName(ctx: PrefsUiCtx, suffix: string): string {
  return `${playerSafeName(ctx.playerName(), 80, true)}-${suffix}.json`;
}

export async function dumpPrefFile(
  ctx: PrefsUiCtx,
  dump: () => string,
  title: string,
  row: number,
  fileName?: string,
): Promise<void> {
  const name = await getJsonPath(ctx, title, fileName ?? preferenceFileName(ctx, "preferences"), row);
  if (name === null) return;
  const shortTitle = title.slice(title.indexOf(" ") + 1);
  const text = dump();
  if (IO.write(name, text)) {
    exportUserFile(name, text, "application/json");
    ctx.say(t("prefsUi.saved", "Saved {shortTitle}.", { shortTitle }));
  } else {
    ctx.say(t("prefsUi.saveFailed", "Failed to save {shortTitle}.", { shortTitle }));
  }
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
 * The core parser still handles mod resources and tile mappings.
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
 * what upstream does. Errors
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

/** Pick a JSON preferences file and apply the document it names. */
export async function importPreferences(ctx: PrefsUiCtx): Promise<void> {
  let picked: Awaited<ReturnType<typeof pickTextFile>>;
  try {
    picked = await pickTextFile(".json,application/json");
  } catch {
    ctx.say(t("prefsUi.loadFailed", "Failed to load ''{name}''!", { name: "preferences.json" }));
    return;
  }
  if (picked === null) return;
  if ("tooLarge" in picked) {
    ctx.say(t("prefsUi.loadFailed", "Failed to load ''{name}''!", { name: picked.name }));
    return;
  }
  const result = importPreferenceDocument(picked.text, {
    glyphs: ctx.glyphs,
    deps: ctx.prefDeps,
    ...(ctx.extraSink ? { extra: ctx.extraSink } : {}),
    applyLayout: () => ctx.applyLayoutDocument?.(picked.text),
    applyColors: () => {
      loadColorPrefs();
      ctx.afterLoad?.();
    },
    applySounds: applyStoredSoundMappings,
  });
  if (result === "applied") ctx.say(t("prefsUi.loaded", "Loaded ''{name}''.", { name: picked.name }));
  else ctx.say(t("prefsUi.loadFailed", "Failed to load ''{name}''!", { name: picked.name }));
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
    t("prefsUi.visuals.loadPrefFile", "Import visual graphics"),
    t("prefsUi.visuals.saveMonster", "Export monster graphics"),
    t("prefsUi.visuals.saveObject", "Export object graphics"),
    t("prefsUi.visuals.saveFeature", "Export terrain graphics"),
    t("prefsUi.visuals.saveFlavor", "Export flavor graphics"),
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
        await importPreferences(ctx);
        break;
      case 1:
        await dumpPrefFile(ctx, () => exportVisualSection(ctx.glyphs, ctx.dumpDeps(), "monsters"), row!, 15, preferenceFileName(ctx, "monsters"));
        break;
      case 2:
        await dumpPrefFile(ctx, () => exportVisualSection(ctx.glyphs, ctx.dumpDeps(), "objects"), row!, 15, preferenceFileName(ctx, "objects"));
        break;
      case 3:
        await dumpPrefFile(ctx, () => exportVisualSection(ctx.glyphs, ctx.dumpDeps(), "features"), row!, 15, preferenceFileName(ctx, "terrain"));
        break;
      case 4:
        await dumpPrefFile(ctx, () => exportVisualSection(ctx.glyphs, ctx.dumpDeps(), "flavors"), row!, 15, preferenceFileName(ctx, "flavors"));
        break;
      case 5:
        /* visuals_reset (L806-813): reset_visuals(true) then the message. The
         * tile pipeline keeps its own map, so this only clears the ASCII
         * overrides and the document that would put them back next launch. */
        ctx.glyphs.reset();
        clearVisualDocument();
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
  const dumpColorsLabel = t("prefsUi.colors.dumpColors", "Export colors");
  const items: MenuItem[] = [
    { label: t("prefsUi.colors.loadPrefFile", "Import colors") },
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
      await importPreferences(ctx);
      ctx.afterLoad?.();
    } else if (idx === 1) {
      await dumpPrefFile(
        ctx,
        () => exportColorDocument(),
        dumpColorsLabel,
        15,
        preferenceFileName(ctx, "colors"),
      );
    } else {
      await modify();
    }
  }
}

/** The subwindow layout document, downloaded as JSON. */
export function dumpWindowSettings(ctx: PrefsUiCtx): Promise<void> {
  return dumpPrefFile(
    ctx,
    () => ctx.layoutDocument?.() ?? "",
    t("prefsUi.dumpWindowSettings", "Export subwindow layout"),
    20,
    preferenceFileName(ctx, "subwindows"),
  );
}

/** Aware autoinscriptions as a JSON document. */
export function dumpAutoinscriptionsRow(ctx: PrefsUiCtx): Promise<void> {
  return dumpPrefFile(
    ctx,
    () => autoinscriptionDocument(ctx),
    t("prefsUi.dumpAutoinscriptions", "Export autoinscriptions"),
    20,
    preferenceFileName(ctx, "autoinscriptions"),
  );
}

/** Character-screen renderer rows as a JSON document. */
export function dumpCharScreenOptions(ctx: PrefsUiCtx): Promise<void> {
  return dumpPrefFile(
    ctx,
    () => entryRendererDocument(ctx),
    t("prefsUi.dumpCharScreenOptions", "Export character screen options"),
    20,
    preferenceFileName(ctx, "character-screen"),
  );
}

/** The '=' -> 'p' row: pick a JSON preferences file and apply it. */
export function loadUserPrefFileRow(ctx: PrefsUiCtx): Promise<void> {
  return importPreferences(ctx);
}

function autoinscriptionDocument(ctx: PrefsUiCtx): string {
  const notes = [];
  const deps = ctx.dumpDeps();
  for (const kind of deps.objects.kinds) {
    if (!kind.name || !kind.tval) continue;
    const text = deps.autoinscription?.(kind.kidx) ?? null;
    if (text === null) continue;
    notes.push({ tval: tvalFindName(kind.tval), sval: objectShortName(kind.name), text });
  }
  return serializeDocument(autoinscriptionFormat, { notes });
}

function entryRendererDocument(ctx: PrefsUiCtx): string {
  const renderers = (ctx.dumpDeps().entryRenderers ?? []).map((row) => ({
    name: row.name,
    colors: row.colors,
    labelColors: row.labelColors,
    symbols: row.symbols,
  }));
  return serializeDocument(entryRendererFormat, { renderers });
}

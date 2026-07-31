/**
 * The download-and-install screen: the front end for RECOMMENDED_MODS.
 *
 * Everything under it was already built and had no caller. `mod-registry.ts` holds
 * the catalogue with a pinned tag and a SHA-256 per file; `mod-install.ts` fetches,
 * verifies, unzips and stores into IndexedDB, and `disk-packs.ts` reads installed
 * mods back at boot through the same validator a folder on disk goes through. The
 * only missing piece was a way for a player to ask for it, and until this existed
 * `installRecommendedMod` was referenced by nothing but its own tests - which is
 * the shape of a feature that is finished everywhere except where it is used.
 *
 * It matters more now than it did: the game bundles NO mods, so this and the
 * mods-folder picker are the two ways a mod arrives. The picker needs a directory
 * the browser will hand over, which Firefox and Safari will not; this needs only
 * fetch and IndexedDB, so it is the path that works everywhere.
 *
 * THE PURE PARTS ARE EXPORTED AND TESTED SEPARATELY. Row labels and the result
 * summary are the places where a wrong answer LOOKS right - an install that failed
 * on one file of seven, reported as a tick, is worse than no installer - so they
 * are plain functions over data rather than paint calls.
 */

import { selectFromMenu, showTextScreen, type MenuItem, type ScreenLine } from "./overlay";
import type { GlyphTerm } from "./term";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_GOOD, UI_BAD } from "./ui-colors";
import {
  RECOMMENDED_MODS,
  repoUrl,
  usableRecommendedMods,
  type RecommendedMod,
} from "./mod-registry";
import type { InstallProgress, InstallResult } from "./mod-install";

const C_FG = UI_TEXT;
const C_DIM = UI_DIM;
const C_WARN = UI_GOLD;
const C_GOOD = UI_GOOD;
const C_BAD = UI_BAD;

/** What the screen needs from the outside, so the tests need no IndexedDB and no network. */
export interface ModCatalogueDeps {
  /** Defaults to the shipped catalogue; a test passes its own. */
  readonly catalogue?: readonly RecommendedMod[];
  /** id -> installed tag, for every mod already downloaded. */
  readonly installed: () => Promise<ReadonlyMap<string, string>>;
  readonly install: (
    mod: RecommendedMod,
    onProgress: (p: InstallProgress) => void,
  ) => Promise<InstallResult>;
  /** True when the mod was removed. */
  readonly uninstall: (id: string) => Promise<boolean>;
}

/**
 * A size in the units a player thinks in.
 *
 * Binary units with their real names: 24.6 MiB is what the seven neo-linoleum
 * archives actually weigh, and rounding that to "25 MB" understates a download
 * someone may be paying for by the megabyte.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib < 10 ? 1 : 0)} MiB`;
}

/**
 * One catalogue row.
 *
 * The three states are distinct on purpose. "Installed" and "installed at a
 * DIFFERENT tag" look the same to anyone who only checks a boolean, and they are
 * not the same thing: the second is a mod whose bug reports would name a version
 * the player is not running.
 */
export function catalogueRow(mod: RecommendedMod, installedTag: string | null): MenuItem {
  const size = formatBytes(mod.approxBytes);
  if (installedTag === null) {
    return {
      label: `[ ] ${mod.name}  ${mod.tag}  (${size})`,
      color: C_FG,
      hint: `Not installed. Enter to download ${size} from ${mod.repo}.`,
    };
  }
  if (installedTag !== mod.tag) {
    return {
      label: `[~] ${mod.name}  ${installedTag} -> ${mod.tag}  (${size})`,
      color: C_WARN,
      hint: `Installed at ${installedTag}; the catalogue offers ${mod.tag}. Enter to update.`,
    };
  }
  return {
    label: `[x] ${mod.name}  ${mod.tag}`,
    color: C_GOOD,
    hint: "Installed. Enter to reinstall or remove. Turn it on in the mod list.",
  };
}

/**
 * The lines shown after an install attempt.
 *
 * A failure is reported with the reason the installer gave, verbatim. Those strings
 * name the file and the cause - a digest mismatch, a refused write, a path that
 * escapes the mod folder - and paraphrasing them into "install failed" would throw
 * away the only information anyone could act on.
 */
export function installSummary(mod: RecommendedMod, result: InstallResult): ScreenLine[] {
  if (result.ok) {
    return [
      { text: `${mod.name} ${mod.tag} installed.`, color: C_GOOD },
      { text: "", color: C_FG },
      {
        text: `${String(result.meta.files.length)} file(s), verified against the digests`,
        color: C_FG,
      },
      { text: "that ship inside this build - not against anything the", color: C_FG },
      { text: "download claimed about itself.", color: C_FG },
      { text: "", color: C_FG },
      { text: "It is OFF until you turn it on in the mod list, and a", color: C_FG },
      { text: "reload is what makes it take effect.", color: C_FG },
    ];
  }
  return [
    { text: `${mod.name} was NOT installed.`, color: C_BAD },
    { text: "", color: C_FG },
    { text: result.problem, color: C_WARN },
    { text: "", color: C_FG },
    { text: "Nothing was stored, so there is no half-installed mod to", color: C_FG },
    { text: "clean up. You can try again.", color: C_FG },
  ];
}

/** The progress line, as a player reads it. */
export function progressLine(mod: RecommendedMod, p: InstallProgress): string {
  return `${mod.name}: ${String(p.done)}/${String(p.total)}  ${p.path}`;
}

/** The screen shown when the catalogue has nothing usable in it. */
function emptyLines(problems: readonly string[]): ScreenLine[] {
  const lines: ScreenLine[] = [
    { text: "No mods are on offer in this build.", color: C_FG },
    { text: "", color: C_FG },
    { text: "The catalogue ships inside the app, with a pinned tag and a", color: C_FG },
    { text: "digest per file, so it only lists mods this build was built", color: C_FG },
    { text: "to trust. You can still add one from a folder on your", color: C_FG },
    { text: "computer - see Mods folder.", color: C_FG },
  ];
  if (problems.length > 0) {
    lines.push({ text: "", color: C_FG });
    lines.push({ text: "Rows this build refused:", color: C_WARN });
    for (const p of problems) lines.push({ text: `  ${p}`, color: C_WARN });
  }
  return lines;
}

/** What this screen is, for the player who asks. */
const ABOUT: readonly ScreenLine[] = [
  { text: "Where these come from", color: C_FG },
  { text: "", color: C_FG },
  { text: "Each mod lives in its own repository and is downloaded from a", color: C_FG },
  { text: "TAG - never a branch - so what arrives cannot change under you.", color: C_FG },
  { text: "", color: C_FG },
  { text: "Every file is checked against a SHA-256 that ships inside this", color: C_FG },
  { text: "build of the game. A file that does not match is discarded and", color: C_FG },
  { text: "nothing is stored, so a tampered or truncated download cannot", color: C_FG },
  { text: "become a mod that runs once and fails later.", color: C_FG },
  { text: "", color: C_FG },
  { text: "Installed mods are kept in your browser's storage, and are read", color: C_FG },
  { text: "back by the same validator that reads a mod folder on disk - so", color: C_FG },
  { text: "a mod behaves identically however it got here.", color: C_FG },
  { text: "", color: C_FG },
  { text: "Nothing is enabled by installing it. Every mod is off until you", color: C_WARN },
  { text: "turn it on in the mod list, which is the parity rule: the", color: C_FG },
  { text: "default experience is Angband 4.2.6 with no mod at all.", color: C_FG },
];

/**
 * Run the catalogue screen. Returns true when anything was installed or removed,
 * so the caller can offer the reload that makes it take effect.
 */
export async function showModCatalogue(
  term: GlyphTerm,
  deps: ModCatalogueDeps,
): Promise<boolean> {
  const { mods, problems } = usableRecommendedMods(deps.catalogue ?? RECOMMENDED_MODS);
  let changed = false;

  if (mods.length === 0) {
    await showTextScreen(term, "Install a mod", emptyLines(problems));
    return false;
  }

  for (;;) {
    const installed = await deps.installed();
    const items: MenuItem[] = mods.map((m) => catalogueRow(m, installed.get(m.id) ?? null));
    items.push({
      label: "What is this?",
      color: C_DIM,
      hint: "Where these come from, and how they are checked.",
    });
    if (problems.length > 0) {
      items.push({
        label: `${String(problems.length)} catalogue row(s) this build refused`,
        color: C_WARN,
        hint: "A row the validator rejected. It is not offered, and this says why.",
      });
    }

    const pick = await selectFromMenu(term, "Install a mod", items, "[ ESC to go back ]");
    if (pick === null) return changed;

    if (pick === mods.length) {
      await showTextScreen(term, "Install a mod", ABOUT);
      continue;
    }
    if (pick === mods.length + 1) {
      await showTextScreen(term, "Refused catalogue rows", [
        { text: "These rows are in the catalogue and are not offered:", color: C_FG },
        { text: "", color: C_FG },
        ...problems.map((p) => ({ text: `  ${p}`, color: C_WARN })),
        { text: "", color: C_FG },
        { text: "Each is a bug in this build's catalogue, not in your setup.", color: C_DIM },
      ]);
      continue;
    }

    const mod = mods[pick];
    if (!mod) continue;
    const at = installed.get(mod.id) ?? null;

    if (at !== null && at === mod.tag) {
      const what = await selectFromMenu(
        term,
        mod.name,
        [
          { label: "Reinstall", color: C_FG, hint: "Download and verify it again." },
          { label: "Remove", color: C_BAD, hint: "Delete its files from this browser." },
        ],
        "[ ESC to go back ]",
      );
      if (what === null) continue;
      if (what === 1) {
        const gone = await deps.uninstall(mod.id);
        changed = changed || gone;
        await showTextScreen(term, mod.name, [
          gone
            ? { text: `${mod.name} removed.`, color: C_FG }
            : { text: `${mod.name} could not be removed.`, color: C_BAD },
          { text: "", color: C_FG },
          { text: "Reload to stop loading it.", color: C_FG },
        ]);
        continue;
      }
    }

    await installOne(term, mod, deps);
    changed = true;
  }
}

/** Download one mod, drawing progress, then report. */
async function installOne(
  term: GlyphTerm,
  mod: RecommendedMod,
  deps: ModCatalogueDeps,
): Promise<void> {
  const paint = (line: string): void => {
    const { cols, rows } = term.size();
    term.clear();
    term.print(0, 1, mod.name.slice(0, cols - 1), C_FG);
    term.print(0, 3, line.slice(0, cols - 1), C_FG);
    /* No "press ESC to cancel": the installer has no cancel, and offering one that
     * does nothing is worse than saying nothing. */
    term.print(0, rows - 1, "Downloading...".slice(0, cols - 1), C_DIM);
  };
  paint(`${mod.name}: starting  (${formatBytes(mod.approxBytes)})`);
  const result = await deps.install(mod, (p) => {
    paint(progressLine(mod, p));
  });
  await showTextScreen(term, mod.name, [
    ...installSummary(mod, result),
    { text: "", color: C_FG },
    { text: repoUrl(mod), color: C_DIM },
  ]);
}

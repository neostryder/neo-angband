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
  compareTags,
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
  /**
   * Offer to turn a freshly-installed mod on, and do it. Returns true when it
   * ended up enabled.
   *
   * INSTALLING AND ENABLING ARE ONE ACTION HERE, because separating them was
   * making the common case take two screens: download the mod, read a summary
   * ending "it is OFF until you turn it on in the mod list", press ESC, find it
   * in that list, open it, choose Enable. Every one of those steps is defensible
   * and together they are a chore.
   *
   * It stays a QUESTION rather than becoming automatic. Nothing is enabled by
   * installing it - that is the parity rule, and a mod that switched itself on
   * because it finished downloading would break it - and the answer is also where
   * the capability-consent prompt and the permanent-non-scoring warning belong,
   * which is why this is a callback into the manager rather than code here.
   *
   * Optional, so a host that only wants the downloader (or a test) gets exactly
   * the old behaviour: the summary says where to turn it on, and stops.
   */
  readonly offerEnable?: (id: string) => Promise<boolean>;
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
 * FIVE STATES, NOT THREE. "Installed" and "installed at a DIFFERENT tag" look the
 * same to anyone who only checks a boolean, and they are not the same thing: the
 * second is a mod whose bug reports would name a version the player is not
 * running. But "different" is not one state either, and the row used to render it
 * as though it were - `installedTag !== mod.tag` produced an arrow and the word
 * "update" whichever way round the two versions actually stood. A player who
 * installed a mod from its own repository at a tag newer than the catalogue this
 * build shipped with would be shown `v0.12.0 -> v0.11.0  Enter to update`, and
 * pressing Enter would roll them back to the older one. So the direction is
 * computed (compareTags), and the three ways a tag can differ are three rows.
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
    const order = compareTags(installedTag, mod.tag);
    if (order !== null && order > 0) {
      /* AHEAD of the catalogue. Not a fault and not an update: this is what a mod
       * author testing their own release sees, and what any player sees whose mod
       * moved faster than the game build did. Enter still works - reinstalling at
       * the catalogue's tag is a legitimate thing to want - but the row says
       * REPLACE and names the direction, because "update" here would be a lie the
       * player only discovers afterwards. */
      return {
        label: `[x] ${mod.name}  ${installedTag}  (newer than this catalogue)`,
        color: C_GOOD,
        hint:
          `Installed at ${installedTag}; this build's catalogue only knows ${mod.tag}. ` +
          `Enter would REPLACE it with the older ${mod.tag}.`,
      };
    }
    /* Behind the catalogue, or two tags that cannot be ordered at all (a tag need
     * not be a version). Both offer the catalogue's copy; only the first may call
     * it an update. */
    const behind = order !== null;
    return {
      label: `[~] ${mod.name}  ${installedTag} -> ${mod.tag}  (${size})`,
      color: C_WARN,
      hint: behind
        ? `Installed at ${installedTag}; the catalogue offers the newer ${mod.tag}. Enter to update.`
        : `Installed at ${installedTag}; the catalogue offers ${mod.tag}, which cannot be ` +
          `ordered against it. Enter to install the catalogue's copy.`,
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
export function installSummary(
  mod: RecommendedMod,
  result: InstallResult,
  /** True when the caller is about to offer to turn it on, so the closing line changes. */
  willOfferEnable = false,
): ScreenLine[] {
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
      ...(willOfferEnable
        ? [
            { text: "It is OFF, as every mod is until you say otherwise.", color: C_FG },
            { text: "You are asked next whether to turn it on.", color: C_FG },
          ]
        : [
            { text: "It is OFF until you turn it on in the mod list, and a", color: C_FG },
            { text: "reload is what makes it take effect.", color: C_FG },
          ]),
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
  { text: "", color: C_FG },
  /* Named rather than left to be discovered. A mod from this screen is the only
   * kind the game can tell you is out of date, because it is the only kind whose
   * intended version this build knows - a mod in a folder you picked, or one an
   * external manager deployed, has no version to compare against. Saying so here
   * is cheaper than a player assuming the silence means "up to date". */
  { text: "This screen is also the only place the game can notice that a", color: C_FG },
  { text: "mod is out of date, and it can only do that for mods listed", color: C_FG },
  { text: "here. A mod you added from a folder is whatever version you", color: C_FG },
  { text: "put there; nothing checks it, and nothing will tell you when", color: C_FG },
  { text: "its author releases a new one.", color: C_FG },
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

    /* A ROLLBACK IS CONFIRMED, an update is not. The row already says which way
     * this goes, but the row is read once and the consequence lands afterwards -
     * and this is the one press on this screen that can leave the player with LESS
     * than they started with. */
    if (at !== null && (compareTags(at, mod.tag) ?? 0) > 0) {
      const go = await selectFromMenu(
        term,
        `Replace ${mod.name} ${at} with ${mod.tag}?`,
        [
          { label: "Keep what I have", color: C_FG, hint: `Leave ${at} installed.` },
          {
            label: `Replace with ${mod.tag}`,
            color: C_WARN,
            hint: `Downloads the older ${mod.tag} over your ${at}.`,
          },
        ],
        "[ ESC to go back ]",
      );
      if (go !== 1) continue;
    }

    await installOne(term, mod, deps);
    changed = true;
  }
}

/** Download one mod, drawing progress, then report - and offer to turn it on. */
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
  const offer = result.ok && deps.offerEnable !== undefined;
  await showTextScreen(term, mod.name, [
    ...installSummary(mod, result, offer),
    { text: "", color: C_FG },
    { text: repoUrl(mod), color: C_DIM },
  ]);
  /* The second half of "install and enable in one action". The manager owns the
   * question because it owns the gates behind the answer - consent, the
   * non-scoring ratchet, an author's conflict claim - and none of those belong to
   * a downloader. A failed install offers nothing: there is no mod to turn on. */
  if (offer) await deps.offerEnable?.(mod.id);
}

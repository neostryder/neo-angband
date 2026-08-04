/**
 * The four doors: how a player actually reaches a mod.
 *
 * WHAT THIS REPLACES, AND WHY. The old screen was a front end for RECOMMENDED_MODS -
 * a catalogue COMPILED INTO THE BUILD, holding each mod's name, version, description
 * and a SHA-256 per file. That shape has one fatal property: a mod cannot be updated
 * without updating the game, because the game is where the mod's version lives. It
 * also meant the build knew things about mods that are not the build's to know.
 *
 * Now the game knows one thing - where to ask - and everything else comes from the
 * mod's own repository (mod-discover.ts). Three ways in, and they are the SAME way
 * in: all three produce a RepoRef, go through the same discovery, the same
 * requirements inspection and the same install.
 *
 *   1. Recommended    - the curated list in this game's own repository. A list of
 *                       repository POINTERS, re-curatable without a release.
 *   2. A registry      - anybody else's list of the same shape, by address.
 *   3. A repository    - one mod, by owner/repo or a GitHub URL.
 *   4. A .zip file      - the one door that does NOT end in a repository. Either an
 *                       archive waiting in the game's own mods folder, or one the
 *                       player chooses. See mod-zip.ts for what an archive has to be,
 *                       and mod-zip-source.ts for why those two halves differ.
 *
 * Doors 2, 3 and 4 need "Allow third-party mods" first (mod-consent.ts). Door 1 does
 * not, because a maintainer putting a repository on that list is the act of
 * vouching - and the disclaimer says plainly that vouching is not auditing. There is
 * no such thing as a curated zip: an archive did not come from the curated list, so
 * door 4 is third-party by construction.
 *
 * WHAT A ROW SAYS AND WHERE EACH PART CAME FROM is the whole design. The name,
 * version, description, size and engine range are the MOD's, read from its
 * repository at a tag. The compatibility verdict is the LOADER's, from the same
 * function that gates at load time. The author standing is the REGISTER's, worded so
 * it cannot be read as a review. Nothing on the row is the build's opinion, because
 * the build no longer has one.
 *
 * The pure parts - `browseRow`, `sourceLabel`, `installFailureLines` - are exported
 * and tested on their own, for the reason the catalogue's were: a row that says the
 * wrong thing convincingly is worse than a row that says nothing.
 */

import { promptText, selectFromMenu, showTextScreen, type MenuItem, type ScreenLine } from "./overlay";
import type { GlyphTerm } from "./term";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_GOOD, UI_BAD } from "./ui-colors";
import { formatBytes } from "./mod-catalogue";
import { authorFor, standingNote, type AuthorRegister } from "./mod-authors";
import { CONSENT_DISCLAIMER, type ModOrigin } from "./mod-consent";
import { DEFAULT_REGISTRY_URL, type ModRegistry } from "./mod-curated";
import type { DiscoveredMod } from "./mod-discover";
import { parseRepoRef, repoPageUrl, type RepoRef } from "./mod-source";
import type { InstallProgress, InstallResult } from "./mod-install";
import type { WaitingZip, ZipImportDeps } from "./mod-zip-source";
import {
  pendingUpgrades,
  refreshRow,
  repoPage,
  unavailableMods,
  upToDateHeadline,
  type ModRefresh,
} from "./mod-refresh";

const C_FG = UI_TEXT;
const C_DIM = UI_DIM;
const C_WARN = UI_GOLD;
const C_GOOD = UI_GOOD;
const C_BAD = UI_BAD;

/** One mod, discovered or not, ready to be a row. */
export type BrowseEntry =
  | { readonly ok: true; readonly ref: RepoRef; readonly mod: DiscoveredMod }
  | { readonly ok: false; readonly ref: RepoRef; readonly problem: string };

/** Everything the screen needs, injected so the tests need no network and no IndexedDB. */
export interface ModBrowseDeps {
  /** id -> installed tag, for every mod already installed from a repository. */
  readonly installed: () => Promise<ReadonlyMap<string, string>>;
  /** Discover one repository. Wired to discoverMod, with the player's channel. */
  readonly discover: (ref: RepoRef) => Promise<BrowseEntry>;
  /** Install a discovered mod. Enforces consent itself; see mod-install.ts. */
  readonly install: (
    mod: DiscoveredMod,
    origin: ModOrigin,
    onProgress: (p: InstallProgress) => void,
  ) => Promise<InstallResult>;
  readonly uninstall: (id: string) => Promise<boolean>;
  /** The curated list, or the problem reading it. */
  readonly curated: () => Promise<{ registry: ModRegistry | null; problem: string | null }>;
  /** Somebody else's list, by address. */
  readonly registryAt: (
    url: string,
  ) => Promise<{ registry: ModRegistry | null; problem: string | null }>;
  /** The author register, or null when it could not be read - which decides nothing. */
  readonly authors: () => Promise<AuthorRegister | null>;
  readonly consent: {
    readonly read: () => boolean;
    /** False when the answer could not be recorded, which must be reported. */
    readonly write: (allow: boolean) => boolean;
  };
  /** Offer to turn a freshly-installed mod on. See ModCatalogueDeps.offerEnable. */
  readonly offerEnable?: (id: string) => Promise<boolean>;
  /**
   * Importing a mod from an archive. Absent where no file can be read at all.
   *
   * The fourth door, and the only one that does not end in a repository - see
   * mod-zip-source.ts for why its two halves are not the same door.
   */
  readonly importZip?: ZipImportDeps;
}

/** ModBrowseDeps plus the one thing the update screen needs of its own. */
export interface ModUpgradeDeps extends ModBrowseDeps {
  /** Ask every installed mod's own repository where it stands (mod-refresh.ts). */
  readonly refresh: () => Promise<readonly ModRefresh[]>;
}

/** How a source is named on screen, and in a message about it. */
export function sourceLabel(origin: ModOrigin, registryName: string): string {
  return origin === "curated" ? "Recommended mods" : registryName;
}

/**
 * One row for a discovered mod.
 *
 * A DISCOVERY FAILURE IS A ROW, not a missing row. A repository that has been renamed
 * or has no release yet must SAY so where the player is looking for it; dropping it
 * would make a curated list quietly shrink, and the player would have no way to tell
 * a mod that was removed from one that could not be reached.
 */
export function browseRow(entry: BrowseEntry, installedTag: string | null): MenuItem {
  if (!entry.ok) {
    return {
      label: `${entry.ref.repo} - unavailable`,
      color: C_BAD,
      hint: entry.problem,
    };
  }
  const m = entry.mod;
  const size = m.bytes === null ? "" : `  ${formatBytes(m.bytes)}`;

  /* NO AUTHOR BADGE ON THE ROW, deliberately, though the register is right here.
   * A one-word marker beside a name is exactly the thing a player reads as "checked",
   * and no listing means that (see standingNote). The standing goes in the detail
   * pane, in a full sentence that can say what it does and does not mean - and that
   * pane is shown by default, so it is not hidden, just not compressed into a word
   * that would mislead. */
  if (!m.compatible) {
    return {
      label: `${m.name} ${m.version} - will not run on this version`,
      color: C_BAD,
      hint: m.engineNote ?? `needs engine ${m.engine ?? "(unstated)"}`,
    };
  }

  const mark =
    installedTag === null ? " " : installedTag === m.tag ? "*" : "~";
  const state =
    installedTag === null
      ? ""
      : installedTag === m.tag
        ? "  installed"
        : `  installed ${installedTag}`;

  return {
    label: `[${mark}] ${m.name} ${m.version}${state}${size}`,
    color: installedTag === null ? C_FG : C_GOOD,
    hint:
      (m.description?.split("\n")[0] ?? "No description.") +
      (m.channelHeld !== null ? `  (${m.channelHeld} is on a faster channel)` : ""),
  };
}

/**
 * Greedy word-wrap to `width`, preserving the author's own line breaks.
 *
 * A description is prose written by somebody else and can be any length. Without
 * this, every line ran off the right edge and was truncated mid-word - measured in
 * the real build, where a mod's description read "Angband's own options are cor" and
 * the author standing lost the half that says nobody reviewed the code. Truncation
 * eats the END of a line, which is exactly where a sentence's qualification lives.
 */
function wrapTo(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/u).filter((w) => w.length > 0)) {
      if (line.length === 0) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line !== "") out.push(line);
  }
  return out;
}

/**
 * The detail pane for one mod: everything its repository said, attributed.
 *
 * `width` is the pane's columns. It has a default so the pure tests can call this
 * without inventing a terminal, but the screen passes the real one - a default that
 * silently disagreed with the terminal is how the truncation above survived.
 */
export function browseDetail(
  entry: BrowseEntry,
  installedTag: string | null,
  authors: AuthorRegister | null,
  width = 78,
): ScreenLine[] {
  const wrap = (text: string, color: string): ScreenLine[] =>
    wrapTo(text, width).map((t) => ({ text: t, color }));

  if (!entry.ok) {
    return [
      ...wrap(`${entry.ref.repo} could not be read.`, C_BAD),
      { text: "", color: C_FG },
      ...wrap(entry.problem, C_WARN),
      { text: "", color: C_FG },
      { text: repoPageUrl(entry.ref.repo), color: C_DIM },
    ];
  }
  const m = entry.mod;
  const out: ScreenLine[] = [
    ...wrap(m.name, C_FG),
    { text: "", color: C_FG },
    ...wrap(m.description ?? "No description.", C_FG),
  ];
  out.push({ text: "", color: C_FG });
  out.push({ text: `Version    ${m.version}  (tag ${m.tag})`, color: C_DIM });
  if (installedTag !== null) {
    out.push({ text: `Installed  ${installedTag}`, color: C_DIM });
  }
  out.push({
    text: `Engine     ${m.engine ?? "not stated"}${m.compatible ? "" : "  - will not run here"}`,
    color: m.compatible ? C_DIM : C_BAD,
  });
  if (m.bytes !== null) {
    out.push({
      text: `Download   ${formatBytes(m.bytes)} in ${String(m.payload.length)} file(s)`,
      color: C_DIM,
    });
  }
  /* NOT wrapped: a URL has no spaces to break at, so wrapping cannot help it and
   * folding it mid-path would produce something unusable to copy. Long repository
   * names are the one thing this pane still lets run to the edge, deliberately. */
  out.push({ text: `From       ${repoPageUrl(m.repo, m.tag)}`, color: C_DIM });
  /* The standing, in the register's own words, WRAPPED - it is the sentence whose
   * end says nobody reviewed the code, and truncation eats ends. */
  out.push({ text: "", color: C_FG });
  out.push(...wrap(standingNote(authorFor(authors, m.repo), m.repo), C_DIM));
  if (m.channelHeld !== null) {
    out.push({ text: "", color: C_FG });
    out.push(
      ...wrap(
        `A newer version (${m.channelHeld}) exists on a faster update channel.`,
        C_WARN,
      ),
    );
  }
  if (m.guessedPayload) {
    /* Said out loud, because it is the difference between "the author decided what
     * ships" and "the game guessed". A player reporting a broken install should know
     * which of those they are looking at. */
    out.push({ text: "", color: C_FG });
    out.push(
      ...wrap(
        "This mod does not declare which of its files to install, so they were " +
          "worked out from the repository.",
        C_DIM,
      ),
    );
  }
  return out;
}

/**
 * The width a refusal is wrapped to before it is shown.
 *
 * Fixed rather than measured, because these are pure functions with no terminal to ask,
 * and 74 fits the narrowest layout the game draws. The number earns its place: a
 * refusal is the one screen whose LAST words carry the instruction - "...one at a time,
 * each in its own zip" - and an unwrapped line loses its end, not its middle.
 */
const MESSAGE_WIDTH = 74;

/**
 * Wrap one line of a message, and only if it needs it.
 *
 * wrapTo splits on whitespace, so passing it every line would strip the indent off the
 * bulleted requirements the standards inspection returns - turning a readable list into
 * a flush-left block. A line that already fits is therefore handed back untouched, and
 * a line that does not keeps its indent on every continuation.
 */
function wrapMessage(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const indent = /^[ \t]*/u.exec(line)?.[0] ?? "";
  return wrapTo(line, Math.max(20, width - indent.length)).map((l) => indent + l);
}

/** What to show when an install was refused. Never a bare "it failed". */
export function installFailureLines(name: string, problem: string): ScreenLine[] {
  return [
    { text: `${name} was not installed.`, color: C_BAD },
    { text: "", color: C_FG },
    ...problem
      .split("\n")
      .flatMap((line) => wrapMessage(line, MESSAGE_WIDTH))
      .map((line) => ({ text: line, color: C_WARN })),
    { text: "", color: C_FG },
    { text: "Nothing was stored, so your other mods are untouched.", color: C_DIM },
  ];
}

const ABOUT: readonly ScreenLine[] = [
  { text: "Where mods come from", color: C_FG },
  { text: "", color: C_FG },
  { text: "This game ships no mods and holds no list of what a mod contains.", color: C_FG },
  { text: "Everything you see about a mod - its name, version, description,", color: C_FG },
  { text: "size and the game versions it supports - is read from that mod's", color: C_FG },
  { text: "own repository when this screen opens. So a mod can release an", color: C_FG },
  { text: "update without waiting for a new version of the game.", color: C_FG },
  { text: "", color: C_FG },
  { text: "Recommended mods is a list of REPOSITORIES kept in the game's", color: C_FG },
  { text: "own repository. It says somebody thought a mod was worth", color: C_FG },
  { text: "offering. It does not say anybody read its code.", color: C_FG },
  { text: "", color: C_FG },
  { text: "A registry is the same kind of list, published by somebody else.", color: C_FG },
  { text: "A repository address installs a single mod. Both need", color: C_FG },
  { text: '"Allow third-party mods" turned on first.', color: C_FG },
  { text: "", color: C_FG },
  { text: "On first install a mod is pinned to the repository it came from,", color: C_FG },
  { text: "and can only ever be updated from that same place. The files it", color: C_FG },
  { text: "stored are listed in the mod manager, with a check for whether", color: C_FG },
  { text: "they have changed since.", color: C_FG },
  { text: "", color: C_FG },
  { text: "Your update channel decides which mod versions you are offered:", color: C_DIM },
  { text: "a stable game is offered a mod's releases, and beta or early", color: C_DIM },
  { text: "are also offered its pre-releases.", color: C_DIM },
];

/** Ask the consent question, showing the disclaimer. Returns the new setting. */
async function askConsent(term: GlyphTerm, deps: ModBrowseDeps): Promise<boolean> {
  const on = deps.consent.read();
  if (on) {
    const off = await selectFromMenu(
      term,
      "Third-party mods are allowed",
      [
        { label: "Leave them allowed", color: C_FG, hint: "No change." },
        {
          label: "Stop allowing them",
          color: C_WARN,
          /* Stated on the row, because the fear that it deletes things is exactly
           * what stops people using a safety control. */
          hint: "Does not uninstall or delete anything you already added.",
        },
      ],
      "[ ESC to go back ]",
    );
    if (off === 1 && !deps.consent.write(false)) {
      await showTextScreen(term, "Could not save that", [
        { text: "This browser would not let the game record the setting.", color: C_BAD },
        { text: "It is off for now and may be back on next time.", color: C_FG },
      ]);
    }
    return deps.consent.read();
  }

  await showTextScreen(term, "Before you allow third-party mods", [
    ...CONSENT_DISCLAIMER.map((text) => ({
      text,
      color: text.trimStart().startsWith("-") ? C_DIM : C_FG,
    })),
  ]);
  const yes = await selectFromMenu(
    term,
    "Allow third-party mods?",
    [
      { label: "No, not for now", color: C_FG, hint: "Only the recommended list stays available." },
      {
        label: "Yes, I understand",
        color: C_WARN,
        hint: "Lets you install from any registry or repository.",
      },
    ],
    "[ ESC to go back - the same as No ]",
  );
  if (yes !== 1) return false;
  if (!deps.consent.write(true)) {
    await showTextScreen(term, "Could not save that", [
      { text: "This browser would not let the game record the setting.", color: C_BAD },
      { text: "", color: C_FG },
      { text: "You can still install now, but you will be asked again.", color: C_FG },
    ]);
    /* Honest: the answer was given, so honour it for this session rather than
     * pretending the player did not answer. It simply will not persist. */
    return true;
  }
  return true;
}

/** Install one mod, with progress, and offer to enable it. */
async function installOne(
  term: GlyphTerm,
  entry: Extract<BrowseEntry, { ok: true }>,
  origin: ModOrigin,
  deps: ModBrowseDeps,
): Promise<boolean> {
  const m = entry.mod;
  const result = await deps.install(m, origin, (p) => {
    const { rows } = term.size();
    term.clear();
    term.print(0, 1, `Installing ${m.name} ${m.version}`, C_FG);
    term.print(0, 3, `${String(p.done)} of ${String(p.total)}: ${p.path}`, C_DIM);
    term.print(0, rows - 1, "[ please wait ]", C_DIM);
    term.flush?.();
  });

  if (!result.ok) {
    await showTextScreen(term, m.name, installFailureLines(m.name, result.problem));
    return false;
  }

  const enabled = deps.offerEnable ? await deps.offerEnable(m.id) : false;
  await showTextScreen(term, m.name, [
    { text: `${m.name} ${m.version} installed.`, color: C_GOOD },
    { text: "", color: C_FG },
    {
      text: `${String(result.meta.files.length)} file(s) stored, from ${repoPageUrl(m.repo, m.tag)}.`,
      color: C_DIM,
    },
    { text: "", color: C_FG },
    ...(enabled
      ? [{ text: "It is enabled. Reload to start using it.", color: C_FG }]
      : [
          { text: "It is OFF until you turn it on in the mod list.", color: C_FG },
          { text: "Nothing is enabled by installing it.", color: C_DIM },
        ]),
  ]);
  return true;
}

/**
 * Show one source's mods, discovering each as the list is built.
 *
 * Discovery is per repository and the results are kept for the life of this screen:
 * a list of twenty mods is twenty pairs of API calls, and rebuilding it every time a
 * player presses ESC out of a detail pane would spend a rate limit on nothing.
 */
async function showSource(
  term: GlyphTerm,
  title: string,
  origin: ModOrigin,
  refs: readonly RepoRef[],
  problems: readonly string[],
  deps: ModBrowseDeps,
): Promise<boolean> {
  let changed = false;
  const authors = await deps.authors();

  if (refs.length === 0) {
    await showTextScreen(term, title, [
      { text: "This list names no mods this game can install.", color: C_FG },
      { text: "", color: C_FG },
      ...problems.map((p) => ({ text: `  ${p}`, color: C_WARN })),
    ]);
    return false;
  }

  term.clear();
  term.print(0, 1, title, C_FG);
  term.print(0, 3, `Asking ${String(refs.length)} repositories what they hold...`, C_DIM);
  term.flush?.();

  const entries: BrowseEntry[] = [];
  for (const ref of refs) entries.push(await deps.discover(ref));

  for (;;) {
    const installed = await deps.installed();
    const items: MenuItem[] = entries.map((e) =>
      browseRow(e, e.ok ? (installed.get(e.mod.id) ?? null) : null),
    );
    items.push({ label: "What is this?", color: C_DIM, hint: "Where these come from." });
    if (problems.length > 0) {
      items.push({
        label: `${String(problems.length)} entry(s) in this list could not be read`,
        color: C_WARN,
        hint: "A problem with the list itself, not with your setup.",
      });
    }

    const pick = await selectFromMenu(term, title, items, "[ ESC to go back ]", {
      detail: (i) => {
        const e = entries[i];
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
    });
    if (pick === null) return changed;

    if (pick === entries.length) {
      await showTextScreen(term, title, ABOUT);
      continue;
    }
    if (pick === entries.length + 1) {
      await showTextScreen(term, title, [
        { text: "These entries are in the list and are not offered:", color: C_FG },
        { text: "", color: C_FG },
        ...problems.map((p) => ({ text: `  ${p}`, color: C_WARN })),
      ]);
      continue;
    }

    const entry = entries[pick];
    if (!entry) continue;
    if (!entry.ok) {
      await showTextScreen(term, entry.ref.repo, browseDetail(entry, null, authors));
      continue;
    }
    if (!entry.mod.compatible) {
      /* Refused BEFORE the action menu, not after it. Offering "Install" on a mod
       * that cannot run and failing afterwards wastes a download and reads as a bug. */
      await showTextScreen(term, entry.mod.name, [
        { text: `${entry.mod.name} will not run on this version of the game.`, color: C_BAD },
        { text: "", color: C_FG },
        { text: entry.mod.engineNote ?? `It needs engine ${entry.mod.engine ?? "?"}.`, color: C_WARN },
        { text: "", color: C_FG },
        { text: "Updating the game may be all it needs.", color: C_DIM },
      ]);
      continue;
    }

    const at = installed.get(entry.mod.id) ?? null;
    const actions: MenuItem[] =
      at === null
        ? [{ label: `Install ${entry.mod.version}`, color: C_FG, hint: "Download and store it." }]
        : at === entry.mod.tag
          ? [
              { label: "Reinstall", color: C_FG, hint: "Download it again." },
              { label: "Remove", color: C_BAD, hint: "Delete its files." },
            ]
          : [
              {
                label: `Change to ${entry.mod.version}`,
                color: C_WARN,
                hint: `You have ${at}.`,
              },
              { label: "Remove", color: C_BAD, hint: "Delete its files." },
            ];

    const what = await selectFromMenu(term, entry.mod.name, actions, "[ ESC to go back ]");
    if (what === null) continue;
    if (at !== null && what === 1) {
      const gone = await deps.uninstall(entry.mod.id);
      changed = changed || gone;
      await showTextScreen(term, entry.mod.name, [
        gone
          ? { text: `${entry.mod.name} removed.`, color: C_FG }
          : { text: `${entry.mod.name} could not be removed.`, color: C_BAD },
        { text: "", color: C_FG },
        { text: "Reload to stop loading it.", color: C_FG },
      ]);
      continue;
    }
    if (await installOne(term, entry, origin, deps)) changed = true;
  }
}

/** Read a registry, then show it. Shared by doors 1 and 2. */
async function openRegistry(
  term: GlyphTerm,
  origin: ModOrigin,
  read: () => Promise<{ registry: ModRegistry | null; problem: string | null }>,
  deps: ModBrowseDeps,
): Promise<boolean> {
  term.clear();
  term.print(0, 1, "Reading the list...", C_DIM);
  term.flush?.();
  const { registry, problem } = await read();
  if (!registry) {
    await showTextScreen(term, "Could not read that list", [
      { text: problem ?? "The list could not be read.", color: C_BAD },
      { text: "", color: C_FG },
      { text: "Mods you have already installed are unaffected.", color: C_DIM },
    ]);
    return false;
  }
  return await showSource(
    term,
    sourceLabel(origin, registry.name),
    origin,
    registry.mods,
    registry.problems,
    deps,
  );
}

/* ------------------------------------------------------------------ *
 * The fourth door: a mod that arrived as a file.
 * ------------------------------------------------------------------ */

/** How one waiting archive reads on its row. */
export function waitingZipRow(z: WaitingZip): string {
  return `${z.name}  (${formatBytes(z.bytes)})`;
}

/**
 * What the screen says after an import, including the part about the file itself.
 *
 * A SEPARATE FUNCTION BECAUSE THE SENTENCE IS THE FEATURE. Three outcomes have to be
 * distinguishable: the archive was deleted, the archive is still there because this
 * platform cannot delete it, and the archive is still there because deleting it FAILED.
 * Collapsing the last two into "installed" would leave a player with a duplicate they
 * do not know about; collapsing them into "could not delete" would report a fault on a
 * browser that never had the ability in the first place.
 */
export function importedLines(
  id: string,
  fileCount: number,
  source: string,
  discarded: { readonly ok: boolean; readonly error?: string } | null,
  enabled: boolean,
): readonly ScreenLine[] {
  const tail: ScreenLine[] =
    discarded === null
      ? [
          { text: `${source} is still where you left it.`, color: C_DIM },
          { text: "The game has its own copy now; you can delete yours.", color: C_DIM },
        ]
      : discarded.ok
        ? [{ text: `${source} has been removed from the mods folder.`, color: C_DIM }]
        : [
            { text: `${source} is still in the mods folder.`, color: C_WARN },
            {
              text: `It could not be removed: ${discarded.error ?? "no reason given"}`,
              color: C_WARN,
            },
            { text: "The mod is installed. Deleting the file is safe.", color: C_DIM },
          ];
  return [
    { text: `${id} installed.`, color: C_GOOD },
    { text: "", color: C_FG },
    { text: `${String(fileCount)} file(s) stored, from ${source}.`, color: C_DIM },
    ...tail,
    { text: "", color: C_FG },
    ...(enabled
      ? [{ text: "It is enabled. Reload to start using it.", color: C_FG }]
      : [
          { text: "It is OFF until you turn it on in the mod list.", color: C_FG },
          { text: "Nothing is enabled by installing it.", color: C_DIM },
        ]),
  ];
}

/** Read, validate, store - then, only then, discard the source. */
async function importOne(
  term: GlyphTerm,
  bytes: Uint8Array,
  source: string,
  /** The leaf name to delete afterwards, or null for a file the game does not own. */
  discardable: string | null,
  deps: ModBrowseDeps,
  zip: ZipImportDeps,
): Promise<boolean> {
  const result = await paintWhile(term, "Importing", `Checking ${source}...`, () =>
    zip.install(bytes),
  );
  if (!result.ok) {
    await showTextScreen(term, "That zip was not imported", [
      ...result.problem
        .split("\n")
        .flatMap((line) => wrapMessage(line, MESSAGE_WIDTH))
        .map((line) => ({ text: line, color: C_BAD })),
      { text: "", color: C_FG },
      { text: "Nothing has been installed or changed.", color: C_DIM },
    ]);
    return false;
  }

  /* STORE FIRST, DELETE SECOND, and never the other way round. The two cannot be made
   * one operation - IndexedDB and a filesystem have no shared transaction - so the
   * question is only which wreckage is survivable. Deleting first and failing to store
   * loses the archive; storing first and failing to delete leaves a duplicate the
   * player can remove. Prefer the one that costs a tidy-up. */
  const discarded =
    discardable !== null && zip.discard !== null ? await zip.discard(discardable) : null;

  const enabled = deps.offerEnable ? await deps.offerEnable(result.meta.id) : false;
  await showTextScreen(
    term,
    result.meta.id,
    importedLines(result.meta.id, result.meta.files.length, source, discarded, enabled),
  );
  return true;
}

/**
 * "Import a mod from a file".
 *
 * Lists whatever is waiting in the game's own mods folder, and offers the file picker
 * underneath it. Both halves end in the same importOne, so an archive that came out of
 * the folder and one the player chose are validated, stored and reported identically -
 * the ONLY difference between them is whether the source file can be deleted, and that
 * difference is stated on the screen rather than hidden.
 */
export async function showZipImport(term: GlyphTerm, deps: ModBrowseDeps): Promise<boolean> {
  const zip = deps.importZip;
  if (!zip) return false;
  let changed = false;

  for (;;) {
    const waiting = await paintWhile(term, "Import a mod", "Looking in the mods folder...", () =>
      zip.waiting(),
    );
    const folder = zip.folder();

    const items: MenuItem[] = [
      ...waiting.map((z) => ({
        label: waitingZipRow(z),
        color: C_FG,
        hint:
          zip.discard === null
            ? "Import this archive."
            : "Import it, then remove the zip from the mods folder.",
      })),
      {
        label: "Choose a .zip file...",
        color: C_FG,
        hint: "Any zip on your machine. Your copy of it is left alone.",
      },
      { label: "What is this?", color: C_DIM, hint: "What a mod zip has to look like." },
    ];

    const title = folder === null ? "Import a mod" : `Import a mod  -  ${folder}`;
    const pick = await selectFromMenu(term, title, items, "[ ESC to go back ]");
    if (pick === null) return changed;

    if (pick === items.length - 1) {
      await showTextScreen(term, "Import a mod", aboutImport(folder, zip.discard !== null));
      continue;
    }

    /* The consent check is repeated at the INSTALL (mod-install.ts); this one exists so
     * the player is offered the disclaimer instead of being refused after choosing a
     * file. An imported mod is third-party by definition - there is no curated zip. */
    if (!deps.consent.read()) {
      if (!(await askConsent(term, deps))) continue;
    }

    if (pick === items.length - 2) {
      const chosen = await zip.pick();
      if (chosen === null) continue;
      if (await importOne(term, chosen.bytes, chosen.name, null, deps, zip)) changed = true;
      continue;
    }

    const which = waiting[pick];
    if (!which) continue;
    const bytes = await paintWhile(term, "Import a mod", `Reading ${which.name}...`, () =>
      zip.read(which.name),
    );
    if (bytes === null) {
      await showTextScreen(term, which.name, [
        { text: `${which.name} could not be read.`, color: C_BAD },
        { text: "", color: C_FG },
        { text: "It may have been moved or deleted since this list was made.", color: C_DIM },
      ]);
      continue;
    }
    if (await importOne(term, bytes, which.name, which.name, deps, zip)) changed = true;
  }
}

/** What the "What is this?" row says, which depends on what this platform can do. */
function aboutImport(folder: string | null, canDiscard: boolean): readonly ScreenLine[] {
  const dim = (text: string): ScreenLine => ({ text, color: C_DIM });
  const fg = (text: string): ScreenLine => ({ text, color: C_FG });
  return [
    fg("A mod can be installed from a .zip file instead of from a repository."),
    dim("This is the same install: the same requirements are checked, and the"),
    dim("mod is stored the same way. Only where the bytes came from differs."),
    { text: "", color: C_FG },
    fg("The zip has to hold ONE mod, and its manifest.json has to be either:"),
    dim("  at the top of the zip, or"),
    dim("  inside a single folder at the top of the zip."),
    dim("That second shape is what GitHub's \"Download ZIP\" gives you."),
    { text: "", color: C_FG },
    fg("Nothing deeper is looked at. A zip holding two mods is refused, and"),
    fg("says which two, rather than guessing which one you meant."),
    { text: "", color: C_FG },
    ...(folder === null
      ? [dim("This front end has no mods folder, so only the file picker is offered.")]
      : [
          fg("You can also drop a zip into the mods folder and import it here:"),
          dim(`  ${folder}`),
          ...(canDiscard
            ? [dim("A zip imported from there is deleted once the mod is installed.")]
            : []),
        ]),
    { text: "", color: C_FG },
    fg("A zip is never checked at startup and never unpacked on its own."),
    dim("Importing is something you do, once, from this screen."),
    { text: "", color: C_FG },
    fg("An imported mod has no repository, so the update check has nothing to"),
    fg("ask. To update one, import a newer zip."),
  ];
}

/**
 * The door chooser.
 *
 * Returns true when anything was installed or removed, so the caller can offer the
 * reload that makes it take effect.
 */
export async function showModBrowse(term: GlyphTerm, deps: ModBrowseDeps): Promise<boolean> {
  let changed = false;

  for (;;) {
    const allowed = deps.consent.read();
    const items: MenuItem[] = [
      {
        label: "Recommended mods",
        color: C_FG,
        hint: "A curated list of repositories, kept with the game.",
      },
      {
        label: "Add from a registry address",
        color: allowed ? C_FG : C_DIM,
        hint: allowed
          ? "Somebody else's list of mods."
          : 'Needs "Allow third-party mods" below.',
      },
      {
        label: "Add from a repository address",
        color: allowed ? C_FG : C_DIM,
        hint: allowed ? "One mod, by owner/repo." : 'Needs "Allow third-party mods" below.',
      },
      {
        label: "Import a mod from a file",
        color: !deps.importZip ? C_DIM : allowed ? C_FG : C_DIM,
        hint: !deps.importZip
          ? "This front end cannot read a file."
          : allowed
            ? "A .zip you have, or one waiting in the mods folder."
            : 'Needs "Allow third-party mods" below.',
      },
      {
        label: `Allow third-party mods: ${allowed ? "yes" : "no"}`,
        color: allowed ? C_WARN : C_FG,
        hint: allowed
          ? "You have accepted the risks of installing other people's code."
          : "A mod can run code. Read what this means before choosing.",
      },
      { label: "What is this?", color: C_DIM, hint: "Where mods come from." },
    ];

    const pick = await selectFromMenu(term, "Get mods", items, "[ ESC to go back ]");
    if (pick === null) return changed;

    if (pick === 0) {
      if (await openRegistry(term, "curated", deps.curated, deps)) changed = true;
      continue;
    }
    if (pick === 3) {
      /* Its own consent handling lives inside the screen, because the disclaimer has
       * to be offered when a file is chosen rather than when the row is. */
      if (deps.importZip && (await showZipImport(term, deps))) changed = true;
      continue;
    }
    if (pick === 4) {
      await askConsent(term, deps);
      continue;
    }
    if (pick === 5) {
      await showTextScreen(term, "Get mods", ABOUT);
      continue;
    }

    /* Doors 2 and 3. The consent check is repeated at the INSTALL as well
     * (mod-install.ts); this one exists so the player is offered the disclaimer
     * instead of being refused after typing an address. */
    if (!allowed) {
      const now = await askConsent(term, deps);
      if (!now) continue;
    }

    if (pick === 1) {
      const url = await promptText(
        term,
        "Registry address",
        DEFAULT_REGISTRY_URL,
        200,
        "[ type or paste an address, Enter to read it, ESC to cancel ]",
      );
      if (url === null || url.trim() === "") continue;
      if (await openRegistry(term, "third-party", () => deps.registryAt(url.trim()), deps)) {
        changed = true;
      }
      continue;
    }

    const typed = await promptText(
      term,
      "Repository",
      "",
      200,
      "[ owner/repo or a GitHub address, Enter to look it up, ESC to cancel ]",
    );
    if (typed === null || typed.trim() === "") continue;
    const ref = parseRepoRef(typed.trim());
    if (!ref.ok) {
      await showTextScreen(term, "That is not a repository", [
        { text: ref.problem, color: C_BAD },
        { text: "", color: C_FG },
        { text: "Examples:", color: C_DIM },
        { text: "  neostryder/neo-angband-mod-qol", color: C_DIM },
        { text: "  https://github.com/neostryder/neo-angband-mod-qol", color: C_DIM },
        { text: "  https://github.com/neostryder/neo-angband-mod-qol/tree/v0.13.0", color: C_DIM },
      ]);
      continue;
    }
    if (await showSource(term, ref.ref.repo, "third-party", [ref.ref], [], deps)) {
      changed = true;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Updating what is already installed.
 * ------------------------------------------------------------------ */

/**
 * "Update installed mods": ask each installed mod's OWN repository, then offer.
 *
 * WHAT THIS SCREEN USED TO SAY. It compared the installed tags against the catalogue
 * compiled into the build and, finding nothing newer THERE, told the player
 * "Every installed mod is at the version this build knows about" over a paragraph
 * explaining that mod versions travel with the game and a newer mod arrives when you
 * update. All of that was true of the old design and none of it is true now: a mod
 * releases when its author releases it, and this screen asks.
 *
 * THREE ANSWERS, NOT TWO. A mod is behind, or it is at its repository's newest, or
 * THE REPOSITORY COULD NOT BE ASKED - and the third is not a quiet version of the
 * second. A 404 is deleted, renamed, made private, a typo, or an office proxy; a 403
 * is a rate limit that clears by itself. Every one of them leaves the installed bytes
 * exactly where they are and says what happened, on the row it happened to.
 *
 * The install path is `installOne`'s, the same one the browse screen uses, so the
 * consent gate, the requirements inspection, the origin check and the progress line
 * are not reimplemented here.
 */
export async function showModUpgrades(term: GlyphTerm, deps: ModUpgradeDeps): Promise<boolean> {
  let changed = false;

  for (;;) {
    /* Re-asked each time round, because an install just changed the answer. It is
     * one request per mod, and the alternative is a list that disagrees with what
     * the player just did. */
    const refreshed = await paintWhile(term, "Update installed mods", "Asking each mod's repository...", () =>
      deps.refresh(),
    );
    const pending = pendingUpgrades(refreshed);
    const blind = unavailableMods(refreshed);

    if (pending.length === 0) {
      await showTextScreen(term, "Update installed mods", [
        /* One sentence, from one place, that has to fit what was actually asked -
         * see upToDateHeadline. Composing it here is how it came to say "every"
         * about a set that included mods nothing had asked about. */
        ...wrapMessage(upToDateHeadline(refreshed), MESSAGE_WIDTH).map((text) => ({
          text,
          color: blind.length > 0 && blind.length === refreshed.length ? C_WARN : C_FG,
        })),
        { text: "", color: C_FG },
        ...refreshed.map((r) => ({
          text: `  ${refreshRow(r)}`,
          color: r.standing === "unavailable" ? C_WARN : C_DIM,
        })),
        ...(blind.length > 0
          ? [
              { text: "", color: C_FG },
              {
                text: "A mod that could not be checked has NOT been removed and has not",
                color: C_DIM,
              },
              {
                text: "changed. Its repository may be renamed, private, or simply not",
                color: C_DIM,
              },
              { text: "reachable from here right now.", color: C_DIM },
            ]
          : []),
        { text: "", color: C_FG },
        ...ABOUT_MOD_UPGRADES,
      ]);
      return changed;
    }

    const items: MenuItem[] = [
      {
        label: pending.length === 1 ? "Update it" : `Update all ${String(pending.length)}`,
        color: C_WARN,
        hint: "Download and store each one in turn. Nothing is enabled or disabled.",
      },
      ...pending.map((u) => ({
        label: `${u.id}  ${u.from} -> ${u.to}`,
        color: C_FG,
        hint: `Update only this one, from ${u.repo}.`,
      })),
      ...blind.map((r) => ({
        label: `${r.id}  could not be checked`,
        color: C_WARN,
        enabled: false,
        /* The address as well as the reason: a player told "HTTP 404" can do
         * nothing, and a player given the page can look at it themselves. */
        hint: `${r.problem ?? "no reason given"} - ${repoPage(r)}`,
      })),
    ];

    const pick = await selectFromMenu(term, "Update installed mods", items, "[ ESC to go back ]");
    if (pick === null) return changed;

    /* Snapshotted before the first install: `refresh()` is re-read at the top of the
     * loop, and a list that shrinks under an in-progress "update all" would skip
     * whatever moved up into the index just used. */
    const todo = pick === 0 ? pending : [pending[pick - 1]];
    const curated = await curatedRepos(deps);
    for (const u of todo) {
      if (!u) continue;
      /* Pinned to the tag the check found, not to "newest": between the check and
       * this line the repository may have released again, and installing something
       * the player was never shown is exactly the surprise a notify-don't-auto-update
       * design exists to avoid. */
      const entry = await deps.discover({ repo: u.repo, tag: u.to });
      if (!entry.ok) {
        await showTextScreen(term, u.id, installFailureLines(u.id, entry.problem));
        continue;
      }
      const origin: ModOrigin = curated.has(u.repo.toLowerCase()) ? "curated" : "third-party";
      if (await installOne(term, entry, origin, deps)) changed = true;
    }
  }
}

/**
 * Which repositories the curated list vouches for, lower-cased.
 *
 * WHY AN UPDATE STILL HAS AN ORIGIN. The origin decides one thing: whether the
 * consent gate applies (mod-install.ts checks it before any fetch). A recommended
 * mod is exempt from the prompt, so its update must be too, or a player who never
 * turned third-party mods on would find the recommended mods they already have
 * frozen at the version they installed. Everything else is third-party - which is
 * what it was when it went in - and the switch that let it in is the switch that
 * lets it be replaced. A player who has since turned the switch off has said they
 * do not want that code, and an update is more of that code.
 *
 * A list that cannot be read yields an empty set, so nothing is silently promoted to
 * exempt on the strength of a failed fetch.
 */
async function curatedRepos(deps: ModUpgradeDeps): Promise<ReadonlySet<string>> {
  const { registry } = await deps.curated();
  return new Set((registry?.mods ?? []).map((r) => r.repo.toLowerCase()));
}

/** Where a mod update comes from, said once. */
const ABOUT_MOD_UPGRADES: readonly ScreenLine[] = [
  {
    text: "Each mod lives in its own repository and releases on its own schedule,",
    color: C_DIM,
  },
  {
    text: "so this asks every installed mod where it came from and compares the",
    color: C_DIM,
  },
  {
    text: "version you have with the newest one your update channel allows.",
    color: C_DIM,
  },
  { text: "Updating the game is not what brings a newer mod.", color: C_DIM },
];

/** Draw one line, let it paint, then run `job`. For a wait a player can read. */
async function paintWhile<T>(
  term: GlyphTerm,
  title: string,
  line: string,
  job: () => Promise<T>,
): Promise<T> {
  const { cols } = term.size();
  term.clear();
  term.print(0, 1, title.slice(0, cols - 1), C_FG);
  term.print(0, 3, line.slice(0, cols - 1), C_DIM);
  term.flush?.();
  return await job();
}

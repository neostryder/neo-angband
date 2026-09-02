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

import {
  promptText,
  screenRegionSpec,
  selectFromMenu,
  showTextScreen,
  type MenuItem,
  type ScreenLine,
} from "./overlay";
import { popRegion, pushRegion, regionSurface } from "./ui-stack";
import {
  freezeView,
  screenBodyLines,
  SCREEN_FOOTER,
  type ScreenBlock,
  type ScreenRow,
  type ScreenView,
} from "./screen-view";
import type { GridPointerInput, GridSurface } from "./term";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_GOOD, UI_BAD } from "./ui-colors";
import { authorFor, displayName, standingNote, type AuthorRegister } from "./mod-authors";
import { CONSENT_DISCLAIMER, type ModOrigin } from "./mod-consent";
import { DEFAULT_REGISTRY_URL, type ModRegistry } from "./mod-curated";
import { classifyModTag } from "./mod-updates";
import type { Finding } from "@rpgm-tools/neo-angband-mod-sdk";
import type { DiscoveredMod } from "./mod-discover";
import { parseRepoRef, repoPageUrl, type RepoRef } from "./mod-source";
import {
  MOD_CHECK_ADVICE,
  type InstallProgress,
  type InstallResult,
} from "./mod-install";
import type { WaitingZip, ZipImportDeps } from "./mod-zip-source";
import { previewSessionArchive, type SessionPreview } from "./mod-session";
import { describeCapabilities } from "./capability-describe";
import {
  pendingUpgrades,
  refreshRow,
  repoPage,
  unavailableMods,
  upToDateHeadline,
  type ModRefresh,
  type ModUpgrade,
} from "./mod-refresh";
import { t } from "@rpgm-tools/neo-angband-core";

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
   * The manager-owned bulk enable path. It owns live rules, sections, save
   * ratchets, and the one combined capability approval for recommended mods.
   */
  readonly applyRecommended?: (ids: readonly string[], enableAllOptions: boolean) => Promise<boolean>;
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
  return origin === "curated" ? t("modBrowse.sourceLabel.curated", "Recommended mods") : registryName;
}

/**
 * One row for a discovered mod.
 *
 * A DISCOVERY FAILURE IS A ROW, not a missing row. A repository that has been renamed
 * or has no release yet must SAY so where the player is looking for it; dropping it
 * would make a curated list quietly shrink, and the player would have no way to tell
 * a mod that was removed from one that could not be reached.
 */
/**
 * What to say about a newer version this build cannot run, or null when there is
 * none to say anything about.
 *
 * ONE WORDING, three places: the row's hint has room for a clause, the detail pane
 * has room for the sentence, and the refusal screen needs the same fact in a fourth
 * shape. Three copies of this would be three chances to promise something the gate
 * does not, which is the specific way compatibility wording goes wrong here.
 *
 * The instruction to update the game is given ONLY when updating the game is
 * actually what would help. A range can want an older game as easily as a newer one
 * (`newerGameCouldRun` says which, within a stated bound), and "update the game"
 * aimed at a mod that wants 0.22.x would send a player backwards.
 */
export function engineHeldLines(m: DiscoveredMod): { short: string; full: string } | null {
  const held = m.engineHeld;
  if (held === null) return null;
  const helps = held.newerGameHelps === true;
  return {
    short: helps
      ? t("modBrowse.engineHeld.shortNewer", "{tag} needs a newer game", { tag: held.tag })
      : t("modBrowse.engineHeld.shortNoRun", "{tag} will not run here", { tag: held.tag }),
    full: helps
      ? t(
          "modBrowse.engineHeld.fullNewer",
          "{tag} is newer and needs a newer game: it {why}. {installTag} is the newest version that runs on this build, and is the one that will be installed. Update the game to get {tag}.",
          { tag: held.tag, why: held.why, installTag: m.tag },
        )
      : t(
          "modBrowse.engineHeld.fullNoRun",
          "{tag} is newer and will not run here: it {why}. {installTag} is the newest version that runs on this build, and is the one that will be installed.",
          { tag: held.tag, why: held.why, installTag: m.tag },
        ),
  };
}

export function browseRow(entry: BrowseEntry, installedTag: string | null): MenuItem {
  if (!entry.ok) {
    return {
      label: t("modBrowse.row.unavailable", "{repo} - unavailable", { repo: entry.ref.repo }),
      color: C_BAD,
      hint: entry.problem,
    };
  }
  const m = entry.mod;
  const size = m.bytes === null ? "" : `  ${formatBytes(m.bytes)}`;

  /* THE MANIFEST'S AUTHOR IS ON THE ROW; THE REGISTER'S STANDING IS NOT, and the two
   * are not interchangeable. `Linoleum (neostryder)` is attribution - the author's
   * own claim, which is the most useful single fact about a stranger's mod and belongs
   * where the player is already looking. A REGISTER marker beside a name would be read
   * as "checked", which no listing means (see standingNote); that stays in the detail
   * pane where a full sentence can say what it does and does not mean, and that pane is
   * shown by default, so it is not hidden - just not compressed into a word that would
   * mislead. */
  const who = displayName(m.name, m.author);
  if (!m.compatible) {
    /* An older version was LOOKED FOR before this row gave up, so the row says so.
     * Without it the player cannot tell a game that checked one version from a game
     * that checked eight, and "install an older one" is the obvious next idea. */
    const checked = m.versionsChecked ?? 1;
    return {
      label: t("modBrowse.row.wontRun", "{who} {version} - will not run on this version", {
        who,
        version: m.version,
      }),
      color: C_BAD,
      hint:
        (m.engineNote ??
          t("modBrowse.row.needsEngine", "needs engine {engine}", {
            engine: m.engine ?? t("modBrowse.row.unstatedEngine", "(unstated)"),
          })) +
        (checked > 1
          ? t("modBrowse.row.checkedPrevious", "  (nor its {count} previous version(s))", {
              count: checked - 1,
            })
          : ""),
    };
  }

  const held = engineHeldLines(m);
  const mark =
    installedTag === null ? " " : installedTag === m.tag ? "*" : "~";
  const state =
    installedTag === null
      ? ""
      : installedTag === m.tag
        ? `  ${t("modBrowse.row.installed", "installed")}`
        : `  ${t("modBrowse.row.installedAt", "installed {tag}", { tag: installedTag })}`;

  return {
    label: `[${mark}] ${who} ${m.version}${state}${size}`,
    color: installedTag === null ? C_FG : C_GOOD,
    hint:
      (m.description?.split("\n")[0] ?? t("modBrowse.row.noDescription", "No description.")) +
      (m.channelHeld !== null
        ? t("modBrowse.row.fasterChannel", "  ({channel} is on a faster channel)", {
            channel: m.channelHeld,
          })
        : "") +
      (held === null ? "" : `  (${held.short})`),
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
      ...wrap(t("modBrowse.detail.couldNotRead", "{repo} could not be read.", { repo: entry.ref.repo }), C_BAD),
      { text: "", color: C_FG },
      ...wrap(entry.problem, C_WARN),
      { text: "", color: C_FG },
      { text: repoPageUrl(entry.ref.repo), color: C_DIM },
    ];
  }
  const m = entry.mod;
  const out: ScreenLine[] = [
    ...wrap(displayName(m.name, m.author), C_FG),
    { text: "", color: C_FG },
    ...wrap(m.description ?? t("modBrowse.detail.noDescription", "No description."), C_FG),
  ];
  out.push({ text: "", color: C_FG });
  out.push({
    text: t("modBrowse.detail.version", "Version    {version}  (tag {tag})", {
      version: m.version,
      tag: m.tag,
    }),
    color: C_DIM,
  });
  if (installedTag !== null) {
    out.push({
      text: t("modBrowse.detail.installed", "Installed  {tag}", { tag: installedTag }),
      color: C_DIM,
    });
  }
  out.push({
    text:
      t("modBrowse.detail.engine", "Engine     {engine}", {
        engine: m.engine ?? t("modBrowse.detail.engineNotStated", "not stated"),
      }) + (m.compatible ? "" : `  ${t("modBrowse.detail.engineWontRun", "- will not run here")}`),
    color: m.compatible ? C_DIM : C_BAD,
  });
  if (m.bytes !== null) {
    out.push({
      text: t("modBrowse.detail.download", "Download   {bytes} in {count} file(s)", {
        bytes: formatBytes(m.bytes),
        count: m.payload.length,
      }),
      color: C_DIM,
    });
  }
  /* NOT wrapped: a URL has no spaces to break at, so wrapping cannot help it and
   * folding it mid-path would produce something unusable to copy. Long repository
   * names are the one thing this pane still lets run to the edge, deliberately. */
  out.push({
    text: t("modBrowse.detail.from", "From       {url}", { url: repoPageUrl(m.repo, m.tag) }),
    color: C_DIM,
  });
  if (m.screenshots.length > 0) {
    /* A LISTING, not a preview - and that is a fact about this screen, not a gap
     * left for later. The grid this game draws to is a fixed-size cell canvas
     * (term.ts) that only ever draws pre-loaded tileset glyphs into cells; it has
     * no path for decoding an arbitrary image fetched from a mod's repository, at
     * a resolution and aspect ratio nobody controls, into that grid. Building one
     * would mean fetching and decoding the file, then downsampling it to either a
     * fixed glyph size or some form of block/ASCII art - a real feature, not a
     * line here. Until it exists, naming what the author declared and where to go
     * look is the honest middle ground between showing nothing and promising a
     * picture this pane cannot draw. */
    out.push({ text: "", color: C_FG });
    out.push({
      text: t(
        "modBrowse.detail.screenshots",
        "Screenshots  {count} declared - open the repository above to view:",
        { count: m.screenshots.length },
      ),
      color: C_DIM,
    });
    for (const path of m.screenshots) {
      out.push({ text: `  ${path}`, color: C_DIM });
    }
  }
  /* The standing, in the register's own words, WRAPPED - it is the sentence whose
   * end says nobody reviewed the code, and truncation eats ends. */
  out.push({ text: "", color: C_FG });
  out.push(...wrap(standingNote(authorFor(authors, m.repo), m.repo), C_DIM));
  if (m.channelHeld !== null) {
    out.push({ text: "", color: C_FG });
    out.push(
      ...wrap(
        t(
          "modBrowse.detail.fasterChannel",
          "A newer version ({channel}) exists on a faster update channel.",
          { channel: m.channelHeld },
        ),
        C_WARN,
      ),
    );
  }
  const heldNewer = engineHeldLines(m);
  if (heldNewer !== null) {
    out.push({ text: "", color: C_FG });
    out.push(...wrap(heldNewer.full, C_WARN));
  }
  if (m.guessedPayload) {
    /* Said out loud, because it is the difference between "the author decided what
     * ships" and "the game guessed". A player reporting a broken install should know
     * which of those they are looking at. */
    out.push({ text: "", color: C_FG });
    out.push(
      ...wrap(
        t(
          "modBrowse.detail.guessedPayload",
          "This mod does not declare which of its files to install, so they were " +
            "worked out from the repository.",
        ),
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

/**
 * One unmet requirement as a table row: `title` is the row's own line, so a
 * presenter can read it without finding a colon in English; `problem` is the
 * paragraph under it, in `detail`.
 *
 * WHY THE ROW SPLITS WHERE IT DOES. `requirementLine` used to compose "- title:
 * problem" as ONE string and wrap it as one flowing paragraph - which is exactly
 * why this used to be unable to become a table at all: a `table` row is one
 * terminal line, and that flowing wrap could break anywhere inside "problem",
 * with no seam a row could stand on. `Requirement.title` is contracted to be
 * "one line, in the imperative" (mod-sdk/standards.ts), so it is the one part of
 * the old bullet a row CAN own outright; `problem` is arbitrary-length free text
 * naming the field or file that is wrong, so it is what `detail` exists for.
 *
 * `wrap` is DERIVED, not typed in: `MESSAGE_WIDTH` (74) stays the one authority
 * on how wide a refusal is wrapped, and `detail`'s own width comes out as
 * `MESSAGE_WIDTH - indent`, matching what `textblockCalculatedLines` computes
 * internally (`min(wrap, cols - indent)`) at an 80-column terminal.
 */
function findingRow(f: Finding, color: string): ScreenRow {
  return {
    id: f.id,
    semantic: { kind: "mod-requirement", ref: f.id, data: { level: f.level } },
    color,
    cells: {
      bullet: { text: "-" },
      title: { text: f.title },
    },
    detail: {
      indent: 2,
      wrap: MESSAGE_WIDTH - 2,
      paragraphs: [[{ text: f.problem }]],
      color,
    },
  };
}

/**
 * A refusal's body blocks: the summary as prose, one row per unmet requirement
 * as a table, then the author's advice as prose - never rows themselves, because
 * neither is a record with a stable identity, they are sentences this file (or
 * `checkMod`) composed.
 *
 * THE RE-PARSE IS GONE. This used to split `problem` on "\n" and re-wrap each
 * fragment, because `storeMod` had flattened `checkMod`'s `{ title, problem }[]` into
 * that one string with hand-typed bullets - the process re-parsing a rendering it had
 * produced two frames earlier. The findings now arrive as records (`InstallResult.unmet`)
 * and each row's wording is `f.title`/`f.problem` straight off the `Finding`, so
 * there is one copy of it and nothing here reads a colon out of English.
 *
 * The split that REMAINS is on `problem` alone, and it is not the old one: a refusal
 * whose text came from `message(e)` is an Error's own message, which can legitimately
 * carry a newline, and swallowing it would put a literal "\n" on the player's screen.
 */
function refusalBlocks(problem: string, unmet: readonly Finding[], color: string): ScreenBlock[] {
  const blocks: ScreenBlock[] = [
    {
      kind: "lines",
      lines: problem
        .split("\n")
        .flatMap((line) => wrapMessage(line, MESSAGE_WIDTH))
        .map((text) => ({ text, color })),
    },
  ];
  if (unmet.length > 0) {
    blocks.push({
      kind: "table",
      key: "unmet",
      tagged: false,
      columns: [
        { key: "bullet", width: 3, align: "right" },
        { key: "title", pad: false },
      ],
      rows: unmet.map((f) => findingRow(f, color)),
    });
    blocks.push({
      kind: "lines",
      lines: wrapMessage(MOD_CHECK_ADVICE, MESSAGE_WIDTH).map((text) => ({ text, color })),
    });
  }
  return blocks;
}

/**
 * What to show when an install was refused. Never a bare "it failed".
 *
 * NOW MODELLED: `unmet` used to be flattened straight into `lines` because a
 * `table` row is one terminal line and the old bullet ("- title: problem") wrapped
 * as one flowing paragraph that could break anywhere inside `problem` - there was
 * no seam a row could stand on. Splitting the row at `title` (contracted to be one
 * line by `Requirement.title` itself) and letting `problem` be the row's `detail`
 * is what removes that blocker; see `findingRow`.
 */
export function installFailureScreen(
  name: string,
  problem: string,
  unmet: readonly Finding[] = [],
): ScreenView {
  return freezeView({
    id: "core:mod-install-failure",
    title: name,
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "lines",
        lines: [
          { text: t("modBrowse.installFailure.notInstalled", "{name} was not installed.", { name }), color: C_BAD },
          { text: "", color: C_FG },
        ],
      },
      ...refusalBlocks(problem, unmet, C_WARN),
      {
        kind: "lines",
        lines: [
          { text: "", color: C_FG },
          {
            text: t(
              "modBrowse.installFailure.untouched",
              "Nothing was stored, so your other mods are untouched.",
            ),
            color: C_DIM,
          },
        ],
      },
    ],
  });
}

/**
 * `installFailureScreen`'s body, flattened to `ScreenLine[]` for a caller that has
 * not moved onto `showTextScreen(term, view)` yet. Exported and kept alongside the
 * view builder rather than folded away, because it is what `mod-browse.test.ts`
 * pins byte-for-byte and this pass does not own that file.
 */
export function installFailureLines(
  name: string,
  problem: string,
  unmet: readonly Finding[] = [],
): ScreenLine[] {
  return screenBodyLines(installFailureScreen(name, problem, unmet), 80);
}

/**
 * What to show when a .zip import was refused - the same shape as
 * `installFailureScreen`, in this door's own colour (`C_BAD` rather than
 * `C_WARN`) and its own closing line ("has not been installed or changed"
 * rather than "was not stored"), because a zip that failed its check was never
 * accepted in the first place.
 */
export function zipImportFailureScreen(
  problem: string,
  unmet: readonly Finding[] = [],
): ScreenView {
  return freezeView({
    id: "core:mod-zip-import-failure",
    title: t("modBrowse.zipFailure.title", "That zip was not imported"),
    footer: SCREEN_FOOTER,
    blocks: [
      ...refusalBlocks(problem, unmet, C_BAD),
      {
        kind: "lines",
        lines: [
          { text: "", color: C_FG },
          {
            text: t("modBrowse.zipFailure.untouched", "Nothing has been installed or changed."),
            color: C_DIM,
          },
        ],
      },
    ],
  });
}

/**
 * "What is this?" prose for the door chooser and the browse screens.
 *
 * A FUNCTION, not a constant: see gameMenuFooter's comment in game-menu.ts - a
 * locale can change mid-session, so nothing translatable may be frozen at
 * import time.
 */
function aboutLines(): readonly ScreenLine[] {
  return [
    { text: t("modBrowse.about.title", "Where mods come from"), color: C_FG },
    { text: "", color: C_FG },
    {
      text: t(
        "modBrowse.about.body1",
        "This game ships no mods and holds no list of what a mod contains.",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modBrowse.about.body2",
        "Everything you see about a mod - its name, version, description,",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modBrowse.about.body3",
        "size and the game versions it supports - is read from that mod's",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modBrowse.about.body4",
        "own repository when this screen opens. So a mod can release an",
      ),
      color: C_FG,
    },
    {
      text: t("modBrowse.about.body5", "update without waiting for a new version of the game."),
      color: C_FG,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modBrowse.about.recommended1",
        "Recommended mods is a list of REPOSITORIES kept in the game's",
      ),
      color: C_FG,
    },
    {
      text: t("modBrowse.about.recommended2", "own repository. It says somebody thought a mod was worth"),
      color: C_FG,
    },
    {
      text: t("modBrowse.about.recommended3", "offering. It does not say anybody read its code."),
      color: C_FG,
    },
    { text: "", color: C_FG },
    {
      text: t("modBrowse.about.registry1", "A registry is the same kind of list, published by somebody else."),
      color: C_FG,
    },
    {
      text: t("modBrowse.about.registry2", "A repository address installs a single mod. Both need"),
      color: C_FG,
    },
    {
      text: t("modBrowse.about.registry3", '"Allow third-party mods" turned on first.'),
      color: C_FG,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modBrowse.about.pinned1",
        "On first install a mod is pinned to the repository it came from,",
      ),
      color: C_FG,
    },
    {
      text: t("modBrowse.about.pinned2", "and can only ever be updated from that same place. The files it"),
      color: C_FG,
    },
    {
      text: t("modBrowse.about.pinned3", "stored are listed in the mod manager, with a check for whether"),
      color: C_FG,
    },
    { text: t("modBrowse.about.pinned4", "they have changed since."), color: C_FG },
    { text: "", color: C_FG },
    {
      text: t(
        "modBrowse.about.channel1",
        "Your update channel decides which mod versions you are offered:",
      ),
      color: C_DIM,
    },
    {
      text: t("modBrowse.about.channel2", "a stable game is offered a mod's releases, and beta or early"),
      color: C_DIM,
    },
    { text: t("modBrowse.about.channel3", "are also offered its pre-releases."), color: C_DIM },
  ];
}

/** Ask the consent question, showing the disclaimer. Returns the new setting. */
async function askConsent(term: GridSurface & GridPointerInput, deps: ModBrowseDeps): Promise<boolean> {
  const on = deps.consent.read();
  if (on) {
    const off = await selectFromMenu(
      term,
      "core:mods-third-party-disable",
      t("modBrowse.consent.currentlyAllowed", "Third-party mods are allowed"),
      [
        {
          label: t("modBrowse.consent.leaveAllowed", "Leave them allowed"),
          color: C_FG,
          hint: t("modBrowse.common.noChange", "No change."),
        },
        {
          label: t("modBrowse.consent.stopAllowing", "Stop allowing them"),
          color: C_WARN,
          /* Stated on the row, because the fear that it deletes things is exactly
           * what stops people using a safety control. */
          hint: t(
            "modBrowse.consent.stopAllowingHint",
            "Does not uninstall or delete anything you already added.",
          ),
        },
      ],
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    );
    if (off === 1 && !deps.consent.write(false)) {
      await showTextScreen(term, t("modBrowse.consent.couldNotSave", "Could not save that"), [
        {
          text: t(
            "modBrowse.consent.couldNotSaveBody1",
            "This browser would not let the game record the setting.",
          ),
          color: C_BAD,
        },
        {
          text: t("modBrowse.consent.couldNotSaveBody2", "It is off for now and may be back on next time."),
          color: C_FG,
        },
      ]);
    }
    return deps.consent.read();
  }

  await showTextScreen(term, t("modBrowse.consent.beforeAllow", "Before you allow third-party mods"), [
    ...CONSENT_DISCLAIMER.map((text) => ({
      text,
      color: text.trimStart().startsWith("-") ? C_DIM : C_FG,
    })),
  ]);
  const yes = await selectFromMenu(
    term,
    "core:mods-third-party-consent",
    t("modBrowse.consent.allowConfirm", "Allow third-party mods?"),
    [
      {
        label: t("modBrowse.consent.notForNow", "No, not for now"),
        color: C_FG,
        hint: t("modBrowse.consent.notForNowHint", "Only the recommended list stays available."),
      },
      {
        label: t("modBrowse.consent.iUnderstand", "Yes, I understand"),
        color: C_WARN,
        hint: t("modBrowse.consent.iUnderstandHint", "Lets you install from any registry or repository."),
      },
    ],
    t("modBrowse.consent.footer", "[ ESC to go back - the same as No ]"),
  );
  if (yes !== 1) return false;
  if (!deps.consent.write(true)) {
    await showTextScreen(term, t("modBrowse.consent.couldNotSave", "Could not save that"), [
      {
        text: t(
          "modBrowse.consent.couldNotSaveBody1",
          "This browser would not let the game record the setting.",
        ),
        color: C_BAD,
      },
      { text: "", color: C_FG },
      {
        text: t("modBrowse.consent.stillInstallAsked", "You can still install now, but you will be asked again."),
        color: C_FG,
      },
    ]);
    /* Honest: the answer was given, so honour it for this session rather than
     * pretending the player did not answer. It simply will not persist. */
    return true;
  }
  return true;
}

/**
 * Install one mod, with progress, and say what happened.
 *
 * AN UPDATE IS NOT AN INSTALL, and this screen used to tell the player otherwise.
 * There was one message for both, and on an update of a mod the player had already
 * chosen and already switched on it read:
 *
 *     Quality of Life 0.14.0 installed.
 *     It is OFF until you turn it on in the mod list.
 *     Nothing is enabled by installing it.
 *
 * Every line of that is wrong for an update. The mod was not newly installed, it was
 * not switched off, and nothing about the player's choices changed - the second line
 * in particular tells someone whose mod is running that it is not, which is the kind
 * of message that sends a player to the mod list to fix something that is not broken.
 * It happened because "was it just turned on" was the only thing being asked, and an
 * already-enabled mod answers no to that.
 *
 * So the tag the player HAD is read before the install, and the outcome is one of
 * three sentences rather than a boolean: a first install, an upgrade, or a change to
 * a different version that is not newer (a deliberate rollback, or a tag nothing can
 * order). Each one says what became of the two things a player actually worries about
 * when replacing a mod that works: whether it is still on, and whether their settings
 * survived.
 */
async function installOne(
  term: GridSurface & GridPointerInput,
  entry: Extract<BrowseEntry, { ok: true }>,
  origin: ModOrigin,
  deps: ModBrowseDeps,
  opts?: {
    readonly offerEnable?: boolean;
    /** A combined game update reports all failed mods together before restart. */
    readonly reportOutcome?: boolean;
    /** Lets that combined report retain the installer's exact refusal. */
    readonly onFailure?: (problem: string) => void;
  },
): Promise<boolean> {
  const m = entry.mod;
  /* BEFORE the install, because afterwards there is nothing left to compare - the
   * meta record has already been overwritten with the new tag. */
  const before = (await deps.installed()).get(m.id) ?? null;

  /* The progress screen is a REGION for exactly as long as the install runs
   * (#253). It repaints on every file, so without a rectangle it was a
   * full-screen erase arriving several times a second at a moment the player
   * cannot interrupt - the worst possible time for a front end to be wiped with
   * no way to learn it had happened. `screenRegionSpec` is core's own answer to
   * what rectangle a screen occupies; see overlay.ts. */
  const handle = pushRegion(screenRegionSpec(), term.size());
  const progress = regionSurface(term, handle.cells);
  const result = await deps
    .install(m, origin, (p) => {
      const { rows } = progress.size();
      progress.clear();
      progress.print(
        0,
        1,
        before === null
          ? t("modBrowse.progress.installing", "Installing {name} {version}", {
              name: m.name,
              version: m.version,
            })
          : t("modBrowse.progress.updating", "Updating {name} {version}", {
              name: m.name,
              version: m.version,
            }),
        C_FG,
      );
      progress.print(
        0,
        3,
        t("modBrowse.progress.fileOf", "{done} of {total}: {path}", {
          done: p.done,
          total: p.total,
          path: p.path,
        }),
        C_DIM,
      );
      progress.print(0, rows - 1, t("modBrowse.progress.pleaseWait", "[ please wait ]"), C_DIM);
      progress.flush?.();
    })
    /* Released before the outcome screen, which declares its own: a wait screen
     * left in the stack would keep telling a front end it is covered by
     * something that is no longer on screen. */
    .finally(() => {
      popRegion(handle);
    });

  if (!result.ok) {
    opts?.onFailure?.(result.problem);
    if (opts?.reportOutcome !== false) {
      await showTextScreen(term, installFailureScreen(m.name, result.problem, result.unmet));
    }
    return false;
  }

  /* Only a FIRST install asks. Re-offering on an update asks the player to re-make a
   * decision they already made, and answering "no" out of habit would switch off a
   * mod that was running - an update that can turn something off is an update nobody
   * should have to think about before accepting. */
  const enabled =
    before === null && opts?.offerEnable !== false && deps.offerEnable
      ? await deps.offerEnable(m.id)
      : false;

  if (opts?.reportOutcome !== false) {
    await showTextScreen(term, m.name, [
      ...installOutcomeLines(m.name, m.version, before, m.tag, enabled),
      { text: "", color: C_FG },
      {
        text: t("modBrowse.installOne.stored", "{count} file(s) stored, from {source}.", {
          count: result.meta.files.length,
          source: repoPageUrl(m.repo, m.tag),
        }),
        color: C_DIM,
      },
    ]);
  }
  return true;
}

/**
 * What to say after a successful install. Exported for the test that pins it, because
 * the wording IS the feature here - the bug this replaces was entirely in the words.
 *
 * `before` is the tag on disk beforehand, null for a first install. `enabled` is only
 * meaningful for a first install, and is ignored otherwise (see installOne).
 */
export function installOutcomeLines(
  name: string,
  version: string,
  before: string | null,
  after: string,
  enabled: boolean,
): ScreenLine[] {
  if (before === null) {
    return [
      { text: t("modBrowse.outcome.installed", "{name} {version} installed.", { name, version }), color: C_GOOD },
      { text: "", color: C_FG },
      ...(enabled
        ? [{ text: t("modBrowse.outcome.enabled", "It is enabled. Reload to start using it."), color: C_FG }]
        : [
            {
              text: t("modBrowse.outcome.off", "It is OFF until you turn it on in the mod list."),
              color: C_FG,
            },
            {
              text: t("modBrowse.outcome.nothingEnabled", "Nothing is enabled by installing it."),
              color: C_DIM,
            },
          ]),
    ];
  }

  /* Which DIRECTION, from the one classifier both this and the update screen use.
   * "Updated" is a claim about order, and a player who deliberately went back to an
   * older version should not be told they moved forward. */
  const standing = classifyModTag(before, after);
  const headline =
    standing === "behind"
      ? t("modBrowse.outcome.updated", "{name} updated: {before} -> {after}.", { name, before, after })
      : standing === "ahead"
        ? t("modBrowse.outcome.rolledBack", "{name} rolled back: {before} -> {after}.", {
            name,
            before,
            after,
          })
        : t("modBrowse.outcome.replaced", "{name} replaced: {before} -> {after}.", { name, before, after });

  return [
    { text: headline, color: C_GOOD },
    { text: "", color: C_FG },
    /* The two things a player worries about when replacing a mod that works. Both
     * are true by construction rather than by promise: the enabled set lives in the
     * player's own store keyed on the mod id, and a mod's preferences live in its
     * own bag - the installer replaces files and nothing else. */
    {
      text: t("modBrowse.outcome.settingsUnchanged", "Your on/off choice and this mod's settings are unchanged."),
      color: C_FG,
    },
    { text: t("modBrowse.outcome.reloadNewVersion", "Reload to start using the new version."), color: C_FG },
  ];
}

/**
 * The bulk shortcuts at the top of Recommended mods.
 *
 * Recommendation is a property of the curated registry, not of a manifest, so
 * this stays on the screen that has already read that registry. The toggles make
 * the install-all action explicit: replacement is normally wanted, enabling is
 * deliberately opt-in, and the two other actions remain separate jobs rather
 * than silently happening as side effects of install.
 */
async function showRecommendedActions(
  term: GridSurface & GridPointerInput,
  entries: readonly BrowseEntry[],
  deps: ModBrowseDeps,
): Promise<boolean> {
  let updateExisting = true;
  let enableAfterInstall = false;
  let changed = false;
  const usable = (): Extract<BrowseEntry, { ok: true }>[] =>
    entries.filter((entry): entry is Extract<BrowseEntry, { ok: true }> => entry.ok && entry.mod.compatible);

  for (;;) {
    const items: MenuItem[] = [
      {
        label: t("modBrowse.recommended.bulkInstall", "Install all recommended mods..."),
        color: C_WARN,
        hint: t(
          "modBrowse.recommended.bulkInstallHint",
          "Install every recommended mod that is missing, with the choices below.",
        ),
      },
      {
        label: `${updateExisting ? "[x]" : "[ ]"} ${t("modBrowse.recommended.updateExisting", "Update mods already installed")}`,
        color: updateExisting ? C_GOOD : C_DIM,
        hint: t("modBrowse.recommended.updateExistingHint", "On by default. Never replaces a newer local copy."),
      },
      {
        label: `${enableAfterInstall ? "[x]" : "[ ]"} ${t("modBrowse.recommended.enableAfterInstall", "Enable after installing")}`,
        color: enableAfterInstall ? C_GOOD : C_DIM,
        hint: t(
          "modBrowse.recommended.enableAfterInstallHint",
          "Off by default. One approval screen covers every requested capability.",
        ),
      },
      {
        label: t("modBrowse.recommended.updateAll", "Update all recommended mods..."),
        color: C_FG,
        hint: t("modBrowse.recommended.updateAllHint", "Update installed recommended mods, without enabling anything."),
      },
      {
        label: t("modBrowse.recommended.enableAllOptions", "Enable all options from recommended mods..."),
        color: C_FG,
        hint: t(
          "modBrowse.recommended.enableAllOptionsHint",
          "Turn recommended mods on and select every fix and part. One approval screen covers them.",
        ),
      },
    ];
    const pick = await selectFromMenu(
      term,
      "core:recommended-mod-actions",
      t("modBrowse.recommended.actionsTitle", "Recommended mod actions"),
      items,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    );
    if (pick === null) return changed;
    if (pick === 1) {
      updateExisting = !updateExisting;
      continue;
    }
    if (pick === 2) {
      enableAfterInstall = !enableAfterInstall;
      continue;
    }

    const installed = await deps.installed();
    const candidates = usable();
    if (pick === 0) {
      const todo = candidates.filter((entry) => {
        const at = installed.get(entry.mod.id) ?? null;
        return at === null || (updateExisting && classifyModTag(at, entry.mod.tag) === "behind");
      });
      for (const entry of todo) {
        if (await installOne(term, entry, "curated", deps, { offerEnable: false })) changed = true;
      }
      if (enableAfterInstall && deps.applyRecommended) {
        if (await deps.applyRecommended(candidates.map((entry) => entry.mod.id), false)) changed = true;
      }
      continue;
    }
    if (pick === 3) {
      const todo = candidates.filter((entry) => {
        const at = installed.get(entry.mod.id) ?? null;
        return at !== null && classifyModTag(at, entry.mod.tag) === "behind";
      });
      for (const entry of todo) {
        if (await installOne(term, entry, "curated", deps, { offerEnable: false })) changed = true;
      }
      continue;
    }
    if (pick === 4 && deps.applyRecommended) {
      if (await deps.applyRecommended(candidates.map((entry) => entry.mod.id), true)) changed = true;
    }
  }
}

/**
 * Show one source's mods, discovering each as the list is built.
 *
 * Discovery is per repository and the results are kept for the life of this screen:
 * a list of twenty mods is twenty pairs of API calls, and rebuilding it every time a
 * player presses ESC out of a detail pane would spend a rate limit on nothing.
 */
async function showSource(
  term: GridSurface & GridPointerInput,
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
      count: refs.length,
    }),
    C_DIM,
  );
  waiting.flush?.();

  const entries: BrowseEntry[] = [];
  try {
    for (const ref of refs) entries.push(await deps.discover(ref));
  } finally {
    /* Popped even when a discovery throws: the menu below never runs in that
     * case, and a wait screen that outlives its wait is a phantom occluder. */
    popRegion(handle);
  }

  for (;;) {
    const installed = await deps.installed();
    const items: MenuItem[] = entries.map((e) =>
      browseRow(e, e.ok ? (installed.get(e.mod.id) ?? null) : null),
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
      },
    );
    if (pick === null) return changed;

    if (pick === recommendedActionsAt) {
      if (await showRecommendedActions(term, entries, deps)) changed = true;
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

    const entry = entries[pick];
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
              label: t("modBrowse.actions.install", "Install {version}", { version: entry.mod.version }),
              color: C_FG,
              hint: t("modBrowse.actions.installHint", "Download and store it."),
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

    const what = await selectFromMenu(
      term,
      "core:mod-browse-actions",
      entry.mod.name,
      actions,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    );
    if (what === null) continue;
    if (at !== null && what === 1) {
      const gone = await deps.uninstall(entry.mod.id);
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
    if (await installOne(term, entry, origin, deps)) changed = true;
  }
}

/** Read a registry, then show it. Shared by doors 1 and 2. */
async function openRegistry(
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
    registry.problems,
    deps,
  );
}


/**
 * An exact byte count for a player-visible mod size.
 *
 * Measurements are exact, so the display keeps that count instead of reducing it to
 * an approximation a player cannot use for precise comparisons.
 */
export function formatBytes(bytes: number): string {
  return t("modBrowse.formatBytes", "{bytes, number} bytes", { bytes });
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
 * distinguishable: the archive was moved aside, the archive is still there because this
 * platform cannot move it, and the archive is still there because moving it FAILED.
 * Collapsing the last two into "installed" would leave a player with a duplicate they
 * do not know about; collapsing them into "could not be moved" would report a fault on a
 * browser that never had the ability in the first place.
 *
 * Nothing here says "deleted" any more, and nothing deletes: the successful case NAMES
 * the file's new home, because a player who wants their download back has to be able to
 * find it without being told to go hunting.
 */
export function importedLines(
  id: string,
  fileCount: number,
  source: string,
  archived: { readonly ok: boolean; readonly error?: string; readonly to?: string } | null,
  enabled: boolean,
): readonly ScreenLine[] {
  const tail: ScreenLine[] =
    archived === null
      ? [
          {
            text: t("modBrowse.imported.stillThere", "{source} is still where you left it.", { source }),
            color: C_DIM,
          },
          {
            text: t("modBrowse.imported.untouched", "The game has its own copy now; yours is untouched."),
            color: C_DIM,
          },
        ]
      : archived.ok
        ? [
            {
              text: t("modBrowse.imported.moved", "{source} has been moved to {to} in the mods folder.", {
                source,
                // "imported/" is the on-disk folder name the archiver writes to, not prose.
                to: archived.to ?? "imported/",
              }),
              color: C_DIM,
            },
            {
              text: t("modBrowse.imported.kept", "Kept, not deleted - it is your copy of the download."),
              color: C_DIM,
            },
          ]
        : [
            {
              text: t("modBrowse.imported.stillLoose", "{source} is still loose in the mods folder.", {
                source,
              }),
              color: C_WARN,
            },
            {
              text: t("modBrowse.imported.moveFailed", "It could not be moved aside: {error}", {
                error: archived.error ?? t("modBrowse.imported.noReasonGiven", "no reason given"),
              }),
              color: C_WARN,
            },
            {
              text: t(
                "modBrowse.imported.safeToMove",
                "The mod is installed. Moving the file yourself is safe.",
              ),
              color: C_DIM,
            },
          ];
  return [
    { text: t("modBrowse.imported.installed", "{id} installed.", { id }), color: C_GOOD },
    { text: "", color: C_FG },
    {
      text: t("modBrowse.imported.stored", "{count} file(s) stored, from {source}.", {
        count: fileCount,
        source,
      }),
      color: C_DIM,
    },
    ...tail,
    { text: "", color: C_FG },
    ...(enabled
      ? [{ text: t("modBrowse.outcome.enabled", "It is enabled. Reload to start using it."), color: C_FG }]
      : [
          {
            text: t("modBrowse.outcome.off", "It is OFF until you turn it on in the mod list."),
            color: C_FG,
          },
          {
            text: t("modBrowse.outcome.nothingEnabled", "Nothing is enabled by installing it."),
            color: C_DIM,
          },
        ]),
  ];
}

/** Read, validate, store - then, only then, move the source aside. */
async function importOne(
  term: GridSurface & GridPointerInput,
  bytes: Uint8Array,
  source: string,
  /** The leaf name to move afterwards, or null for a file the game does not own. */
  archivable: string | null,
  deps: ModBrowseDeps,
  zip: ZipImportDeps,
): Promise<boolean> {
  const result = await paintWhile(
    term,
    t("modBrowse.importing.title", "Importing"),
    t("modBrowse.importing.checking", "Checking {source}...", { source }),
    () => zip.install(bytes),
  );
  if (!result.ok) {
    await showTextScreen(term, zipImportFailureScreen(result.problem, result.unmet ?? []));
    return false;
  }

  /* STORE FIRST, MOVE SECOND, and never the other way round. The two cannot be made
   * one operation - IndexedDB and a filesystem have no shared transaction - so the
   * question is only which wreckage is survivable. Moving first and failing to store
   * hides the archive; storing first and failing to move leaves a file the player can
   * tidy up. Prefer the one that costs a tidy-up. */
  const archived =
    archivable !== null && zip.archive !== null ? await zip.archive(archivable) : null;

  const enabled = deps.offerEnable ? await deps.offerEnable(result.meta.id) : false;
  await showTextScreen(
    term,
    result.meta.id,
    importedLines(result.meta.id, result.meta.files.length, source, archived, enabled),
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
export async function showZipImport(term: GridSurface & GridPointerInput, deps: ModBrowseDeps): Promise<boolean> {
  const zip = deps.importZip;
  if (!zip) return false;
  let changed = false;

  for (;;) {
    const waiting = await paintWhile(
      term,
      t("modBrowse.zipImport.title", "Import a mod"),
      t("modBrowse.zipImport.looking", "Looking in the mods folder..."),
      () => zip.waiting(),
    );
    const folder = zip.folder();

    const items: MenuItem[] = [
      ...waiting.map((z) => ({
        label: waitingZipRow(z),
        color: C_FG,
        hint:
          zip.archive === null
            ? t("modBrowse.zipImport.importThis", "Import this archive.")
            : t("modBrowse.zipImport.importThenMove", "Import it, then move the zip into mods/imported."),
      })),
      {
        label: t("modBrowse.zipImport.chooseFile", "Choose a .zip file..."),
        color: C_FG,
        hint: t("modBrowse.zipImport.chooseFileHint", "Any zip on your machine. Your copy of it is left alone."),
      },
      {
        label: t("modBrowse.zipImport.tryOnce", "Try a .zip for this session only..."),
        color: C_WARN,
        /* The hint says the true thing rather than the reassuring one. "Nothing is
         * installed" is what a player wants to hear here and is only half of it. */
        hint: t(
          "modBrowse.zipImport.tryOnceHint",
          "Not installed - loaded until you close the game. Code included, if it has any.",
        ),
      },
      {
        label: t("modBrowse.common.whatIsThis", "What is this?"),
        color: C_DIM,
        hint: t("modBrowse.zipImport.whatIsThisHint", "What a mod zip has to look like."),
      },
    ];

    const title =
      folder === null
        ? t("modBrowse.zipImport.title", "Import a mod")
        : t("modBrowse.zipImport.titleWithFolder", "Import a mod  -  {folder}", { folder });
    const pick = await selectFromMenu(
      term,
      "core:mod-import",
      title,
      items,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    );
    if (pick === null) return changed;

    if (pick === items.length - 1) {
      await showTextScreen(
        term,
        t("modBrowse.zipImport.title", "Import a mod"),
        aboutImport(folder, zip.archive !== null),
      );
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
      if (await tryOne(term, chosen.bytes, chosen.name, deps, zip)) changed = true;
      continue;
    }

    if (pick === items.length - 3) {
      const chosen = await zip.pick();
      if (chosen === null) continue;
      if (await importOne(term, chosen.bytes, chosen.name, null, deps, zip)) changed = true;
      continue;
    }

    const which = waiting[pick];
    if (!which) continue;
    const bytes = await paintWhile(
      term,
      t("modBrowse.zipImport.title", "Import a mod"),
      t("modBrowse.zipImport.readingFile", "Reading {name}...", { name: which.name }),
      () => zip.read(which.name),
    );
    if (bytes === null) {
      await showTextScreen(term, which.name, [
        {
          text: t("modBrowse.zipImport.couldNotRead", "{name} could not be read.", { name: which.name }),
          color: C_BAD,
        },
        { text: "", color: C_FG },
        {
          text: t(
            "modBrowse.zipImport.mayHaveMoved",
            "It may have been moved or deleted since this list was made.",
          ),
          color: C_DIM,
        },
      ]);
      continue;
    }
    if (await importOne(term, bytes, which.name, which.name, deps, zip)) changed = true;
  }
}

/**
 * The screen that asks before a mod is run for one session.
 *
 * EVERY SENTENCE HERE IS DELIBERATE, because this is the one place a player is
 * asked to run somebody's code on a lower-friction gesture than a permanent
 * install, and the phrase "just for this session" does most of its damage by
 * sounding like a safety feature. Four things it therefore has to say:
 *
 *   - WHAT IS SHORT-LIVED IS THE MOD, NOT WHAT IT DOES. The archive is forgotten.
 *     A save it rewrote stays rewritten, a setting it changed stays changed, a
 *     request it sent has been sent. Stated first, because it is the thing the
 *     framing hides.
 *   - THE CAPABILITY LIST IS NOT THE LIMIT. It is shown in full, in the same
 *     words and the same order the install prompt uses - not shortened on the
 *     grounds that this is only a test, since shortening it is precisely how a
 *     temporary framing launders a consent. Above it, in plain terms, the reach
 *     that the list does not bound: a mod's code runs inside the game, so it can
 *     read and change anything the game can.
 *   - WHICH BYTES. The id, the version, the size and the digest, so a player who
 *     stages a draft twice can tell the two apart, and so "I tested this one" has
 *     a referent.
 *   - WHERE IT WILL BE AFTERWARDS. A browser that will not hold the archive across
 *     the reload cannot run this loop at all, and saying so beats sending somebody
 *     round it.
 *
 * A CONTENT-ONLY archive gets the same screen with the code paragraph absent. It
 * is not a different question with a softer answer; it is the same question with
 * one fewer thing to say.
 */
export function sessionLoadScreen(
  preview: Extract<SessionPreview, { ok: true }>,
  source: string,
  survivesReload: boolean,
): ScreenView {
  const caps = describeCapabilities(preview.capabilities ?? []);
  const runs = preview.code.length > 0;
  const blocks: ScreenBlock[] = [
    {
      kind: "lines",
      lines: [
        {
          text:
            preview.version === null
              ? t("modBrowse.sessionLoad.header", "{id}, from {source}", { id: preview.id, source })
              : t("modBrowse.sessionLoad.headerVersioned", "{id} {version}, from {source}", {
                  id: preview.id,
                  version: preview.version,
                  source,
                }),
          color: C_FG,
        },
        {
          text:
            preview.digest === ""
              ? formatBytes(preview.bytes)
              : t("modBrowse.sessionLoad.sizeDigest", "{size}  -  {digest}", {
                  size: formatBytes(preview.bytes),
                  digest: preview.digest.slice(0, 16),
                }),
          color: C_DIM,
        },
        { text: "", color: C_FG },
        {
          text: t(
            "modBrowse.sessionLoad.thisSession",
            "This loads it for THIS SESSION. It is not added to your mods.",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modBrowse.sessionLoad.reloadsToPickUp",
            "The game reloads to pick it up, and forgets it when you close the game.",
          ),
          color: C_DIM,
        },
        { text: "", color: C_FG },
        {
          text: t("modBrowse.sessionLoad.whatIsTemporary", "What is temporary is the MOD. What it does is not."),
          color: C_WARN,
        },
        {
          text: t(
            "modBrowse.sessionLoad.characterChanged",
            "A character it changed stays changed. Settings it wrote stay written.",
          ),
          color: C_DIM,
        },
        {
          text: t("modBrowse.sessionLoad.networkSent", "Anything it sent over the network has been sent."),
          color: C_DIM,
        },
      ],
    },
  ];

  if (runs) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        { text: t("modBrowse.sessionLoad.runsCode", "THIS MOD RUNS CODE:"), color: C_BAD },
        ...preview.code.map((path) => ({ text: `  ${path}`, color: C_WARN })),
        { text: "", color: C_FG },
        {
          text: t(
            "modBrowse.sessionLoad.codeRunsInside",
            "Code in a mod runs inside the game, with everything the game has.",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modBrowse.sessionLoad.canReadRewrite",
            "It can read and rewrite your characters and talk to the network,",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modBrowse.sessionLoad.listDeclared",
            "whatever the list below says - that list is what the mod DECLARED.",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modBrowse.sessionLoad.loadTrusted1",
            "Load code you wrote, or code from somebody you would trust with the",
          ),
          color: C_DIM,
        },
        {
          text: t("modBrowse.sessionLoad.loadTrusted2", "same file if it were permanent. This is the same decision."),
          color: C_DIM,
        },
      ],
    });
  }

  if (preview.capabilities === null) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        {
          text: t("modBrowse.sessionLoad.manifestUnreadable", "Its manifest.json could not be read as JSON."),
          color: C_BAD,
        },
        {
          text: t(
            "modBrowse.sessionLoad.manifestRefused",
            "So there is no list of what it asks for. It will be refused.",
          ),
          color: C_DIM,
        },
      ],
    });
  } else if (caps.length > 0) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        { text: t("modBrowse.sessionLoad.asksFor", "It asks for:"), color: C_FG },
      ],
    });
    /* THE SAME TABLE THE INSTALL CONSENT SCREEN DRAWS (mods.ts's
     * capabilityConsentScreen), column for column. A long blurb wraps in the
     * room left by the elevated flag, just as it does before installation. */
    blocks.push({
      kind: "table",
      key: "capabilities",
      tagged: false,
      columns: [
        { key: "bullet", width: 3, align: "right" },
        { key: "text", wrap: true },
        { key: "elevated", gap: 3, pad: false },
      ],
      rows: caps.map((d): ScreenRow => ({
        id: d.cap,
        semantic: { kind: "capability", ref: d.cap, data: { elevated: d.elevated } },
        color: d.elevated ? C_WARN : C_FG,
        cells: {
          bullet: { text: "-" },
          text: { text: d.text },
          elevated: { text: d.elevated ? t("modBrowse.sessionLoad.elevatedTag", "[elevated]") : "" },
        },
      })),
    });
  } else if (runs) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        {
          text: t("modBrowse.sessionLoad.noCapabilitiesNamed", "It asks for no capabilities by name."),
          color: C_DIM,
        },
        {
          text: t(
            "modBrowse.sessionLoad.boundsNothing",
            "That bounds nothing: the code is in the game either way.",
          ),
          color: C_DIM,
        },
      ],
    });
  }

  blocks.push({
    kind: "lines",
    lines: [
      { text: "", color: C_FG },
      ...(survivesReload
        ? [
            {
              text: t(
                "modBrowse.sessionLoad.survives",
                "It will still be here after the reload, and gone the time after.",
              ),
              color: C_DIM,
            },
          ]
        : [
            {
              text: t(
                "modBrowse.sessionLoad.doesNotSurvive",
                "This browser will not hold it across a reload, so it cannot load.",
              ),
              color: C_BAD,
            },
            {
              text: t(
                "modBrowse.sessionLoad.installInstead",
                "Install it instead, or save the file and import it.",
              ),
              color: C_FG,
            },
          ]),
    ],
  });

  return freezeView({
    id: "core:mod-session-load",
    title: runs
      ? t("modBrowse.sessionLoad.titleRuns", "Run this mod for one session?")
      : t("modBrowse.sessionLoad.titleLoads", "Load this mod for one session?"),
    footer: SCREEN_FOOTER,
    blocks,
  });
}

/** What the screen says once an archive is staged. */
export function sessionLoadedLines(
  id: string,
  source: string,
  runs: boolean,
): readonly ScreenLine[] {
  return [
    { text: t("modBrowse.sessionLoaded.loaded", "{id} is loaded for this session.", { id }), color: C_GOOD },
    { text: "", color: C_FG },
    {
      text: t("modBrowse.sessionLoaded.from", "From {source}. Nothing has been added to your mods.", {
        source,
      }),
      color: C_DIM,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modBrowse.sessionLoaded.reload",
        "Reload to start using it - you are offered that on the way out.",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modBrowse.sessionLoaded.listedInList",
        "It is listed in the mod list, marked for this session, and can be dropped there.",
      ),
      color: C_DIM,
    },
    { text: "", color: C_FG },
    ...(runs
      ? [
          {
            text: t("modBrowse.sessionLoaded.codeRuns", "Its code will run every reload until you close the game."),
            color: C_WARN,
          },
          {
            text: t("modBrowse.sessionLoaded.dropToStop", "Dropping it and reloading is how you stop it."),
            color: C_DIM,
          },
        ]
      : [
          {
            text: t(
              "modBrowse.sessionLoaded.doNotCare",
              "Do not play a character you care about on session-only content:",
            ),
            color: C_WARN,
          },
          {
            text: t(
              "modBrowse.sessionLoaded.goesWithIt",
              "next time the pack is gone, and what it added goes with it.",
            ),
            color: C_DIM,
          },
        ]),
  ];
}

/** Look at an archive, ask, and stage it. True when something was staged. */
async function tryOne(
  term: GridSurface & GridPointerInput,
  bytes: Uint8Array,
  source: string,
  deps: ModBrowseDeps,
  zip: ZipImportDeps,
): Promise<boolean> {
  const preview = await paintWhile(
    term,
    t("modBrowse.tryOne.title", "For this session"),
    t("modBrowse.tryOne.reading", "Reading {source}...", { source }),
    () => previewSessionArchive(bytes),
  );
  if (!preview.ok) {
    await showTextScreen(term, zipImportFailureScreen(preview.problem));
    return false;
  }

  const survives = zip.sessionSurvivesReload();
  await showTextScreen(term, sessionLoadScreen(preview, source, survives));
  /* ASKED AFTER THE SCREEN, NOT ON IT. The read-through comes first and the choice
   * second, which is the shape the install consent prompt uses - a player who
   * pressed a key to get past a wall of text has not answered a question. */
  const pick = await selectFromMenu(
    term,
    "core:mod-session-consent",
    preview.code.length > 0
      ? t("modBrowse.tryOne.runConfirm", "Run {id} for this session?", { id: preview.id })
      : t("modBrowse.tryOne.loadConfirm", "Load {id} for this session?", { id: preview.id }),
    [
      {
        label: survives
          ? t("modBrowse.tryOne.yesLoad", "Yes, load it for this session")
          : t("modBrowse.tryOne.cannotHold", "Cannot: this browser will not hold it"),
        color: survives ? C_WARN : C_DIM,
        hint: survives
          ? t("modBrowse.tryOne.yesLoadHint", "Applies on the next reload. Gone when you close the game.")
          : t("modBrowse.tryOne.cannotHoldHint", "Storage is off in this window, so a reload would lose it."),
      },
      {
        label: t("modBrowse.tryOne.no", "No, leave it alone"),
        color: C_FG,
        hint: t("modBrowse.tryOne.noHint", "Nothing is loaded or changed."),
      },
    ],
    t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
  );
  if (pick !== 0 || !survives) return false;

  const staged = await paintWhile(
    term,
    t("modBrowse.tryOne.title", "For this session"),
    t("modBrowse.tryOne.checking", "Checking {source}...", { source }),
    () =>
      /* The capabilities the archive DECLARED are what is granted, and only for this
       * session. Granting exactly the declared list is what the install path does
       * (`setConsent(id, m.capabilities)`); the difference is where it is kept. */
      zip.loadForSession(bytes, source, preview.capabilities ?? [], preview.digest),
  );
  if (!staged.ok) {
    await showTextScreen(
      term,
      zipImportFailureScreen(staged.problem, (staged.unmet ?? []) as readonly Finding[]),
    );
    return false;
  }
  await showTextScreen(
    term,
    staged.mod.id,
    sessionLoadedLines(staged.mod.id, source, staged.code),
  );
  void deps;
  return true;
}

/** What the "What is this?" row says, which depends on what this platform can do. */
function aboutImport(folder: string | null, canArchive: boolean): readonly ScreenLine[] {
  const dim = (text: string): ScreenLine => ({ text, color: C_DIM });
  const fg = (text: string): ScreenLine => ({ text, color: C_FG });
  return [
    fg(t("modBrowse.aboutImport.body1", "A mod can be installed from a .zip file instead of from a repository.")),
    dim(t("modBrowse.aboutImport.body2", "This is the same install: the same requirements are checked, and the")),
    dim(t("modBrowse.aboutImport.body3", "mod is stored the same way. Only where the bytes came from differs.")),
    { text: "", color: C_FG },
    fg(t("modBrowse.aboutImport.body4", "The zip has to hold ONE mod, and its manifest.json has to be either:")),
    dim(t("modBrowse.aboutImport.body5", "  at the top of the zip, or")),
    dim(t("modBrowse.aboutImport.body6", "  inside a single folder at the top of the zip.")),
    dim(t("modBrowse.aboutImport.body7", 'That second shape is what GitHub\'s "Download ZIP" gives you.')),
    { text: "", color: C_FG },
    fg(t("modBrowse.aboutImport.body8", "Nothing deeper is looked at. A zip holding two mods is refused, and")),
    fg(t("modBrowse.aboutImport.body9", "says which two, rather than guessing which one you meant.")),
    { text: "", color: C_FG },
    ...(folder === null
      ? [dim(t("modBrowse.aboutImport.noFolder", "This front end has no mods folder, so only the file picker is offered."))]
      : [
          fg(t("modBrowse.aboutImport.folder1", "You can also drop a zip into the mods folder and import it here:")),
          dim(`  ${folder}`),
          ...(canArchive
            ? [
                dim(t("modBrowse.aboutImport.folder2", "A zip imported from there is moved into imported/ once the mod is")),
                dim(t("modBrowse.aboutImport.folder3", "installed - kept, not deleted, so your download is still yours.")),
              ]
            : []),
        ]),
    { text: "", color: C_FG },
    fg(t("modBrowse.aboutImport.body10", "A zip is never checked at startup and never unpacked on its own.")),
    dim(t("modBrowse.aboutImport.body11", "Importing is something you do, once, from this screen.")),
    { text: "", color: C_FG },
    fg(t("modBrowse.aboutImport.body12", "An imported mod keeps the repository its own manifest declares, so the")),
    fg(t("modBrowse.aboutImport.body13", "update check has somewhere to ask. You can also import a newer zip.")),
  ];
}

/**
 * The door chooser.
 *
 * Returns true when anything was installed or removed, so the caller can offer the
 * reload that makes it take effect.
 */
export async function showModBrowse(term: GridSurface & GridPointerInput, deps: ModBrowseDeps): Promise<boolean> {
  let changed = false;

  for (;;) {
    const allowed = deps.consent.read();
    const items: MenuItem[] = [
      {
        label: t("modBrowse.doorChooser.recommended", "Recommended mods"),
        color: C_FG,
        hint: t("modBrowse.doorChooser.recommendedHint", "A curated list of repositories, kept with the game."),
      },
      {
        label: t("modBrowse.doorChooser.registry", "Add from a registry address"),
        color: allowed ? C_FG : C_DIM,
        hint: allowed
          ? t("modBrowse.doorChooser.registryHint", "Somebody else's list of mods.")
          : t("modBrowse.doorChooser.needsConsent", 'Needs "Allow third-party mods" below.'),
      },
      {
        label: t("modBrowse.doorChooser.repository", "Add from a repository address"),
        color: allowed ? C_FG : C_DIM,
        hint: allowed
          ? t("modBrowse.doorChooser.repositoryHint", "One mod, by owner/repo.")
          : t("modBrowse.doorChooser.needsConsent", 'Needs "Allow third-party mods" below.'),
      },
      {
        label: t("modBrowse.doorChooser.importFile", "Import a mod from a file"),
        color: !deps.importZip ? C_DIM : allowed ? C_FG : C_DIM,
        hint: !deps.importZip
          ? t("modBrowse.doorChooser.cannotReadFile", "This front end cannot read a file.")
          : allowed
            ? t("modBrowse.doorChooser.importFileHint", "A .zip you have, or one waiting in the mods folder.")
            : t("modBrowse.doorChooser.needsConsent", 'Needs "Allow third-party mods" below.'),
      },
      {
        label: t("modBrowse.doorChooser.allowThirdParty", "Allow third-party mods: {state}", {
          state: allowed ? t("modBrowse.common.yes", "yes") : t("modBrowse.common.no", "no"),
        }),
        color: allowed ? C_WARN : C_FG,
        hint: allowed
          ? t(
              "modBrowse.doorChooser.acceptedRisks",
              "You have accepted the risks of installing other people's code.",
            )
          : t(
              "modBrowse.doorChooser.readFirst",
              "A mod can run code. Read what this means before choosing.",
            ),
      },
      {
        label: t("modBrowse.common.whatIsThis", "What is this?"),
        color: C_DIM,
        hint: t("modBrowse.doorChooser.whatIsThisHint", "Where mods come from."),
      },
    ];

    const pick = await selectFromMenu(
      term,
      "core:mod-get",
      t("modBrowse.doorChooser.title", "Get mods"),
      items,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    );
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
      await showTextScreen(term, t("modBrowse.doorChooser.title", "Get mods"), aboutLines());
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
        t("modBrowse.doorChooser.registryPrompt", "Registry address"),
        DEFAULT_REGISTRY_URL,
        200,
        t("modBrowse.doorChooser.registryPromptFooter", "[ type or paste an address, Enter to read it, ESC to cancel ]"),
      );
      if (url === null || url.trim() === "") continue;
      if (await openRegistry(term, "third-party", () => deps.registryAt(url.trim()), deps)) {
        changed = true;
      }
      continue;
    }

    const typed = await promptText(
      term,
      t("modBrowse.doorChooser.repositoryPrompt", "Repository"),
      "",
      200,
      t(
        "modBrowse.doorChooser.repositoryPromptFooter",
        "[ owner/repo or a GitHub address, Enter to look it up, ESC to cancel ]",
      ),
    );
    if (typed === null || typed.trim() === "") continue;
    const ref = parseRepoRef(typed.trim());
    if (!ref.ok) {
      await showTextScreen(term, t("modBrowse.notARepo.title", "That is not a repository"), [
        { text: ref.problem, color: C_BAD },
        { text: "", color: C_FG },
        { text: t("modBrowse.notARepo.examples", "Examples:"), color: C_DIM },
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
 * Prepare the existing single-mod installer for a game-update pass.
 *
 * The pending tags still come from `pendingUpgrades`; this only turns one of
 * those already-shown, pinned tags into the same install operation the mod
 * manager normally performs.  One curated-list read covers the entire pass.
 */
export async function gameUpdateModInstaller(
  term: GridSurface & GridPointerInput,
  deps: ModUpgradeDeps,
): Promise<(upgrade: ModUpgrade) => Promise<string | null>> {
  const curated = await curatedRepos(deps);
  return async (upgrade) => {
    const entry = await deps.discover({ repo: upgrade.repo, tag: upgrade.to });
    if (!entry.ok) return entry.problem;
    const origin: ModOrigin = curated.has(upgrade.repo.toLowerCase()) ? "curated" : "third-party";
    let problem: string | null = null;
    const installed = await installOne(term, entry, origin, deps, {
      offerEnable: false,
      reportOutcome: false,
      onFailure: (reason) => {
        problem = reason;
      },
    });
    return installed ? null : (problem ?? "The mod was not installed.");
  };
}

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
export async function showModUpgrades(term: GridSurface & GridPointerInput, deps: ModUpgradeDeps): Promise<boolean> {
  let changed = false;

  for (;;) {
    /* Re-asked each time round, because an install just changed the answer. It is
     * one request per mod, and the alternative is a list that disagrees with what
     * the player just did. */
    const refreshed = await paintWhile(
      term,
      t("modBrowse.upgrades.title", "Update installed mods"),
      t("modBrowse.upgrades.asking", "Asking each mod's repository..."),
      () => deps.refresh(),
    );
    const pending = pendingUpgrades(refreshed);
    const blind = unavailableMods(refreshed);

    if (pending.length === 0) {
      await showTextScreen(term, modUpdateReportScreen(refreshed));
      return changed;
    }

    const items: MenuItem[] = [
      {
        label:
          pending.length === 1
            ? t("modBrowse.upgrades.updateIt", "Update it")
            : t("modBrowse.upgrades.updateAll", "Update all {count}", { count: pending.length }),
        color: C_WARN,
        hint: t(
          "modBrowse.upgrades.updateAllHint",
          "Download and store each one in turn. Nothing is enabled or disabled.",
        ),
      },
      ...pending.map((u) => ({
        label: `${u.name ?? u.id}  ${u.from} -> ${u.to}`,
        color: C_FG,
        hint: t("modBrowse.upgrades.updateOneHint", "Update only this one, from {repo}.", { repo: u.repo }),
      })),
      ...blind.map((r) => ({
        label: t("modBrowse.upgrades.couldNotCheck", "{id}  could not be checked", { id: r.id }),
        color: C_WARN,
        enabled: false,
        /* The address as well as the reason: a player told "HTTP 404" can do
         * nothing, and a player given the page can look at it themselves. */
        hint: `${r.problem ?? t("modBrowse.upgrades.noReasonGiven", "no reason given")} - ${repoPage(r)}`,
      })),
    ];

    const pick = await selectFromMenu(
      term,
      "core:mod-update",
      t("modBrowse.upgrades.title", "Update installed mods"),
      items,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    );
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
        await showTextScreen(term, installFailureScreen(u.id, entry.problem));
        continue;
      }
      const origin: ModOrigin = curated.has(u.repo.toLowerCase()) ? "curated" : "third-party";
      if (await installOne(term, entry, origin, deps)) changed = true;
    }
  }
}

/**
 * `refreshRow`'s sentence with the two fields it opens with taken back off it.
 *
 * DERIVED RATHER THAN RE-WORDED. Six standings' wording lives in mod-refresh.ts and
 * a second copy of it here would be two transcriptions of the same sentence, with
 * the one nobody looks at rotting - the lesson screen-view.ts's header is built on.
 * Every branch of `refreshRow` opens `${id} ${installed}` and then says one thing
 * about the repository, so the head is the shape of that function rather than a
 * guess; the test asserts the three cells rejoin into exactly `refreshRow(r)`, which
 * is what fails the day it stops being true.
 */
function refreshStatus(r: ModRefresh): string {
  const head = `${r.name ?? r.id} ${r.installed}`;
  const row = refreshRow(r);
  return row.startsWith(`${head} `) ? row.slice(head.length + 1) : row;
}

/**
 * The "nothing is waiting" report as a document: prose, then the per-mod list as a
 * TABLE, then prose.
 *
 * THE LIST IS THE PART THAT WAS BEING LOST. `ModRefresh` already carries the six
 * facts a row is made of - id, repo, installed tag, newest tag, standing, and why
 * the repository could not be asked - and `refreshRow` glued them into one sentence
 * before anything could see them. A presenter that wanted to sort by standing, or
 * colour the status, or act on the mod this row is about, had to find an arrow in
 * English first. Cells carry the fields and `semantic.data` carries the record.
 *
 * THE PROSE AROUND IT STAYS `lines`, by the rule rather than for convenience: the
 * headline is prose this screen has already laid out (`wrapMessage` at
 * MESSAGE_WIDTH) and the closing paragraphs are hand-broken constants. Re-declaring
 * them as `text` blocks would hand the wrap to `textblock_calculate_lines`, which
 * agrees with `wrapMessage` on every headline `upToDateHeadline` can produce today
 * but not by construction - a moved line on the player's screen for no gain.
 *
 * NO `latest` COLUMN, which is where this parts company with the obvious four-column
 * shape. Only a `behind` row writes a newest tag at all, so a column for it is empty
 * on the other five standings and puts a stray space into every one of their rows.
 * The tag rides on `semantic.data.newest` instead, unformatted and without the arrow
 * - which is what a presenter wanted from that column in the first place.
 */
export function modUpdateReportScreen(refreshed: readonly ModRefresh[]): ScreenView {
  const blind = unavailableMods(refreshed);
  return freezeView({
    id: "core:mod-updates",
    title: t("modBrowse.upgrades.title", "Update installed mods"),
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "lines",
        lines: [
          /* One sentence, from one place, that has to fit what was actually asked -
           * see upToDateHeadline. Composing it here is how it came to say "every"
           * about a set that included mods nothing had asked about. */
          ...wrapMessage(upToDateHeadline(refreshed), MESSAGE_WIDTH).map((text) => ({
            text,
            color: blind.length > 0 && blind.length === refreshed.length ? C_WARN : C_FG,
          })),
          { text: "", color: C_FG },
        ],
      },
      {
        kind: "table",
        key: "installed",
        tagged: false,
        columns: [
          /* The listing's two columns of margin, as a column of their own. The
           * alternative was to bake them into the mod cell, which would put the
           * terminal's indent back inside the one field a mod is addressed by. */
          { key: "indent", width: 2 },
          /* The identifying fields stay unpadded; status uses their remaining
           * space and continues below them when a repository returns a long reason. */
          { key: "mod", gap: 0, pad: false },
          { key: "installed", pad: false },
          { key: "status", wrap: true },
        ],
        rows: refreshed.map((r) => ({
          id: r.id,
          semantic: {
            kind: "mod",
            ref: r.id,
            data: {
              repo: r.repo,
              installed: r.installed,
              newest: r.newest,
              standing: r.standing,
              problem: r.problem,
              channelHeld: r.channelHeld,
            },
          },
          /* The whole row in one colour, exactly as the line was. Colouring the
           * status CELL would emit a `runs` array where a plain coloured line used
           * to go: the same pixels down a different path in showTextScreen, and a
           * different object for anything that measures. A presenter with its own
           * palette reads `semantic.data.standing` and colours what it likes. */
          color: r.standing === "unavailable" ? C_WARN : C_DIM,
          cells: {
            mod: { text: r.name ?? r.id },
            installed: { text: r.installed },
            status: { text: refreshStatus(r) },
          },
        })),
        /* No `empty` state: with nothing installed the old screen printed nothing
         * between the headline and the closing prose, and the headline is already
         * "No mods are installed yet." */
      },
      {
        kind: "lines",
        lines: [
          ...(blind.length > 0
            ? [
                { text: "", color: C_FG },
                {
                  text: t(
                    "modBrowse.upgrades.blind1",
                    "A mod that could not be checked has NOT been removed and has not",
                  ),
                  color: C_DIM,
                },
                {
                  text: t(
                    "modBrowse.upgrades.blind2",
                    "changed. Its repository may be renamed, private, or simply not",
                  ),
                  color: C_DIM,
                },
                { text: t("modBrowse.upgrades.blind3", "reachable from here right now."), color: C_DIM },
              ]
            : []),
          { text: "", color: C_FG },
          ...aboutModUpgradesLines(),
        ],
      },
    ],
  });
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

/**
 * Where a mod update comes from, said once.
 *
 * A FUNCTION, not a constant: see gameMenuFooter's comment in game-menu.ts - a
 * locale can change mid-session, so nothing translatable may be frozen at
 * import time.
 */
function aboutModUpgradesLines(): readonly ScreenLine[] {
  return [
    {
      text: t(
        "modBrowse.aboutUpgrades.body1",
        "Each mod lives in its own repository and releases on its own schedule,",
      ),
      color: C_DIM,
    },
    {
      text: t(
        "modBrowse.aboutUpgrades.body2",
        "so this asks every installed mod where it came from and compares the",
      ),
      color: C_DIM,
    },
    {
      text: t(
        "modBrowse.aboutUpgrades.body3",
        "version you have with the newest one your update channel allows.",
      ),
      color: C_DIM,
    },
    {
      text: t(
        "modBrowse.aboutUpgrades.body4",
        "Game and mod updates can be installed together from Update, or separately here.",
      ),
      color: C_DIM,
    },
  ];
}

/** Draw one line, let it paint, then run `job`. For a wait a player can read. */
async function paintWhile<T>(
  term: GridSurface & GridPointerInput,
  title: string,
  line: string,
  job: () => Promise<T>,
): Promise<T> {
  /* A REGION for the length of the job (#253). This is the shared wait screen,
   * so converting it converts every caller of it at once. */
  const handle = pushRegion(screenRegionSpec(), term.size());
  const waiting = regionSurface(term, handle.cells);
  const { cols } = waiting.size();
  waiting.clear();
  waiting.print(0, 1, title.slice(0, cols - 1), C_FG);
  waiting.print(0, 3, line.slice(0, cols - 1), C_DIM);
  waiting.flush?.();
  try {
    return await job();
  } finally {
    popRegion(handle);
  }
}

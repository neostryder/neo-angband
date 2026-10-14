import { type ModOrigin } from "../mod-consent";
import { t } from "@rpgm-tools/neo-angband-core";
import { type DiscoveredMod } from "../mod-discover";
import { type BrowseEntry } from "./browse-types";
import { type MenuItem, type ScreenLine } from "../overlay";
import { C_BAD, C_FG, C_GOOD, C_WARN, C_DIM } from "./browse-colors";
import { formatBytes } from "./classic-browse-archive";
import { displayName, type AuthorRegister, standingNote, authorFor } from "../mod-authors";
import { repoPageUrl } from "../mod-source";
import { type Finding } from "@rpgm-tools/neo-angband-mod-sdk";
import { type ScreenRow, type ScreenBlock, type ScreenView, freezeView, SCREEN_FOOTER, screenBodyLines } from "../screen-view";
import { MOD_CHECK_ADVICE } from "../mod-install";

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
export function wrapTo(text: string, width: number): string[] {
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
export const MESSAGE_WIDTH = 74;

/**
 * Wrap one line of a message, and only if it needs it.
 *
 * wrapTo splits on whitespace, so passing it every line would strip the indent off the
 * bulleted requirements the standards inspection returns - turning a readable list into
 * a flush-left block. A line that already fits is therefore handed back untouched, and
 * a line that does not keeps its indent on every continuation.
 */
export function wrapMessage(line: string, width: number): string[] {
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
export function findingRow(f: Finding, color: string): ScreenRow {
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
export function refusalBlocks(problem: string, unmet: readonly Finding[], color: string): ScreenBlock[] {
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
export function aboutLines(): readonly ScreenLine[] {
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

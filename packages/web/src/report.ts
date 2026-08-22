/**
 * The problem report: what a player sends when something goes wrong.
 *
 * NOTHING HERE LEAVES THE MACHINE. The report is written to the game's `logs`
 * folder on desktop and downloaded in a browser, and the player is told the path
 * so they can attach it to a message. That is a deliberate choice rather than a
 * missing feature: an uploader is a service to run, a privacy notice to write and
 * a consent flow to get right, and none of those are worth shipping half of. The
 * bundle below is the whole of what an uploader would ever send, so wiring one
 * later is a function, not a rewrite.
 *
 * THAT STAYS TRUE NOW THAT THE SCREEN CAN OPEN A TRACKER. Opening a page is not
 * uploading a report: the file stays where it was written, and what crosses the
 * network is a request for somebody's issues page, made by the player's own
 * browser because they pressed a key asking for it. The report is still attached
 * by hand, on purpose - a form the player fills in themselves is a form they read.
 *
 * SAME SPLIT AS update-ui.ts: the words and the arithmetic are here and tested,
 * main.ts owns the painting. The text is the part worth asserting, because the
 * whole value of a report is whether somebody reading it a week later can tell
 * what happened.
 *
 * WHAT IS DELIBERATELY IN IT, and why each one has earned its place from a real
 * bug in this project:
 *
 *   the version        "it happens on 0.16.something" is not a build
 *   the display metrics a ghost-residue bug that only appeared at fractional dpr
 *   the shell          a portable launch cannot self-update and reports `manual`
 *   the enabled mods   a mod's patch is indistinguishable from a core bug on screen
 *   the dropped count  "the last 2000 lines" and "the session" look identical
 */

import { elideHome } from "@rpgm-tools/neo-angband-core/log";
import { githubRepo } from "@rpgm-tools/neo-angband-mod-sdk";
import type { LogLevel } from "@rpgm-tools/neo-angband-core/log";

/** How many log lines the report carries, newest last. */
export const REPORT_LOG_LINES = 500;

/** How many lines of free text the player is asked for. */
export const REPORT_DESCRIPTION_LINES = 3;

/** Which front end this is, in the player's words rather than the code's. */
export type ReportShell = "desktop" | "installed" | "browser";

export const SHELL_BLURB: Record<ReportShell, string> = {
  desktop: "the desktop app",
  installed: "installed from the browser (PWA)",
  browser: "a browser tab",
};

export interface ReportCharacter {
  readonly name: string;
  readonly race: string;
  readonly cls: string;
  readonly level: number;
  readonly depthFt: number;
}

export interface ReportInput {
  readonly at: number;
  readonly version: string;
  readonly parityBaseline: string;
  /** The exact build, where there is one. Distinguishes two deploys of 0.17.0. */
  readonly buildId?: string | undefined;
  readonly channel: string;
  readonly shell: ReportShell;
  readonly platform: string;
  readonly arch: string;
  readonly userAgent: string;
  readonly cols: number;
  readonly rows: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly level: LogLevel;
  readonly ringSize: number;
  readonly dropped: number;
  /** What the player typed, one entry per line. Empty is allowed and common. */
  readonly description: readonly string[];
  readonly character: ReportCharacter | null;
  readonly mods: readonly { readonly id: string; readonly version: string }[];
  /** Already-formatted log lines, oldest first. */
  readonly lines: readonly string[];
  /**
   * The user's home directory, so it can be taken out.
   *
   * Every path in a desktop log starts with it, and on Windows it is routinely
   * somebody's full name. The log FILE keeps it - that file is theirs, on their
   * machine - but the report is the artefact they hand to a stranger, so this is
   * the one place it is worth removing. Undefined in a browser, which has no
   * such path to leak.
   */
  readonly home?: string | undefined;
}

function heading(text: string): string[] {
  return ["", text, "-".repeat(text.length)];
}

function stamp(at: number): string {
  try {
    return new Date(at).toISOString();
  } catch {
    return "(unknown time)";
  }
}

/** `level 12 Half-Troll Warrior, 550 feet down` - or where they are standing. */
export function describeCharacter(c: ReportCharacter): string {
  const where = c.depthFt === 0 ? "in town" : `${String(c.depthFt)} feet down`;
  return `${c.name}, level ${String(c.level)} ${c.race} ${c.cls}, ${where}`;
}

/**
 * The file.
 *
 * Plain text with underlined headings rather than JSON or Markdown: the reader
 * is a person, often in a chat window, and the first thing anybody does with a
 * report is scroll it. JSON would make the log lines - the bulk of it, and the
 * part that has to stay readable - into one escaped string.
 */
export function reportText(input: ReportInput): string {
  const out: string[] = [];
  const field = (name: string, value: string): void => {
    out.push(`${name.padEnd(15)}${value}`);
  };

  out.push("Neo Angband problem report", "==========================", "");
  field("written", stamp(input.at));
  field("version", `${input.version} (parity baseline ${input.parityBaseline})`);
  if (input.buildId !== undefined && input.buildId !== "") field("build", input.buildId);
  field("update channel", input.channel);
  field("shell", SHELL_BLURB[input.shell]);
  field("platform", `${input.platform} ${input.arch}`);
  field(
    "display",
    `${String(input.cols)}x${String(input.rows)} cells, ` +
      `${String(input.cssWidth)}x${String(input.cssHeight)} css px, dpr ${String(input.dpr)}`,
  );
  field("logging", `${input.level}, ring holds ${String(input.ringSize)}`);
  /* Only when it happened, because "0 dropped" on every report trains the eye to
   * skip the line that matters on the one report where it is not zero. */
  if (input.dropped > 0) {
    field("dropped", `${String(input.dropped)} earlier lines fell off the top`);
  }
  field("user agent", input.userAgent);

  out.push(...heading("What the player said"));
  const said = input.description.map((l) => l.trim()).filter((l) => l !== "");
  out.push(...(said.length > 0 ? said : ["(nothing written)"]));

  out.push(...heading("Character"));
  out.push(input.character ? describeCharacter(input.character) : "(no character in play)");

  out.push(...heading("Mods enabled"));
  out.push(
    ...(input.mods.length > 0
      ? input.mods.map((m) => `${m.id} ${m.version}`)
      : ["(none - this is the unmodified game)"]),
  );

  const lines = input.lines.slice(-REPORT_LOG_LINES);
  out.push(
    ...heading(
      `Log (${String(lines.length)} lines, oldest first` +
        `${input.lines.length > lines.length ? `, of ${String(input.lines.length)} held` : ""})`,
    ),
  );
  out.push(...(lines.length > 0 ? lines : ["(the log is empty)"]));
  out.push("");

  /* Elided once, over the whole document, rather than per field. A home path
   * turns up inside stack traces and inside JSON detail as well as in the fields
   * that are obviously paths, and doing it at the end is the only way to catch
   * the ones nobody thought of. */
  return elideHome(out.join("\n"), input.home);
}

/* ------------------------------------------------------------------ *
 * Where to send it.
 * ------------------------------------------------------------------ */

/**
 * The game's own tracker, and the only URL here that is a build constant.
 *
 * The CHOOSER rather than the plain tracker, because this repository's two issue
 * templates are known to exist - `2-bug.yml` for something broken and
 * `1-parity-difference.yml` for something that does not match Angband - and
 * picking the right one is most of what makes a first report readable. No other
 * project's templates are known here, which is why a mod is sent somewhere else.
 */
export const NEO_ANGBAND_TRACKER =
  "https://github.com/neostryder/neo-angband/issues/new/choose";

/**
 * The chat room, kept beside the tracker because it answers a different player.
 *
 * A tracker asks somebody who is not sure what they are looking at to write the
 * thing down formally. Plenty of reports start as "is this supposed to happen",
 * and the ones that do are lost entirely if the only door on this screen is an
 * issue form.
 */
export const RPGM_TOOLS_DISCORD = "https://discord.gg/YegtwbHTBQ";

/**
 * A mod's tracker: the tracker ROOT, deliberately, not the chooser.
 *
 * `/issues/new/choose` is not a promise. It presumes the repository has issue
 * templates and that its tracker is open at all, and neither is knowable from
 * here - a repository can disable issues, and one with no templates routes that
 * path by whatever GitHub currently does rather than by anything this game was
 * told. `/issues` is the one address that means the same thing for every state a
 * repository can be in: the player lands on the project's own tracker, reads
 * whatever it says about reporting, and files from there. One extra click buys a
 * URL that does not depend on a stranger's repository settings.
 *
 * Null when `repo` is not a GitHub owner/name. That covers the `file:import`
 * sentinel an installed record carries when nothing resolvable was declared, and
 * it covers it without naming it, because "not a repository this game can address"
 * is the question and the sentinel is only one way to be that.
 *
 * Resolved through the SDK's `githubRepo` rather than a pattern here, for the
 * reason `importedOrigin` gives: the requirement that refuses a manifest, the
 * field that pins an origin, and this all have to agree about what a repository
 * reference is, and a second parser is the one that drifts.
 */
export function modTrackerUrl(repo: string): string | null {
  const slug = githubRepo(repo);
  return slug === null ? null : `https://github.com/${slug}/issues`;
}

/** How many mod trackers the screen offers before it stops listing them. */
export const REPORT_MAX_MOD_TRACKERS = 8;

/**
 * Every action id `reportDestinations` can ever produce.
 *
 * WHY THE SET HAS TO BE FINITE AND WRITTEN DOWN. `SCREEN_NO_PROMPT` in screens.ts
 * is a census of every action the game publishes, and its totality test fails on
 * an action that appears in neither of that pair of tables. An id built from a
 * mod's own id could not be listed there, because the mods are not known until a
 * player installs them - so a screen with per-mod actions would either break that
 * test or force it to be loosened, and loosening it is how the four unnoticed
 * prompting sites it was written to catch got in.
 *
 * Derived from the cap rather than typed out, so the two cannot part: raising
 * `REPORT_MAX_MOD_TRACKERS` raises this, and `report.test.ts` checks that the
 * builder never emits an id outside it.
 */
export const REPORT_TRACKER_ACTION_IDS: readonly string[] = [
  "tracker-game",
  ...Array.from({ length: REPORT_MAX_MOD_TRACKERS }, (_, i) => `tracker-mod-${String(i + 1)}`),
  "tracker-chat",
];

/** An enabled mod, and the origin its install record pinned it to. */
export interface ReportModOrigin {
  readonly id: string;
  /** `owner/name`, the `file:import` sentinel, or empty where none was recorded. */
  readonly repo: string;
}

/**
 * One row of "where to report it".
 *
 * `url` is null for a row that names a mod the game cannot address. That row is
 * still SHOWN: an enabled mod missing from the list would read as a mod that
 * cannot be at fault, and the player would send a mod's bug to core.
 */
export interface ReportDestination {
  /** Stable action id, so a presenter can offer the row too. */
  readonly id: string;
  /** The key that opens it, or empty where there is nothing to open. */
  readonly key: string;
  readonly label: string;
  readonly url: string | null;
}

/**
 * The game's row, then one per enabled mod.
 *
 * THE GAME IS ALWAYS FIRST AND ALWAYS PRESENT. A player who cannot tell which
 * project is at fault - which is most of them, and is the normal case for a
 * crash - has a correct answer to reach for without reading the rest.
 *
 * Ids are positional and bounded rather than built from a mod's id, because
 * `SCREEN_PROMPTS` / `SCREEN_NO_PROMPT` in screens.ts is a census of every action
 * the game publishes and an id invented at runtime could never appear in it. The
 * cap is what makes the set finite; a player with more enabled mods than that is
 * told the list was cut rather than shown a screen of rows nobody can read.
 */
export function reportDestinations(
  mods: readonly ReportModOrigin[],
): ReportDestination[] {
  const out: ReportDestination[] = [
    { id: "tracker-game", key: "G", label: "Neo Angband itself", url: NEO_ANGBAND_TRACKER },
  ];
  let opened = 0;
  for (const mod of mods.slice(0, REPORT_MAX_MOD_TRACKERS)) {
    const url = modTrackerUrl(mod.repo);
    if (url === null) {
      out.push({ id: `tracker-mod-${String(out.length)}`, key: "", label: mod.id, url: null });
      continue;
    }
    opened++;
    out.push({
      id: `tracker-mod-${String(out.length)}`,
      key: String(opened),
      label: mod.id,
      url,
    });
  }
  out.push({
    id: "tracker-chat",
    key: "C",
    label: "Ask in the RPGM Tools Discord",
    url: RPGM_TOOLS_DISCORD,
  });
  return out;
}

/** Where the report ended up, or why it did not. */
export type ReportPhase = "compose" | "saved" | "failed";

export interface ReportView {
  readonly phase: ReportPhase;
  readonly shell: ReportShell;
  readonly description: readonly string[];
  readonly level: LogLevel;
  readonly lineCount: number;
  readonly modCount: number;
  /** Where it was written. A path on desktop, a filename in a browser. */
  readonly savedAs?: string | undefined;
  readonly error?: string | undefined;
  /** The folder reports go into, shown before one is written. */
  readonly logsDir?: string | undefined;
  /**
   * The enabled mods and where each came from, for the "where to report it" list.
   *
   * Separate from `modCount`, which is the count the compose page prints, because
   * these are only READ once a report exists and are read for a different fact:
   * the count answers "what will be in the file", these answer "whose bug is it".
   */
  readonly modOrigins?: readonly ReportModOrigin[] | undefined;
  /**
   * One line about what just happened, drawn at the top of the saved page.
   *
   * It exists for the one outcome this screen cannot otherwise report: a browser
   * refusing to open the tab. The game's own message log is where a note like this
   * would normally go, and it is the wrong place here - this page has cleared the
   * terminal and drawn over it, so a message written to the log is a message
   * written where the player cannot see it, about a key they just pressed and
   * watched do nothing.
   */
  readonly notice?: string | undefined;
}

export type ReportTone = "head" | "body" | "dim" | "good" | "warn";

export interface ReportLine {
  readonly text: string;
  readonly tone: ReportTone;
}

/**
 * The screen.
 *
 * It lists what the report will contain BEFORE it is written, which is the whole
 * reason this is a screen and not a menu row that silently drops a file
 * somewhere. A player who can see that the log and their character are going
 * into it can decide not to send it; one who cannot has to trust a sentence.
 */
export function reportLines(v: ReportView): ReportLine[] {
  const out: ReportLine[] = [];
  const say = (text: string, tone: ReportTone = "body"): void => {
    out.push({ text, tone });
  };

  if (v.phase === "saved") {
    say("The report is written.", "good");
    say("  " + (v.savedAs ?? ""), "dim");
    say("");
    if (v.notice !== undefined && v.notice !== "") {
      say(v.notice, "warn");
      say("");
    }
    say(
      v.shell === "desktop"
        ? "Nothing has been uploaded; attach that file where you report it."
        : "Your browser has downloaded it; attach it where you report it.",
      "body",
    );
    say("");

    /* THE ADVICE COMES BEFORE THE LIST, and that ordering is the point rather
     * than a preference. This block is drawn into a fixed number of terminal rows
     * and the painter simply stops at the last one, so whatever sits at the bottom
     * is what a small window loses. Below the list it would be the first thing to
     * go, on exactly the screen where a player who has never filed a bug is about
     * to file one. The list losing its last row costs a link they can still reach
     * from the game's own tracker; the advice losing its rows costs the report. */
    /* FOUR LINES, and the count is load-bearing rather than a matter of taste.
     * Measured in the desktop build at a window height that fits 27 rows: at five
     * the last destination's address fell off the bottom, because this block and
     * the list share one fixed budget. Anything added here is taken from the list
     * below it. */
    say("Before you post", "head");
    say("  One problem per report, and search the tracker first.", "body");
    say("  Say what you did, what you expected, and what happened instead.", "body");
    say("  Something broken is a bug. Something that merely differs from", "body");
    say("  Angband 4.2.6 is a parity difference. The form asks which.", "body");
    say("");

    const origins = v.modOrigins ?? [];
    const dests = reportDestinations(origins);
    say("Where to report it", "head");
    if (origins.length > 0) {
      /* Said ONCE, above the rows, and said plainly. An address here was recorded
       * from the mod's own manifest or from the place the player typed, and the
       * game has never checked that the project behind it is the project that
       * wrote the mod. Opening a stranger's repository because an archive claimed
       * it is the failure this line exists to make impossible to walk into. */
      say("  A mod's address comes from the mod itself and has not been", "dim");
      say("  checked. Read it before you open it.", "dim");
    }
    for (const d of dests) {
      say(`  ${(d.key === "" ? "-" : d.key).padEnd(3)}${d.label}`, "body");
      say(`     ${d.url ?? "no repository recorded - report it to Neo Angband"}`, "dim");
    }
    if (origins.length > REPORT_MAX_MOD_TRACKERS) {
      say(
        `  ...and ${String(origins.length - REPORT_MAX_MOD_TRACKERS)} more enabled mods not listed here.`,
        "dim",
      );
    }
    return out;
  }

  if (v.phase === "failed") {
    say("The report could not be written.", "warn");
    say("");
    say(v.error ?? "Something went wrong.", "body");
    say("");
    say("Nothing else has changed, and your character is untouched.", "body");
    return out;
  }

  say("Report a problem", "head");
  say("");
  say("This writes a file describing what the game was doing. It is NOT", "body");
  say("sent anywhere - it lands on your computer and you decide who sees it.", "body");
  say("");

  const said = v.description.map((l) => l.trim()).filter((l) => l !== "");
  say("What went wrong:", "body");
  if (said.length === 0) {
    say("  (nothing written yet - press D to describe it)", "dim");
    /* The one sentence that decides whether the description is worth reading, put
     * where it is read: on the page holding the key that asks for it, not on the
     * page shown afterwards when the words are already typed. The rest of what
     * makes a report actionable is on that later page, because the rest is about
     * choosing a tracker and posting rather than about what to write. */
    say("  Say what you did, what you expected, and what happened.", "dim");
  } else {
    for (const l of said) say(`  ${l}`, "good");
  }
  say("");
  say("The file will also contain:", "body");
  say("  the version, your platform, and the size of the window", "dim");
  say(`  the last ${String(Math.min(v.lineCount, REPORT_LOG_LINES))} lines of the log`, "dim");
  say(
    v.modCount > 0
      ? `  the ${String(v.modCount)} mod${v.modCount === 1 ? "" : "s"} you have enabled`
      : "  that you have no mods enabled",
    "dim",
  );
  say("  your character's name, race, class, level and depth", "dim");
  say("");
  say(`Logging is set to ${v.level}.`, "dim");
  if (v.level === "warn" || v.level === "error") {
    /* The one piece of advice on this screen, and it is the one that changes
     * whether the NEXT report is any use. A released build logs warnings only,
     * which is right for a machine that is working and useless on one that is
     * not. */
    say("Turning it up to info and making the problem happen again produces a", "body");
    say("much more useful report. Press L to change it.", "body");
  }
  if (v.logsDir !== undefined && v.logsDir !== "") {
    say("");
    say("Reports and logs are kept in:", "body");
    say(`  ${v.logsDir}`, "dim");
  }
  return out;
}

export function reportFooter(v: ReportView): string {
  if (v.phase === "saved") {
    /* The keys are named from the SAME list the rows were drawn from, so a footer
     * cannot come to offer a key no row has - which is the ordinary way a screen
     * with a variable number of rows goes wrong. */
    const keys = reportDestinations(v.modOrigins ?? [])
      .map((d) => d.key)
      .filter((k) => k !== "");
    return `[ ${keys.join("/")} to open a tracker - ESC to go back ]`;
  }
  if (v.phase === "failed") return "[ ENTER to try again - ESC to go back ]";
  return "[ D to describe - L logging level - ENTER to write it - ESC to go back ]";
}

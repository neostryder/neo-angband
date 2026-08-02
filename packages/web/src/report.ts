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
    say("");
    say("  " + (v.savedAs ?? ""), "dim");
    say("");
    if (v.shell === "browser" || v.shell === "installed") {
      say("Your browser has downloaded it. Attach it to a message and send it", "body");
      say("wherever you got the game from.", "body");
    } else {
      say("Send that file wherever you got the game from. Nothing has been", "body");
      say("uploaded anywhere - it is a file on your computer.", "body");
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
  if (v.phase === "saved") return "[ ESC to go back ]";
  if (v.phase === "failed") return "[ ENTER to try again - ESC to go back ]";
  return "[ D to describe - L logging level - ENTER to write it - ESC to go back ]";
}

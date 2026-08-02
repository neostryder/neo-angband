/**
 * What the (U)pdate screen says, with no terminal in sight.
 *
 * Same split as install-local.ts: the words and the arithmetic are here and are
 * tested, and main.ts owns the painting. The screen has to be honest about four
 * different situations that look identical from the title screen - a folder
 * install that can replace itself, a single-file portable launch that cannot,
 * the browser where the new build is already on the machine, and a failure -
 * so the text is the part worth asserting.
 */

import type { UpdateChannel } from "./update";

/** Tones, resolved to this shell's palette by the caller. */
export type UpdateTone = "head" | "body" | "dim" | "good" | "warn";

/**
 * What each channel means, in the player's words rather than GitHub's.
 *
 * "Pre-release" and "draft" are release-engineering vocabulary and neither one
 * tells a player what they will actually get, so the screen says how often the
 * build changes and how tested it is.
 */
export const CHANNEL_BLURB: Record<UpdateChannel, string> = {
  stable: "finished releases only",
  beta: "pre-releases too - where every 0.x version lives",
  early: "every commit, minutes after it lands - expect breakage",
};

export interface UpdateLine {
  readonly text: string;
  readonly tone: UpdateTone;
}

/** How this launch can take an update. Mirrors update-plan.ts, plus the web. */
export type UpdateHow = "swap" | "manual" | "web" | "none";

/**
 * `uptodate` exists so the channel is reachable.
 *
 * The (U)pdate row was originally painted only when there was something to
 * install, which is correct for a row whose whole job is to announce one - but
 * it also made the channel setting unreachable, because the only door to it is
 * this screen and the door only appeared when you did not need it. On desktop
 * the row is now always there and shimmers only when a build is waiting.
 */
export type UpdatePhase = "offer" | "uptodate" | "downloading" | "installing" | "failed";

export interface UpdateView {
  readonly how: UpdateHow;
  readonly current: string;
  readonly version: string;
  /** Which channel produced `version`, and the one the player can change. */
  readonly channel: UpdateChannel;
  /**
   * The offered build is BEHIND the installed one - only reachable by moving
   * from `early` to a slower channel. The screen must say so: an unlabelled
   * "0.16.0 is available" to someone running 0.16.1-edge.9 reads as a bug.
   */
  readonly older?: boolean | undefined;
  /**
   * The build this page was compiled from, for the web, where there is no
   * version to quote: every deploy of a release carries the same version
   * string and a different build id.
   */
  readonly buildId?: string | undefined;
  /** The folder that would be replaced, shown so the player knows what moves. */
  readonly installRoot?: string | undefined;
  /** The file this machine would fetch. */
  readonly assetName?: string | undefined;
  readonly phase: UpdatePhase;
  readonly received?: number | undefined;
  readonly total?: number | undefined;
  readonly error?: string | undefined;
  readonly releaseUrl?: string | undefined;
}

/** Bytes as a human reads them. Two significant figures is enough for a download. */
export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1024) return `${String(Math.round(n))} B`;
  const mb = n / (1024 * 1024);
  if (mb < 1) return `${String(Math.round(n / 1024))} KB`;
  if (mb < 100) return `${mb.toFixed(1)} MB`;
  return `${String(Math.round(mb))} MB`;
}

/**
 * An ASCII progress bar, because this screen is a terminal.
 *
 * A total of zero means the server did not send a content-length: the bar shows
 * as indeterminate rather than dividing by zero and drawing a full bar, which
 * would say "finished" for the whole download.
 */
export function progressBar(received: number, total: number, width = 40): string {
  const inner = Math.max(4, width - 2);
  if (!(total > 0)) return `[${"?".repeat(inner)}]`;
  const done = Math.max(0, Math.min(inner, Math.round((received / total) * inner)));
  return `[${"=".repeat(done)}${" ".repeat(inner - done)}]`;
}

/** The percentage, clamped, or null when there is no total to measure against. */
export function percent(received: number, total: number): number | null {
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
}

/**
 * A path that fits, cut in the MIDDLE.
 *
 * Found by screenshotting the real screen: an install under a deep folder ran
 * off the right edge and the terminal simply stopped drawing it, leaving
 * `...\Temp\claude\C--Repositories\e8d28b` - which reads as a complete path that
 * happens to look odd. Truncation eats the END, and the end of a path is the
 * part that identifies it. Cutting the middle keeps both the drive and the
 * folder name, and the ellipsis says a cut happened at all.
 */
/*
 * The default budget is 62, not 80: this path is printed after `  every file in `
 * on an 80-column line, so the width that matters is what is LEFT. Sizing it to
 * the screen instead of to the space is how the first attempt produced an
 * 84-character line and clipped anyway - a cut string that is still too long is
 * the original bug wearing an ellipsis.
 */
export function elidePath(p: string, width = 62): string {
  if (p.length <= width) return p;
  const keepEnd = Math.max(8, Math.floor((width - 3) / 2));
  const keepStart = width - 3 - keepEnd;
  return `${p.slice(0, keepStart)}...${p.slice(p.length - keepEnd)}`;
}

export function updateLines(v: UpdateView): UpdateLine[] {
  const out: UpdateLine[] = [];
  const say = (text: string, tone: UpdateTone = "body"): void => {
    out.push({ text, tone });
  };

  if (v.phase === "failed") {
    say("The update did not install.", "warn");
    say("");
    say(v.error ?? "Something went wrong.", "body");
    say("");
    say("Nothing was changed - you are still running this version, and your", "body");
    say("characters have not been touched. You can try again, or download the", "body");
    say("new version by hand from the releases page.", "body");
    if (v.releaseUrl) {
      say("");
      say(`  ${v.releaseUrl}`, "dim");
    }
    return out;
  }

  if (v.phase === "uptodate") {
    say(`Neo Angband ${v.current}`, "head");
    say("");
    say("This is the newest build on your channel.", "good");
    say("");
    say(`Channel: ${v.channel} - ${CHANNEL_BLURB[v.channel]}`, "dim");
    say("");
    say("A faster channel gets you newer builds sooner and tests them less.", "body");
    say("The game checks once when it starts, and the title screen row", "body");
    say("shimmers when something is waiting.", "body");
    return out;
  }

  if (v.phase === "downloading" || v.phase === "installing") {
    const received = v.received ?? 0;
    const total = v.total ?? 0;
    const pc = percent(received, total);
    say(`Neo Angband ${v.version}`, "head");
    say("");
    if (v.phase === "installing") {
      say("Installing, then restarting.", "good");
      say("");
      say("The game will close and open again on its own. Do not close it", "body");
      say("yourself while this happens.", "body");
      return out;
    }
    say(`Downloading ${v.assetName ?? "the update"}`, "body");
    say("");
    say(`  ${progressBar(received, total)}`, "body");
    say(
      `  ${humanBytes(received)}${total > 0 ? ` of ${humanBytes(total)}` : ""}` +
        `${pc === null ? "" : `   ${String(pc)}%`}`,
      "dim",
    );
    say("");
    say("Your characters are not touched by this.", "dim");
    return out;
  }

  /* phase === "offer" */
  if (v.how === "web") {
    /*
     * The web has no version to name. A deploy happens on every push and they
     * are all `0.17.0` as far as the version string goes, so what changed is a
     * BUILD - and printing "Neo Angband a newer version is available" to make
     * the shared sentence fit was worse than having its own.
     */
    say("A newer version of the game is ready.", "head");
    say(`This page is running build ${v.buildId ?? "unknown"}.`, "dim");
  } else if (v.older) {
    /* Leaving `early`. Calling this an update would be false, and saying
     * nothing at all would leave the player wondering why the channel they just
     * chose has no build in it. */
    say(`Moving back to ${v.version}.`, "head");
    say(`You are running ${v.current}, which is newer.`, "dim");
  } else {
    say(`Neo Angband ${v.version} is available.`, "head");
    say(`You are running ${v.current}.`, "dim");
  }
  say("");

  if (v.how === "web") {
    /* No channel line: the web has none. What the page runs is whatever the
     * site last deployed, and offering a setting that does nothing is worse
     * than the blank space.
     *
     * THIS USED TO SAY "the new version is already downloaded", which was true
     * of the only way staleness was detected then - a service worker that had
     * fetched and installed the new build. The build-id check answers the same
     * question from the server, so a page can now know it is out of date BEFORE
     * anything is downloaded, and that sentence became a claim the screen could
     * not stand behind. */
    say("Pressing ENTER fetches it and reloads the page onto it. That takes a", "body");
    say("moment and nothing else - your characters live in this browser and", "body");
    say("stay exactly where they are.", "body");
    return out;
  }

  say(`Channel: ${v.channel} - ${CHANNEL_BLURB[v.channel]}`, "dim");
  say("");

  if (v.how === "swap") {
    say("ENTER downloads it and restarts the game on the new version.", "good");
    say("");
    say("What changes:", "body");
    if (v.installRoot) say(`  every file in ${elidePath(v.installRoot)}`, "dim");
    say("  ...except neo-angband-data, which is where your characters,", "dim");
    say("  settings, scores and mods live. That folder is not touched.", "dim");
    say("");
    say("The old files are kept until the new ones are in place, so a failure", "body");
    say("here leaves you on the version you have now.", "body");
    return out;
  }

  if (v.how === "manual") {
    /* The single-file portable launch and the read-only install. Saying "cannot"
     * without saying WHY reads as a bug; both reasons are things the player did
     * on purpose and can undo. */
    say("This copy cannot replace itself.", "warn");
    say("");
    say("A single-file portable build unpacks itself to a temporary folder", "body");
    say("each time it runs, and an install in a protected folder cannot be", "body");
    say("written to. Either way there is nothing here to update in place.", "body");
    say("");
    say("ENTER opens the releases page, where you can download the new one.", "good");
    if (v.releaseUrl) {
      say("");
      say(`  ${v.releaseUrl}`, "dim");
    }
    return out;
  }

  say("There is nothing to install here.", "dim");
  return out;
}

/**
 * The footer, which is the only place that says what ENTER will do.
 *
 * C is offered wherever changing it is meaningful and safe - not mid-download,
 * and not in the browser, where there are no channels to choose between: the
 * page is whatever the site last deployed.
 */
export function updateFooter(v: UpdateView): string {
  if (v.phase === "downloading") return "[ ESC to cancel ]";
  if (v.phase === "installing") return "[ restarting... ]";
  const channel = v.how === "web" ? "" : " - C to change channel";
  if (v.phase === "failed") return `[ ENTER to try again${channel} - ESC to go back ]`;
  if (v.phase === "uptodate") return `[ C to change channel - ESC to go back ]`;
  if (v.how === "swap") {
    const verb = v.older ? "move back and restart" : "update and restart";
    return `[ ENTER to ${verb}${channel} - ESC to go back ]`;
  }
  if (v.how === "web") return "[ ENTER to reload onto the new version - ESC to go back ]";
  if (v.how === "manual") return `[ ENTER to open the releases page${channel} - ESC to go back ]`;
  return `[${channel === "" ? "" : " C to change channel -"} ESC to go back ]`;
}

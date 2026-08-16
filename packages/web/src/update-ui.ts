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

import { EDGE_MARKER, type UpdateChannel, type UpdateCheck } from "./update";

/** Tones, resolved to this shell's palette by the caller. */
import { upgradeNotice, type ModUpgrade } from "./mod-refresh";

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

/**
 * Is the installed build one this channel could not have published?
 *
 * The same test `decideUpdate` retired as a reason to go BACKWARDS, kept here
 * as a reason to EXPLAIN standing still. Only edge builds can be ahead of a
 * channel: every other version is reachable from every channel that is a
 * superset of it, so a plain 0.19.0 on `stable` is simply up to date.
 */
export function aheadOfChannel(v: {
  readonly current: string;
  readonly channel: UpdateChannel;
}): boolean {
  return v.current.includes(EDGE_MARKER) && v.channel !== "early";
}

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
/*
 * `unchecked` is the one that was missing, and its absence was a bug rather
 * than a gap: a check that failed produced the same `null` as a check that
 * found nothing, so the screen said "This is the newest build on your channel"
 * to a player whose game had never managed to ask. See UpdateCheck in
 * update.ts for the four outcomes that used to share one value.
 */
export type UpdatePhase =
  | "offer"
  | "uptodate"
  | "unchecked"
  | "downloading"
  | "installing"
  | "failed";

/**
 * A check's outcome, turned into the phase that describes it.
 *
 * A THREE-WAY MAPPING THAT USED TO BE TWO-WAY, and it lives here rather than
 * inline in main.ts because main.ts is the one file in this package no test
 * runs. The collapse it replaces - `phase: offer ? "offer" : "uptodate"` - was
 * three lines of shell code that no assertion could see, sitting under a screen
 * whose every sentence is asserted. Being unreachable by test is how it stayed
 * wrong through a whole release cycle.
 */
export function checkPhase(c: UpdateCheck): {
  readonly phase: UpdatePhase;
  readonly error: string | undefined;
} {
  if (!c.ok) return { phase: "unchecked", error: c.reason };
  return { phase: c.update ? "offer" : "uptodate", error: undefined };
}

export interface UpdateView {
  readonly how: UpdateHow;
  readonly current: string;
  readonly version: string;
  /** Which channel produced `version`, and the one the player can change. */
  readonly channel: UpdateChannel;
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
  /**
   * Installed mods this build has a newer copy of.
   *
   * ON THE SAME SCREEN AS THE GAME UPDATE, because they are the same question
   * to the player - "is anything waiting for me" - and they were two answers in
   * two places, one of which nobody could find.
   *
   * THE RELATIONSHIP BETWEEN THE TWO HAS CHANGED, though, and this comment used
   * to state the old one as a fact: "a mod version travels with the game build,
   * so the moment a game update lands is exactly the moment mod updates appear".
   * That was true while the catalogue shipped inside the build. Mods now release
   * from their own repositories on their own schedule (mod-refresh.ts), so the
   * two answers are simply independent, and this screen shows both because it is
   * where a player comes to ask.
   *
   * A SEPARATE KEY, though, never folded into ENTER. ENTER here quits the game
   * and swaps the whole install; pulling a 5 KiB mod is not that, and a player
   * who wanted only the mod should not have their session ended for it.
   */
  readonly modUpdates?: readonly ModUpgrade[] | undefined;
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

/**
 * The mod-update paragraph, or nothing at all.
 *
 * Nothing at all is the common case and it has to stay silent: a screen that
 * says "0 mods need updating" every time is a screen people stop reading, and
 * this one carries a sentence that matters.
 */
export function modUpdateLines(v: UpdateView): UpdateLine[] {
  const pending = v.modUpdates ?? [];
  const notice = upgradeNotice(pending);
  if (notice === null) return [];
  const out: UpdateLine[] = [{ text: "", tone: "body" }, { text: notice, tone: "warn" }];
  /* Listed one per line only when the single-line notice did not already name
   * them, so the one-mod case does not say the same thing twice. */
  if (pending.length > 1) {
    for (const u of pending) {
      out.push({ text: `  ${u.id}  ${u.from} -> ${u.to}`, tone: "dim" });
    }
  }
  out.push({ text: "", tone: "body" });
  out.push({ text: "M updates your mods. It does not touch the game.", tone: "good" });
  return out;
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

  if (v.phase === "unchecked") {
    say(`Neo Angband ${v.current}`, "head");
    say("");
    say("The check for a new version did not get an answer.", "warn");
    say("");
    say(v.error ?? "GitHub could not be reached.", "body");
    say("");
    /* Says nothing either way ON PURPOSE, and does not contain the currency
     * sentence even to deny it: a failed check knows nothing about what is
     * published, and the reassuring guess is the one that hides an update.
     * update-ui.test.ts holds this branch to that, by the same phrase
     * mod-refresh.test.ts holds the mod half to. */
    say("The game does not know whether anything is waiting for you, so it is", "body");
    say("not going to tell you either way. A reassuring guess here is exactly", "body");
    say("the guess that hides an update.", "body");
    say("");
    say(`Channel: ${v.channel} - ${CHANNEL_BLURB[v.channel]}`, "dim");
    say("");
    say("ENTER asks again.", "good");
    return [...out, ...modUpdateLines(v)];
  }

  if (v.phase === "uptodate") {
    say(`Neo Angband ${v.current}`, "head");
    say("");
    if (aheadOfChannel(v)) {
      /* The Windows Insider case, and the ONLY reason this screen has two
       * ways of saying "nothing to install". Somebody who moved off `early`
       * is running a build their channel does not contain and will not
       * contain until it catches up, so "this is the newest build on your
       * channel" would be false - the channel's newest is older than what
       * they have. Saying nothing would be worse: a player who just chose
       * `stable` and then sees no updates for a fortnight concludes the
       * check is broken. */
      say("Nothing newer on your channel yet.", "good");
      say("");
      say(`You are running ${v.current}, which is ahead of ${v.channel}. You keep`, "body");
      say(`it until ${v.channel} publishes something newer, and then that arrives`, "body");
      say("like any other update.", "body");
      say("");
      say("The game will not move you back to an older build. A character is", "dim");
      say("saved by the version that made it, and older engines cannot always", "dim");
      say("read it.", "dim");
    } else {
      say("This is the newest build on your channel.", "good");
    }
    say("");
    say(`Channel: ${v.channel} - ${CHANNEL_BLURB[v.channel]}`, "dim");
    say("");
    say("A faster channel gets you newer builds sooner and tests them less.", "body");
    say("The game checks when it starts and again when you open this screen,", "body");
    say("and the title screen row shimmers when something is waiting.", "body");
    return [...out, ...modUpdateLines(v)];
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
    return [...out, ...modUpdateLines(v)];
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
    return [...out, ...modUpdateLines(v)];
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
  return [...out, ...modUpdateLines(v)];
}

/**
 * The footer, which is the only place that says what ENTER will do.
 *
 * C is offered wherever changing it is meaningful and safe - not mid-download,
 * and not in the browser, where there are no channels to choose between: the
 * page is whatever the site last deployed.
 */
export function updateFooter(v: UpdateView, cols = 80): string {
  if (v.phase === "downloading") return "[ ESC to cancel ]";
  if (v.phase === "installing") return "[ restarting... ]";

  /*
   * BUILT TO A WIDTH, because the caller SLICES this and a sliced footer is a
   * key nobody knows about. Adding "M for mod updates" pushed the swap-offer
   * footer to 90 characters, and an 80-column terminal rendered it as
   * `... - M for mod updates - ESC t` - the mods key survived and the way out
   * did not. It looked fine in every test, all of which asked whether a
   * substring was present.
   *
   * So the parts are named twice, long and short, and the short set is used
   * whenever the long one will not fit. Elision beats truncation: a shorter
   * label is still a label, and the test below holds every combination to the
   * width rather than to a substring.
   */
  const esc = v.phase === "failed" || v.phase === "uptodate" ? "ESC to go back" : "ESC to go back";
  const parts = (short: boolean): string[] => {
    const out: string[] = [];
    if (v.phase === "failed") out.push("ENTER to try again");
    else if (v.phase === "unchecked") out.push("ENTER to check again");
    else if (v.phase === "uptodate") {
      /* Nothing to install, so there is no ENTER to describe. */
    } else if (v.how === "swap") {
      out.push("ENTER to update and restart");
    } else if (v.how === "web") out.push("ENTER to reload onto the new version");
    else if (v.how === "manual") out.push("ENTER to open the releases page");

    if (v.how !== "web") out.push(short ? "C: channel" : "C to change channel");
    /* Offered only when it would do something. A key named in the footer that
     * does nothing when pressed is how a player learns to distrust the footer. */
    if ((v.modUpdates?.length ?? 0) > 0) out.push(short ? "M: mods" : "M for mod updates");
    out.push(esc);
    return out;
  };
  const render = (short: boolean): string => `[ ${parts(short).join(" - ")} ]`;
  const long = render(false);
  return long.length <= cols - 1 ? long : render(true);
}

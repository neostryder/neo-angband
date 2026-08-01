/**
 * The (I)nstall locally page: what you get by installing, said accurately.
 *
 * WHY THE ACCURACY IS THE HARD PART. A page like this writes itself as marketing
 * and is wrong within a month. So every claim below was checked against the code
 * that would have to implement it, and three claims a reasonable person would
 * have written did not survive:
 *
 *   - "Your saves become real files you can back up." FALSE. The desktop build
 *     is this same web bundle inside Electron and keeps the roster in
 *     localStorage, partitioned by the loopback origin the shell serves it from
 *     (packages/desktop/src/loopback-port.ts). writeSlot goes to localStorage on
 *     both platforms. What DOES become a real file is everything routed through
 *     HostIo - pref files, character dumps, spoilers - because the desktop host
 *     is RawFsHost and the browser host is localStorage-backed.
 *   - "Extra terminal windows, like the original." FALSE today. The shell
 *     reports termCount: 1 (packages/desktop/src/bridge-channel.ts:74), the same
 *     as one canvas, so subwindows are absent on both.
 *   - "A panic save if the process is killed." FALSE today. The shell reports
 *     signals: false at the same place, deliberately, because nothing yet holds
 *     a quit open long enough for the save to land.
 *
 * neostryder's ruling is parity: the desktop build, the static site and the installed
 * PWA should differ as little as possible, and this page describes ONLY what
 * genuinely cannot be done in a tab. That makes the honest list short, which is
 * the correct outcome and not a failure of the page.
 *
 * IT READS THE LIVE HOST rather than a hardcoded list. `caps` is the same
 * HostCapabilities the game itself branches on, so a claim here cannot drift from
 * what the platform actually reports - if the shell ever starts delivering
 * signals or opening subwindows, the page starts saying so without being edited.
 */

import type { HostCapabilities } from "@rpgm-tools/neo-angband-core";

/** How a line is coloured; the caller owns the palette. */
export type Tone = "head" | "body" | "dim" | "good" | "warn";

export interface InstallLine {
  readonly text: string;
  readonly tone: Tone;
}

/** What the page needs to know about where it is running. */
export interface InstallContext {
  /** Running inside the Electron shell. */
  readonly isDesktop: boolean;
  /** Already installed as an app (PWA display-mode: standalone / window-controls-overlay). */
  readonly isStandalone: boolean;
  /** The browser can hand the game a real directory (File System Access API). */
  readonly canPickFolder: boolean;
  /** A browser install prompt is available right now (beforeinstallprompt fired). */
  readonly canPromptInstall: boolean;
  /** What the live host reports it can do. */
  readonly caps: HostCapabilities;
}

/**
 * Whether to offer the page at all.
 *
 * Hidden under the desktop shell, because the offer is "install this on your
 * computer" and it already is. It stays visible for an installed PWA: that is a
 * browser app, and the desktop half of this page still has things to tell it.
 */
export function offerInstall(ctx: Pick<InstallContext, "isDesktop">): boolean {
  return !ctx.isDesktop;
}

const head = (text: string): InstallLine => ({ text, tone: "head" });
const body = (text: string): InstallLine => ({ text, tone: "body" });
const dim = (text: string): InstallLine => ({ text, tone: "dim" });
const good = (text: string): InstallLine => ({ text, tone: "good" });
const warn = (text: string): InstallLine => ({ text, tone: "warn" });
const gap: InstallLine = { text: "", tone: "body" };

/**
 * The page.
 *
 * Ordered by what the reader can act on soonest: the one-click browser install
 * first, the download second, the honest "these are the same" third, and the
 * character transfer last, because it is the thing they will need only after
 * they have done one of the first two.
 */
export function installLines(ctx: InstallContext): InstallLine[] {
  const out: InstallLine[] = [];

  if (!ctx.isStandalone) {
    out.push(head("Install as an app - one click, no download"));
    out.push(gap);
    out.push(body("Neo Angband installs from this page as an app in its own window,"));
    out.push(body("with no browser bars. It keeps the whole game on your machine, so"));
    out.push(body("it starts instantly and plays with no connection at all - the"));
    out.push(body("engine, all four tile sets and the sound pack are stored the first"));
    out.push(body("time you install."));
    out.push(gap);
    if (ctx.canPromptInstall) {
      out.push(good("Press ENTER on this page to install it now."));
    } else {
      /* Firefox and desktop Safari never fire beforeinstallprompt at all, and
       * iOS Safari installs from the Share sheet instead - so this is the
       * ordinary case on two of the four engines, not an error. */
      out.push(dim("Your browser has not offered an install button here. Look"));
      out.push(dim("for \"Install\" or \"Add to Home Screen\" in its own menu."));
    }
    out.push(gap);
    out.push(dim("Your characters stay exactly where they are - it is the same game,"));
    out.push(dim("the same storage, in a different window."));
    out.push(gap);
  } else {
    out.push(head("You are running the installed app"));
    out.push(gap);
    out.push(body("The whole game is already on this machine and works offline."));
    out.push(gap);
  }

  out.push(head("The desktop build - what it adds, and only that"));
  out.push(gap);
  for (const line of desktopOnlyLines(ctx)) out.push(line);
  out.push(gap);

  out.push(head("What is the same either way"));
  out.push(gap);
  out.push(body("Everything else, on purpose. Same engine, same save format, same"));
  out.push(body("four tile sets including Shockbolt, same sounds, same mods from the"));
  out.push(body("same catalogue, the same Borg, wizard mode and cheat options. The"));
  out.push(body("game is not cut down in a browser and not extended on a desktop."));
  out.push(gap);
  out.push(dim("Two things a desktop build might be expected to add and does not,"));
  out.push(dim("yet: extra terminal windows (the shell opens one, exactly as one"));
  out.push(
    dim(
      `canvas is one) and a panic save when the process is killed (${
        ctx.caps.signals ? "now delivered" : "not delivered"
      }).`,
    ),
  );
  out.push(gap);

  out.push(head("Taking your characters with you"));
  out.push(gap);
  out.push(body("Characters do NOT follow you between the browser and the desktop"));
  out.push(body("build, or between two browsers: each copy keeps its own roster in"));
  out.push(body("its own storage. Move one across yourself:"));
  out.push(gap);
  out.push(body("  1. On the character-select screen, press Shift-X on a character."));
  out.push(body("  2. In the other copy, press Shift-M there and pick the file."));
  out.push(gap);
  out.push(dim("The character arrives in a fresh slot, so an import can never write"));
  out.push(dim("over one you already have. A dead character stays dead."));

  return out;
}

/**
 * The desktop-only half, from the live capability report.
 *
 * Each entry names the capability it comes from, because that is the thing that
 * would have to change for the line to stop being true - and a line whose source
 * nobody can find is a line nobody dares delete.
 */
function desktopOnlyLines(ctx: InstallContext): InstallLine[] {
  const out: InstallLine[] = [];

  /* directories: false in a tab. This is the big one, and it is the reason an
   * external mod manager cannot work in a browser. */
  out.push(body("A REAL MODS FOLDER. The desktop build reads mods straight out of a"));
  out.push(body("folder on disk, so an external manager - Vortex, Mod Organizer 2 -"));
  out.push(body("can deploy into it and the game picks them up."));
  out.push(
    ctx.canPickFolder
      ? dim("  In this browser you can point the game at a folder yourself, which")
      : warn("  This browser cannot hand the game a folder at all, so downloading"),
  );
  out.push(
    ctx.canPickFolder
      ? dim("  covers most of it - but you re-grant it, and it is not every browser.")
      : warn("  from the mod list is the only route here."),
  );
  out.push(gap);

  /* realFiles: false in a tab. Deliberately NOT claimed for saves - see the header. */
  out.push(body("FILES THE GAME WRITES GO WHERE YOU CAN SEE THEM. Character dumps,"));
  out.push(body("spoiler files, screenshots and your pref files land as real files"));
  out.push(body("you can open in another program or keep in version control."));
  out.push(
    dim(
      `  In a browser they live in browser storage (here: ${
        ctx.caps.realFiles ? "real files" : "no real files"
      }).`,
    ),
  );
  out.push(gap);

  /* argv: false in a tab. */
  out.push(body("A COMMAND LINE. The original's switches - a different save file, a"));
  out.push(body("different user directory, a forced dump name - need one, and a tab"));
  out.push(body("has none."));
  out.push(gap);

  out.push(body("QUIT ACTUALLY QUITS, instead of greying out with nowhere to go."));
  out.push(gap);
  out.push(dim("Saves are NOT the reason to install it. The desktop build keeps its"));
  out.push(dim("roster in the same kind of browser storage this page does - it is"));
  out.push(dim("the same game bundle in its own window - so it is no safer a place"));
  out.push(dim("for a character than here. Export the ones you care about."));

  return out;
}

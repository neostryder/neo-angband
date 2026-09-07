/**
 * Which browser this is, and how a player installs the app in it.
 *
 * WHY THIS EXISTS AT ALL. `beforeinstallprompt` is a non-standard event that
 * only Chromium fires. Mozilla and Apple have both declined it deliberately,
 * taking the position that a site should not be able to initiate its own
 * installation, so there is no polyfill and no flag to turn on: in Safari and
 * Firefox the page is never told that installing is possible. The app is
 * installable in every browser that has installation at all - the manifest and
 * the service worker are standard and complete - so the gap is not capability,
 * it is that the game cannot offer the button and has to say where the browser
 * keeps its own.
 *
 * WHY THIS SNIFFS THE USER AGENT, WHICH IS NORMALLY THE WRONG ANSWER. Feature
 * detection is right whenever the question is "can this browser do X", and it
 * is available for every other branch in this package. It cannot answer this
 * one. The question here is "what is this vendor's menu called and where is
 * it", which is a fact about a UI, not about the platform, and nothing is
 * exposed to query. The honest options were a wrong-but-testable string sniff
 * or a message that names no menu, and naming no menu is what players already
 * had.
 *
 * So it is treated as a hint throughout. An engine that does not match falls
 * back to `"unknown"` and gets the old generic wording rather than a guess, and
 * every branch is written so that being wrong costs a reader one confusing
 * sentence rather than a dead end.
 *
 * WHAT DECIDES A BRANCH, in the order the checks have to run:
 *
 *   - iOS and iPadOS are a platform rule, not a browser one. Only Safari can
 *     add to the Home Screen there. Every other browser on iOS is WebKit in a
 *     different wrapper with no install path of its own, so Chrome and Firefox
 *     on an iPhone need "open this in Safari first", not their own desktop
 *     instructions. Getting this wrong sends a reader hunting for a menu item
 *     their browser does not have.
 *   - iPadOS reports itself as a Macintosh in desktop mode, and has since
 *     iPadOS 13. A touch count separates the two, because no Mac reports more
 *     than one.
 *   - Firefox must be checked before Safari and Chromium, because its own
 *     string on iOS (`FxiOS`) carries neither `Firefox` nor a clue that it is
 *     not Safari.
 *   - Safari must be checked after Chromium, because every Chromium build puts
 *     `Safari/` in its string for historical reasons and always has.
 */

/** What the detector reads. Passed in rather than read from `navigator`, so a test needs no browser. */
export interface InstallEnvironment {
  readonly userAgent: string;
  /** `navigator.maxTouchPoints`. Separates an iPad in desktop mode from a Mac. */
  readonly maxTouchPoints: number;
}

/**
 * The install path a player has, named by what they have to do rather than by
 * the browser, because two different browsers can share one answer.
 */
export type InstallTarget =
  /** Chromium on a desktop: an install icon lives in the address bar. */
  | "chromium-desktop"
  /** Chromium on Android: install sits in the browser's own menu. */
  | "chromium-android"
  /** Safari on iOS or iPadOS: the Share sheet. */
  | "safari-ios"
  /** Safari on macOS: the File menu. */
  | "safari-macos"
  /** A non-Safari browser on iOS or iPadOS: no install path of its own. */
  | "ios-non-safari"
  /** Firefox anywhere it can install nothing, which is everywhere. */
  | "firefox"
  /** Anything unrecognised. Gets wording that names no menu. */
  | "unknown";

export function detectInstallTarget(env: InstallEnvironment): InstallTarget {
  const ua = env.userAgent;
  if (ua === "") return "unknown";

  /* iPadOS in desktop mode calls itself a Macintosh. No Mac reports more than
   * one touch point, so the count is what tells them apart. */
  const iPadInDesktopMode = /Macintosh/u.test(ua) && env.maxTouchPoints > 1;
  const isIos = /iPhone|iPad|iPod/u.test(ua) || iPadInDesktopMode;

  const isFirefox = /Firefox\/|FxiOS\//u.test(ua);
  const isChromium = /Chrome\/|Chromium\/|CriOS\/|Edg(?:e|A|iOS)?\//u.test(ua);

  if (isIos) {
    /* The platform decides, not the wrapper. Safari is the only browser on iOS
     * that can add to the Home Screen; the rest are WebKit with no install of
     * their own, whatever their menus imply. */
    return isFirefox || isChromium ? "ios-non-safari" : "safari-ios";
  }

  if (isFirefox) return "firefox";

  if (isChromium) return /Android/u.test(ua) ? "chromium-android" : "chromium-desktop";

  /* Every Chromium string also contains `Safari/`, so this is only reachable
   * once Chromium has been ruled out above. */
  if (/Safari\//u.test(ua) && /Macintosh/u.test(ua)) return "safari-macos";

  return "unknown";
}

/**
 * What to tell a player whose browser will not offer the game an install button.
 *
 * Each entry is one or two short lines, because both screens that use this are
 * fixed-width terminals with a line budget, and because an instruction longer
 * than that is one a reader stops following. Callers own the tone and the
 * wrapping; this owns only the words.
 */
export function installInstructions(target: InstallTarget): readonly string[] {
  switch (target) {
    case "chromium-desktop":
      return ["Use the install icon at the right of the address bar."];
    case "chromium-android":
      return ["Open the browser menu and choose \"Install app\"."];
    case "safari-ios":
      return ["Tap Share, then \"Add to Home Screen\"."];
    case "safari-macos":
      return ["Open the File menu and choose \"Add to Dock\"."];
    case "ios-non-safari":
      /* Not a menu they can find, because there is not one. On iOS only Safari
       * installs to the Home Screen, so the instruction is to change browser. */
      return [
        "On iPhone and iPad only Safari can install a web app.",
        "Open this page in Safari, then Share, \"Add to Home Screen\".",
      ];
    case "firefox":
      /* Firefox installs nothing, on any platform. Mozilla removed desktop
       * site-specific browsers and has declined the install prompt, and Firefox
       * for Android has no install of its own either. Sending a reader to hunt
       * for an item that does not exist wastes their time and reads as the game
       * being broken, so this says so plainly and points at the thing that does
       * work for them.
       *
       * No "below": one of the two screens using this puts the desktop option
       * above and the other puts it under, so a direction here is wrong on one
       * of them. */
      return [
        "Firefox cannot install web apps, on desktop or on Android.",
        "The desktop app is the way to keep Neo Angband on this machine.",
      ];
    case "unknown":
      return ["Look for \"Install\" or \"Add to Home Screen\" in its own menu."];
  }
}

/**
 * How the instructions above should be introduced, which is not the same
 * question as which browser this is.
 *
 * A first pass gave every non-Firefox target the same lead-in, "this browser
 * installs from its own menu". Two of them are not that. Chrome on an iPhone
 * does not install from any menu of its own and has to hand off to Safari, so
 * the sentence contradicted the step printed directly under it; and an
 * unrecognised engine is not known to have an install at all, so promising one
 * states something the detector explicitly declined to decide. The lead-in is
 * therefore its own decision.
 */
export type InstallRoute =
  /** The browser installs it; the game just cannot press the button. */
  | "own-menu"
  /** This browser cannot, but another one on the same device can. */
  | "another-browser"
  /** Nothing on this platform installs it. */
  | "none"
  /** Not known. Say where to look without claiming there is something there. */
  | "unrecognised";

export function installRoute(target: InstallTarget): InstallRoute {
  switch (target) {
    case "chromium-desktop":
    case "chromium-android":
    case "safari-ios":
    case "safari-macos":
      return "own-menu";
    case "ios-non-safari":
      return "another-browser";
    case "firefox":
      return "none";
    case "unknown":
      return "unrecognised";
  }
}

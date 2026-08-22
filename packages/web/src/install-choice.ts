/**
 * The choice in front of "(I)nstall locally": the desktop app, or installing
 * this page itself as a PWA. Split out from install-local.ts on purpose - that
 * module is the DETAIL a PWA pick lands on afterwards (see showInstallPage in
 * main.ts), and answers a different question. This one picks a PLATFORM; that
 * one describes what you can do once you are on it.
 *
 * EVERY CLAIM HERE IS CHECKED THE SAME WAY install-local.ts's ARE: against the
 * code or workflow that would have to make it true, not written as marketing.
 *
 *   - The desktop platform list, and "not code-signed yet" needing a one-time OS
 *     bypass, come straight from .github/workflows/release.yml's build matrix
 *     (windows-latest / macos-latest / ubuntu-latest) and its own release-notes
 *     generator, which writes out the SmartScreen / Gatekeeper steps because
 *     there is no Apple or Windows signing identity behind this project.
 *   - "Checks for updates itself and can track a channel" is update.ts's
 *     UPDATE_CHANNELS (stable/beta/early) and the (U)pdate screen's channel row,
 *     which main.ts only offers when `view.how !== "web"`.
 *   - "Tracks whatever this site is currently serving, with no channel to pick"
 *     is that same guard read the other way: the browser build has no channels,
 *     it runs whatever was last deployed (main.ts's own comment on the point).
 *   - "Works offline" and "updates itself the next time you open it" are
 *     pwa.ts's service worker (vite-plugin-pwa, registerType "autoUpdate") and
 *     its freshness watch - the offline cache and the auto-update are the same
 *     mechanism, not two separate promises.
 *   - "A real mods folder" versus "no folder to hand an external manager" is
 *     install-local.ts's own `directories` capability, read live rather than
 *     assumed here too.
 *
 * Saves are deliberately NOT a point of comparison: both platforms keep the
 * roster in the same kind of local storage (install-local.ts's file header
 * explains why), so the choice here turns on nothing about save safety.
 */

/** Which path the player picked. */
export type InstallPath = "desktop" | "pwa";

/** How a line is coloured; the caller owns the palette. */
export type ChoiceTone = "head" | "body" | "dim";

export interface ChoiceLine {
  readonly text: string;
  readonly tone: ChoiceTone;
}

/** What the page needs to know to describe the PWA path honestly. */
export interface ChoiceContext {
  /** A browser install prompt is available right now (beforeinstallprompt fired). */
  readonly canPromptInstall: boolean;
}

const head = (text: string): ChoiceLine => ({ text, tone: "head" });
const body = (text: string): ChoiceLine => ({ text, tone: "body" });
const dim = (text: string): ChoiceLine => ({ text, tone: "dim" });
const gap: ChoiceLine = { text: "", tone: "body" };

/**
 * The page. Two headed blocks, one per key the footer offers (D, W), each
 * ending in the one line that actually depends on where the player is running
 * this from - everything else is true regardless of browser.
 */
export function installChoiceLines(ctx: ChoiceContext): ChoiceLine[] {
  const out: ChoiceLine[] = [];

  out.push(body("Two ways to keep Neo Angband on this machine. Both are the"));
  out.push(body("same game and the same save format; neither is a demo of"));
  out.push(body("the other, and your characters are unaffected either way."));
  out.push(gap);

  out.push(head("(D) The desktop app"));
  out.push(gap);
  out.push(body("A native build for Windows, macOS (Apple Silicon or Intel)"));
  out.push(body("and Linux. It checks for updates itself and can track a"));
  out.push(body("stable, beta or early channel. A real mods folder on disk"));
  out.push(body("means an external manager - Vortex, Mod Organizer 2 - can"));
  out.push(body("deploy straight into it."));
  out.push(gap);
  out.push(dim("Not code-signed yet, so the first launch needs a one-time"));
  out.push(dim("OK past Windows SmartScreen or macOS Gatekeeper."));
  out.push(gap);

  out.push(head("(W) Install this page as an app"));
  out.push(gap);
  out.push(body("Adds Neo Angband to this device straight from the browser,"));
  out.push(body("in its own window with no address bar - no separate download"));
  out.push(body("to run. The engine, tile sets and sounds are cached the"));
  out.push(body("first time you play, so it works offline after that and"));
  out.push(body("updates itself the next time you open it - whatever this"));
  out.push(body("site is currently serving, with no channel to pick."));
  out.push(gap);
  if (ctx.canPromptInstall) {
    out.push(dim("This browser can install it in one press."));
  } else {
    out.push(dim("This browser has no one-press install here; look for"));
    out.push(dim("\"Install\" or \"Add to Home Screen\" in its own menu."));
  }

  return out;
}

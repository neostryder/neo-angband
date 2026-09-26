/**
 * The host's side of the screenText mod seam (core mod/hooks.ts): where screen
 * text outside the message line meets the session's composed hooks.
 *
 * WHY A SOURCE AND NOT A VALUE. The screens and prompts that draw this text
 * (overlay.ts, and every screen shown through it) are imported by tests that
 * boot no game, and they hold no GameState. So the shell installs a function
 * that reads the live hook on each call. A mod toggled on or off mid-session
 * rebuilds `GameState.modHooks`, and the next screen or prompt picks the change
 * up with nothing else to rewire.
 *
 * WHERE IT IS APPLIED. Once per piece of text, at the moment a screen is shown
 * (`showTextScreen`, through `restateView`) or a row-0 prompt is drawn (the
 * prompt functions in overlay.ts). Never per frame and never per glyph. With no
 * mod contributing the hook, the source answers undefined and every caller
 * keeps the text it was given without copying anything.
 */

import type { ScreenTextSite } from "@rpgm-tools/neo-angband-core";
import { restateView, type ScreenTextRestate, type ScreenView } from "./screen-view";

/** The site every row-0 prompt reports. */
export const PROMPT_SITE: ScreenTextSite = Object.freeze({ screen: "core:prompt", part: "prompt" });

let source: () => ScreenTextRestate | undefined = () => undefined;

/**
 * Install where the live screenText hook comes from. The shell passes
 * `() => state.modHooks?.screenText`; tests pass whatever they are checking.
 * `null` puts back the default, which has no hook.
 */
export function setScreenTextSource(next: (() => ScreenTextRestate | undefined) | null): void {
  source = next ?? ((): undefined => undefined);
}

/** The text a row-0 prompt draws, restated by the live hook when there is one. */
export function restatePrompt(raw: string): string {
  const hook = source();
  return hook === undefined ? raw : hook(raw, PROMPT_SITE);
}

/** A whole screen, restated by the live hook when there is one; the same view otherwise. */
export function restateScreen(view: ScreenView): ScreenView {
  const hook = source();
  return hook === undefined ? view : restateView(view, hook);
}

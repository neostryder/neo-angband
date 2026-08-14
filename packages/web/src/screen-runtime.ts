/**
 * Who shows the game's full screens.
 *
 * The fourth of the gap-21 owner runtimes, after `frontend-runtime.ts` (the map),
 * `hud-runtime.ts` (the vitals, the messages, the status line) and
 * `menu-runtime.ts` (the questions). Same rules as the menus, for the same
 * reasons: ONE grant - `ui:screen.replace` - because a capability string per
 * screen would be a consent list nobody could read; a presenter is offered every
 * screen and DECLINES the ones it has no better way to show; core is not a
 * candidate, because core's way of showing a screen is `showTextScreen`'s own body
 * and every decline falls into it.
 *
 * WHAT IS DIFFERENT FROM THE MENUS, and it is only one thing: a screen has no
 * answer. A menu resolves with a choice, so `ask` can decline by resolving with
 * `undefined`; here the resolution means "the player dismissed it" and there is no
 * value left to decline with. So `show` declines by returning `undefined`
 * SYNCHRONOUSLY and takes the screen by returning a handle. Deciding never needs
 * to be async - a presenter matches on `view.id` - and drawing obviously does.
 *
 * A FAULT COSTS THE SEAM, not one screen, exactly as it does for menus and
 * unlike the HUD. The failure mode is a presenter that throws on everything, and a
 * fault report every time the player opens anything is worse than one report and
 * out.
 *
 * MODULE-LEVEL, like `menu-runtime.ts`: `showTextScreen` is called from ~85 sites
 * and threading an installed object through all of them buys nothing, because a
 * mod being disabled takes effect on reload anyway (recorded ruling, 2026-08-11).
 */

import { CapabilitySet, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";
import type { ScreenHost, ScreenPresenter, ScreenShown, ScreenView } from "./screen-view";

/** What a mod must hold in its manifest before it may show the game's screens. */
export const SCREEN_CAPABILITY = "ui:screen.replace";

export interface ScreenPlugin {
  readonly id: string;
  /** Read for `capabilities` only; the loader has already validated it. */
  readonly manifest: PackManifest;
  readonly plugin: Pick<ModPlugin, "screen">;
}

/** Who holds the screens, and what shows them. Null means the game does. */
export interface InstalledScreen {
  readonly id: string;
  readonly presenter: ScreenPresenter;
}

type ReportFault = (id: string, message: string, error: unknown) => void;

/**
 * Whether this candidate may show screens at all: it declares `screen()` AND its
 * manifest grants `ui:screen.replace`.
 *
 * Declaring the hook without the capability is reported once with the fix in the
 * sentence, the same treatment `menuClaimed` and `hudRegionsClaimed` give - a mod
 * whose interface silently does nothing is the worst outcome for everyone
 * including the player.
 */
export function screenClaimed(candidate: ScreenPlugin, reportFault: ReportFault = () => {}): boolean {
  if (candidate.plugin.screen === undefined) return false;
  let capabilities: CapabilitySet;
  try {
    capabilities = CapabilitySet.fromManifest(candidate.manifest);
  } catch (error) {
    reportFault(candidate.id, "its capabilities could not be read, so it cannot show screens", error);
    return false;
  }
  if (!capabilities.has(SCREEN_CAPABILITY)) {
    reportFault(
      candidate.id,
      `declares screen() without the "${SCREEN_CAPABILITY}" capability, so the game goes on showing its own; ` +
        `add "${SCREEN_CAPABILITY}" to its manifest capabilities`,
      undefined,
    );
    return false;
  }
  return true;
}

/** Every candidate competing for the screens, for the contested-claim report. */
export function screenClaimants(candidates: readonly ScreenPlugin[]): readonly string[] {
  return candidates.filter((c) => screenClaimed(c)).map((c) => c.id);
}

/**
 * Select and construct the one screen presenter, or null for "the game shows its
 * own".
 *
 * Claims are read for EVERY candidate rather than stopping at the winner, so a mod
 * that declared `screen()` and forgot the capability hears about it even when a
 * later mod would have outranked it anyway.
 */
export function installScreen(
  candidates: readonly ScreenPlugin[],
  contextFor: (id: string) => ModPluginContext,
  reportFault: ReportFault,
): InstalledScreen | null {
  const eligible = candidates.filter((candidate) => screenClaimed(candidate, reportFault));
  const winner = eligible[eligible.length - 1];
  if (!winner) return null;
  let returned: ScreenPresenter | undefined;
  try {
    returned = winner.plugin.screen!.call(winner.plugin, contextFor(winner.id));
  } catch (error) {
    reportFault(winner.id, "screen() failed, so the game goes on showing its own screens", error);
    return null;
  }
  if (returned === undefined) return null;
  if (typeof returned !== "object" || returned === null || typeof returned.show !== "function") {
    reportFault(winner.id, "screen() returned no usable presenter; the game goes on showing its own", returned);
    return null;
  }
  const presenter = returned;
  /* The SDK owns the public types; the live view is structurally identical and
   * this adapter keeps the runtime boundary local. */
  /* `host` is forwarded, not dropped: it is the only way a presenter reaches a
   * screen's `actions`, and an adapter that silently ate it would leave the
   * character sheet's rename and dump unreachable with no error anywhere. */
  return { id: winner.id, presenter: { show: (view, host) => presenter.show(view, host) } };
}

/* ------------------------------------------------------------------ */
/* The live holder                                                     */
/* ------------------------------------------------------------------ */

let installed: InstalledScreen | null = null;
let broken = false;

/** Install (or clear, with null) the session's screen presenter. */
export function setScreenPresenter(next: InstalledScreen | null): void {
  installed = next;
  broken = false;
}

/** The installed presenter, or null when the game is showing its own screens. */
export function currentScreenPresenter(): InstalledScreen | null {
  return broken ? null : installed;
}

/**
 * Show one view through the installed presenter.
 *
 * Resolves with a promise that completes when the player dismisses it, or `null`
 * for "the game should show this one" - which covers all three of: nobody
 * installed, the presenter declined this screen, and the presenter failed. The
 * caller cannot usefully tell those apart, and collapsing them here is what keeps
 * `showTextScreen` from growing a second policy about mods.
 *
 * A presenter that throws while the screen is OPEN is caught too, and the game
 * shows the screen itself rather than leaving the player looking at a dead
 * overlay with no way out. That is the one place this differs from a decline in
 * consequence rather than in wording: the view is shown twice, once badly.
 */
export function showThroughPresenter(
  view: ScreenView,
  reportFault: ReportFault = () => {},
  host?: ScreenHost,
): Promise<void> | null {
  const owner = currentScreenPresenter();
  if (!owner) return null;
  let shown: ScreenShown | undefined;
  try {
    shown = owner.presenter.show(view, host);
  } catch (error) {
    broken = true;
    reportFault(owner.id, `showing "${view.id}" failed; the game has resumed showing its own screens`, error);
    return null;
  }
  if (shown === undefined) return null;
  if (typeof shown !== "object" || shown === null || typeof shown.dismissed?.then !== "function") {
    broken = true;
    reportFault(
      owner.id,
      `took "${view.id}" without returning a dismissal to wait on; the game has resumed showing its own screens`,
      shown,
    );
    return null;
  }
  return shown.dismissed.then(
    () => undefined,
    (error: unknown) => {
      broken = true;
      reportFault(
        owner.id,
        `failed while "${view.id}" was open; the game has resumed showing its own screens`,
        error,
      );
      /* Rethrown as a sentinel the caller turns back into "show it myself": a
       * screen that vanished mid-read has to come back, or the player is looking
       * at nothing and pressing keys the dead overlay is no longer taking. */
      throw new ScreenAbandoned(owner.id, view.id);
    },
  );
}

/** A presenter's screen died while the player was reading it. */
export class ScreenAbandoned extends Error {
  constructor(
    readonly modId: string,
    readonly screenId: string,
  ) {
    super(`${modId} abandoned "${screenId}"`);
    this.name = "ScreenAbandoned";
  }
}

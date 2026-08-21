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
import type { PromptRequest } from "./prompt-view";
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
  /* Whatever the outgoing presenter was holding is not open any more, and a
   * record left behind would make the NEXT presenter's first prompt consult a
   * screen that no longer exists. */
  openScreens.length = 0;
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
  /*
   * RE-ENTRANCY. This presenter has already stood aside (or been stood aside)
   * for a prompt the game is running right now, and the game is asking it to
   * take ANOTHER screen while that is happening. Re-offering would ask it to
   * draw over the very terminal it just cleared - which is site 4 exactly:
   * `core:update`'s `mods` action opens `showModUpgrades`, whose own screens go
   * back through here while the same presenter is still holding `core:update`.
   *
   * The whole stack is scanned rather than just its top, because a DIFFERENT
   * presenter's nested screen sitting on top must not hide the fact that this
   * one has stood aside. And it is keyed on the presenter OBJECT, not on the mod
   * id, so a different presenter is served normally - refusing everybody would
   * take the seam away from a mod that has done nothing wrong.
   */
  if (openScreens.some((o) => o.presenter === owner.presenter && standingAside(o))) return null;
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
  /* The same `typeof x === "function"` treatment `dismissed?.then` gets, and for
   * the same reason: a member that is present and is not callable reads as "this
   * presenter can stand aside" and then takes the seam down at the worst possible
   * moment - mid-prompt, with the player waiting. Absent is fine and is the
   * ordinary shape; present-and-lying is not. */
  const stepAside = shown.yieldTerminal;
  if (stepAside !== undefined && typeof stepAside !== "function") {
    broken = true;
    reportFault(
      owner.id,
      `took "${view.id}" with a yieldTerminal that is not a function, so the game has no way to tell it ` +
        `when to stand aside for a prompt; the game has resumed showing its own screens`,
      shown,
    );
    return null;
  }
  const open: OpenScreen = {
    presenter: owner.presenter,
    modId: owner.id,
    screenId: view.id,
    shown,
    yielded: false,
    surrendered: false,
    reported: false,
  };
  openScreens.push(open);
  const close = (): void => {
    const at = openScreens.indexOf(open);
    if (at >= 0) openScreens.splice(at, 1);
  };
  return shown.dismissed.then(
    () => {
      close();
      return undefined;
    },
    (error: unknown) => {
      close();
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

/* ------------------------------------------------------------------ */
/* Standing aside for the game's own prompt                            */
/* ------------------------------------------------------------------ */

/** One screen a presenter is holding right now. */
interface OpenScreen {
  readonly presenter: ScreenPresenter;
  readonly modId: string;
  readonly screenId: string;
  readonly shown: ScreenShown;
  /** Announced, and not yet released. */
  yielded: boolean;
  /** It could not be told, so the game took the terminal anyway. Permanent. */
  surrendered: boolean;
  reported: boolean;
}

/**
 * The screens a presenter is holding, innermost last. A STACK rather than one
 * slot because a prompt can open a whole nested screen (`update:mods` does), and
 * whoever is holding THAT is who the next prompt has to be announced to.
 */
const openScreens: OpenScreen[] = [];

/** Standing aside, whether it was told to or the game gave up on telling it. */
function standingAside(open: OpenScreen): boolean {
  return open.yielded || open.surrendered;
}

/**
 * Whether the game currently holds the terminal out from under a presenter.
 *
 * TRUE IN BOTH SHAPES OF STANDING ASIDE - announced and awaited, or surrendered
 * because it could not be told - because from the terminal's point of view they
 * are the same situation: the game is drawing where the presenter's screen is.
 * Collapsing them is what makes the re-entrancy guard one condition instead of
 * two that could disagree.
 *
 * FALSE when nobody is holding a screen at all. There is nothing to yield in
 * unmodded play, and reporting "yielded" for it would make every caller test the
 * one case that never needed testing.
 */
export function terminalIsYielded(): boolean {
  const open = openScreens[openScreens.length - 1];
  return open !== undefined && standingAside(open);
}

/** The screen is the game's now, and the presenter is told once why. */
function surrender(
  open: OpenScreen,
  request: PromptRequest,
  reportFault: ReportFault,
  message: string,
  error: unknown,
): void {
  open.yielded = false;
  open.surrendered = true;
  /* ONCE. The failure mode is a presenter that cannot stand aside for ANY
   * prompt, and a fault report per keystroke of a three-line description is
   * worse than one report and out - the same rule the seam's other faults use. */
  if (open.reported) return;
  open.reported = true;
  reportFault(open.modId, message, error);
}

/**
 * Run one piece of the game's own terminal work - a prompt - with whoever is
 * holding the screen standing aside for it.
 *
 * THE ORDER IS THE FIX, so it is worth spelling out:
 *
 * 1. Nobody is holding a screen. Run the work; `held: true`. This is unmodded
 *    play and it costs exactly one branch.
 * 2. The holder has no `yieldTerminal`. Report ONCE, naming the mod and the
 *    member to add, mark the screen surrendered, run the work anyway;
 *    `held: false`. The player sees the prompt drawn over the mod's overlay,
 *    which is ugly and is enormously better than answering an invisible
 *    question - and this is the case a shortcut would get wrong, because
 *    treating a missing member as consent looks identical until you look.
 * 3. Otherwise announce, and AWAIT WHATEVER COMES BACK BEFORE DRAWING ANYTHING.
 *    A throw or a rejection is case 2.
 * 4. Run the work.
 * 5. In a `finally`, release with `null`.
 *
 * NO TIMEOUT, deliberately. A presenter animating a fade out is legitimate and
 * a deadline would cut it off mid-frame; a presenter that never resolves is
 * already the `dismissed`-that-never-settles hazard this module reports through
 * the same machinery, and it does not need a second, differently-behaved
 * answer here.
 *
 * THE RELEASE IS IN A `finally` for one specific reason: a prompt can throw -
 * `getFile` reaches the filesystem, `showModUpgrades` reaches the network - and
 * a release that only ran on the happy path would leave the player's overlay
 * hidden for the rest of the session after one exception. One `finally` against
 * a permanently invisible interface is a good trade.
 */
export async function withTerminal<T>(
  request: PromptRequest,
  work: () => T | Promise<T>,
  reportFault: ReportFault = () => {},
): Promise<{ held: boolean; value: T }> {
  const open = openScreens[openScreens.length - 1];
  /* (1) */
  if (open === undefined) return { held: true, value: await work() };
  /* Already given up on for an earlier prompt: no second report, no second try. */
  if (open.surrendered) return { held: false, value: await work() };
  /* (2) */
  const stepAside = open.shown.yieldTerminal;
  if (typeof stepAside !== "function") {
    surrender(
      open,
      request,
      reportFault,
      `is holding "${open.screenId}" and cannot stand aside for the game's own "${request.label}" prompt, ` +
        `so the game has drawn it over that screen; add yieldTerminal(request) to what show() returns - ` +
        `stand the screen aside while request is a PromptRequest, and take it back when request is null`,
      undefined,
    );
    return { held: false, value: await work() };
  }
  /* (3) Announced and AWAITED before anything is drawn. */
  open.yielded = true;
  try {
    await stepAside.call(open.shown, request);
  } catch (error) {
    surrender(
      open,
      request,
      reportFault,
      `is holding "${open.screenId}" and its yieldTerminal() failed on the game's "${request.label}" prompt, ` +
        `so the game has drawn it over that screen; yieldTerminal(request) must stand the screen aside and ` +
        `resolve, never throw`,
      error,
    );
    return { held: false, value: await work() };
  }
  /* (4) */
  try {
    return { held: true, value: await work() };
  } finally {
    /* (5) */
    open.yielded = false;
    try {
      await stepAside.call(open.shown, null);
    } catch (error) {
      /* Reported, not rethrown: the work is already done and its own result -
       * or its own exception - is what the player is owed. The screen is the
       * presenter's problem now, and it has been told about it. */
      reportFault(
        open.modId,
        `is holding "${open.screenId}" and its yieldTerminal(null) failed, so its screen may not have come ` +
          `back after the game's "${request.label}" prompt`,
        error,
      );
    }
  }
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

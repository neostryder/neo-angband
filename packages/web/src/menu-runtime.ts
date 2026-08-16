/**
 * Who asks the game's questions.
 *
 * The third of the gap-21 owner runtimes, after `frontend-runtime.ts` (the map)
 * and `hud-runtime.ts` (the vitals, the messages, the status line). Same rules:
 * one capability, last eligible candidate in load order wins, a fault hands the
 * work back to the game mid-session and says so by name.
 *
 * WHY THE UNIT OF OWNERSHIP IS "MENUS", NOT "THIS MENU". The HUD sells ownership
 * per region because its three regions are three answers to three questions and
 * a mod wanting one has no business taking the others. Menus are not like that:
 * there are ~50 of them, they come and go, and a capability string per menu id
 * would be a consent list nobody could read and a manifest nobody could write.
 * So there is ONE grant - `ui:menu.replace` - and the finer choice is made where
 * it belongs, at the question: a presenter is offered every menu and DECLINES
 * the ones it has no better way to ask. A radial dial for the six command verbs
 * genuinely has no opinion about the mod manager's thirty-row list.
 *
 * WHICH IS A REAL DIFFERENCE FROM THE HUD, and worth being plain about. There,
 * the capability IS the claim and selection finishes before any candidate is
 * called, so a loser cannot mount a canvas it will never draw into. Here the
 * selection still finishes first - exactly one presenter is constructed, and the
 * losers are never called - but WHICH QUESTIONS it answers is decided per ask.
 * The reason the HUD's rule does not apply is that declining a menu costs
 * nothing: the game asks it, the presenter drew nothing, and there is no surface
 * left half-owned.
 *
 * CORE IS NOT A CANDIDATE HERE, which is the one place this file does not mirror
 * its siblings. Core's way of asking a menu is `selectFromMenu`'s own body - a
 * function, not a presenter object - and every decline and every fault falls
 * into it. Wrapping it in a candidate that always declines would be symmetry for
 * its own sake: it could never win, because winning is what declining means.
 *
 * MODULE-LEVEL, like `menu-registry.ts` and for the same reason: `selectFromMenu`
 * is called from ~50 sites across the shell and threading an installed object
 * through all of them buys nothing, because a mod being disabled takes effect on
 * reload anyway (recorded ruling, 2026-08-11).
 */

import { CapabilitySet, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";
import type { MenuAnswer, MenuPresenter, MenuQuestion } from "./menu-view";

/** What a mod must hold in its manifest before it may ask the game's questions. */
export const MENU_CAPABILITY = "ui:menu.replace";

export interface MenuPlugin {
  readonly id: string;
  /** Read for `capabilities` only; the loader has already validated it. */
  readonly manifest: PackManifest;
  readonly plugin: Pick<ModPlugin, "menu">;
}

/** Who holds the menus, and what asks them. Null everywhere means the game does. */
export interface InstalledMenu {
  readonly id: string;
  readonly presenter: MenuPresenter;
}

type ReportFault = (id: string, message: string, error: unknown) => void;

/**
 * Whether this candidate may present menus at all: it declares `menu()` AND its
 * manifest grants `ui:menu.replace`.
 *
 * Declaring the hook without the capability is that mod's mistake, reported once
 * with the fix in the sentence - the same treatment `hudRegionsClaimed` gives,
 * because a mod whose interface silently does nothing is the worst outcome for
 * everyone including the player.
 */
export function menuClaimed(candidate: MenuPlugin, reportFault: ReportFault = () => {}): boolean {
  if (candidate.plugin.menu === undefined) return false;
  let capabilities: CapabilitySet;
  try {
    capabilities = CapabilitySet.fromManifest(candidate.manifest);
  } catch (error) {
    reportFault(candidate.id, "its capabilities could not be read, so it cannot present menus", error);
    return false;
  }
  if (!capabilities.has(MENU_CAPABILITY)) {
    reportFault(
      candidate.id,
      `declares menu() without the "${MENU_CAPABILITY}" capability, so the game goes on asking its own; ` +
        `add "${MENU_CAPABILITY}" to its manifest capabilities`,
      undefined,
    );
    return false;
  }
  return true;
}

/** Every candidate competing for the menus, for the contested-claim report. */
export function menuClaimants(candidates: readonly MenuPlugin[]): readonly string[] {
  return candidates.filter((c) => menuClaimed(c)).map((c) => c.id);
}

/**
 * Select and construct the one menu presenter, or null for "the game asks its
 * own questions".
 *
 * Claims are read for EVERY candidate rather than stopping at the winner, so a
 * mod that declared `menu()` and forgot the capability hears about it even when
 * a later mod would have outranked it anyway. Its mistake does not become
 * invisible because somebody else won.
 */
export function installMenu(
  candidates: readonly MenuPlugin[],
  contextFor: (id: string) => ModPluginContext,
  reportFault: ReportFault,
): InstalledMenu | null {
  const eligible = candidates.filter((candidate) => menuClaimed(candidate, reportFault));
  const winner = eligible[eligible.length - 1];
  if (!winner) return null;
  let returned: MenuPresenter | undefined;
  try {
    returned = winner.plugin.menu!.call(winner.plugin, contextFor(winner.id));
  } catch (error) {
    reportFault(winner.id, "menu() failed, so the game goes on asking its own questions", error);
    return null;
  }
  if (returned === undefined) return null;
  if (typeof returned !== "object" || returned === null || typeof returned.ask !== "function") {
    reportFault(winner.id, "menu() returned no usable presenter; the game goes on asking its own", returned);
    return null;
  }
  const presenter = returned;
  /* The SDK owns the public types; the live question is structurally identical
   * and this adapter keeps the runtime boundary local. */
  return { id: winner.id, presenter: { ask: (question) => presenter.ask(question) } };
}

/* ------------------------------------------------------------------ */
/* The live holder                                                     */
/* ------------------------------------------------------------------ */

let installed: InstalledMenu | null = null;
/**
 * A presenter that threw is finished for the session, on every menu and not just
 * the one it threw on.
 *
 * The HUD costs a fault ONE region, because the regions are independent and
 * losing your hit points to the mod drawing the clock would be a blast radius
 * bigger than the grant. Menus are not independent that way: the failure mode
 * here is a presenter that throws on every question, and re-entering it once per
 * menu would give the player a fault report every time they opened anything
 * while still making them use the game's own menus. One report, then it is out.
 */
let broken = false;

/** Install (or clear, with null) the session's menu presenter. */
export function setMenuPresenter(next: InstalledMenu | null): void {
  installed = next;
  broken = false;
}

/** The installed presenter, or null when the game is asking its own questions. */
export function currentMenuPresenter(): InstalledMenu | null {
  return broken ? null : installed;
}

/**
 * Ask one question through the installed presenter.
 *
 * Resolves with the presenter's answer, or `undefined` for "the game should ask
 * this one" - which covers all three of: nobody installed, the presenter
 * declined this question, and the presenter failed. The caller cannot usefully
 * tell those apart, and collapsing them here is what keeps `selectFromMenu` from
 * growing a second policy about mods.
 */
export async function askInstalledPresenter(
  question: MenuQuestion,
  reportFault: ReportFault = () => {},
): Promise<MenuAnswer | undefined> {
  const owner = currentMenuPresenter();
  if (!owner) return undefined;
  try {
    return (await owner.presenter.ask(question)) ?? undefined;
  } catch (error) {
    broken = true;
    reportFault(
      owner.id,
      `asking "${question.id}" failed; the game has resumed asking its own questions`,
      error,
    );
    return undefined;
  }
}

/**
 * Refuse an answer, and hand this menu back to the game.
 *
 * A presenter that names a choice the question does not have, or answers a
 * browse-only question with a choice, has misunderstood the question rather than
 * crashed - so it keeps the seam and loses this one menu. It is reported,
 * because the alternative is a menu that silently does nothing when the player
 * picks something.
 */
export function refuseMenuAnswer(
  id: string,
  question: MenuQuestion,
  why: string,
  reportFault: ReportFault = () => {},
): void {
  reportFault(id, `answered "${question.id}" with ${why}; the game asked it instead`, undefined);
}

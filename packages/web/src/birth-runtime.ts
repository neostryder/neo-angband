/**
 * Which mod, if any, runs character creation instead of the birth screens.
 *
 * A mod needs `ui:birth.replace` and a `birth()` hook. When several mods have
 * both, the last one in load order gets the job. Before the birth screens open,
 * that mod's presenter is shown a `ModBirthSession` (birth-session.ts) and says
 * yes by returning true from `show`. From then on the mod finishes the job with
 * the session's `accept()` or `cancel()`; the game waits, since it has no
 * character to play until one is made. Returning anything else, or having no
 * such mod, sends the player to the birth screens as usual.
 *
 * If `show` throws, the fault is reported once and the birth screens are used
 * for the rest of the session.
 */

import { CapabilitySet, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { BirthChoice } from "./birth";
import type { ModBirthSession } from "./birth-session";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";
import { pushRegion, type RegionSpec } from "./ui-stack";

/** What a mod must hold in its manifest before it may show character creation. */
export const BIRTH_CAPABILITY = "ui:birth.replace";

/** A mod's character creation wizard. */
export interface BirthPresenter {
  /** Return true to take this character creation; anything else declines it. */
  show(session: ModBirthSession): boolean | undefined;
}

export interface BirthPlugin {
  readonly id: string;
  readonly manifest: PackManifest;
  readonly plugin: Pick<ModPlugin, "birth">;
}

export interface InstalledBirth {
  readonly id: string;
  readonly presenter: BirthPresenter;
}

type ReportFault = (id: string, message: string, error: unknown) => void;

function regionSpec(modId: string): RegionSpec {
  return {
    id: `${modId}:birth`,
    layer: "modal",
    place: (grid) => ({ col: 0, row: 0, cols: grid.cols, rows: grid.rows }),
  };
}

/** Whether this candidate may show character creation: it declares `birth()` and holds the grant. */
export function birthClaimed(candidate: BirthPlugin, reportFault: ReportFault = () => {}): boolean {
  if (candidate.plugin.birth === undefined) return false;
  let capabilities: CapabilitySet;
  try {
    capabilities = CapabilitySet.fromManifest(candidate.manifest);
  } catch (error) {
    reportFault(candidate.id, "its capabilities could not be read, so it cannot show character creation", error);
    return false;
  }
  if (!capabilities.has(BIRTH_CAPABILITY)) {
    reportFault(
      candidate.id,
      `declares birth() without the "${BIRTH_CAPABILITY}" capability, so the game goes on showing its own character creation; ` +
        `add "${BIRTH_CAPABILITY}" to its manifest capabilities`,
      undefined,
    );
    return false;
  }
  return true;
}

/** Select and construct the one birth presenter, or null for "the game shows its own". */
export function installBirth(
  candidates: readonly BirthPlugin[],
  contextFor: (id: string) => ModPluginContext,
  reportFault: ReportFault,
): InstalledBirth | null {
  const eligible = candidates.filter((candidate) => birthClaimed(candidate, reportFault));
  const winner = eligible[eligible.length - 1];
  if (!winner) return null;
  let returned: BirthPresenter | undefined;
  try {
    returned = winner.plugin.birth!.call(winner.plugin, contextFor(winner.id));
  } catch (error) {
    reportFault(winner.id, "birth() failed, so the game goes on showing its own character creation", error);
    return null;
  }
  if (returned === undefined) return null;
  if (typeof returned !== "object" || returned === null || typeof returned.show !== "function") {
    reportFault(winner.id, "birth() returned no usable presenter; the game goes on showing its own character creation", returned);
    return null;
  }
  const presenter = returned;
  return { id: winner.id, presenter: { show: (session) => presenter.show(session) } };
}

let installed: InstalledBirth | null = null;
let broken = false;
let faultReporter: ReportFault = () => {};

/** Install (or clear, with null) the session's birth presenter. */
export function setBirthPresenter(next: InstalledBirth | null, reportFault?: ReportFault): void {
  installed = next;
  broken = false;
  if (reportFault) faultReporter = reportFault;
}

export function currentBirthPresenter(): InstalledBirth | null {
  return broken ? null : installed;
}

/**
 * Offer one character creation to the installed presenter. Undefined means the
 * game shows its own; otherwise the promise settles with the accepted choice, or
 * null when the presenter cancelled.
 */
export function offerBirth(
  session: ModBirthSession,
  outcome: Promise<BirthChoice | null>,
): Promise<BirthChoice | null> | undefined {
  const owner = currentBirthPresenter();
  if (!owner) return undefined;
  let taken: boolean | undefined;
  try {
    taken = owner.presenter.show(session);
  } catch (error) {
    broken = true;
    faultReporter(owner.id, "its character creation failed to open, so the game shows its own from now on", error);
    return undefined;
  }
  if (taken !== true) return undefined;
  const region = pushRegion(regionSpec(owner.id));
  return outcome.finally(() => region.release());
}

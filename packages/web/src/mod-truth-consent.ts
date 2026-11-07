/**
 * The runtime path to the real map (`mod.permissions.requestTruth`).
 *
 * A first-party in-process mod the game lets hold `state:map-actual.read` can
 * ask for it at the moment the player turns on a feature that needs it, instead
 * of declaring it in the manifest and holding it from the first turn. The game
 * draws the question itself; a yes is stored like a manager decision, so the
 * mod holds the grant from the next session on, and every character played
 * while a marking mod holds it is marked the way debug mode marks it.
 */
import { markNoscore, NOSCORE } from "@rpgm-tools/neo-angband-core";
import { TRUTH_MAP, grantRuntime, modHolds, modTier } from "./mod-tier";
import type { ModStore } from "./mod-store";

export type TruthConsentResult = "granted" | "declined" | "unavailable";

export interface TruthConsentDeps {
  readonly store: Pick<ModStore, "grantCapability">;
  /** Draw the question and answer whether the player allowed it. */
  readonly ask: (modId: string, reason: string, marksSave: boolean) => Promise<boolean>;
  /** Mark the character being played, the way debug mode does. */
  readonly markSave: () => void;
}

/** Whether the game lets this mod ask: first-party, code in the page, and the real map is one of its seams. */
export function mayAskForTruth(id: string): boolean {
  const tier = modTier(id);
  return tier.trust === "first-party" && tier.execution === "in-process" && tier.seams.includes(TRUTH_MAP);
}

export async function requestTruthConsent(id: string, reason: string, deps: TruthConsentDeps): Promise<TruthConsentResult> {
  if (!mayAskForTruth(id)) return "unavailable";
  if (modHolds(id, TRUTH_MAP)) return "granted";
  const marks = modTier(id).marksSave.includes(TRUTH_MAP);
  if (!(await deps.ask(id, reason, marks))) return "declined";
  deps.store.grantCapability(id, TRUTH_MAP);
  grantRuntime(id, TRUTH_MAP);
  if (marks) deps.markSave();
  return "granted";
}

/** Mark a player the way a held marking grant does at boot. */
export function markPlayerForTruth(player: { noscore: number }): void {
  player.noscore = markNoscore(player.noscore, NOSCORE.DEBUG);
}

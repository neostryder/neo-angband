/**
 * The runtime path to the real map (`mod.permissions.requestTruth`).
 *
 * A first-party in-process mod the game lets hold `state:map-actual.read` can
 * ask for it at the moment the player turns on a feature that needs it, instead
 * of declaring it in the manifest and holding it from the first turn. The game
 * draws the question itself; a yes is stored like a manager decision, so the
 * mod holds the grant from the next session on, and every character played
 * while the mod holds it is permanently unscorable.
 */
import { markNoscore, NOSCORE, type CapabilityUseEntry, type CapabilityUseIdentity, type GameState, type SaveManifest } from "@rpgm-tools/neo-angband-core";
import { TRUTH_MAP, TRUTH_MONSTERS, grantRuntime, modHolds, modTier } from "./mod-tier";
import { consentBinding } from "./mod-consent-binding";
import { recordCapabilityUse } from "./mod-controller-record";
import type { ModStore } from "./mod-store";

export type TruthConsentResult = "granted" | "declined" | "unavailable";

export interface TruthConsentDeps {
  readonly store: Pick<ModStore, "grantCapability">;
  /** Draw the question and answer whether the player allowed it. */
  readonly ask: (modId: string, reason: string, marksSave: boolean) => Promise<boolean>;
  /** Truth must stay unavailable if its consequence cannot be saved. */
  readonly markSave: (id: string) => boolean;
}

export type TruthCapability = typeof TRUTH_MAP | typeof TRUTH_MONSTERS;
type TruthSaveWriter = (id: string, capability: TruthCapability, state: GameState) => boolean;
let truthSaveWriter: TruthSaveWriter | undefined;

export function setTruthSaveWriter(writer: TruthSaveWriter | undefined): void {
  truthSaveWriter = writer;
}

/** A missing or failed durable writer must never release hidden information. */
export function prepareTruthRead(id: string, capability: TruthCapability, state: GameState): boolean {
  return truthSaveWriter?.(id, capability, state) === true;
}

export function recordTruthUse(manifest: SaveManifest, player: { noscore: number }, identity: CapabilityUseIdentity, capability: TruthCapability, activation: CapabilityUseEntry["activation"]): void {
  markPlayerForTruth(player);
  recordCapabilityUse(manifest, { ...identity, capability, activation, consequence: "hidden-information" });
}

/** Whether the game lets this mod ask: first-party, code in the page, and the real map is one of its seams. */
export function mayAskForTruth(id: string): boolean {
  const tier = modTier(id);
  return tier.trust === "first-party" && tier.execution === "in-process" && tier.seams.includes(TRUTH_MAP);
}

export async function requestTruthConsent(id: string, reason: string, deps: TruthConsentDeps): Promise<TruthConsentResult> {
  if (!mayAskForTruth(id)) return "unavailable";
  const binding = consentBinding(id);
  if (typeof binding !== "string") return "unavailable";
  if (modHolds(id, TRUTH_MAP)) return deps.markSave(id) ? "granted" : "unavailable";
  if (!(await deps.ask(id, reason, true))) return "declined";
  if (!mayAskForTruth(id) || binding !== consentBinding(id)) return "unavailable";
  if (!deps.markSave(id)) return "unavailable";
  if (!mayAskForTruth(id) || binding !== consentBinding(id)) return "unavailable";
  deps.store.grantCapability(id, TRUTH_MAP);
  grantRuntime(id, TRUTH_MAP);
  return "granted";
}

/** Mark a player the way a held marking grant does at boot. */
export function markPlayerForTruth(player: { noscore: number }): void {
  player.noscore = markNoscore(player.noscore, NOSCORE.DEBUG);
}

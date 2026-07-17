/**
 * Artifact-knowledge gating for the "known artifacts" browser, ported from
 * find_artifact (reference/src/ui-knowledge.c L1537-1610), object_is_known_
 * artifact (obj-knowledge.c L552-556) and artifact_is_known (ui-knowledge.c
 * L1687-1707) of Angband 4.2.6.
 *
 * The point of the gate is to never leak an artifact the player has not yet
 * identified: an artifact is only "known" once it has been created AND there is
 * no live, still-unidentified copy of it anywhere in the world. Wizard mode
 * reveals everything.
 *
 * Attribution: neostryder / RPGM Tools.
 */

import { OBJ_NOTICE } from "./knowledge";
import type { GameObject } from "./object";
import type { Artifact } from "./types";

/**
 * object_is_known_artifact for a LIVE object (obj-knowledge.c L552): upstream
 * reads obj->known->artifact, which objectKnownShadow (known-object.ts L512)
 * sets to obj->artifact only when the object is ASSESSED (touched / picked up).
 * So for a live object this is exactly "it is an artifact and it has been
 * assessed" - computed here without building a full known shadow.
 */
export function liveObjectIsKnownArtifact(obj: GameObject): boolean {
  return obj.artifact !== null && (obj.notice & OBJ_NOTICE.ASSESSED) !== 0;
}

/** The world-scan + created-flags view artifact_is_known needs. */
export interface ArtifactKnownEnv {
  /**
   * Every live object find_artifact scans (ui-knowledge.c L1537): floor piles,
   * player gear, monster-held objects, store stock and stored (cached) level
   * chunks. Order does not matter - a fixed artifact has at most one live copy.
   */
  worldObjects(): Iterable<GameObject>;
  /** is_artifact_created(art) (obj-util.c): the per-game created flag. */
  isCreated(aidx: number): boolean;
  /** player->wizard: wizard mode reveals every artifact. */
  wizard: boolean;
}

/**
 * find_artifact (ui-knowledge.c L1537-1610): the live object that is this
 * artifact, or null if no copy exists in the world right now.
 */
export function findArtifact(env: ArtifactKnownEnv, aidx: number): GameObject | null {
  for (const obj of env.worldObjects()) {
    if (obj.artifact && obj.artifact.aidx === aidx) return obj;
  }
  return null;
}

/**
 * artifact_is_known (ui-knowledge.c L1687-1707): should the browser list this
 * artifact? Requires a name; wizard mode always yes; otherwise it must be
 * created, and if a live copy exists it must already be identified as an
 * artifact (else the copy is a not-yet-found artifact and listing it would
 * leak it).
 */
export function artifactIsKnown(art: Artifact, env: ArtifactKnownEnv): boolean {
  if (!art.name) return false;
  if (env.wizard) return true;
  if (!env.isCreated(art.aidx)) return false;
  const obj = findArtifact(env, art.aidx);
  if (obj && !liveObjectIsKnownArtifact(obj)) return false;
  return true;
}

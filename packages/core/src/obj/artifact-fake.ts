/**
 * make_fake_artifact (obj-make.c L728-745): build a throwaway artifact object
 * directly from a blank object, used purely to DESCRIBE an artifact - the
 * artifact-knowledge recall (desc_art_fake, ui-knowledge.c L1610-1654) and the
 * spoiler dumps. As upstream warns, the result is in no way marked "fake", so
 * it must NEVER become a live game object.
 *
 * DETERMINISM (the reason this lives in one place): object_prep with the
 * "maximise" aspect draws no entropy, but copy_artifact_data's copy_curses step
 * ALWAYS rolls the curse timeout on the "randomise" aspect regardless of the
 * caller's aspect (obj-curse.c L67, ported faithfully in copyCurses). A
 * browsing preview must not perturb the shared game RNG stream, so this builder
 * draws from a DEDICATED throwaway Rng (a fresh Rng at a fixed seed), never the
 * game stream. The fixed seed also makes the same artifact preview identically
 * every time it is browsed.
 *
 * Attribution: neostryder / RPGM Tools.
 */

import type { Constants } from "../constants";
import { Rng } from "../rng";
import type { ObjRegistry } from "./bind";
import { copyArtifactData, objectPrep } from "./make";
import type { GameObject } from "./object";
import type { Artifact } from "./types";

/**
 * The fixed seed for the throwaway prep Rng. object_prep(maximise) consumes no
 * entropy and copy_artifact_data draws only the curse timeout, so a constant
 * seed yields a stable, game-RNG-independent preview.
 */
export const FAKE_ARTIFACT_SEED = 1;

/**
 * make_fake_artifact(obj, artifact) (obj-make.c L728): look up the base kind,
 * object_prep it with the MAXIMISE aspect, stamp on the artifact, then
 * copy_artifact_data. Returns null when the artifact has no tval or its base
 * kind is missing (upstream returns false - L733, L737).
 *
 * The build uses its own throwaway Rng (see the module note); the caller's game
 * RNG stream is never touched.
 */
export function makeFakeArtifact(
  reg: ObjRegistry,
  constants: Constants,
  art: Artifact,
  seed: number = FAKE_ARTIFACT_SEED,
): GameObject | null {
  /* Don't bother with empty artifacts (L733). */
  if (!art.tval) return null;

  /* Get the "kind" index (L736). */
  const kind = reg.lookupKind(art.tval, art.sval);
  if (!kind) return null;

  /* Create the artifact on a dedicated throwaway stream (L740-742). */
  const rng = new Rng(seed);
  const obj = objectPrep(rng, reg, constants, kind, 0, "maximise");
  obj.artifact = art;
  copyArtifactData(rng, reg, obj, art);
  obj.number = 1;
  return obj;
}

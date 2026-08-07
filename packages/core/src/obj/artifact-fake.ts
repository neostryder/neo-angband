/**
 * make_fake_artifact (obj-make.c L728-745): build a throwaway artifact object
 * directly from a blank object, used purely to DESCRIBE an artifact - the
 * artifact-knowledge recall (desc_art_fake, ui-knowledge.c L1610-1654) and the
 * spoiler dumps. As upstream warns, the result is in no way marked "fake", so
 * it must NEVER become a live game object.
 *
 * This is the ONLY implementation. Upstream has one make_fake_artifact and so
 * does the port: the spoiler dump (game/spoil.ts) and artifact_power's power
 * evaluation (obj/randart-data.ts) both call this. They used to carry their own
 * hand-written copies, which agreed until they did not - see the note on
 * randart-fake-agreement.test.ts, which now guards the singleness instead.
 *
 * WHICH RNG IS THE CALLER'S DECISION, and it is a real decision rather than a
 * detail: object_prep with the "maximise" aspect draws no entropy, but
 * copy_artifact_data's copy_curses step ALWAYS rolls the curse timeout on the
 * "randomise" aspect regardless of the caller's aspect (obj-curse.c L67, ported
 * faithfully in copyCurses). So
 *
 *   - a browsing preview must NOT perturb the shared game stream, and passes a
 *     throwaway `new Rng(FAKE_ARTIFACT_SEED)`; the fixed seed also makes the
 *     same artifact preview identically every time it is browsed;
 *   - artifact_power during randart generation MUST draw from the game stream,
 *     because upstream does and design_artifact re-powers artifacts that
 *     make_bad has just cursed. Handing it a private Rng silently forks the
 *     port's artifact sets away from Angband's.
 *
 * Hence the parameter, with no default: the two answers are opposite, and a
 * default would quietly pick the one that is wrong for the caller that matters.
 *
 * Attribution: neostryder / RPGM Tools.
 */

import type { Constants } from "../constants.js";
import type { Rng } from "../rng.js";
import type { ObjRegistry } from "./bind.js";
import { copyArtifactData, objectPrep } from "./make.js";
import type { GameObject } from "./object.js";
import type { Artifact } from "./types.js";

/**
 * The fixed seed for a PREVIEW's throwaway prep Rng. object_prep(maximise)
 * consumes no entropy and copy_artifact_data draws only the curse timeout, so a
 * constant seed yields a stable, game-RNG-independent preview.
 */
export const FAKE_ARTIFACT_SEED = 1;

/**
 * make_fake_artifact(obj, artifact) (obj-make.c L728): look up the base kind,
 * object_prep it with the MAXIMISE aspect, stamp on the artifact, then
 * copy_artifact_data. Returns null when the artifact has no tval or its base
 * kind is missing (upstream returns false - L733, L737).
 *
 * `rng` is the stream copy_curses draws its timeouts from - see the module note
 * for why the caller has to say which.
 */
export function makeFakeArtifact(
  reg: ObjRegistry,
  constants: Constants,
  art: Artifact,
  rng: Rng,
): GameObject | null {
  /* Don't bother with empty artifacts (L733). */
  if (!art.tval) return null;

  /* Get the "kind" index (L736). */
  const kind = reg.lookupKind(art.tval, art.sval);
  if (!kind) return null;

  /* object_prep + copy_artifact_data (L740-742). */
  const obj = objectPrep(rng, reg, constants, kind, 0, "maximise");
  obj.artifact = art;
  copyArtifactData(rng, reg, obj, art);
  obj.number = 1;
  return obj;
}

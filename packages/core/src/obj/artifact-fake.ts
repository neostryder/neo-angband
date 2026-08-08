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
 * WHICH RNG IS THE CALLER'S DECISION, and it stays an explicit parameter with
 * no default even though every caller now answers the same way. It matters
 * because copy_artifact_data's copy_curses step ALWAYS rolls the curse timeout
 * on the "randomise" aspect regardless of the caller's aspect (obj-curse.c L67,
 * ported faithfully in copyCurses), while object_prep(maximise) draws nothing.
 * So this function's draw count is not zero, and where those draws land is a
 * parity claim rather than a detail.
 *
 * Every caller passes the GAME stream, because upstream has no other:
 *
 *   - artifact_power during randart generation, where design_artifact re-powers
 *     artifacts make_bad has just cursed. Handing it a private Rng silently
 *     forked the port's artifact sets away from Angband's, and did (fixed
 *     2026-08-07).
 *   - desc_art_fake, the knowledge browser's artifact recall (ui-knowledge.c
 *     L1629). This used to take a throwaway Rng at a fixed seed so that
 *     browsing could not perturb a run and an artifact previewed identically
 *     every time. Both are true of that design and neither is Angband's:
 *     browsing an artifact DOES advance upstream's stream. It was an
 *     improvement, and improvements go in a mod, not in the port.
 *   - the spoiler generator, which boots its own headless game at a fixed seed
 *     and draws from that game's stream (game/spoil.ts).
 *
 * A default would quietly answer for a caller that had not thought about it,
 * which is how the browser acquired its private stream in the first place.
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
 * @deprecated Nothing in this port reads it. It was the seed of the knowledge
 * browser's private preview stream, which was a divergence and is gone (see the
 * module note); every caller of makeFakeArtifact now passes the game stream.
 *
 * It is still exported because it is on the `ctx.core` surface a mod's plugin
 * code can reach, and `MOD_COMPATIBILITY.md` says a removal from that surface
 * either keeps the old name or is recorded as a knowing break. A mod could have
 * used this to reproduce a preview, and breaking it at runtime in a player's
 * browser to save one constant is a bad trade. Scheduled for deletion in the
 * release after the one that deprecates it, which is the same two-release rule
 * an ABI bump follows.
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

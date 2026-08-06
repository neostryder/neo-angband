/**
 * The two throwaway objects the KNOWLEDGE browser builds purely to describe a
 * class of item rather than an item the player owns:
 *
 * - make_fake_kind: the object half of desc_obj_fake (ui-knowledge.c L1938),
 *   an object_prep of the kind on the EXTREMIFY aspect, whose object_info
 *   (OINFO_FAKE) run stream is the "known objects" recall body.
 * - object_info_ego (obj-info.c L2402), which builds a bare object of the
 *   ego's first possible kind, applies the ego, and dumps
 *   object_info_out(OINFO_NONE | OINFO_EGO) - the "ego items" recall body.
 *
 * They live beside artifact-fake.ts rather than in object-info.ts because they
 * need the registry and the generation layer (objectPrep, egoApplyMagic), and
 * object-info.ts is a pure describer that must not depend on either. Upstream
 * has no such constraint - C has one translation unit per file and no import
 * graph to keep acyclic.
 *
 * DETERMINISM, as for makeFakeArtifact: browsing must not perturb the game RNG
 * stream. object_prep(EXTREMIFY) draws no entropy (randcalc takes the
 * min/max branch, z-rand.c L504), but copy_curses always rolls the curse
 * timeout on RANDOMISE and ego_apply_magic rolls to_h / to_d / to_a and every
 * modifier the same way. Both builders therefore draw from a DEDICATED
 * throwaway Rng at a fixed seed, so a preview is stable across browses and
 * invisible to the game.
 *
 * As with make_fake_artifact, nothing marks the result "fake": these objects
 * must never enter the world.
 *
 * Attribution: neostryder / RPGM Tools.
 */

import type { Constants } from "../constants.js";
import { Rng } from "../rng.js";
import type { ObjRegistry } from "./bind.js";
import { egoApplyMagic, objectPrep } from "./make.js";
import { blankObjKnowledge } from "../player/player.js";
import type { Player } from "../player/player.js";
import { OBJ_NOTICE, playerLearnAllRunes } from "./knowledge.js";
import type { GameObject } from "./object.js";
import { objectNew } from "./object.js";
import {
  OINFO,
  objectInfo,
  tbAppend,
  tbNew,
  type ObjectInfoDeps,
  type Textblock,
} from "./object-info.js";
import type { EgoItem, ObjectKind } from "./types.js";

/**
 * The fixed seed for the throwaway prep Rng, shared with makeFakeArtifact's
 * rationale: a constant seed makes the same kind or ego preview identically
 * every time it is browsed, and never touches the game stream.
 */
export const FAKE_OBJECT_SEED = 1;

/**
 * The object half of desc_obj_fake (ui-knowledge.c L1946):
 * `object_prep(obj, kind, 0, EXTREMIFY)`. EXTREMIFY takes whichever of the
 * minimum and maximum is larger in absolute value, so a browsed kind shows its
 * most extreme legal roll - which is why a Ring of Damage reads as its best
 * case and a cursed kind as its worst.
 */
export function makeFakeKind(
  reg: ObjRegistry,
  constants: Constants,
  kind: ObjectKind,
  seed: number = FAKE_OBJECT_SEED,
): GameObject {
  const rng = new Rng(seed);
  return objectPrep(rng, reg, constants, kind, 0, "extremify");
}

/**
 * object_info_ego (obj-info.c L2402): describe an EGO TYPE. Upstream walks
 * k_info looking for the head of the ego's poss_items list, builds a bare
 * object (NOT an object_prep - the base kind contributes only tval / sval, so
 * every flag on the result came from the ego), applies the ego's magic, and
 * runs object_info_out with OINFO_EGO, which suppresses the per-instance
 * detail (combat, effects, stat magnitudes) because "abilities can vary".
 *
 * `makeDeps` builds the ObjectInfoDeps for the object once it exists - the
 * player, projections and registry handles the describer needs. It does NOT
 * have to arrange the fully-known twin; see the note at the bottom of the body.
 *
 * Both of upstream's bug-text fallbacks are kept, including the one that is
 * effectively unreachable: C's search loop assigns `kind` every iteration and
 * only `break`s on a match, so after a fruitless walk `kind` still points at
 * the last kind examined. The "no longer contains" message therefore needs an
 * empty k_info to appear. Here the lookup is a direct index, so the message
 * fires on any dangling kidx - a strictly wider net for the same claim.
 */
export function objectInfoEgo(
  reg: ObjRegistry,
  ego: EgoItem,
  makeDeps: (obj: GameObject) => ObjectInfoDeps,
  seed: number = FAKE_OBJECT_SEED,
): Textblock {
  /* `if (ego->poss_items)` (L2408): the head of the list, or nothing. */
  const kind = ego.firstPossItem >= 0 ? reg.kinds[ego.firstPossItem] : undefined;

  if (!kind || !kind.name) {
    const tb = tbNew();
    if (ego.firstPossItem >= 0) {
      tbAppend(
        tb,
        "Bug: the array of kinds of objects no longer contains the first kind that can have this ego.",
      );
    } else {
      tbAppend(tb, "This ego does not appear on any items.");
    }
    return tb;
  }

  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.ego = ego;
  egoApplyMagic(new Rng(seed), reg, obj, 0);

  /* `object_copy(&known_obj, &obj); obj.known = &known_obj` (L2437): the twin
   * is a FULL copy, so an ego recall reads identically to a fresh character
   * and to one who has learned every rune. The port has no twin - it derives a
   * knowledge shadow from the player - so the equivalent is to run this one
   * describe against a player who knows everything, and to mark the object
   * assessed. Doing it HERE rather than asking each caller to remember: a
   * caller that forgot would get a silently emptier page, not an error. */
  const deps = makeDeps(obj);
  const knowing: Player = { ...deps.player, objKnown: blankObjKnowledge() };
  playerLearnAllRunes(knowing, deps.env);
  obj.notice |= OBJ_NOTICE.ASSESSED;

  return objectInfo(obj, OINFO.NONE | OINFO.EGO, { ...deps, player: knowing });
}

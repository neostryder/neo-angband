/**
 * Game-layer glue for the character history log (player/history.ts is the
 * pure module; this supplies the two things only live GameState can give it:
 * the dlev/clev/turn stamp and the artifact fake-name builder).
 *
 * Ported from player-history.c:
 * - history_add_with_flags (L115-121): stamps every entry with p->depth,
 *   p->lev and p->total_energy/100 - matched here by state.chunk.depth,
 *   state.actor.player.lev and trunc(state.actor.totalEnergy/100). The
 *   turn stamp is deliberately total_energy/100 (what ui-history.c
 *   displays), not state.turn.
 * - get_artifact_name (L197-215), which is obj-make.c's make_fake_artifact
 *   (object_prep(kind, 0, MAXIMISE) then copy_artifact_data) followed by
 *   object_desc(ODESC_PREFIX|ODESC_BASE|ODESC_SPOIL).
 *
 * RNG SAFETY: objectPrep's "maximise" aspect draws nothing (damcalc/
 * mBonusCalc's maximise branches are pure arithmetic - see rng.ts). Unlike
 * make_fake_artifact, this builder deliberately does NOT call
 * copyArtifactData: that helper's copy_curses step always rolls the curse
 * timeout with the "randomise" aspect regardless of the caller's aspect
 * (obj-curse.c:67, ported faithfully in obj/object.ts copyCurses) - a
 * property upstream itself has. Since object_desc's PREFIX|BASE|SPOIL mode
 * never reads modifiers/combat bonuses/curses (only ODESC_COMBAT's
 * objDescCombat does, via env), only obj.kind and obj.artifact feed the
 * name text, so copying the rest is both unnecessary and would risk an RNG
 * draw for the one artifact in the game data that carries a curse
 * (artifact.txt's "curse:air swing:30"). A golden test in
 * game/history.test.ts pins the exact string this produces so any future
 * drift from make_fake_artifact's real behaviour is caught.
 */

import type { Artifact } from "../obj/types";
import type { Constants } from "../constants";
import type { ObjRegistry } from "../obj/bind";
import { ODESC, objectDesc } from "../obj/desc";
import { objectPrep } from "../obj/make";
import { knownDescOf } from "./describe";
import type { GameState } from "./context";

/** The dlev/clev/turn stamp history_add_with_flags reads off live state. */
export interface HistoryStamp {
  dlev: number;
  clev: number;
  turn: number;
}

/** history_add_with_flags's stamp (player-history.c L115-121). */
export function historyStamp(state: GameState): HistoryStamp {
  return {
    dlev: state.chunk.depth,
    clev: state.actor.player.lev,
    turn: Math.trunc(state.actor.totalEnergy / 100),
  };
}

/**
 * get_artifact_name (player-history.c L197-215): the spoiled description
 * ("the Phial of Galadriel") history_find_artifact / history_lose_artifact
 * use for their "Found "/"Missed " text. RNG-free (see module doc).
 */
export function artifactHistoryName(
  state: GameState,
  reg: ObjRegistry,
  constants: Constants,
  art: Artifact,
): string {
  const kind = reg.lookupKind(art.tval, art.sval);
  if (!kind) return art.name;
  const obj = objectPrep(state.rng, reg, constants, kind, 0, "maximise");
  obj.artifact = art;
  return objectDesc(
    obj,
    ODESC.PREFIX | ODESC.BASE | ODESC.SPOIL,
    null,
    state.runeEnv,
    knownDescOf(state),
  );
}

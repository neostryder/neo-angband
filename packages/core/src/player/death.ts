/**
 * death_knowledge (player-util.c L278-317).
 *
 * "Win or not, know inventory, home items and history upon death." Upstream
 * runs this once, from the death path, before the memorial and the score
 * table. It does three separable things:
 *
 *  1. Retires a WINNER in a good state (L288-294): back to town, cause of
 *     death rewritten to WINNING_HOW, experience and level restored to their
 *     maxima, and ten million gold. Every one of those is read straight back
 *     out by the tombstone and the score entry, so skipping it shows a winner
 *     their drained-by-a-vampire level and their real purse.
 *  2. Reveals what the character was carrying (L296-307): every rune, every
 *     flavour, and the per-object effect/activation knowledge - so the
 *     memorial lists identified gear, which is the entire point of a memorial.
 *  3. Unmasks the history (L309), the one part the port already did.
 *
 * enter_score and the closing handle_stuff stay with the shell: the score
 * store and the update flags are host-owned, and the shell already calls
 * enterScore immediately after this.
 */

import type { GameObject } from "../obj/object.js";
import type { ObjectKind } from "../obj/types.js";
import type { FlavorAwareDeps, RuneEnv } from "../obj/knowledge.js";
import { playerLearnAllRunes } from "../obj/knowledge.js";
import { historyUnmaskUnknown } from "./history.js";
import type { Player } from "./player.js";
import { WINNING_HOW } from "../score/types.js";

export interface DeathKnowledgeDeps {
  /** The rune environment player_learn_all_runes learns against. */
  runeEnv: RuneEnv;
  /** object_flavor_aware's owner, plus the deps its ignore re-check needs. */
  flavor: {
    objectFlavorAware(kind: ObjectKind, deps: FlavorAwareDeps): boolean;
  };
  flavorDeps: FlavorAwareDeps;
  /** p->gear (L297). */
  gear: Iterable<GameObject>;
  /**
   * The HOME store's stock (L303). Upstream reaches it through
   * f_info[FEAT_HOME].shopnum; the port passes it in because the store list is
   * a host-assembled part of GameState. An empty iterable is correct for a
   * character who never rented a room.
   */
  homeStock: Iterable<GameObject>;
  /**
   * p->depth = 0 for a winner (L289). The port keeps depth on the chunk rather
   * than the player, so the shell supplies the setter.
   */
  setDepth: (depth: number) => void;
}

export function deathKnowledge(p: Player, deps: DeathKnowledgeDeps): void {
  /* Retire in the town in a good state (L288-294). */
  if (p.totalWinner) {
    deps.setDepth(0);
    p.diedFrom = WINNING_HOW;
    p.exp = p.maxExp;
    p.lev = p.maxLev;
    p.au += 10000000;
  }

  playerLearnAllRunes(p, deps.runeEnv);

  /* Gear, then the home's stock (L297-307). The two per-object writes are the
   * ones no awareness rule can express (obj/object.ts knownEffect). */
  for (const objs of [deps.gear, deps.homeStock]) {
    for (const obj of objs) {
      deps.flavor.objectFlavorAware(obj.kind, deps.flavorDeps);
      obj.knownEffect = obj.effect;
      obj.knownActivation = obj.activation;
    }
  }

  historyUnmaskUnknown(p);
}

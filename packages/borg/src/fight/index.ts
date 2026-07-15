/**
 * Public API of the Borg combat / defense / escape cluster (P8.4) - a faithful
 * port of reference/src/borg/borg-fight-attack.c, borg-fight-defend.c,
 * borg-fight-perm.c, borg-caution.c, borg-escape.c, borg-attack-munchkin.c and
 * the fight-only geometry from borg-projection.c.
 *
 * The think-ladder-facing entry points (P8.6 calls these) each return an
 * AgentCommand for this decision, or null to yield to the next ladder stage:
 *   - borgAttack(ctx, boostedBravery?)   - best offensive action
 *   - borgDefend(ctx, p1)                - best defensive maneuver
 *   - borgPermaSpell(ctx)                - maintenance buffs
 *   - borgCaution(ctx)                   - "try not to die" (heal/defend/escape)
 *   - borgEscape(ctx, bQ)                - phase/teleport away
 *   - borgMunchkinMage(ctx)/borgMunchkinMelee(ctx) - stair-scum attacks
 *   - borgRecall(ctx)                    - induce Word of Recall
 *
 * The per-Borg FightState (getFightState) exposes the maneuver flags the caller
 * sets before invoking (fightingUnique, fightingSummoner, tAntisummon, ...),
 * mirroring the C file-scope globals. Damage estimators and geometry helpers are
 * exported for tests / debug HUDs.
 *
 * Names already exported at the package root by other subsystems (trait,
 * distance, BI, borgLos, borgProjectable, borgCaveFloorGrid, ...) are imported
 * internally but NOT re-exported here, to keep the flat package barrel
 * conflict-free.
 */

/* State + shared enums. */
export { getFightState, type FightState } from "./state";
export { BA, BF, BTH_PLUS_ADJ } from "./bf";

/* Fight-only projection/targeting helpers. */
export {
  borgOffsetProjectable,
  borgProjectableDark,
  borgTarget,
  borgTargetUnknownWall,
} from "./projection";

/* Attack: chooser, dispatch and damage estimators. */
export {
  borgAttack,
  borgCalculateAttackEffectiveness,
  borgThrustDamageOne,
  borgLaunchDamageOne,
  borgBestMult,
  borgLaunchBolt,
  borgLaunchArc,
} from "./attack";

/* Defense / maintenance. */
export { borgDefend } from "./defend";
export { borgPermaSpell } from "./perm";

/* Caution / heal. */
export { borgCaution, borgHeal } from "./caution";

/* Escape. */
export {
  borgEscape,
  borgRecall,
  borgSurrounded,
  borgFreedom,
  borgCautionPhase,
  borgCautionTeleport,
  borgAllowTeleport,
  borgShadowShift,
  borgDimensionDoor,
} from "./escape";

/* Munchkin (stair-scum) attacks. */
export { borgMunchkinMage, borgMunchkinMelee } from "./munchkin";

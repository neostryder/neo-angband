/**
 * convert_mana_to_hp, ported from reference/src/player-util.c (L655, Angband
 * 4.2.6). PF_COMBAT_REGEN characters trade the spell points just spent for a
 * small recovery of lost hit points on a successful cast (player-spell.c
 * L519-521 passes spell->smana << 16).
 *
 * This is entirely deterministic: the HP gain is pure fixed-point arithmetic
 * routed through player_adjust_hp_precise, which draws no RNG. sp_long is the
 * spell points in the 2^16 fixed-point form upstream uses.
 */

import type { Player } from "./player";
import { playerAdjustHpPrecise } from "../game/loop";

/** convert_mana_to_hp (player-util.c L655). No RNG. */
export function convertManaToHp(p: Player, spLong: number): void {
  if (spLong <= 0 || p.msp === 0 || p.mhp === p.chp) return;

  /* Lost HP from max, in 2^16ths. */
  let hpGain = (p.mhp - p.chp) * 65536;
  hpGain -= p.chpFrac;

  /* Spend X% of SP to recover X/2% of the lost HP (X/4% at 50% HP). sp_ratio
   * is the max-to-spent SP ratio, doubled to suit the target rate; the msp<10
   * floor keeps gains low where MP is already generous. */
  let spRatio = Math.trunc((Math.max(10, p.msp) * 131072) / spLong);

  /* Cap healing at 25% of the damage, so spending > 50% msp is inefficient. */
  if (spRatio < 4) spRatio = 4;
  hpGain = Math.trunc(hpGain / spRatio);

  playerAdjustHpPrecise(p, hpGain);
}

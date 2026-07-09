/**
 * Player damage, ported from reference/src/player-util.c (Angband 4.2.6):
 * player_apply_damage_reduction (L167) and take_hit (L197). The player analog
 * of mon_take_hit - the shared primitive that projections (project_p), melee
 * and ranged monster attacks, traps, lava, poison ticks, and the EF_DAMAGE
 * effect handler all route player damage through, so damage reduction, death,
 * the bloodlust save, and the low-hitpoint warning behave identically no matter
 * the source. It is the concrete backing for the effect interpreter's
 * EffectPlayer.takeHit / applyDamageReduction capabilities.
 *
 * As with mon/take-hit.ts, the heavy / downstream consequences are injected as
 * hooks so the damage-and-death arithmetic ships and is tested independently:
 * - onDeath (the death routine: died_from, score entry, EVENT_DEATH) fires when
 *   the blow is fatal and not cheated; the target's isDead is already set.
 * - combatRegenReward (player_adjust_mana_precise for PF_COMBAT_REGEN classes)
 *   is invoked only for non-excluded killers; the caller does the PF check and
 *   the mana maths.
 * - cheatDeath is the wizard / cheat_live "Die?" escape; absent (the default)
 *   means death is final, matching the ratified no-save-scum policy.
 * - disturb, the PR_HP redraw, and bell() are UI hooks (onDisturb, onRedrawHp,
 *   bell).
 */

import { TMD } from "../generated";
import type { Rng } from "../rng";

/** The player state take_hit reads and mutates (a narrow structural view). */
export interface TakeHitTarget {
  /** Current hit points (mutated). */
  chp: number;
  /** Maximum hit points (for the warning threshold). */
  mhp: number;
  /** Character level (bloodlust save). */
  lev: number;
  /** player->is_dead (set true on a fatal, non-cheated blow). */
  isDead: boolean;
  /** timed[TMD_MAX]: read for INVULN and BLOODLUST. */
  timed: Int16Array;
  /** player->opts.hitpoint_warn (0..9): warn when chp < mhp * warn / 10. */
  hitpointWarn: number;
}

/** state.dam_red / state.perc_dam_red, from calc_bonuses. */
export interface DamageReduction {
  /** Flat damage reduction. */
  damRed: number;
  /** Percentage damage reduction (after the flat cut). */
  percDamRed: number;
}

/**
 * player_apply_damage_reduction: apply invulnerability, then the flat and
 * percentage reductions. Not called by take_hit; the caller applies it first so
 * it can show the post-reduction amount.
 */
export function playerApplyDamageReduction(
  target: TakeHitTarget,
  red: DamageReduction,
  dam: number,
): number {
  /* Mega-Hack -- apply "invulnerability". */
  if (target.timed[TMD.INVULN] && dam < 9000) return 0;

  dam -= red.damRed;
  if (dam > 0 && red.percDamRed) {
    dam -= Math.trunc((dam * red.percDamRed) / 100);
  }

  return dam < 0 ? 0 : dam;
}

/** The consequences of a hit the caller supplies. */
export interface TakeHitHooks {
  /** RNG for the bloodlust flavour roll; required only when bloodlust saves. */
  rng?: Rng;
  /** msg() / msgt(): status and death messages. */
  onMessage?: (text: string, msgt?: string) => void;
  /** disturb(p). */
  onDisturb?: () => void;
  /** PR_HP redraw. */
  onRedrawHp?: () => void;
  /** bell() on the first low-hitpoint notice. */
  bell?: () => void;
  /**
   * The death routine (score, died_from, EVENT_DEATH). Called after isDead is
   * set on a fatal, non-cheated blow.
   */
  onDeath?: (target: TakeHitTarget, killer: string) => void;
  /**
   * PF_COMBAT_REGEN mana reward. Invoked with the raw damage only for killers
   * that grant it (not poison / a fatal wound / starvation); the caller checks
   * the player flag and performs player_adjust_mana_precise.
   */
  combatRegenReward?: (dam: number) => void;
  /**
   * Wizard / cheat_live escape: return true to survive a fatal blow. Absent
   * means death is final (the no-save-scum default).
   */
  cheatDeath?: () => boolean;
}

/** Killers excluded from the COMBAT_REGEN mana reward. */
const COMBAT_REGEN_EXCLUDED = new Set(["poison", "a fatal wound", "starvation"]);

/**
 * take_hit: reduce the player's hit points by `dam` and set the death flag if
 * the blow is fatal. `dam` should already have passed through
 * playerApplyDamageReduction. `killer` describes the cause of death.
 */
export function takeHit(
  target: TakeHitTarget,
  dam: number,
  killer: string,
  hooks: TakeHitHooks = {},
): void {
  const oldChp = target.chp;
  const warning = Math.trunc((target.mhp * target.hitpointWarn) / 10);

  /* Paranoia */
  if (target.isDead || dam <= 0) return;

  /* Disturb */
  hooks.onDisturb?.();

  /* Hurt the player */
  target.chp -= dam;

  /* Reward COMBAT_REGEN characters with mana for their lost hitpoints. */
  if (!COMBAT_REGEN_EXCLUDED.has(killer)) {
    hooks.combatRegenReward?.(dam);
  }

  /* Display the hitpoints */
  hooks.onRedrawHp?.();

  /* Dead player */
  if (target.chp < 0) {
    /* From hell's heart I stab at thee -- bloodlust can save the player. */
    if (
      target.timed[TMD.BLOODLUST] &&
      target.chp + target.timed[TMD.BLOODLUST]! + target.lev >= 0
    ) {
      if (!hooks.rng || hooks.rng.randint0(10)) {
        hooks.onMessage?.("Your lust for blood keeps you alive!");
      } else {
        hooks.onMessage?.(
          "So great was his prowess and skill in warfare, the Elves said: ",
        );
        hooks.onMessage?.("'The Mormegil cannot be slain, save by mischance.'");
      }
    } else if (hooks.cheatDeath?.()) {
      /* Wizard / cheat death: survive (no is_dead). */
    } else {
      /* Note death */
      hooks.onMessage?.("You die.", "DEATH");
      target.isDead = true;
      hooks.onDeath?.(target, killer);
      return;
    }
  }

  /* Hitpoint warning */
  if (target.chp < warning) {
    /* Bell on first notice */
    if (oldChp > warning) hooks.bell?.();

    hooks.onMessage?.("*** LOW HITPOINT WARNING! ***", "HITPOINT_WARN");
  }
}

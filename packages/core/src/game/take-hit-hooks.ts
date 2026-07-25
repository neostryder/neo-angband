/**
 * makeTakeHitHooks: the single, complete TakeHitHooks the live game binds to
 * EVERY player take_hit site - projections (project_p), monster melee, the
 * effect interpreter (traps, EF_DAMAGE, activations, monster casts) and the
 * world clock's damage-over-time / terrain / over-exertion. Before this, the
 * projection and effect paths passed no hooks (or only onMessage + onDisturb),
 * so death by a breath, spell, trap or poison tick was SILENT - no damage line,
 * no "*** LOW HITPOINT WARNING! ***" + bell, no "You die." - and p->died_from /
 * p->total_winner were never recorded, so every death was scored as an unknown
 * killer (audit 01 P1 CRITICAL).
 *
 * These are exactly the consequences take_hit itself performs inline in
 * reference/src/player-util.c (Angband 4.2.6):
 * - disturb(p)                                   (L207)  -> onDisturb
 * - p->upkeep->redraw |= PR_HP                   (L225)  -> see onRedrawHp note
 * - the bloodlust death-save randint0(10) roll   (L232)  -> rng
 * - bell() on the first low-hitpoint notice      (L270)  -> bell
 * - the msgt() status / death lines              (L233..L273) -> onMessage
 * - my_strcpy(p->died_from, kb_str, ...)         (L244)  -> onDeath
 * - p->total_winner = false                      (L255)  -> onDeath
 *
 * The score entry and death_knowledge (player-util.c L281 enter_score) are
 * deliberately NOT done here: upstream defers them to close_game, and the port
 * mirrors that in the shell's LOOP_STATUS.DEAD handler (web/src/main.ts), which
 * reads the died_from this hook records and calls enterScore once. Recording
 * died_from here without entering the score keeps that single close-game path.
 *
 * onRedrawHp has no faithful analogue in the port's batch-render model: the HP
 * sidebar repaints once per turn after runGameLoop returns, so a mid-turn PR_HP
 * is a visual no-op. It is deliberately omitted (matching the melee reference).
 */

import { MSG, PF } from "../generated";
import type { TakeHitHooks } from "../player/take-hit";
import type { GameState } from "./context";
import { disturb } from "./player-path";
import { playerAdjustManaPrecise } from "./loop";
import {
  markNoscore,
  wizCheatDeath,
  type WizardDeps,
} from "./wizard";

/**
 * Optional deps for the EVENT_CHEAT_DEATH path (ui-display.c:2568-2573).
 * The effect bundle is assigned after makeTakeHitHooks when wireGame finishes
 * building the wizard effect stack; the hook closes over a mutable holder.
 */
export interface TakeHitHookOpts {
  /**
   * Mutable holder for WizardDeps.effect (assembled later in wireGame). The
   * cheat-death hook reads `.current` at death time so it sees the live
   * bundle even though makeTakeHitHooks runs before the effect stack exists.
   */
  wizardEffect?: { current: WizardDeps["effect"] | undefined };
}

/** Build the shared, complete player take_hit consequences for `state`. */
export function makeTakeHitHooks(
  state: GameState,
  opts: TakeHitHookOpts = {},
): TakeHitHooks {
  const recordDeath = (killer: string): void => {
    const p = state.actor.player;
    /* my_strcpy(p->died_from, kb_str, ...) (L244) and total_winner = false
     * (L255). The shell's death handler reads diedFrom for the score/tombstone
     * and clears the active slot. */
    p.diedFrom = killer;
    p.totalWinner = false;
  };

  const cheatDeath = (killer: string): boolean | "pending" => {
    const wizard = state.wizard === true;
    const cheatLive = state.options?.get("cheat_live") === true;
    if (!wizard && !cheatLive) return false;

    const p = state.actor.player;
    /* C assigns died_from before get_check("Die? ") even when the answer is
     * No and EVENT_CHEAT_DEATH follows. */
    p.diedFrom = killer;
    state.pendingDeath = {
      killer,
      resolve: (die: boolean): void => {
        state.pendingDeath = undefined;
        if (die) {
          state.msg?.("You die.", "DEATH");
          state.sound?.(MSG.DEATH);
          state.isDead = true;
          recordDeath(killer);
          return;
        }
        state.msg?.("You invoke wizard mode and cheat death.");
        const effect = opts.wizardEffect?.current;
        wizCheatDeath(state, {
          wizard: true,
          ...(effect ? { effect } : {}),
          markNoscore: (bits: number): void => {
            p.noscore = markNoscore(p.noscore, bits);
          },
          msg: (t) => state.msg?.(t),
        });
      },
    };
    return "pending";
  };

  return {
    /* The bloodlust death-save flavour roll (player-util.c L232). */
    rng: state.rng,
    onMessage: (text: string, msgt?: string): void => {
      state.msg?.(text, msgt);
      /* msgt() also plays the message-type sound (death, low-hp warning). Sound
       * is a pure UI sink - it draws no RNG - so this restores the audible cue
       * without perturbing the deterministic stream. */
      if (msgt !== undefined) {
        const code = (MSG as Record<string, number>)[msgt];
        if (code !== undefined) state.sound?.(code);
      }
    },
    onDisturb: (): void => disturb(state),
    /* bell() on the first low-hitpoint notice (player-util.c L270). */
    bell: (): void => state.sound?.(MSG.BELL),
    onDeath: (_target, killer): void => recordDeath(killer),
    /*
     * Wizard / cheat_live escape (player-util.c:246-248 + ui-display.c:2568):
     * when player->wizard or OPT(cheat_live), the C asks get_check("Die? ")
     * and on "no" signals EVENT_CHEAT_DEATH -> wiz_cheat_death(). No RNG.
     * The shell owns the asynchronous prompt through state.pendingDeath.
     */
    cheatDeath,
    /* PF_COMBAT_REGEN mana reward (player-util.c L216-222, audit 01 C1): a
     * Blackguard turns lost hitpoints into rage-mana. take_hit already excludes
     * poison / fatal wound / starvation before calling this, so only the flag
     * gate and the formula remain. sp_gain = (MAX(msp,10)*65536)/mhp*dam,
     * left-associative integer arithmetic, through player_adjust_mana_precise
     * (no RNG). Absent p->mhp is never 0 in play. */
    combatRegenReward: (dam: number): void => {
      const p = state.actor.player;
      const hasFlag =
        state.playerState?.pflags.has(PF.COMBAT_REGEN) ??
        (p.race.pflags.has(PF.COMBAT_REGEN) || p.cls.pflags.has(PF.COMBAT_REGEN));
      if (!hasFlag || p.mhp <= 0) return;
      const spGain = Math.trunc((Math.max(p.msp, 10) * 65536) / p.mhp) * dam;
      playerAdjustManaPrecise(p, spGain);
    },
  };
}

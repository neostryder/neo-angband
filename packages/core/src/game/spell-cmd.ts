/**
 * Player spellcasting commands, ported from the casting half of
 * reference/src/player-spell.c (spell_cast, beam_chance) and the cast /
 * study commands of cmd-obj.c (Angband 4.2.6). The spell's effect chain
 * runs through the same effect interpreter as items, monster spells and
 * traps, with a player source.
 *
 * Commands address the spell by its class-wide index (args.spell) and the
 * book by gear handle (args.handle); the book/spell selection MENUS are the
 * UI layer's (#25) - a front end lists spellCollectFromBook and passes the
 * choice down, exactly as upstream's cmd_get_spell resolves before the
 * command runs.
 *
 * DEFERRED (ledgered in game-spell-cmd.yaml): the low-mana confirmation
 * prompt (get_check, UI), TMD_FASTCAST's 3/4-turn cast, and no_light in
 * player_can_cast (light model) - blindness still forbids casting.
 * convert_mana_to_hp (PF_COMBAT_REGEN) and player_over_exert's faint/CON
 * drain on overcasting are now wired (the latter through env.overExert,
 * supplied by session/game.ts).
 */

import { PF, TMD } from "../generated";
import { sourcePlayer } from "../effects/interpreter";
import type { EffectRecordJson } from "../obj/types";
import type { Player } from "../player/player";
import {
  calcSpells,
  spellByIndex,
  spellChance,
  spellLearn,
  spellOkayToCast,
  spellOkayToStudy,
  playerObjectToBook,
  PY_SPELL,
} from "../player/spell";
import type { SpellChanceEnv } from "../player/spell";
import { convertManaToHp } from "../player/combat-regen";
import type { GameState, PlayerCommand } from "./context";
import {
  buildObjectEffectChain,
  effectRecordsNeedAim,
  playerConfuseDir,
  playerGetResumeNormalShape,
} from "./obj-cmd";
import type { ObjCmdDeps } from "./obj-cmd";
import { gearGet } from "./gear";
import { buildEffectContext } from "./effect-env";
import { attachGameEnv } from "./effect-game-env";
import type { ActionRegistry } from "./player-turn";
import { targetFix, targetGet, targetOkay, targetRelease } from "./target";

/** Hooks for messages and unported systems; all optional. */
export interface SpellCmdEnv extends SpellChanceEnv {
  msg?: (text: string) => void;
  /** player_exp_gain (experience system). */
  expGain?: (amount: number) => void;
  /** player_over_exert on overcasting (faint / CON drain). */
  overExert?: (oops: number) => void;
  /**
   * get_aim_dir: keypad 1-9, or DIR_TARGET (5) to use the player's
   * current target (game/target.ts). The prompt itself is UI (#25).
   */
  chooseDir?: () => number;
}

/** Everything the cast/study commands need beyond the state. */
export interface SpellCmdDeps {
  /** The effect stack bundle (same as obj-cmd / traps). */
  effects: Pick<
    ObjCmdDeps,
    | "registry"
    | "cast"
    | "envDeps"
    | "inject"
    | "teleport"
    | "general"
    | "item"
    | "summon"
  >;
  /** state->stat_ind from calc_bonuses, for the fail / mana math. */
  statInd: readonly number[];
  env?: SpellCmdEnv;
}

/** beam_chance (player-spell.c L486): plev for PF_BEAM classes, else half. */
export function playerBeamChance(player: Player): number {
  return player.cls.pflags.has(PF.BEAM) ? player.lev : Math.trunc(player.lev / 2);
}

/** spell_needs_aim over the spell's raw effect records. */
export function spellNeedsAim(player: Player, spellIndex: number): boolean {
  const spell = spellByIndex(player.cls, spellIndex);
  if (!spell) return false;
  return effectRecordsNeedAim(spell.effectsRaw as EffectRecordJson[]);
}

/** player_can_cast (player-util.c L1087); no_light is the light model's. */
export function playerCanCast(state: GameState, env: SpellCmdEnv = {}): boolean {
  const p = state.actor.player;
  if (!p.cls.magic.totalSpells) {
    env.msg?.("You cannot pray or produce magics.");
    return false;
  }
  if ((p.timed[TMD.BLIND] ?? 0) > 0) {
    env.msg?.("You cannot see!");
    return false;
  }
  if ((p.timed[TMD.CONFUSED] ?? 0) > 0) {
    env.msg?.("You are too confused!");
    return false;
  }
  return true;
}

/**
 * spell_cast (player-spell.c L495): roll the failure chance, run the effect
 * chain on success (learning WORKED + exp the first time), and spend the
 * mana either way, overcasting to zero. Returns whether the turn is spent
 * (false only when the effect aborted, e.g. no target).
 */
export function spellCast(
  state: GameState,
  spellIndex: number,
  dir: number,
  deps: SpellCmdDeps,
): boolean {
  const env = deps.env ?? {};
  const player = state.actor.player;
  const spell = spellByIndex(player.cls, spellIndex);
  if (!spell) return false;

  const beam = playerBeamChance(player);
  const chance = spellChance(player, deps.statInd, spellIndex, env);

  if (state.rng.randint0(100) < chance) {
    env.msg?.("You failed to concentrate hard enough!");
  } else {
    /* Cast the spell. */
    const chain = buildObjectEffectChain(
      spell.effectsRaw as EffectRecordJson[],
      state,
      deps.effects.inject,
    );
    const ctx = attachGameEnv(buildEffectContext(state, deps.effects.envDeps), {
      state,
      cast: deps.effects.cast,
      /* target_get inside the handlers: a DIR_TARGET cast re-reads the
       * live target per handler, as upstream. */
      get aimed() {
        return targetOkay(state) ? targetGet(state) : undefined;
      },
      ...(deps.effects.teleport ? { teleport: deps.effects.teleport } : {}),
      ...(deps.effects.general ? { general: deps.effects.general } : {}),
      ...(deps.effects.item ? { item: deps.effects.item } : {}),
      ...(deps.effects.summon ? { summon: deps.effects.summon } : {}),
    });
    const ident = { value: false };
    if (
      !deps.effects.registry.effectDo(chain, ctx, {
        origin: sourcePlayer(),
        ident,
        aware: true,
        dir,
        beam,
      })
    ) {
      return false;
    }

    /* Reward PF_COMBAT_REGEN characters with a small HP recovery from the
     * mana just spent (player-spell.c L519-521). Deterministic - no RNG. */
    const hasPf =
      env.hasPf ?? ((pf: number): boolean => player.cls.pflags.has(pf));
    if (hasPf(PF.COMBAT_REGEN)) {
      convertManaToHp(player, spell.mana << 16);
    }

    if (((player.spellFlags[spellIndex] ?? 0) & PY_SPELL.WORKED) === 0) {
      /* The spell worked. */
      player.spellFlags[spellIndex] =
        (player.spellFlags[spellIndex] ?? 0) | PY_SPELL.WORKED;
      env.expGain?.(spell.exp * spell.level);
    }
  }

  /* Sufficient mana? */
  if (spell.mana <= player.csp) {
    player.csp -= spell.mana;
  } else {
    const oops = spell.mana - player.csp;
    player.csp = 0;
    player.cspFrac = 0;
    /* Over-exert the player (faint / CON drain hook). */
    env.overExert?.(oops);
  }
  return true;
}

/**
 * Register the cast and study commands. Cast takes args.spell (the
 * class-wide index); study takes args.handle (a book in the pack) and, for
 * PF_CHOOSE_SPELLS classes, args.spell.
 */
export function installSpellCommands(
  registry: ActionRegistry,
  deps: SpellCmdDeps,
): void {
  const env = deps.env ?? {};

  registry.register("cast", (state, cmd: PlayerCommand) => {
    /* A shapechanged caster returns to normal form first (cmd-obj.c
     * L1118 player_get_resume_normal_shape; headless default yes). */
    if (!playerGetResumeNormalShape(state, env)) return 0;
    if (!playerCanCast(state, env)) return 0;
    const player = state.actor.player;

    const args = cmd.args ?? {};
    const spellIndex =
      typeof args["spell"] === "number" ? args["spell"] : -1;
    if (spellIndex < 0 || !spellOkayToCast(player, spellIndex)) {
      env.msg?.("You cannot cast that spell.");
      return 0;
    }

    /* Low-mana warning is a UI prompt; the headless port casts anyway
     * (the over-exert consequences still apply). */
    let dir = 5;
    if (spellNeedsAim(player, spellIndex)) {
      const chosen =
        typeof args["dir"] === "number"
          ? args["dir"]
          : (cmd.dir ?? env.chooseDir?.() ?? 5);
      dir = playerConfuseDir(state, chosen);
    }

    /* target_fix / target_release bracket the whole cast (cmd-obj.c
     * L1162): a target dying mid-spell keeps its grid for the rest of
     * the effect chain. */
    targetFix(state);
    /* cmd_get_item "tgtitem" / "tgtcurse" presets for enchant/identify-family
     * spells: the shell pre-resolves the target and rides it on the cast
     * command; the getItem seam reads state.itemTarget. */
    state.itemRequest = null;
    const rawTgt = args["tgtitem"];
    state.itemTarget =
      rawTgt && typeof rawTgt === "object"
        ? typeof (rawTgt as { handle?: unknown }).handle === "number"
          ? { handle: (rawTgt as { handle: number }).handle }
          : typeof (rawTgt as { floor?: unknown }).floor === "number"
            ? { floor: (rawTgt as { floor: number }).floor }
            : null
        : null;
    state.curseTarget =
      typeof args["tgtcurse"] === "number" ? args["tgtcurse"] : null;
    const cast = spellCast(state, spellIndex, dir, deps);
    state.itemTarget = null;
    state.curseTarget = null;
    targetRelease(state);
    if (!cast) return 0;
    /* TMD_FASTCAST's 3/4 turn is deferred with that timed effect. */
    return state.z.moveEnergy;
  });

  registry.register("study", (state, cmd: PlayerCommand) => {
    if (!playerGetResumeNormalShape(state, env)) return 0;
    if (!playerCanCast(state, env)) return 0;
    const player = state.actor.player;
    if (player.upkeep.newSpells <= 0) {
      env.msg?.("You cannot learn any new spells.");
      return 0;
    }

    const args = cmd.args ?? {};
    const handle = typeof args["handle"] === "number" ? args["handle"] : -1;
    const bookObj = handle >= 0 ? gearGet(state.gear, handle) : null;
    const book = bookObj ? playerObjectToBook(player, bookObj) : null;
    if (!book) {
      env.msg?.("You cannot learn any new spells from the books you have.");
      return 0;
    }

    let spellIndex = -1;
    if (player.cls.pflags.has(PF.CHOOSE_SPELLS)) {
      /* do_cmd_study_spell: the player picks. */
      const want = typeof args["spell"] === "number" ? args["spell"] : -1;
      if (want >= 0 && spellOkayToStudy(player, want)) spellIndex = want;
    } else {
      /* do_cmd_study_book: pick at random (reservoir sample). */
      let k = 0;
      for (const s of book.spells) {
        if (!spellOkayToStudy(player, s.sidx)) continue;
        k++;
        if (k > 1 && state.rng.randint0(k) !== 0) continue;
        spellIndex = s.sidx;
      }
    }
    if (spellIndex < 0) {
      env.msg?.("You cannot learn any spells from that book.");
      return 0;
    }

    spellLearn(player, spellIndex, env.msg);
    calcSpells(player, deps.statInd, env.msg);
    return state.z.moveEnergy;
  });
}

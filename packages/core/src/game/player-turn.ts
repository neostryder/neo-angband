/**
 * The player-action layer: a string-keyed action registry and the
 * process_player() command pump, ported from reference/src/cmd-core.c
 * (cmdq_pop / the command dispatch), game-world.c (process_player and
 * process_player_cleanup: player->energy -= energy_use) and the move/attack
 * path of cmd-cave.c / player-util.c / player-attack.c (Angband 4.2.6).
 *
 * The registry is the moddability seam (decision 13): a command code maps to
 * an action that mutates the game state and returns the energy it spent
 * (0 = a free, non-turn-consuming command). Mods add or replace codes without
 * touching the core. The built-in actions cover walk (move / melee an
 * adjacent monster), hold/rest (spend a turn in place) and the stair commands
 * (signal a level change). Every other command code gets a base-registry stub
 * that spends no energy, and the installers replace all of them before play
 * (obj-cmd, cave-cmd, ranged-cmd, spell-cmd, pickup, player-path). Only "look"
 * and "search" stay stubs, correctly: upstream's look is a UI function with
 * CMD_NULL (ui-knowledge.c:4169) and 4.2.6 has no search command at all.
 *
 * process_player() reads queued commands through the injected provider
 * (state.nextCommand) so the loop never blocks on real input, and drains free
 * commands until one uses energy or the queue empties, exactly as the
 * upstream do-while around cmdq_pop.
 */

import {
  FEAT,
  MON_MSG,
  MON_TMD,
  MSG,
  OF,
  PF,
  SQUARE,
  STAT,
  TF,
  TMD,
  TRF,
} from "../generated/index.js";
import { DDGRID, DDGRID_DDD, locSum } from "../loc.js";
import type { Loc } from "../loc.js";
import { pyAttack } from "../combat/melee.js";
import type { MeleeAttack, MeleeEffectHooks } from "../combat/melee.js";
import { learnBrandSlayFromMelee } from "../combat/brand-slay.js";
import type { TempBrandSlay } from "../combat/brand-slay.js";
import { getLore } from "../mon/lore.js";
import type { Monster } from "../mon/monster.js";
import { MDESC, monsterDesc } from "../mon/desc.js";
import {
  monsterIsCamouflaged,
  monsterIsObvious,
  monsterIsVisible,
} from "../mon/predicate.js";
import { monsterWake } from "../mon/take-hit.js";
import { MON_TMD_FLG_NOTIFY, monIncTimed } from "../mon/timed.js";
import { equipLearnFlag, equipLearnOnMeleeAttack } from "../obj/knowledge.js";
import { playerClearTimed, playerTimedGradeEq } from "../player/timed.js";
import type { GameState, PlayerCommand } from "./context.js";
import {
  arenaInterceptDeath,
  deleteMonster,
  gameTakeHitHooks,
  movePlayer,
  squareMonster,
} from "./context.js";
import { gearGet } from "./gear.js";
import { noticeStuff } from "./notice.js";
import { repeatBeginCommand } from "./repeat.js";
import { floorPile } from "./floor.js";
import { isTrappedChest } from "../obj/chest.js";
import {
  clearMonsterShow,
  knownIsClosedDoor,
  knownIsEnterable,
  knownIsRubble,
  knownObject,
  squareForget,
  squareIsKnown,
  squareMemorize,
  tickMonsterNiceAndMark,
} from "./known.js";
import { squareIsSeen } from "../world/view.js";
import { playerConfuseDir } from "./obj-cmd.js";
import { disturb } from "./player-path.js";
import { playerAdjustManaPrecise } from "./loop.js";
import { addMonsterMessage } from "./mon-message.js";
import {
  playerIsTrapsafe,
  squareIsDisarmableTrap,
  squareIsWebbed,
  squareRemoveAllTraps,
  squareTrap,
} from "./trap.js";
import {
  PY_EXERT,
  playerCheckTerrainDamage,
  playerOverExert,
  playerTakeTerrainDamage,
} from "./world.js";

/**
 * A player action: mutate the state for `cmd` and return the energy spent
 * (player->upkeep->energy_use). Zero means the command consumed no turn.
 */
export type PlayerAction = (state: GameState, cmd: PlayerCommand) => number;

/**
 * The action registry (moddable command table). Built-ins can be replaced and
 * new codes added; unknown codes fall back to a no-energy stub.
 */
export class ActionRegistry {
  private actions = new Map<string, PlayerAction>();

  /** Register (or replace) the action for a command code. */
  register(code: string, action: PlayerAction): void {
    this.actions.set(code, action);
  }

  has(code: string): boolean {
    return this.actions.has(code);
  }

  /** The action for a code, or undefined if none is registered. */
  get(code: string): PlayerAction | undefined {
    return this.actions.get(code);
  }

  codes(): string[] {
    return Array.from(this.actions.keys());
  }
}

/**
 * The wiring-supplied dependencies for the melee blow side effects (gap 2.5):
 * pieces player-turn cannot build from GameState alone. Installed by the
 * session on the state object (see installMeleeSideEffects); every field is
 * optional, and absent fields degrade to the pre-wiring behaviour.
 */
export interface MeleeSideDeps {
  /** effect_simple(EF_EARTHQUAKE, source_player(), "0", 0, 10) (L688). */
  earthquake?: () => void;
  /** effect_simple(EF_HEAL_HP, source_player(), drain) (L878). */
  healHp?: (amount: number) => void;
  /** player_has_temporary_brand/slay over the live timed effects. */
  temp?: TempBrandSlay;
}

/** The state extension carrying the wiring-installed melee side deps. */
type MeleeSideHost = GameState & { meleeSideDeps?: MeleeSideDeps };

/** Install the melee side-effect dependencies on the state (session wiring). */
export function installMeleeSideEffects(
  state: GameState,
  deps: MeleeSideDeps,
): void {
  (state as MeleeSideHost).meleeSideDeps = deps;
}

/** player_has over the computed player state, else race/class pflags. */
function playerHasPf(state: GameState, pf: number): boolean {
  const ps = state.playerState;
  if (ps) return ps.pflags.has(pf);
  const p = state.actor.player;
  return p.race.pflags.has(pf) || p.cls.pflags.has(pf);
}

/** player_of_has over the computed player state flags (equip + innate). */
function playerOfHasFlag(state: GameState, of: number): boolean {
  return state.playerState?.flags.has(of) ?? false;
}

/**
 * Build the py_attack side-effect hooks (player-attack.c:669-1012) for an
 * attack on `mon` at its current grid: the confusion brand, vampiric drain,
 * bloodlust over-exertion, impact quake, shapechange verbs, shield bash and
 * COMBAT_REGEN reward, each reading the live GameState. Wiring-dependent
 * pieces (earthquake / heal effects, temporary brands) come from the
 * installed MeleeSideDeps.
 */
export function buildMeleeHooks(state: GameState, mon: Monster): MeleeEffectHooks {
  const p = state.actor.player;
  const deps = (state as MeleeSideHost).meleeSideDeps ?? {};
  const grid = mon.grid;

  const hooks: MeleeEffectHooks = {
    takeHit: {
      ...gameTakeHitHooks(state, mon),
      ...(state.becomeAware ? { becomeAware: state.becomeAware } : {}),
    },
    /* Confusion attack (blow_side_effects, player-attack.c:672-677). */
    attConf: (p.timed[TMD.ATT_CONF] ?? 0) > 0,
    clearAttConf: (): void => {
      /* player_clear_timed(p, TMD_ATT_CONF, true, false): route through the
       * grade machinery for the on-end message when the world env is wired. */
      const eff = state.world?.timedTable?.[TMD.ATT_CONF];
      if (eff) {
        playerClearTimed(p, eff, true, false, state.world?.timedHooks ?? {});
      } else {
        p.timed[TMD.ATT_CONF] = 0;
      }
    },
    confuseMonster: (m, dur): void => {
      monIncTimed(state.rng, m, MON_TMD.CONF, dur, MON_TMD_FLG_NOTIFY);
    },
    /* Vampiric drain (player-attack.c:877-881). */
    attVamp: (p.timed[TMD.ATT_VAMP] ?? 0) > 0,
    healPlayer: (amount): void => {
      if (deps.healHp) {
        deps.healHp(amount);
        return;
      }
      /* EF_HEAL_HP fallback: constant amount, no RNG. */
      if (p.chp >= p.mhp || amount <= 0) return;
      p.chp += amount;
      if (p.chp >= p.mhp) {
        p.chp = p.mhp;
        p.chpFrac = 0;
      }
      if (amount < 5) state.msg?.("You feel a little better.");
      else if (amount < 15) state.msg?.("You feel better.");
      else if (amount < 35) state.msg?.("You feel much better.");
      else state.msg?.("You feel very good.");
    },
    /* Bloodlust over-exertion (player-attack.c:770-774, 871-874). */
    bloodlust: (p.timed[TMD.BLOODLUST] ?? 0) > 0,
    overExertScramble: (): void => {
      state.msg?.("You feel strange...");
      playerOverExert(state, PY_EXERT.SCRAMBLE, 20, 20);
    },
    overExertCon: (): void => {
      state.msg?.("You feel something give way!");
      playerOverExert(state, PY_EXERT.CON, 20, 0);
    },
    /* Impact earthquakes (player-attack.c:816-819, blow_after_effects). */
    impact: playerOfHasFlag(state, OF.IMPACT),
    learnImpact: (): void => {
      equipLearnFlag(p, state.runeEnv, OF.IMPACT);
    },
    ...(deps.earthquake
      ? {
          earthquake: deps.earthquake,
          monsterGone: (): boolean => squareMonster(state, grid) !== mon,
        }
      : {}),
    ...(deps.temp ? { temp: deps.temp } : {}),
  };

  /* Shapechange blow substitution (player-attack.c:831-838). */
  if (p.shape && p.shape.name !== "normal" && p.shape.blows.length > 0) {
    hooks.shapeBlows = p.shape.blows;
  }

  /* Reward BGs with 5% of max SPs, min 1/2 point (player-attack.c:1002). */
  if (playerHasPf(state, PF.COMBAT_REGEN)) {
    hooks.combatRegen = (): void => {
      const spGain = Math.trunc((Math.max(p.msp, 10) * 16384) / 5);
      playerAdjustManaPrecise(p, spGain);
    };
  }

  /* Shield bash (player-attack.c:897-978, attempt_shield_bash). */
  if (playerHasPf(state, PF.SHIELD_BASH)) {
    const armSlot = p.body.slots.findIndex((s) => s.type === "SHIELD");
    const shield =
      armSlot >= 0 ? gearGet(state.gear, p.equipment[armSlot] ?? 0) : null;
    hooks.shieldBash = {
      shield,
      dexInd: state.statInd?.[STAT.DEX] ?? 0,
      strInd: state.statInd?.[STAT.STR] ?? 0,
      playerWt: p.wt,
      totalWeight: p.upkeep.totalWeight,
      showDamage: state.options?.get("show_damage") ?? false,
      msg: (text): void => state.msg?.(text),
      stunMonster: (m, dur): void => {
        monIncTimed(state.rng, m, MON_TMD.STUN, dur, 0);
      },
      confuseMonster: (m, dur): void => {
        monIncTimed(state.rng, m, MON_TMD.CONF, dur, 0);
      },
    };
  }

  return hooks;
}

/**
 * The shared player-melee path: learn-on-attack wrapping, py_attack with the
 * full side-effect hooks, the delayed "flees in terror" message, and kill
 * handling. Returns the energy used (py_attack's energy_use). Used by the walk
 * command and the bloodlust random attack.
 */
export function attackMonster(state: GameState, target: Monster): number {
  /* Learning from the attack (player-attack.c L822 equip_learn_on_melee_
   * attack; obj-slays.c learn_brand_slay_from_melee). */
  const deps = (state as MeleeSideHost).meleeSideDeps ?? {};

  /* py_attack's first statement (player-attack.c:995-996). Attacking is a
   * deliberate act, so the run/rest it cancels is a queued one - and it also
   * flushes the command queue, which is what stops an auto-repeated command from
   * carrying on after a monster steps into reach. */
  disturb(state);

  const monVisible = monsterIsVisible(target);
  /* health_track (player-attack.c:745-749): hitting something visible makes it
   * the tracked monster, which is what puts it on the sidebar's health bar. This
   * was absent, and melee is the commonest way a player acquires a tracked
   * monster - so the bar stayed blank unless you explicitly targeted. Upstream
   * does it per blow inside py_attack_real; the assignment is idempotent, so
   * once before the blow loop is behaviourally identical. */
  if (monVisible) state.healthWho = target;
  learnBrandSlayFromMelee(
    state.actor.player,
    state.runeEnv,
    state.actor.weapon,
    {
      race: target.race,
      visible: monVisible,
      lore: getLore(state.lore, target.race),
    },
    deps.temp,
  );
  const result: MeleeAttack = pyAttack(
    state.rng,
    state.actor.player,
    state.actor.combat,
    state.actor.weapon,
    target,
    state.brands,
    state.slays,
    {
      /* chance_of_melee_hit halves unseen targets (player-attack.c:104-109),
       * and py_attack's delayed fear message uses the same visibility. */
      monVisible,
      /* player_of_has(p, OF_AFRAID): py_attack_real refuses the blow and prints
       * "You are too afraid to attack X!" (player-attack.c L752). For obvious
       * monsters do_cmd_walk_test short-circuits before this; the check here
       * covers the invisible-monster walk and open/close/tunnel/alter-into-a-
       * monster (attackBlocker), which upstream routes straight to py_attack. */
      afraid: playerOfHasFlag(state, OF.AFRAID),
      percentDamage: state.options?.get("birth_percent_damage") ?? false,
      /* avail_energy = MIN(p->energy, move_energy); process_player only runs
       * with energy >= move_energy, so the full-turn default is upstream's
       * value at every real call site. */
      moveEnergy: state.z.moveEnergy,
      /* object_to_hit / object_to_dam / object_weight_one read the curse
       * templates of the weapon active curses (obj-util.c:296-330). */
      curses: state.curses,
      hooks: buildMeleeHooks(state, target),
    },
  );
  equipLearnOnMeleeAttack(state.actor.player, state.runeEnv);
  /* py_attack message slice: hand the blow-by-blow result to the shell for
   * faithful "You hit/miss/slay the X" text (combat returns HitType keys
   * only). Before deletion so the monster name is still resolvable. */
  state.onMelee?.(target, result);
  /* "Hack - delay fear messages" (player-attack.c:1023): add_monster_message
   * with delay = true, so the flee line comes out in the second pass. */
  if (result.monsterFled) {
    addMonsterMessage(state, target, MON_MSG.FLEE_IN_TERROR, true);
  }
  if (result.monsterDied && !arenaInterceptDeath(state, target)) {
    state.onPlayerKill?.(target);
    deleteMonster(state, target.midx);
  }
  return result.energyUsed;
}

/**
 * energy_per_move (player-util.c:323-328): the energy one step costs, taking
 * extra moves (state->num_moves, OBJ_MOD_MOVES) into account.
 */
export function energyPerMove(state: GameState): number {
  const num = state.playerState?.numMoves ?? 0;
  const energy = state.z.moveEnergy;
  return Math.trunc((energy * (1 + Math.abs(num) - num)) / (1 + Math.abs(num)));
}

/**
 * player_attack_random_monster (player-util.c:794-813): melee a random
 * adjacent monster ("You angrily lash out at a nearby foe!"). Draws the
 * starting direction BEFORE the confusion check, as upstream declares
 * `dir = randint0(8)` in the initializer. Returns the energy used, or -1 when
 * no monster was attacked (the command proceeds normally).
 */
export function playerAttackRandomMonster(state: GameState): number {
  const p = state.actor.player;
  let dir = state.rng.randint0(8);

  /* Confused players get a free pass. */
  if ((p.timed[TMD.CONFUSED] ?? 0) > 0) return -1;

  /* Look for a monster, attack. */
  for (let i = 0; i < 8; i++, dir++) {
    const grid = locSum(state.actor.grid, DDGRID_DDD[dir % 8]!);
    const mon = squareMonster(state, grid);
    if (mon && !monsterIsCamouflaged(mon)) {
      /* Upstream sets energy_use = move_energy here, but py_attack resets it
       * to zero and re-accumulates per blow (an upstream quirk preserved:
       * the assignment is dead). */
      state.msg?.("You angrily lash out at a nearby foe!");
      return attackMonster(state, mon);
    }
  }
  return -1;
}

/**
 * walk: melee an adjacent monster (py_attack) or step onto a passable grid,
 * refreshing FOV via the injected hook. Returns move_energy when the turn is
 * spent, 0 when blocked by a wall (a bump uses no energy).
 */
/**
 * move_player's pre-step damaging-terrain check (cmd-cave.c L1156-1180), factored
 * out for the web shell to run BEFORE it queues a walk so it can block on the
 * yes/no confirm (the core walk action is synchronous and cannot await UI).
 *
 * Returns the feature's walk_msg when a deliberate (non-running) step onto fiery
 * terrain (lava) would cost more than a third of current HP, so the shell prompts
 * "Really step in?" and, on "no", cancels the move without spending a turn; null
 * otherwise. Faithful conditions: only when the target grid is actually stepped
 * onto (not a wall bump, not a monster attack) and the player is not confused
 * (a confused player is never prompted). Like C, playerCheckTerrainDamage(false)
 * is drawn whenever an unconfused player steps onto fiery terrain - prompt or not
 * - which, with the post-turn damage draw, reproduces C's double draw; it learns
 * no rune. The running-into-lava run_msg branch is a documented follow-up.
 */
export function walkTerrainPrompt(
  state: GameState,
  rawDir: number,
): string | null {
  if (rawDir < 1 || rawDir > 9 || rawDir === 5) return null;
  /* move_player only checks damaging terrain when not confused (cmd-cave.c
   * L1157); a confused player is never prompted and draws no terrain-check RNG
   * here (the randomised direction and any damage happen later in walkAction). */
  if ((state.actor.player.timed[TMD.CONFUSED] ?? 0) > 0) return null;

  const offset = DDGRID[rawDir] as Loc;
  const next: Loc = {
    x: state.actor.grid.x + offset.x,
    y: state.actor.grid.y + offset.y,
  };
  if (!state.chunk.inBounds(next)) return null;
  /* The confirm is on move_player's actual-step branch, after the monster-attack
   * and wall branches: no prompt when attacking a monster or bumping a wall. */
  if (squareMonster(state, next)) return null;
  if (!state.chunk.isPassable(next)) return null;
  if (!state.chunk.isFiery(next)) return null;

  const dam = playerCheckTerrainDamage(state, next, false);
  /* Non-running walk: prompt only when the step costs more than a third of the
   * player's current HP (cmd-cave.c L1174-1177). */
  if (dam > Math.trunc(state.actor.player.chp / 3)) {
    return state.chunk.feature(next).walkMsg;
  }
  return null;
}

export function walkAction(state: GameState, cmd: PlayerCommand): number {
  const rawDir = cmd.dir;
  if (rawDir === undefined || rawDir < 1 || rawDir > 9 || rawDir === 5) return 0;

  /*
   * The port merges do_cmd_walk and move_player into one action; upstream's
   * run_step (player-path.c:2042) calls move_player DIRECTLY, skipping
   * do_cmd_walk's preamble. `fromRun` says which caller this is, and the one
   * place it currently changes behaviour is the known-blocked-grid wording
   * below. The other two preamble steps are unreachable from a run either way:
   * runAction refuses to start while confused (so player_confuse_dir cannot
   * redirect a run step) and clears the web underfoot before the first step (and
   * run_test treats a web ahead as a wall).
   */
  const fromRun = cmd.args?.["fromRun"] === true;

  /*
   * do_cmd_walk / do_cmd_jump (cmd-cave.c:1288-1297 / 1328-1337): standing in
   * a web clears the web and spends the turn in place - no movement.
   */
  if (!fromRun && squareIsWebbed(state, state.actor.grid)) {
    state.msg?.("You clear the web.");
    /* square_remove_all_traps_of_type(web->tidx) (cmd-cave.c:1294). */
    const web = squareTrap(state, state.actor.grid).find(
      (t) => t.kind.flags.has(TRF.WEB) || t.kind.desc === "web",
    );
    squareRemoveAllTraps(state, state.actor.grid, web?.tidx ?? -1);
    return state.z.moveEnergy;
  }

  /* do_cmd_walk (cmd-cave.c L1299-1302): confusion randomises the direction.
   * When it redirects ("You are confused."), the move spends a full turn even
   * if it dead-ends against a wall (energy_use is set to move_energy before the
   * walkability test). The bump-open wrapper (installCaveCommands) applies
   * confusion up front and sets confusedApplied so the RNG is drawn once; a
   * direct caller (jump, borg, tests) rolls it here. */
  let dir = rawDir;
  let confused = false;
  if (!cmd.confusedApplied) {
    dir = playerConfuseDir(state, rawDir);
    confused = dir !== rawDir;
  }
  const offset = DDGRID[dir] as Loc;

  const next: Loc = { x: state.actor.grid.x + offset.x, y: state.actor.grid.y + offset.y };
  if (!state.chunk.inBounds(next)) return confused ? state.z.moveEnergy : 0;

  const target = squareMonster(state, next);
  if (target) {
    /* move_player (cmd-cave.c L1071): a camouflaged monster in the way
     * surprises the player instead of being attacked - reveal it and wake it,
     * matching upstream's become_aware + monster_wake(mon, false, 100). */
    if (monsterIsCamouflaged(target)) {
      state.becomeAware?.(target);
      monsterWake(state.rng, target, false, 100);
      return state.z.moveEnergy;
    }
    /* do_cmd_walk_test (cmd-cave.c L1213-1226): an afraid player refuses to
     * attack an obvious (visible, non-camouflaged) monster - it prints "You are
     * too afraid to attack X!", learns OF_AFRAID from equipment, and makes no
     * move. do_cmd_walk sets energy only AFTER the test passes, so an unconfused
     * refusal costs nothing; a confused walk already spent its full turn. An
     * invisible monster is not obvious, so it falls through to py_attack, whose
     * own afraid branch (player-attack.c L752) fires there instead. */
    if (monsterIsObvious(target) && playerOfHasFlag(state, OF.AFRAID)) {
      state.msg?.(
        `You are too afraid to attack ${monsterDesc(target, MDESC.DEFAULT)}!`,
        "AFRAID",
      );
      state.sound?.(MSG.AFRAID);
      equipLearnFlag(state.actor.player, state.runeEnv, OF.AFRAID);
      return confused ? state.z.moveEnergy : 0;
    }
    /* py_attack: the shared melee path with the full blow side-effect suite.
     * Energy is py_attack's own energy_use (blow_energy per blow), which may
     * be less than a full turn, exactly as upstream. */
    return attackMonster(state, target);
  }

  /*
   * move_player (cmd-cave.c:1084-1088): a RUN stops in front of a known
   * disarmable trap instead of walking into it, and the step is refunded.
   *
   * Ordered after the monster branch and before the impassable one, exactly as
   * upstream, and it does not need to exclude the auto-disarm branch above it:
   * run_step passes `dir && disarm` (player-path.c:2042), which is false on every
   * continuing step, so a run never takes the alter/disarm path for a trap.
   *
   * Absent, a run walked the player onto their own detected traps.
   */
  if (
    (state.run?.running ?? 0) > 0 &&
    squareIsDisarmableTrap(state, next) &&
    !playerIsTrapsafe(state)
  ) {
    disturb(state);
    return 0;
  }

  /* Bump into a wall: no step, no energy.
   * A mod may take the walk over through the walkBlockedByDiggable hook
   * (mod/hooks.ts) - the QoL mod digs here. autoDigStep returns null having drawn
   * NO RNG when no mod supplied one, so faithful core still just bumps. */
  if (!state.chunk.isPassable(next)) {
    /* `!== null`, not `> 0`: a mod may handle the walk and charge ZERO energy
     * (mod/hooks.ts), and `> 0` silently threw that case away by treating it as
     * "no mod supplied one". */
    const dug = state.autoDigStep?.(state, next) ?? null;
    if (dug !== null) return dug;
    /*
     * Upstream splits this by whether the player already KNOWS the grid, and
     * the port previously used the known-grid wording for both cases.
     *
     * Unknown: do_cmd_walk_test lets the walk proceed (cmd-cave.c:1231-1232),
     * so move_player runs and takes its own !square_ispassable branch
     * (:1092-1106) - "You FEEL a wall blocking your way", because the player
     * cannot see it - and MEMORIZES the grid. That mapping side effect is how
     * you feel your way along an unlit corridor, and it was missing entirely:
     * bumping an unseen wall left it unmapped forever and announced the wall as
     * though it had been in plain sight.
     *
     * Known: do_cmd_walk_test messages "in the way!" and refuses the move
     * (:1240-1253), reconciling player memory with what is really there.
     *
     * A closed door is silent in the KNOWN case only - the walk override
     * (installCaveCommands) opens it (move_player's alter branch, :1079-1083) -
     * so the base action stays a safe fallback when the override is absent
     * (borg / unit tests). An UNKNOWN closed door does get its own line.
     */
    disturb(state);
    const rubble = state.chunk.isRubble(next);
    const door = state.chunk.isClosedDoor(next);
    if (!squareIsKnown(state, next)) {
      state.msg?.(
        rubble
          ? "You feel a pile of rubble blocking your way."
          : door
            ? "You feel a door blocking your way."
            : "You feel a wall blocking your way.",
        "HITWALL",
      );
      /* square_memorize + square_light_spot at each of :1096, :1100, :1104. */
      squareMemorize(state, next);
    } else if (fromRun) {
      /*
       * move_player's OWN known-grid branch (cmd-cave.c:1108-1130), whose
       * wording differs from do_cmd_walk_test's above: "blocking your way", not
       * "in the way!". It is reached only when something other than a deliberate
       * walk drives move_player, because a deliberate walk is refused by
       * do_cmd_walk_test before move_player runs. In 4.2.6 that leaves exactly
       * one route - run_step (player-path.c:2042). The whirlwind
       * (effect-handler-attack.c:1838) is NOT a second route, contrary to the
       * census note: it tests square_ispassable on every candidate grid and
       * says "The way is barred." rather than moving into one.
       *
       * A closed door reports here too (unlike the walk case, where the walk
       * override opens it), because run_step passes disarm only for a trap.
       */
      state.msg?.(
        rubble
          ? "There is a pile of rubble blocking your way."
          : door
            ? "There is a door blocking your way."
            : "There is a wall blocking your way.",
        "HITWALL",
      );
      /* The same memory reconciliation, per branch (:1112-1129). */
      if (rubble) {
        if (!knownIsRubble(state, next)) squareMemorize(state, next);
      } else if (door) {
        if (!knownIsClosedDoor(state, next)) squareMemorize(state, next);
      } else if (knownIsEnterable(state, next)) {
        squareForget(state, next);
      }
    } else if (!door) {
      state.msg?.(
        rubble
          ? "There is a pile of rubble in the way!"
          : "There is a wall in the way!",
        "HITWALL",
      );
      /* The memory reconciliation upstream performs alongside each message: a
       * remembered floor/rubble/door that turns out to be a wall is forgotten
       * (:1252-1257), and rubble the player misremembered is re-memorized
       * (:1243-1246). */
      if (rubble) {
        if (!knownIsRubble(state, next)) squareMemorize(state, next);
      } else if (knownIsEnterable(state, next)) {
        squareForget(state, next);
      }
    }
    /* A confused redirect into a wall still spends the turn (cmd-cave.c
     * L1300-1302); a deliberate bump refunds all energy. */
    return confused ? state.z.moveEnergy : 0;
  }

  /*
   * move_player (cmd-cave.c:1141-1152): a run stops at the edge of the detected
   * -traps zone rather than carrying the player out of it, and refunds the step.
   * running_firststep is excluded so a run STARTED on the edge can leave.
   *
   * This is the DTrap indicator's whole point on the move side, and it was
   * missing: a run out of a detected area kept going into undetected ground.
   */
  const leavingDtrap =
    (state.run?.running ?? 0) > 0 &&
    !state.run?.firstStep &&
    state.chunk.sqinfoHas(state.actor.grid, SQUARE.DTRAP) &&
    !state.chunk.sqinfoHas(next, SQUARE.DTRAP);
  if (leavingDtrap) {
    disturb(state);
    return 0;
  }

  movePlayer(state, next);
  if (state.updateFov) state.updateFov(state);
  search(state); /* player_handle_post_move (player-util.c:1633-1634). */

  /*
   * player_handle_post_move's store-door branch (player-util.c:1601-1609): the
   * disturb half. Stepping onto a shop cancels a run or a rest whether or not the
   * host has a store screen to open, so it belongs here rather than beside the
   * host's enterStoreModal - and the shapechanged refusal above it returns before
   * the disturb, so a shapechanged player is not disturbed by a door that will
   * not open for them.
   */
  if (state.chunk.isShop(next) && !state.actor.player.shape) disturb(state);

  /* Autopickup on the new grid (upstream queues CMD_AUTOPICKUP; its energy
   * cost is folded into this step, see game/pickup.ts). */
  const pickupCost = state.autoPickup ? state.autoPickup(state) : 0;

  /* Trap / terrain consequences of the step (move_player -> hit_trap). */
  state.onPlayerMoved?.(state, next);

  /* energy_per_move (cmd-cave.c move_player L1163 via player-util.c:323):
   * extra-moves items make steps cheaper (gap 2.3). */
  return energyPerMove(state) + pickupCost;
}

/**
 * jump (do_cmd_jump, cmd-cave.c:1319): "walk into a trap" - identical to
 * do_cmd_walk except move_player is called with disarm=false (cmd-cave.c:1351),
 * so a known disarmable trap is stepped onto rather than auto-disarmed. The
 * cave-cmd walk wrapper only auto-disarms for code "walk"; jump falls through
 * to the step path.
 */
export function jumpAction(state: GameState, cmd: PlayerCommand): number {
  return walkAction(state, cmd);
}

/**
 * search (player-util.c:1680-1715): reveal adjacent secret doors and the
 * traps on known chests.  The only RNG is place_closed_door's one_in_(4), then
 * randint1(7) on success, once per discovered door in y/x scan order.
 */
export function search(state: GameState): void {
  const p = state.actor.player;
  if (
    (p.timed[TMD.BLIND] ?? 0) > 0 ||
    !squareIsSeen(state.chunk, state.actor.grid) ||
    (p.timed[TMD.CONFUSED] ?? 0) > 0 ||
    (p.timed[TMD.IMAGE] ?? 0) > 0
  ) return;

  for (let y = state.actor.grid.y - 1; y <= state.actor.grid.y + 1; y++) {
    for (let x = state.actor.grid.x - 1; x <= state.actor.grid.x + 1; x++) {
      const grid = { x, y };
      if (!state.chunk.inBoundsFully(grid)) continue;

      const flags = state.chunk.feature(grid).flags;
      if (flags.has(TF.DOOR_ANY) && flags.has(TF.ROCK)) {
        state.msg?.("You have found a secret door.");
        state.chunk.setFeat(grid, FEAT.CLOSED);
        if (state.rng.oneIn(4)) {
          state.setDoorLock?.(grid, state.rng.randint1(7));
        }
        disturb(state);
      }

      /*
       * The C tests knowledge PER OBJECT (`if (!obj->known || ...) continue;`),
       * which has no exact analogue here: this port's object memory is per GRID
       * (KnownObjectMemory holds the remembered pile head's glyph, not a shadow
       * per object), so the closest check is "is this grid's pile remembered".
       *
       * For floor piles the two agree, because square_know_pile shadows the
       * WHOLE pile at once -- either every object on the grid has a shadow or
       * none does. They diverge only for an object added to an
       * already-remembered grid since the last know_pile, e.g. a chest dropped
       * onto a mapped floor: upstream will not discover its trap until the pile
       * is known again, this will. Narrow, and recorded as a finding rather than
       * faked, since a per-object shadow is a larger design change.
       */
      if (!knownObject(state, grid)) continue;
      for (const obj of floorPile(state, grid)) {
        if ((state.isIgnored?.(obj) ?? false) || !isTrappedChest(obj)) continue;
        if (obj.knownPval !== obj.pval) {
          state.msg?.("You have discovered a trap on the chest!");
          obj.knownPval = obj.pval;
          disturb(state);
        }
      }
    }
  }
}

/**
 * hold / rest: stay put and spend a full turn.
 *
 * do_cmd_hold (cmd-cave.c:1580) is energy, search, do_autopickup, then "enter a
 * store if we are on one". do_cmd_rest (cmd-cave.c:1615) is a DIFFERENT upstream
 * function that does NEITHER; the two share this implementation only because both
 * spend a turn standing still.
 *
 * The discriminator is `state.resting`, NOT `cmd.code`. The obvious gate -
 * `cmd.code === "hold"` - is wrong here, because the host's rest loop drives every
 * one of its turns by pushing `{ code: "hold" }` (web/src/main.ts): a rest would
 * have picked items up off the floor and cancelled itself on a shop tile. A code
 * the caller chooses is not evidence about which upstream function this is
 * standing in for; a rest in progress is.
 */
export function holdAction(state: GameState, _cmd: PlayerCommand): number {
  search(state);

  if (!state.resting) {
    /* do_autopickup(player), cmd-cave.c:1590. Upstream's comment says "not using
     * extra energy", so the energy the pickup reports is deliberately discarded -
     * standing still costs one move, whatever is underfoot. Without this call the
     * pickup_always option did nothing at all for a player who stood still on a
     * pile: only walkAction (:597) ran the hook. */
    state.autoPickup?.(state);

    /* disturb(player) on entering a store (cmd-cave.c:1599). Opening the shop
     * screen is the host's (enterStoreModal, web/src/main.ts), but cancelling a
     * run or a rest is the engine's, and it has to happen whether or not a host
     * has a store UI at all. */
    if (state.chunk.isShop(state.actor.grid)) disturb(state);
  }

  return state.z.moveEnergy;
}

/**
 * sleep (do_cmd_sleep, cmd-cave.c:1675): spend a full turn doing nothing.
 * process_player injects CMD_SLEEP when the player is paralyzed or Knocked Out
 * (game-world.c:965-968).
 */
export function sleepAction(state: GameState, _cmd: PlayerCommand): number {
  return state.z.moveEnergy;
}

/**
 * descend / ascend: signal a level change (player->upkeep->generate_level).
 * The generation and depth change belong to the world integration, which does
 * them (session/game.ts changeLevel); the loop observes the signal and clears it.
 */
export function descendAction(state: GameState, _cmd: PlayerCommand): number {
  state.generateLevel = true;
  return state.z.moveEnergy;
}

export function ascendAction(state: GameState, _cmd: PlayerCommand): number {
  state.generateLevel = true;
  return state.z.moveEnergy;
}

/** The base-registry placeholder: consumes no turn. Every code that uses it is
 * re-registered by an installer before play; see STUBBED_COMMANDS. */
export function stubAction(_state: GameState, _cmd: PlayerCommand): number {
  return 0;
}

/** Command codes registered as stubs (deferred; see game-loop.yaml).
 * "pickup"/"autopickup" stubs are replaced by installPickup (game/pickup.ts);
 * "run" is replaced by installRunning (game/player-path.ts). */
export const STUBBED_COMMANDS: readonly string[] = [
  "tunnel",
  "cast",
  "fire",
  "throw",
  "quaff",
  "read",
  "eat",
  "use-staff",
  "aim-wand",
  "zap-rod",
  "activate",
  "pickup",
  "drop",
  "wield",
  "takeoff",
  "look",
  "search",
  "disarm",
  "open",
  "close",
];

/** Build the default registry: the actions defined here plus the placeholders
 * the installers replace. */
export function createDefaultRegistry(): ActionRegistry {
  const reg = new ActionRegistry();
  reg.register("walk", walkAction);
  reg.register("jump", jumpAction);
  reg.register("hold", holdAction);
  reg.register("rest", holdAction);
  reg.register("sleep", sleepAction);
  reg.register("descend", descendAction);
  reg.register("ascend", ascendAction);
  for (const code of STUBBED_COMMANDS) reg.register(code, stubAction);
  return reg;
}

/**
 * Command codes whose upstream game_cmds entry has can_use_energy = false
 * (cmd-core.c game_cmds): these skip the pre-command bloodlust coercion roll.
 * Every other code maps to an energy-capable command and draws the roll.
 */
const NON_COERCION_COMMANDS: ReadonlySet<string> = new Set([
  "inscribe",
  "uninscribe",
  "autoinscribe",
  "sell",
  "stash",
  "buy",
  "retrieve",
  "retire",
  "help",
  "repeat",
]);

/** The result of pumping the player's command queue. */
export interface PlayerTurnResult {
  /** The provider had no command ready: the loop should return for input. */
  needsInput: boolean;
  /** Energy spent this call (0 when a free command ran or input is needed). */
  energyUsed: number;
}

/**
 * process_player_cleanup (game-world.c:839), everything but the energy
 * accounting - which the port applies at the call site below, because `use` is
 * only in scope there.
 *
 * Called at the END of every do-loop iteration in processPlayer, including the
 * bloodlust-coercion path, exactly as the C calls it at L989. Two guards matter
 * and neither is decoration:
 *
 * - The terrain damage and the NICE/MARK loop are inside `if (energy_use)`
 *   (L844): a free command costs no lava burn and fades no detection.
 * - The NICE/MARK loop is additionally skipped while `upkeep->dropping` (L867),
 *   so an ignore_drop auto-drop does not spend the player's one turn of
 *   detection on itself. The SHOW clear and the `dropping` reset are OUTSIDE
 *   both guards (L903-909).
 *
 * `skip_cmd_coercion` (L859-861, L897-903) is not modelled - save gap 12.6.
 */
function processPlayerCleanup(state: GameState, energyUsed: number): void {
  const up = state.actor.player.upkeep;

  if (energyUsed) {
    /* Player can be damaged by terrain (L864): fiery terrain burns after each
     * acted turn. This used to live in game/loop.ts, one level out, which was
     * equivalent only because the do-loop exits immediately after the
     * energy-spending command - but it left no correct home for the block
     * below. */
    playerTakeTerrainDamage(state);

    /* L867-892, minus the hallucination redraw and the multi-hued shimmer,
     * which are PR_MAP / square_light_spot - the ratified redraw divergence. */
    if (!up.dropping) tickMonsterNiceAndMark(state);
  }

  clearMonsterShow(state);
  up.dropping = false;
}

/**
 * process_player: drain queued commands until one spends energy, the queue
 * empties (needsInput), or the player dies / a level change is requested.
 * Applies the process_player_cleanup energy accounting for the spending
 * command (player->energy -= energy_use; total_energy += energy_use).
 */
export function processPlayer(
  state: GameState,
  registry: ActionRegistry,
): PlayerTurnResult {
  let energyUsed = 0;
  do {
    if (state.isDead || state.generateLevel) break;

    /* notice_stuff(player) (game-world.c:942), the first line of the refresh
     * block: the ignore and combine passes owed by whatever ran last, drained
     * BEFORE pack_overflow so the overflow sees a combined pack. */
    noticeStuff(state);

    /* game-world.c:941-947: after the refresh equivalent and before command
     * preparation, recover an overfull/corrupt pack using calc_inventory's
     * sorted inven[] view. */
    state.overflowPack?.();

    /* Paralyzed or Knocked Out player gets no turn (game-world.c:965-968):
     * inject CMD_SLEEP so a full-energy no-op is spent and nextCommand is
     * never consulted. Ordering matches C: after the detect-ore block (not
     * yet in the port), before command prep / cmdq_pop. */
    {
      const p = state.actor.player;
      const stunEff = state.world?.timedTable?.[TMD.STUN];
      const knockedOut =
        stunEff !== undefined &&
        playerTimedGradeEq(p, stunEff, "Knocked Out");
      if ((p.timed[TMD.PARALYZED] ?? 0) > 0 || knockedOut) {
        if (!state.cmdQueue) state.cmdQueue = [];
        state.cmdQueue.push({ code: "sleep" });
      }
    }

    /* Drain the internal queue (cmdq) first - self-continuing commands like
     * running push their follow-up there - then ask the injected provider. */
    const cmd =
      state.cmdQueue && state.cmdQueue.length > 0
        ? state.cmdQueue.shift()!
        : state.nextCommand();
    if (!cmd) return { needsInput: true, energyUsed: 0 };

    /* While TMD_COMMAND runs, the player's commands drive the commanded
     * monster instead (cmd-core.c L333 swaps the command list). */
    const commanding =
      (state.actor.player.timed[TMD.COMMAND] ?? 0) > 0 && state.monCommand;
    const action = commanding
      ? state.monCommand!
      : (registry.get(cmd.code) ?? stubAction);

    /* Occasional attack instead for bloodlust-affected characters
     * (cmd-core.c:373): before an energy-capable command executes, the
     * coercion roll is drawn (unconditionally, even at zero bloodlust,
     * matching upstream's randint0(200) < timed[TMD_BLOODLUST]); on success
     * the command is dropped and a random adjacent monster is attacked.
     * skip_cmd_coercion is not modelled (save gap 12.6, WP-10).
     *
     * background_command > 1 is exempt (cmd-core.c:360): ignore_drop
     * queues its auto-drops that way, and drawing the roll for them would move
     * every later draw in the turn. */

    /* process_command's repeat reset (cmd-core.c:353): every command starts
     * repeatable and the handler clears it if it must not be repeated. BEFORE the
     * coercion block, because the C sets it at L353 and the coercion test is at
     * L360 inside the same function - so a coerced attack replaces the command
     * but not this. Also records whether this command addressed a floor object,
     * which is what cmd_disable_repeat_floor_item reads. */
    repeatBeginCommand(state.actor.player, cmd);

    if (
      !commanding &&
      !NON_COERCION_COMMANDS.has(cmd.code) &&
      (cmd.background ?? 0) <= 1
    ) {
      if (
        state.rng.randint0(200) <
        (state.actor.player.timed[TMD.BLOODLUST] ?? 0)
      ) {
        const spent = playerAttackRandomMonster(state);
        if (spent >= 0) {
          if (spent > 0) {
            state.actor.energy -= spent;
            state.actor.totalEnergy += spent;
            energyUsed = spent;
          }
          /* The coerced attack IS the command for this iteration, so the C
           * reaches process_player_cleanup through it too (process_command
           * returns and L989 runs). */
          processPlayerCleanup(state, spent > 0 ? spent : 0);
          continue;
        }
      }
    }

    const use = action(state, cmd);
    if (use > 0) {
      state.actor.energy -= use;
      state.actor.totalEnergy += use;
      energyUsed = use;
    }
    /* process_player_cleanup (game-world.c:989), the last statement of the loop
     * body. Runs after a FREE command too - that is where the SHOW clear lives,
     * and without it a detected monster's MARK would never reach the
     * MARK && !SHOW state its fade needs. */
    processPlayerCleanup(state, use > 0 ? use : 0);
  } while (energyUsed === 0 && !state.isDead && !state.generateLevel);

  /* "Notice stuff (if needed)" (game-world.c:995-996), after the do-loop: the
   * command that just spent energy may have raised a bit, and this is where
   * upstream drains it rather than leaving it for the next turn. */
  noticeStuff(state);

  return { needsInput: false, energyUsed };
}

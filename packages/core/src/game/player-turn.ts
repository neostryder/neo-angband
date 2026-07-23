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
 * (signal a level change). Every other command code is registered as a stub
 * that spends no energy and is ledgered as deferred.
 *
 * process_player() reads queued commands through the injected provider
 * (state.nextCommand) so the loop never blocks on real input, and drains free
 * commands until one uses energy or the queue empties, exactly as the
 * upstream do-while around cmdq_pop.
 */

import { MON_MSG, MON_TMD, OF, PF, STAT, TMD } from "../generated";
import { DDGRID, DDGRID_DDD, locSum } from "../loc";
import type { Loc } from "../loc";
import { pyAttack } from "../combat/melee";
import type { MeleeAttack, MeleeEffectHooks } from "../combat/melee";
import { learnBrandSlayFromMelee } from "../combat/brand-slay";
import type { TempBrandSlay } from "../combat/brand-slay";
import { getLore } from "../mon/lore";
import type { Monster } from "../mon/monster";
import { monsterIsCamouflaged } from "../mon/predicate";
import { monsterWake } from "../mon/take-hit";
import { MON_TMD_FLG_NOTIFY, monIncTimed } from "../mon/timed";
import { equipLearnFlag, equipLearnOnMeleeAttack } from "../obj/knowledge";
import { playerClearTimed } from "../player/timed";
import type { GameState, PlayerCommand } from "./context";
import { arenaInterceptDeath, deleteMonster, movePlayer, squareMonster } from "./context";
import { gearGet } from "./gear";
import { playerConfuseDir } from "./obj-cmd";
import { playerAdjustManaPrecise } from "./loop";
import { formatMonsterMessage } from "./mon-message";
import { PY_EXERT, playerOverExert } from "./world";

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
   * attack; obj-slays.c learn_brand_slay_from_melee). The target is
   * treated as visible, matching the monVisible option below. */
  const deps = (state as MeleeSideHost).meleeSideDeps ?? {};
  learnBrandSlayFromMelee(
    state.actor.player,
    state.runeEnv,
    state.actor.weapon,
    {
      race: target.race,
      visible: true,
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
      monVisible: true,
      percentDamage: state.options?.get("birth_percent_damage") ?? false,
      /* avail_energy = MIN(p->energy, move_energy); process_player only runs
       * with energy >= move_energy, so the full-turn default is upstream's
       * value at every real call site. */
      moveEnergy: state.z.moveEnergy,
      hooks: buildMeleeHooks(state, target),
    },
  );
  equipLearnOnMeleeAttack(state.actor.player, state.runeEnv);
  /* py_attack message slice: hand the blow-by-blow result to the shell for
   * faithful "You hit/miss/slay the X" text (combat returns HitType keys
   * only). Before deletion so the monster name is still resolvable. */
  state.onMelee?.(target, result);
  /* Hack - delay fear messages (player-attack.c:1023). */
  if (result.monsterFled) {
    const flee = formatMonsterMessage(target, MON_MSG.FLEE_IN_TERROR);
    if (flee) state.msg?.(flee);
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
export function walkAction(state: GameState, cmd: PlayerCommand): number {
  const rawDir = cmd.dir;
  if (rawDir === undefined || rawDir < 1 || rawDir > 9 || rawDir === 5) return 0;

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
    /* py_attack: the shared melee path with the full blow side-effect suite.
     * Energy is py_attack's own energy_use (blow_energy per blow), which may
     * be less than a full turn, exactly as upstream. */
    return attackMonster(state, target);
  }

  /* Bump into a wall: no step, no energy (disturb/knowledge DEFERRED).
   * QoL auto-dig (mod seam): walking into known diggable terrain the player can
   * dig begins one tunnel attempt instead of a no-op bump. autoDigStep returns 0
   * without drawing RNG unless the qol.autoDig flag is on and the grid qualifies,
   * so faithful core (no mod / flag off) still just bumps. */
  if (!state.chunk.isPassable(next)) {
    const dug = state.autoDigStep?.(state, next) ?? 0;
    if (dug > 0) return dug;
    /* do_cmd_walk_test (cmd-cave.c L1240-1253): bumping a known wall or rubble
     * gives a MSG_HITWALL message. A closed door is NOT messaged here - the
     * walk override (installCaveCommands) opens it (move_player's alter branch);
     * this stays silent for a door so the base action is a safe fallback when
     * the override is absent (borg / unit tests). */
    if (!state.chunk.isClosedDoor(next)) {
      state.msg?.(
        state.chunk.isRubble(next)
          ? "There is a pile of rubble in the way!"
          : "There is a wall in the way!",
      );
    }
    /* A confused redirect into a wall still spends the turn (cmd-cave.c
     * L1300-1302); a deliberate bump refunds all energy. */
    return confused ? state.z.moveEnergy : 0;
  }

  movePlayer(state, next);
  if (state.updateFov) state.updateFov(state);

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
 * do_cmd_walk except move_player is called with disarm=false, so a disarmable
 * trap in the target grid is stepped onto and triggered rather than disarmed.
 * The port's walkAction does not yet implement do_cmd_walk's disarm-on-walk
 * branch (cmd-cave.c:1311-1312, deferred: trap consequences run in
 * onPlayerMoved -> hit_trap on any step), so a step onto a trap already
 * triggers it; jump therefore shares walkAction's body. Kept as a distinct
 * action so a front end can bind the faithful CMD_JUMP keys (W / -) and so the
 * distinction survives once walk gains its disarm branch.
 */
export function jumpAction(state: GameState, cmd: PlayerCommand): number {
  return walkAction(state, cmd);
}

/** hold / rest: stay put and spend a full turn. */
export function holdAction(state: GameState, _cmd: PlayerCommand): number {
  return state.z.moveEnergy;
}

/**
 * descend / ascend: signal a level change (player->upkeep->generate_level).
 * The actual level generation and depth change are DEFERRED to the world
 * integration; the loop observes the signal and clears it.
 */
export function descendAction(state: GameState, _cmd: PlayerCommand): number {
  state.generateLevel = true;
  return state.z.moveEnergy;
}

export function ascendAction(state: GameState, _cmd: PlayerCommand): number {
  state.generateLevel = true;
  return state.z.moveEnergy;
}

/** A deferred command: consumes no turn (ledgered as not yet ported). */
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

/** Build the default registry: the ported actions plus the deferred stubs. */
export function createDefaultRegistry(): ActionRegistry {
  const reg = new ActionRegistry();
  reg.register("walk", walkAction);
  reg.register("jump", jumpAction);
  reg.register("hold", holdAction);
  reg.register("rest", holdAction);
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
     * skip_cmd_coercion is not modelled (save gap 12.6, WP-10). */
    if (!commanding && !NON_COERCION_COMMANDS.has(cmd.code)) {
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
  } while (energyUsed === 0 && !state.isDead && !state.generateLevel);

  return { needsInput: false, energyUsed };
}

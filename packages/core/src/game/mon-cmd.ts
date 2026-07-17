/**
 * Monster commanding, ported from Angband 4.2.6: get_commanded_monster
 * (mon-util.c L182), do_cmd_mon_command (cmd-cave.c L1755, the command
 * dispatch that drives the commanded monster while TMD_COMMAND runs) and
 * monster_attack_monster (mon-attack.c L765, the monster-vs-monster blow
 * loop the commanded walk uses). EF_COMMAND itself (the spell that starts
 * the possession) lives in effect-general.ts with the other
 * effect-handler-general.c handlers.
 *
 * While TMD_COMMAND is active, upstream swaps the player's command list
 * (cmd-core.c L333) so the movement/hold/read/cast/drop keys drive the
 * monster; processPlayer mirrors that with the state.monCommand hook this
 * module installs. Reductions, ledgered in parity/ledger/game-mon-cmd.yaml:
 * monster names are the race name (MDESC, #25); the cast branch uses the
 * player's current target instead of re-prompting (get_aim_dir is UI);
 * the drop branch no-ops (monster-held objects are not modelled); the
 * blow loop lands damage, criticals and stun (the mon-blow-effects
 * monster-target side effects reduce to their damage).
 */

import { FEAT, MON_MSG, MON_TMD, RF, TMD } from "../generated";
import { MDESC, MDESC_STANDARD, MDESC_TARG, monsterDesc } from "../mon/desc";
import { formatMonsterMessage } from "./mon-message";
import { DDGRID, loc, locSum } from "../loc";
import type { Loc } from "../loc";
import type { Monster } from "../mon/monster";
import { getLore, loreCountU16, loreCountU8, loreUpdate } from "../mon/lore";
import { monsterIsVisible } from "../mon/predicate";
import { monTakeHit } from "../mon/take-hit";
import {
  MON_TMD_FLG_NOTIFY,
  monClearTimed,
  monIncTimed,
} from "../mon/timed";
import { monSpellIsInnate } from "../mon/spell";
import { STUN_DAM_REDUCTION } from "../combat/hit";
import {
  chanceOfMonsterHit,
  checkHit,
  monsterCritical,
} from "../combat/mon-melee";
import type { GameState, PlayerCommand } from "./context";
import { deleteMonster, monsterSwap, squareMonster } from "./context";
import { monsterPrimaryGroupSize } from "./mon-group";
import { doMonSpell } from "./mon-cast";
import type { DoMonSpellDeps } from "./mon-cast";
import { chooseAttackSpell } from "./mon-ranged";
import { squareDoorPower, squareSetDoorLock } from "./trap";
import type { TrapDeps } from "./trap";

/**
 * get_commanded_monster (mon-util.c L182): the (single) monster under the
 * player's command, or null.
 */
export function getCommandedMonster(state: GameState): Monster | null {
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon || !mon.race) continue;
    if (mon.mTimed[MON_TMD.COMMAND]) return mon;
  }
  return null;
}

/**
 * monster_attack_monster (mon-attack.c L765): the commanded monster's
 * blows against another monster - hit vs the target's racial AC, the
 * stun-reduced damage, the critical-tier stun, and death without player
 * experience (mon_take_nonplayer_hit). Returns false only for
 * RF_NEVER_BLOW.
 */
export function monsterAttackMonster(
  state: GameState,
  mon: Monster,
  tMon: Monster,
): boolean {
  if (mon.race.flags.has(RF.NEVER_BLOW)) return false;

  const rlev = mon.race.level >= 1 ? mon.race.level : 1;
  const stunned = (mon.mTimed[MON_TMD.STUN] ?? 0) > 0;
  /* Get the monster names (or "it") (mon-attack.c L778-779). */
  const name = monsterDesc(mon, MDESC_STANDARD);
  const tName = monsterDesc(tMon, MDESC_TARG);

  for (const blow of mon.race.blows) {
    if (!blow.method) break;
    /* The target died to an earlier blow. */
    if (!state.monsters[tMon.midx]) break;

    const grid = tMon.grid;
    const effectName = blow.effect.name;
    const hit =
      effectName === "NONE" ||
      checkHit(
        state.rng,
        chanceOfMonsterHit(mon, mon.race.level, blow.effect.power),
        { ac: tMon.race.ac, toA: 0 },
      );

    if (!hit) {
      /* Visible monster missed monster, so notify if appropriate. */
      if (monsterIsVisible(mon) && blow.method.miss) {
        state.msg?.(`${name} misses ${tName}.`);
      }
      continue;
    }

    /* Roll dice, reduce when the attacker is stunned. */
    const diceRv = blow.dice
      ? blow.dice.randomValue()
      : { base: 0, dice: 0, sides: 0, mBonus: 0 };
    let damage = blow.dice ? state.rng.randcalc(diceRv, rlev, "randomise") : 0;
    if (stunned) {
      damage = Math.trunc((damage * (100 - STUN_DAM_REDUCTION)) / 100);
    }

    /* Apply the damage (mon_take_nonplayer_hit: death without player
     * experience; the monster-target blow side effects reduce to it). */
    if (damage > 0) {
      const res = monTakeHit(state.rng, tMon, damage, "", {
        /* become_aware: a commanded monster's blow can reveal a camouflaged
         * target, same as any other monster-vs-monster hit. */
        ...(state.becomeAware ? { becomeAware: state.becomeAware } : {}),
        /* The fear roll's per-member group save (mon-predicate.c L296). */
        primaryGroupSize: () => monsterPrimaryGroupSize(state, tMon),
      });
      if (res.died) {
        /* add_monster_message(t_mon, MON_MSG_DIE): the MON_MSG grammar. */
        if (monsterIsVisible(tMon)) {
          const text = formatMonsterMessage(tMon, MON_MSG.DIE);
          if (text) state.msg?.(text);
        }
        deleteMonster(state, tMon.midx);
        continue;
      }
    }

    /* Handle stun (the critical tiers). */
    if (blow.method.stun && squareMonster(state, grid)) {
      const tier = monsterCritical(state.rng, diceRv, rlev, damage);
      let amt = 0;
      switch (tier) {
        case 0:
          amt = 0;
          break;
        case 1:
          amt = state.rng.randint1(5);
          break;
        case 2:
          amt = state.rng.randint1(10) + 10;
          break;
        case 3:
          amt = state.rng.randint1(20) + 20;
          break;
        case 4:
          amt = state.rng.randint1(30) + 30;
          break;
        case 5:
          amt = state.rng.randint1(40) + 40;
          break;
        case 6:
          amt = 100;
          break;
        default:
          amt = 200;
          break;
      }
      if (amt) monIncTimed(state.rng, tMon, MON_TMD.STUN, amt, 0);
    }
  }

  return true;
}

/** Release the commanded monster ('r' while commanding). */
function releaseCommand(state: GameState, mon: Monster): void {
  monClearTimed(state.rng, mon, MON_TMD.COMMAND, MON_TMD_FLG_NOTIFY);
  state.actor.player.timed[TMD.COMMAND] = 0;
}

/**
 * The commanded walk (cmd-cave.c CMD_WALK): attack an intervening
 * monster, move through the open, or deal with walls and doors by racial
 * ability (learning those flags on a visible monster). Returns whether
 * the turn is spent.
 */
function commandedWalk(
  state: GameState,
  mon: Monster,
  dir: number,
  trapDeps: TrapDeps | null,
): boolean {
  const c = state.chunk;
  const lore = getLore(state.lore, mon.race);
  /* monster_desc(mon, MDESC_CAPITAL | MDESC_IND_HID | MDESC_COMMA)
   * (cmd-cave.c L1798). */
  const name = monsterDesc(mon, MDESC.CAPITAL | MDESC.IND_HID | MDESC.COMMA);
  const grid = locSum(mon.grid, DDGRID[dir] ?? loc(0, 0));
  let canMove = false;
  let hasHit = false;

  /* Don't let immobile monsters be moved. */
  if (mon.race.flags.has(RF.NEVER_MOVE)) {
    state.msg?.("The monster can not move.");
    return false;
  }

  if (!c.inBounds(grid)) return false;

  const tMon = squareMonster(state, grid);
  if (tMon) {
    /* Attack the monster. */
    if (monsterAttackMonster(state, mon, tMon)) hasHit = true;
  } else if (c.isPassable(grid)) {
    /* Floor is open? */
    canMove = true;
  } else if (c.isPerm(grid)) {
    /* Permanent wall in the way. */
    canMove = false;
  } else {
    /* Some kind of feature in the way: learn about wall abilities now. */
    if (monsterIsVisible(mon)) {
      lore.flags.on(RF.PASS_WALL);
      lore.flags.on(RF.KILL_WALL);
      lore.flags.on(RF.SMASH_WALL);
    }

    if (mon.race.flags.has(RF.PASS_WALL)) {
      canMove = true;
    } else if (
      mon.race.flags.has(RF.KILL_WALL) ||
      mon.race.flags.has(RF.SMASH_WALL)
    ) {
      /* Remove the wall (square_destroy_wall / square_smash_wall). */
      c.setFeat(grid, FEAT.FLOOR);
      canMove = true;
    } else if (c.feat(grid) === FEAT.CLOSED || c.feat(grid) === FEAT.SECRET) {
      const canOpen = mon.race.flags.has(RF.OPEN_DOOR);
      const canBash = mon.race.flags.has(RF.BASH_DOOR);

      /* Learn about door abilities. */
      if (monsterIsVisible(mon)) {
        lore.flags.on(RF.OPEN_DOOR);
        lore.flags.on(RF.BASH_DOOR);
      }

      if (canBash || canOpen) {
        const k = trapDeps ? squareDoorPower(state, grid, trapDeps) : 0;
        if (k > 0 && trapDeps) {
          /* Test strength against door strength. */
          if (state.rng.randint0(Math.trunc(mon.hp / 10)) > k) {
            state.msg?.(
              canBash
                ? `${name} slams against the door.`
                : `${name} fiddles with the lock.`,
            );
            /* Reduce the power of the door by one. */
            squareSetDoorLock(state, grid, k - 1, trapDeps);
          }
        } else if (canBash) {
          /* Closed or secret door: bash (square_smash_door). */
          c.setFeat(grid, FEAT.BROKEN);
          state.msg?.("You hear a door burst open!");
          canMove = true;
        } else {
          c.setFeat(grid, FEAT.OPEN);
          canMove = true;
        }
      }
    }
  }

  if (hasHit) return true;
  if (canMove) {
    monsterSwap(state, mon.grid, grid);
    state.updateFov?.(state);
    return true;
  }
  state.msg?.("The way is blocked.");
  return true;
}

/**
 * The commanded cast (cmd-cave.c CMD_CAST): pick a random spell from the
 * monster's full list and cast it at the player's target monster,
 * remembering what it did. The interactive re-targeting prompt is UI; the
 * current target stands in.
 */
function commandedCast(
  state: GameState,
  mon: Monster,
  deps: DoMonSpellDeps,
): boolean {
  const seen = !((state.actor.player.timed[TMD.BLIND] ?? 0) > 0);

  /* Choose a target monster (the player's current target). */
  const tMon = targetMonster(state);
  if (!tMon || tMon === mon) {
    state.msg?.("No target monster selected!");
    return false;
  }
  mon.target.midx = tMon.midx;

  /* Pick a random spell and cast it. */
  const f = mon.race.spellFlags.clone();
  const spellIndex = chooseAttackSpell(state, f, true, true);
  if (!spellIndex) {
    state.msg?.("This monster has no spells!");
    return false;
  }
  doMonSpell(state, mon.midx, spellIndex, seen, deps);

  /* Remember what the monster did. */
  const lore = getLore(state.lore, mon.race);
  if (seen) {
    lore.spellFlags.on(spellIndex);
    loreCountU8(lore, monSpellIsInnate(spellIndex) ? "castInnate" : "castSpell");
  }
  if (state.isDead) loreCountU16(lore, "deaths");
  loreUpdate(mon.race, lore);
  return true;
}

/** target_get_monster without importing game/target (no cycle risk). */
function targetMonster(state: GameState): Monster | null {
  return state.monsters[state.target.midx] ?? null;
}

/**
 * do_cmd_mon_command (cmd-cave.c L1755): drive the commanded monster with
 * the player's command. Returns the energy spent (0 = free, as upstream's
 * early returns).
 */
export function doCmdMonCommand(
  state: GameState,
  cmd: PlayerCommand,
  deps: DoMonSpellDeps,
): number {
  const mon = getCommandedMonster(state);
  if (!mon) return 0;

  switch (cmd.code) {
    case "read": {
      /* Actually 'r'elease monster. */
      releaseCommand(state, mon);
      break;
    }
    case "cast": {
      if (!commandedCast(state, mon, deps)) return 0;
      break;
    }
    case "drop": {
      /* Monster-held objects are not modelled; nothing to drop. */
      break;
    }
    case "hold":
    case "rest": {
      /* Do nothing. */
      break;
    }
    case "walk": {
      const dir = cmd.dir ?? 5;
      if (!commandedWalk(state, mon, dir, deps.general?.trapDeps ?? null)) {
        return 0;
      }
      break;
    }
    default: {
      state.msg?.(
        "Valid commands: move, stand still, 'd'rop, 'm'agic, or 'r'elease.",
      );
      return 0;
    }
  }

  /* Take a turn. */
  return state.z.moveEnergy;
}

/**
 * Install do_cmd_mon_command as the state's monCommand hook (upstream
 * swaps the command list while TMD_COMMAND runs; processPlayer routes
 * commands here instead).
 */
export function installMonCommand(
  state: GameState,
  deps: DoMonSpellDeps,
): void {
  state.monCommand = (s, cmd): number => doCmdMonCommand(s, cmd, deps);
}

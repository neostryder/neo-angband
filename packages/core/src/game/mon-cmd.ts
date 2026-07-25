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
 * the drop branch no-ops (monster inventory drop; held-object theft via
 * EAT_ITEM mon-vs-mon is wired). The blow loop runs the mon-target RBE
 * handlers (armour, elemental, timed, SHATTER quake/thrust, EAT_ITEM steal).
 */

import { EF, FEAT, MON_MSG, MON_TMD, MSG, RF, TMD } from "../generated";
import { EffectRegistry, sourceMonster } from "../effects/interpreter";
import { MDESC, MDESC_STANDARD, MDESC_TARG, monsterDesc } from "../mon/desc";
import type { BlowMethod } from "../mon/types";
import { DDGRID, loc, locSum } from "../loc";
import type { Loc } from "../loc";
import type { Monster } from "../mon/monster";
import { monsterCarry } from "../mon/make";
import { getLore, loreCountU16, loreCountU8, loreUpdate } from "../mon/lore";
import { monsterIsVisible } from "../mon/predicate";
import { stealMonsterItem } from "../mon/steal";
import {
  MON_TMD_FLG_NOTIFY,
  monClearTimed,
  monIncTimed,
} from "../mon/timed";
import { monSpellIsInnate } from "../mon/spell";
import { STUN_DAM_REDUCTION } from "../combat/hit";
import {
  adjustDamArmor,
  chanceOfMonsterHit,
  checkHit,
  monsterCritical,
} from "../combat/mon-melee";
import type { GameState, PlayerCommand } from "./context";
import { monsterSwap, squareMonster } from "./context";
import { doMonSpell } from "./mon-cast";
import type { DoMonSpellDeps } from "./mon-cast";
import { chooseAttackSpell } from "./mon-ranged";
import { buildEffectContext } from "./effect-env";
import { attachGameEnv } from "./effect-game-env";
import { registerTerrainHandlers } from "./effect-terrain";
import {
  getNonplayerHitDeps,
  monTakeNonplayerHit,
} from "./mon-death";
import { basicPlayerActor } from "./project-cast";
import { thrustAway } from "./thrust";
import { squareDoorPower, squareSetDoorLock } from "./trap";
import type { TrapDeps } from "./trap";

/** Trailing punct that suppresses MDESC_COMMA after {target} (mon-blows.c L76). */
const BLOW_PUNCT = ".!?;:,'";

/**
 * display_blow_message_vs_monster (mon-blows.c L225) + monster_blow_method_action
 * with midx > 0 (L74-152): draw randint0(num_messages), substitute mon-target
 * tags, emit "m_name act." through msgt(method->msgt, ...) - the typed-message
 * seam (text + type) and the sound channel (mon-cast.ts spell_message pattern).
 */
function displayBlowMessageVsMonster(
  state: GameState,
  method: BlowMethod,
  mName: string,
  tMon: Monster,
): void {
  const n = method.messages.length;
  if (n === 0) return;
  const choice = state.rng.randint0(n);
  const raw = method.messages[choice] ?? method.messages[0]!;
  /* Resolve {target}/{oftarget}/{has} for a monster target (midx > 0). */
  let act = "";
  let i = 0;
  while (i < raw.length) {
    const open = raw.indexOf("{", i);
    if (open < 0) {
      act += raw.slice(i);
      break;
    }
    act += raw.slice(i, open);
    const close = raw.indexOf("}", open + 1);
    if (close < 0) {
      act += raw.slice(open);
      break;
    }
    const tag = raw.slice(open + 1, close);
    const after = raw[close + 1] ?? "";
    if (tag === "target") {
      let mode = MDESC_TARG;
      if (!BLOW_PUNCT.includes(after)) mode |= MDESC.COMMA;
      act += monsterDesc(tMon, mode);
    } else if (tag === "oftarget") {
      act += monsterDesc(tMon, MDESC_TARG | MDESC.POSS);
    } else if (tag === "has") {
      act += "has";
    } else {
      act += raw.slice(open, close + 1);
    }
    i = close + 1;
  }
  const fullstop = act.endsWith("'") || act.endsWith("!") ? "" : ".";
  const text = `${mName} ${act}${fullstop}`;
  /* msgt(method->msgt, ...) (mon-blows.c L236): type + sound. */
  const msgt = method.msgt || undefined;
  state.msg?.(text, msgt);
  if (msgt) {
    state.sound?.((MSG as Record<string, number>)[msgt] ?? 0);
  }
}

/**
 * monster_elemental_damage (mon-blows.c L311): mon-target elemental component
 * (no RNG). Learns the imm/hurt lore flags, returns elemental damage and the
 * hurt/die message codes for mon_take_nonplayer_hit.
 */
function monsterElementalDamage(
  state: GameState,
  tMon: Monster,
  type: "ACID" | "ELEC" | "FIRE" | "COLD" | "POIS",
  baseDamage: number,
): { damage: number; hurtMsg: number; dieMsg: number } {
  let immFlag: number | null = null;
  let hurtFlag: number | null = null;
  let hurtMsg: number = MON_MSG.NONE;
  let dieMsg: number = MON_MSG.DIE;

  switch (type) {
    case "ACID":
      immFlag = RF.IM_ACID;
      break;
    case "ELEC":
      immFlag = RF.IM_ELEC;
      break;
    case "FIRE":
      immFlag = RF.IM_FIRE;
      hurtFlag = RF.HURT_FIRE;
      hurtMsg = MON_MSG.CATCH_FIRE;
      dieMsg = MON_MSG.DISINTEGRATES;
      break;
    case "COLD":
      immFlag = RF.IM_COLD;
      hurtFlag = RF.HURT_COLD;
      hurtMsg = MON_MSG.BADLY_FROZEN;
      dieMsg = MON_MSG.FREEZE_SHATTER;
      break;
    case "POIS":
      immFlag = RF.IM_POIS;
      break;
  }

  /* rf_on(lore->flags, imm_flag) / hurt_flag (mon-blows.c L351-354). */
  const lore = getLore(state.lore, tMon.race);
  if (immFlag !== null) lore.flags.on(immFlag);
  if (hurtFlag !== null) lore.flags.on(hurtFlag);

  if (immFlag !== null && tMon.race.flags.has(immFlag)) {
    return {
      damage: Math.trunc(baseDamage / 9),
      hurtMsg: MON_MSG.RESIST_A_LOT,
      dieMsg: MON_MSG.DIE,
    };
  }
  if (hurtFlag !== null && tMon.race.flags.has(hurtFlag)) {
    return { damage: baseDamage * 2, hurtMsg, dieMsg };
  }
  return { damage: baseDamage, hurtMsg: MON_MSG.NONE, dieMsg: MON_MSG.DIE };
}

/**
 * mon_take_nonplayer_hit (mon-util.c L1193) via mon-death.ts when the session
 * installed deps; otherwise a loot-free mon_take_nonplayer_hit shape so harness
 * callers still get unique/arena cap, wake, pain/hurt, fear and delete.
 */
function applyMonVsMonHit(
  state: GameState,
  tMon: Monster,
  damage: number,
  hurtMsg: number,
  dieMsg: number,
): boolean {
  const deps = getNonplayerHitDeps(state);
  if (deps) {
    return monTakeNonplayerHit(state, tMon, damage, hurtMsg, dieMsg, deps);
  }
  /* Harness fallback: mon_take_nonplayer_hit without monster_death loot. */
  return monTakeNonplayerHit(state, tMon, damage, hurtMsg, dieMsg, {
    makeDeps: null as never,
    reg: null as never,
    floorEnv: {},
    lore: state.lore,
    message: (text: string): void => {
      state.msg?.(text);
    },
  });
}

/**
 * effect_simple(EF_EARTHQUAKE, source_monster, "0", 0, radius)
 * (mon-blows.c L1098-1101). C always runs this for a surviving SHATTER hit with
 * damage > 23 based on game state alone - never on caller wiring. When the
 * live DoMonSpellDeps stack is present (installMonCommand), use its registry
 * and env. When absent (headless/tests), still run the real terrain
 * EF_EARTHQUAKE so the RNG draw count/order matches (decision 6.2 seed parity).
 */
function monVsMonEarthquake(
  state: GameState,
  mon: Monster,
  radius: number,
  deps: DoMonSpellDeps | null,
): void {
  if (deps) {
    const ctx = attachGameEnv(buildEffectContext(state, deps.envDeps), {
      state,
      cast: deps.cast,
      ...(deps.teleport ? { teleport: deps.teleport } : {}),
      ...(deps.general ? { general: deps.general } : {}),
      ...(deps.summon ? { summon: deps.summon } : {}),
    });
    deps.registry.effectSimple(EF.EARTHQUAKE, ctx, {
      origin: sourceMonster(mon.midx),
      diceString: "0",
      subtype: 0,
      radius,
    });
    return;
  }
  /* Wiring-free path: same effect_simple(EF_EARTHQUAKE) draws as C. */
  const registry = new EffectRegistry();
  registerTerrainHandlers(registry);
  const ctx = attachGameEnv(
    {
      rng: state.rng,
      ...(state.msg
        ? { messages: { msg: (text: string) => state.msg?.(text) } }
        : {}),
    },
    {
      state,
      cast: {
        projections: [],
        maxRange: 0,
        playerActor: basicPlayerActor(state),
      },
    },
  );
  registry.effectSimple(EF.EARTHQUAKE, ctx, {
    origin: sourceMonster(mon.midx),
    diceString: "0",
    subtype: 0,
    radius,
  });
}

/** EAT_ITEM mon-vs-mon: steal_monster_item(t_mon, mon->midx) (mon-blows.c L876). */
function monVsMonEatItem(state: GameState, mon: Monster, tMon: Monster): void {
  stealMonsterItem(state.rng, state.lore, tMon, mon.midx, {
    msg: (text: string): void => {
      state.msg?.(text);
    },
    monName: (m) => monsterDesc(m, MDESC_TARG),
    stealthSkill: 0,
    dexToHit: 0,
    playerSpeed: 0,
    statusPenalty: false,
    attRun: false,
    objectWeight: () => 0,
    isMoney: () => false,
    objectName: () => "",
    isIgnored: () => false,
    canCarry: () => false,
    gainGold: () => {},
    carry: () => {},
    dropStolen: () => {},
    thiefName: (midx) => {
      const thief = state.monsters[midx];
      return thief ? monsterDesc(thief, MDESC_STANDARD) : "It";
    },
    thiefCarry: (midx, obj): void => {
      const thief = state.monsters[midx];
      if (thief) monsterCarry(thief.heldObj, obj, midx);
    },
  });
}

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
 * monster_attack_monster (mon-attack.c L765): the commanded monster's blows
 * against another monster. Dispatches the mon-target branches of the RBE
 * handlers (mon-blows.c), hits vs racial AC, mon_take_nonplayer_hit for
 * damage, stun criticals, blow lore, and SHATTER quake/thrust. Per-handler
 * draw ORDER/COUNT matches mon-blows.c. `deps` is the live effect stack
 * (installMonCommand); SHATTER always runs EF_EARTHQUAKE when damage > 23
 * whether or not deps is present (mon-blows.c L1098-1101; seed parity 6.2).
 * Returns false only for RF_NEVER_BLOW.
 */
export function monsterAttackMonster(
  state: GameState,
  mon: Monster,
  tMon: Monster,
  deps: DoMonSpellDeps | null = null,
): boolean {
  if (mon.race.flags.has(RF.NEVER_BLOW)) return false;

  const lore = getLore(state.lore, mon.race);
  const rlev = mon.race.level >= 1 ? mon.race.level : 1;
  const stunned = (mon.mTimed[MON_TMD.STUN] ?? 0) > 0;
  /* Get the monster names (or "it") (mon-attack.c L778-779). */
  const name = monsterDesc(mon, MDESC_STANDARD);
  const tName = monsterDesc(tMon, MDESC_TARG);

  for (let apCnt = 0; apCnt < mon.race.blows.length; apCnt++) {
    const blow = mon.race.blows[apCnt]!;
    if (!blow.method) break;

    const grid = tMon.grid;
    /* visible = monster_is_visible(mon) || mon->race->light > 0 (L784). */
    const visible = monsterIsVisible(mon) || mon.race.light > 0;
    let obvious = false;
    let damage = 0;
    let doStun = false;

    const effectName = blow.effect.name;
    const method = blow.method;
    const hit =
      effectName === "NONE" ||
      checkHit(
        state.rng,
        chanceOfMonsterHit(mon, mon.race.level, blow.effect.power),
        { ac: tMon.race.ac, toA: 0 },
      );

    if (hit) {
      doStun = method.stun;
      /* Assume all attacks are obvious (mon-attack.c L807); handlers may keep it. */
      obvious = true;

      /* Roll dice, reduce when the attacker is stunned. */
      const diceRv = blow.dice
        ? blow.dice.randomValue()
        : { base: 0, dice: 0, sides: 0, mBonus: 0 };
      damage = blow.dice ? state.rng.randcalc(diceRv, rlev, "randomise") : 0;
      if (stunned) {
        damage = Math.trunc((damage * (100 - STUN_DAM_REDUCTION)) / 100);
      }

      const ac = tMon.race.ac;

      /*
       * Per-handler order (mon-blows.c):
       * - timed: randint1 amount BEFORE display_blow_message (arg eval)
       * - EXP_*: damroll(N,6) before message (arg eval; amount unused mon-side)
       * - elemental: message+hit only when final damage > 0
       * - HURT/SHATTER: adjust_dam_armor then message+hit (+ quake/thrust)
       * - EAT_ITEM: damage then steal_monster_item if target lives
       * - NONE: message only
       * - other player-only side effects: damage only on mon targets
       */
      let timedKey: number | null = null;
      let timedAmount = 0;
      if (effectName === "BLIND") {
        timedKey = MON_TMD.STUN;
        timedAmount = 10 + state.rng.randint1(rlev);
      } else if (effectName === "CONFUSE") {
        timedKey = MON_TMD.CONF;
        timedAmount = 3 + state.rng.randint1(rlev);
      } else if (effectName === "TERRIFY") {
        timedKey = MON_TMD.FEAR;
        timedAmount = 3 + state.rng.randint1(rlev);
      } else if (effectName === "PARALYZE") {
        timedKey = MON_TMD.HOLD;
        timedAmount = 3 + state.rng.randint1(rlev);
      }

      if (
        effectName === "EXP_10" ||
        effectName === "EXP_20" ||
        effectName === "EXP_40" ||
        effectName === "EXP_80"
      ) {
        const n =
          effectName === "EXP_10"
            ? 10
            : effectName === "EXP_20"
              ? 20
              : effectName === "EXP_40"
                ? 40
                : 80;
        void state.rng.damroll(n, 6);
      }

      let hurtMsg: number = MON_MSG.NONE;
      let dieMsg: number = MON_MSG.DIE;

      if (effectName === "NONE") {
        displayBlowMessageVsMonster(state, method, name, tMon);
      } else if (
        effectName === "ACID" ||
        effectName === "ELEC" ||
        effectName === "FIRE" ||
        effectName === "COLD" ||
        effectName === "POISON"
      ) {
        const elemType =
          effectName === "POISON"
            ? "POIS"
            : (effectName as "ACID" | "ELEC" | "FIRE" | "COLD");
        const physical = method.phys ? adjustDamArmor(damage, ac + 50) : 0;
        const el = monsterElementalDamage(state, tMon, elemType, damage);
        damage = physical > el.damage ? physical : el.damage;
        hurtMsg = el.hurtMsg;
        dieMsg = el.dieMsg;
        if (damage > 0) {
          displayBlowMessageVsMonster(state, method, name, tMon);
          applyMonVsMonHit(state, tMon, damage, hurtMsg, dieMsg);
        }
      } else if (effectName === "HURT") {
        damage = adjustDamArmor(damage, ac);
        displayBlowMessageVsMonster(state, method, name, tMon);
        applyMonVsMonHit(state, tMon, damage, hurtMsg, dieMsg);
      } else if (effectName === "SHATTER") {
        /* mon-blows.c L1086-1115. Earthquake is game-state gated only
         * (damage > 23), never wiring-gated: C always calls effect_simple
         * (EF_EARTHQUAKE) at L1098-1101 after a surviving hit. */
        damage = adjustDamArmor(damage, ac);
        displayBlowMessageVsMonster(state, method, name, tMon);
        if (!applyMonVsMonHit(state, tMon, damage, hurtMsg, dieMsg)) {
          if (damage > 23) {
            monVsMonEarthquake(state, mon, Math.trunc(damage / 12), deps);
          }
          if (damage > 100 && state.monsters[tMon.midx]) {
            const value = damage - 100;
            if (state.rng.randint1(value) > 40) {
              const dist = 1 + Math.trunc(value / 40);
              /* thrust_away(mon->grid, t_mon->grid, dist) (L1112). */
              thrustAway(state, mon.grid, tMon.grid, dist, {
                ...(state.msg ? { msg: (t: string) => state.msg?.(t) } : {}),
              });
            }
          }
        }
      } else if (effectName === "EAT_ITEM") {
        /* mon-blows.c L847-878: damage then steal_monster_item if alive. */
        displayBlowMessageVsMonster(state, method, name, tMon);
        if (!applyMonVsMonHit(state, tMon, damage, hurtMsg, dieMsg)) {
          monVsMonEatItem(state, mon, tMon);
        }
      } else {
        /* DISENCHANT / DRAIN_CHARGES / EAT_* / LOSE_* / EXP_* / HALLU /
         * BLACK_BREATH / timed: mon-target is damage (+ timed mon status). */
        displayBlowMessageVsMonster(state, method, name, tMon);
        if (!applyMonVsMonHit(state, tMon, damage, hurtMsg, dieMsg)) {
          if (timedKey !== null && state.monsters[tMon.midx]) {
            monIncTimed(state.rng, tMon, timedKey, timedAmount, 0);
          }
        }
      }

      /* Handle stun (the critical tiers) (mon-attack.c L844-863). */
      if (doStun && squareMonster(state, grid)) {
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
        const still = squareMonster(state, grid);
        if (amt && still) monIncTimed(state.rng, still, MON_TMD.STUN, amt, 0);
      }
    } else {
      /* Visible monster missed monster, so notify if appropriate. */
      if (monsterIsVisible(mon) && method.miss) {
        state.msg?.(`${name} misses ${tName}.`);
      }
    }

    /* Analyze "visible" monsters only (mon-attack.c L872-880). */
    if (visible) {
      const seen = lore.blowTimesSeen[apCnt] ?? 0;
      if (obvious || damage || seen > 10) {
        if (seen < 255) {
          if (lore.blowTimesSeen.length <= apCnt) {
            while (lore.blowTimesSeen.length <= apCnt) lore.blowTimesSeen.push(0);
          }
          lore.blowTimesSeen[apCnt] = seen + 1;
        }
      }
    }

    /* Skip remaining blows if the target moved or died (L882-883). */
    if (!squareMonster(state, grid)) break;
  }

  /* Learn lore (mon-attack.c L898). */
  loreUpdate(mon.race, lore);

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
  spellDeps: DoMonSpellDeps | null,
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
    if (monsterAttackMonster(state, mon, tMon, spellDeps)) hasHit = true;
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
      if (
        !commandedWalk(
          state,
          mon,
          dir,
          deps.general?.trapDeps ?? null,
          deps,
        )
      ) {
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

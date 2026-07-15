/**
 * borg_think_dungeon - the priority-ordered decision ladder
 * (reference/src/borg/borg-think-dungeon.c) plus its helpers from
 * borg-think-dungeon-util.c (borg_leave_level, borg_think_dungeon_light,
 * borg_think_stair_scum, borg_money_scum, borg_excavate_vault) and the two
 * scum modes (borg_think_dungeon_lunal / _munchkin).
 *
 * THE ORDER IS LOAD-BEARING. Each stage is transcribed in its exact upstream
 * position with a file:line citation; the first stage that yields a command
 * wins. A stage calls an already-ported subsystem entry (flow / danger / fight /
 * item / store); the few C helpers whose subsystem functions are not part of the
 * P8.1-P8.7 ported surface are represented in-position as documented yielding
 * stubs (see NOT-YET-PORTED below) so the ladder shape stays faithful.
 *
 * NOT-YET-PORTED subsystem calls (represented as ladder stages that yield):
 *   borg_swap_rings / borg_wear_rings / borg_wear_recharge / borg_dump_quiver
 *     (borg-item-wear.c), borg_drop_hole / borg_drop_slow / borg_destroy_floor
 *     (borg-junk.c), borg_play_magic (borg-magic-play.c). borg_drop_junk is
 *     mapped to the ported borgCrushJunk (borg-junk.c's junk-dropping routine).
 *   borg_must_return_to_town (borg-prepared.c) is approximated by borgRestock.
 *
 * SCUM MODES. borg_think_dungeon_lunal / _munchkin and borg_money_scum are
 * gated by the borg config flags BORG_SELF_LUNAL / BORG_MUNCHKIN_START /
 * BORG_MONEY_SCUM_AMOUNT, all of which are off (0/false) under this port's stock
 * config with no createBorg switch to enable them; the corresponding quick-check
 * blocks (borg-think-dungeon.c:1465-1497) are therefore not wired (dead under
 * stock config) and borgMoneyScum below yields. borg_think_stair_scum IS wired
 * (fleeing-to-town depth-1 path).
 *
 * All randomness draws from ctx.rng (determinism ratchet).
 */

import type { AgentCommand } from "@neo-angband/core";
import { FEAT } from "@neo-angband/core";
import type { BorgContext } from "./context";
import { distance } from "./think";
import {
  BI,
  borgNotice,
  borgPrepared,
  borgRestock,
} from "./trait";
import {
  GOAL_BORE,
  GOAL_FLEE,
  GOAL_KILL,
  GOAL_TAKE,
  GOAL_MISC,
  GOAL_DARK,
  GOAL_XTRA,
  GOAL_VAULT,
  GOAL_DIGGING,
  GOAL_RECOVER,
} from "./world/model";
import { borgFlowOld } from "./flow";
import {
  borgAttack,
  borgCaution,
  borgDefend,
  borgPermaSpell,
  borgRecall,
  borgAllowTeleport,
  borgDimensionDoor,
  borgShadowShift,
  getFightState,
} from "./fight";
import { getDangerGlobals, borgDanger } from "./danger";
import {
  BorgNeed,
  borgMaintainLight,
  borgUseThings,
  borgWearStuff,
  borgRemoveStuff,
  borgCrushJunk,
  borgRecover,
  borgTestStuff,
  borgEnchanting,
  borgRecharging,
  borgCheckLightOnly,
  borgLightBeam,
  borgSpell,
  borgReadScroll,
  borgUseStaff,
  borgActivateItem,
  Spell,
  SVAL,
  TV,
} from "./item";
import { borgChooseShop, borgCountSell } from "./store";
import {
  buildItemDeps,
  buildStoreDeps,
  type ThinkSession,
} from "./think-session";
import { borgNearMonsterType } from "./perceive-facts";

/* ------------------------------------------------------------------ helpers */

/** trait[BI_X] with a 0 default (borg.trait[BI_X]). */
function T(ctx: BorgContext, i: BI): number {
  return ctx.world.self.trait[i] ?? 0;
}

/** The feature the borg stands on (borg_grids[borg.c.y][borg.c.x].feat). */
function standingFeat(ctx: BorgContext): number {
  const w = ctx.world;
  return w.map.at(w.self.c.x, w.self.c.y).feat;
}

/** Chebyshev distance to the nearest tracked coordinate, or -1 if none. */
function nearestTrackDist(
  ctx: BorgContext,
  track: { num: number; x: number[]; y: number[] },
): number {
  const w = ctx.world;
  let best = -1;
  for (let i = 0; i < track.num; i++) {
    const d = distance(w.self.c.x, w.self.c.y, track.x[i]!, track.y[i]!);
    if (best === -1 || d < best) best = d;
  }
  return best;
}

/** borg_must_return_to_town approximation (borg-prepared.c:828 via restock). */
function mustReturnToTown(ctx: BorgContext): string | null {
  return borgRestock(ctx, T(ctx, BI.CDEPTH));
}

/**
 * NOT-YET-PORTED ladder stages (see file header). Each keeps its exact position
 * in the ladder but yields, awaiting the subsystem port. Split out so the ladder
 * body reads as the faithful transcription it is.
 */
const NOT_PORTED: () => AgentCommand | null = () => null;

/* --------------------------------------------------------- borg_leave_level */

/** borg_time_to_stay_on_level (borg-think-dungeon-util.c:569). */
function timeToStayOnLevel(ctx: BorgContext, bored: boolean): number {
  const clevel = T(ctx, BI.CLEVEL);
  // borg_feeling_stuff is 0 in the port (no level-feeling stream); the C's
  // borg_stuff_feeling[0] == 50000 governs the not-yet-felt case.
  const STUFF0 = 50000;
  if (clevel < 5) {
    if (clevel < 10) return clevel * 50;
    if (clevel < 15 && T(ctx, BI.FOOD) < 3) return T(ctx, BI.REG) ? 2000 : 2500;
    // z_info->feeling_need * 10 (feeling_need is 10 in 4.2.6) for low maxlevel.
    if (T(ctx, BI.MAXCLEVEL) < 20) return 100;
  }
  return bored ? STUFF0 / 10 : STUFF0;
}

/**
 * borg_leave_level (borg-think-dungeon-util.c:597): decide whether/how to leave
 * the level, setting goal.rising / stairLess / stairMore and flowing to stairs.
 */
export function borgLeaveLevel(
  ctx: BorgContext,
  session: ThinkSession,
  bored: boolean,
): AgentCommand | null {
  const w = ctx.world;
  const self = w.self;
  const g = self.goal;
  const flow = session.flow;
  let dir = 0;

  /* Waiting for recall other than depth 1 (util:605). */
  if (g.recalling && T(ctx, BI.CDEPTH) !== 1) return null;

  /* Town (util:633). */
  if (!T(ctx, BI.CDEPTH)) {
    g.rising = false;
    if (!bored) return null;

    /* Recall into dungeon if deep enough and have recalls (util:663). */
    if (
      T(ctx, BI.MAXDEPTH) >= 8 &&
      T(ctx, BI.RECALL) >= 3 &&
      borgPrepared(ctx, Math.trunc((T(ctx, BI.MAXDEPTH) * 6) / 10)) === null
    ) {
      const rc = borgRecall(ctx);
      if (rc) return rc;
    }
    g.fleeing = true;
    g.leaving = true;
    self.stairMore = true;
    return flow.toStairs(ctx, true, GOAL_BORE, false, false);
  }

  /** In the dungeon (util:708). */
  const prepCur = borgPrepared(ctx, T(ctx, BI.CDEPTH));
  const prepNext = borgPrepared(ctx, T(ctx, BI.CDEPTH) + 1);

  if (prepCur !== null) dir = -1;

  const sellCount = borgCountSell(ctx, buildStoreDeps(session));
  let tryNotToDescend = false;
  if (sellCount >= 12) tryNotToDescend = true;
  if (dir && T(ctx, BI.ISFIXEXP)) tryNotToDescend = true;

  /* Rise if bored and unable to dive (util:731). */
  if (bored && prepNext !== null) {
    dir = -1;
  } else if (bored && getDangerGlobals(w).avoidance > T(ctx, BI.CURHP)) {
    dir = prepNext !== null ? -1 : 1;
  } else if (
    !tryNotToDescend &&
    borgPrepared(ctx, T(ctx, BI.CDEPTH) + 5) === null &&
    sellCount < 13
  ) {
    dir = 1; /* power dive, playing too shallow (util:748) */
  } else if (
    !tryNotToDescend &&
    prepNext === null &&
    T(ctx, BI.CDEPTH) >= 75 &&
    T(ctx, BI.CDEPTH) < 100
  ) {
    dir = 1; /* power dive, head deep */
  }

  /* Power-climb upwards when needed (util:764). */
  if (prepCur !== null) {
    if (!w.facts.uniqueOnLevel) {
      if (
        !dir &&
        borgPrepared(ctx, Math.trunc((T(ctx, BI.MAXDEPTH) * 5) / 10)) !== null &&
        T(ctx, BI.MAXDEPTH) > 65
      ) {
        g.rising = true;
      } else {
        dir = -1;
      }
    }
    if (mustReturnToTown(ctx) !== null) g.rising = true;
  }

  /* Playing too shallow -> town to recall deeper (util:796). */
  if (
    borgPrepared(ctx, T(ctx, BI.CDEPTH) + 20) === null &&
    borgPrepared(ctx, Math.trunc((T(ctx, BI.MAXDEPTH) * 6) / 10)) === null &&
    T(ctx, BI.MAXDEPTH) > T(ctx, BI.CDEPTH) + 20 &&
    (T(ctx, BI.RECALL) >= 3 || T(ctx, BI.GOLD) > 2000)
  ) {
    g.rising = true;
  }

  /* Return to town to sell (util:813). */
  if (bored && T(ctx, BI.MAXCLEVEL) >= 26 && sellCount >= 12) g.rising = true;
  if (T(ctx, BI.ISFIXLEV)) g.rising = true;
  if (bored && T(ctx, BI.ISFIXEXP) && T(ctx, BI.CLEVEL) !== 50) g.rising = true;

  /* Power dive if King / prepared for 99 (util:868). */
  if (T(ctx, BI.KING)) dir = 1;
  if (T(ctx, BI.CDEPTH) < 100 && borgPrepared(ctx, 99) === null) dir = 1;

  /* if returning to town, go up (util:883). */
  if (!dir && g.rising) dir = -1;

  /* Do not hang out on boring levels too long (util:895). */
  if (!dir && w.clock - flow.state.borgBegan > timeToStayOnLevel(ctx, bored)) {
    if (T(ctx, BI.MAXDEPTH) < 99 || !w.facts.uniqueOnLevel) {
      if (tryNotToDescend) dir = -1;
      else dir = ctx.rng.randint0(100) < 50 ? -1 : 1;
    }
  }

  /* Go Up (util:911). */
  if (dir < 0) {
    if (!flow.state.hooks.forceDescend) self.stairLess = true;
    if (g.rising && T(ctx, BI.CDEPTH) >= 5) {
      const rc = borgRecall(ctx);
      if (rc) return rc;
    }
    const up = flow.toStairs(ctx, false, GOAL_BORE, false);
    if (up) return up;
    if (flow.state.less.num === 0) dir = 1; /* no up stairs -> go down */
  }

  /* Go Down (util:963). */
  if (dir > 0) {
    self.stairMore = true;
    const dn = flow.toStairs(ctx, true, GOAL_BORE, false, false);
    if (dn) return dn;
  }

  return null;
}

/* -------------------------------------------------- borg_think_dungeon_light */

/**
 * borg_think_dungeon_light (borg-think-dungeon-util.c:147): survive running out
 * of light. Ported subset: consume food, refuel/wear light, recall/escape, take
 * up stairs, flee to stairs. The name-based Call-Light illumination pass needs
 * the detect/illuminate spell surface not in the ported item light API and is
 * documented as omitted (borgCheckLightOnly / borgLightBeam cover the ported
 * illumination path).
 */
export function borgThinkDungeonLight(
  ctx: BorgContext,
  session: ThinkSession,
): AgentCommand | null {
  const w = ctx.world;
  const deps = buildItemDeps(session);

  /* Consume needed things when hungry (util:153). */
  if (T(ctx, BI.ISHUNGRY)) {
    const eat = borgUseThings(ctx, deps);
    if (eat) return eat;
  }

  const noLight = !T(ctx, BI.LIGHT);
  if (noLight && T(ctx, BI.CDEPTH) >= 1) {
    /* Recalling: sit tight (util:163). */
    if (w.self.goal.recalling) return ctx.act.rest();

    /* Wear stuff and see if it glows (util:172). */
    const wear = borgWearStuff(ctx, deps);
    if (wear) return wear;

    /* Refuel / swap light (util:176). */
    const light = borgMaintainLight(ctx, deps);
    if (light.need === BorgNeed.MET_NEED && light.cmd) return light.cmd;
    if (light.need === BorgNeed.NO_NEED) return null;

    /* Recall out (util:183). */
    if (!w.self.goal.recalling) {
      const rc = borgRecall(ctx);
      if (rc) return rc;
    }

    /* On an up stair -> take it (util:194). */
    if (!session.flow.state.hooks.forceDescend && standingFeat(ctx) === FEAT.LESS) {
      return ctx.act.ascend();
    }

    /* Flee to stairs (util:322). */
    const flee = borgFlowOld(ctx, session.flow.state, GOAL_FLEE);
    if (flee) return flee;
    const up = session.flow.toStairs(ctx, false, GOAL_FLEE, false);
    if (up) {
      if (standingFeat(ctx) === FEAT.LESS) return ctx.act.ascend();
      return up;
    }
    /* Flow to a lit area (util:341). */
    if (T(ctx, BI.RECALL)) {
      const lit = session.flow.toLight(ctx, GOAL_FLEE);
      if (lit) return lit;
    }
  }
  return null;
}

/* ---------------------------------------------------------- borg_money_scum */

/**
 * borg_money_scum (borg-think-dungeon-util.c:64): rest in town waiting for the
 * townsfolk to breed, occasionally twitching. Gated by BORG_MONEY_SCUM_AMOUNT,
 * which defaults to 0 (off), so this yields under stock config.
 */
export function borgMoneyScum(ctx: BorgContext): AgentCommand | null {
  void ctx;
  return null; /* BORG_MONEY_SCUM_AMOUNT == 0 in the stock port config */
}

/* ---------------------------------------------- borg_think_dungeon (LADDER) */

/**
 * The main dungeon decision ladder. Returns the command for this think, or null
 * to yield (nothing productive to do this decision).
 */
export function borgThinkDungeon(
  ctx: BorgContext,
  session: ThinkSession,
): AgentCommand | null {
  const w = ctx.world;
  const self = w.self;
  const g = self.goal;
  const flow = session.flow;
  const st = flow.state;
  const fight = getFightState(w);
  const dg = getDangerGlobals(w);
  const itemDeps = buildItemDeps(session);

  /* HACK: clock-wrap guards (:1178, :1209). */
  if (
    (w.clock >= 12000 && w.clock <= 12025) ||
    (w.clock >= 25000 && w.clock <= 25025)
  ) {
    return ctx.act.hold();
  }

  /* if standing on something valueless, destroy it (:1205). Not ported (needs
   * floor-item valuation); yields. */
  {
    const cmd = NOT_PORTED();
    if (cmd) return cmd;
  }

  /* Prevent clock overflow -> panic (:1209): yield to a human. */
  if (w.clock >= 30000) return null;

  /* Boredom leaving/fleeing (:1247). */
  if (w.clock - st.borgBegan >= 10000) {
    g.leaving = true;
    g.fleeing = true;
  }

  /* Am I fighting a unique / summoner / scaryguy? (:1268). max_sight = 20. */
  borgNearMonsterType(ctx, T(ctx, BI.MAXCLEVEL) < 15 ? 20 : 12);

  /* Fleeing-to-town stair-scum on depth 1 (:1276). */
  if (T(ctx, BI.CDEPTH) === 1 && g.fleeingToTown) {
    const scum = borgThinkStairScum(ctx, session);
    if (scum) return scum;
    g.leaving = true;
    g.fleeing = true;
  }

  /* Bouncing-borg anti-loop (:1308). */
  if (T(ctx, BI.CDEPTH) && self.timeThisPanel >= 300 && self.timeThisPanel <= 303) {
    g.type = 0;
  }
  if (T(ctx, BI.CDEPTH) && self.timeThisPanel >= 500 && self.timeThisPanel <= 503) {
    w.takes.wipe();
    w.kills.wipe();
  }
  if (T(ctx, BI.CDEPTH) && self.timeThisPanel >= 700) {
    g.leaving = true;
    g.fleeing = true;
  }

  /* Count awake breeders (:1352). */
  let breeders = 0;
  const facts = getDangerGlobals(w).resolveFacts;
  for (const [i, k] of w.kills.entries()) {
    if (!k.awake) continue;
    if (facts(ctx, i).flags.has("MULTIPLY")) breeders += 1;
  }
  if (breeders >= 3) w.facts.breederLevel = true;

  /* Caution from breeders (:1376). */
  if (
    breeders >= Math.min(T(ctx, BI.CLEVEL) + 2, 5) &&
    (T(ctx, BI.RECALL) <= 0 || T(ctx, BI.CLEVEL) < 35)
  ) {
    if (!g.ignoring && w.clock >= 2500) g.ignoring = true;
    g.leaving = true;
    g.fleeing = true;
  }

  /* Reset avoidance (:1407). */
  if (dg.avoidance !== T(ctx, BI.CURHP)) {
    dg.avoidance = T(ctx, BI.CURHP);
    st.avoidance = T(ctx, BI.CURHP);
    st.borgDangerWipe = true;
  }

  /* Keep borg on a short leash if weak (:1418). */
  if (
    st.less.num &&
    (T(ctx, BI.MAXHP) < 30 || T(ctx, BI.CLEVEL) < 15) &&
    T(ctx, BI.CDEPTH) >= T(ctx, BI.CLEVEL) - 5
  ) {
    const bj = nearestTrackDist(ctx, st.less);
    const leash = T(ctx, BI.CLEVEL) * 3 + 14;
    if (!g.less && bj > leash) g.less = true;
    else if (g.less && bj !== -1 && bj < 3) {
      g.less = false;
      g.type = 0;
    }
  }

  /* Keep borg on a suitable level if too shallow-inexperienced (:1500). */
  if (
    st.less.num &&
    T(ctx, BI.CLEVEL) < 10 &&
    !g.less &&
    borgPrepared(ctx, T(ctx, BI.CDEPTH)) !== null
  ) {
    g.less = true;
    if (standingFeat(ctx) === FEAT.LESS && !st.hooks.forceDescend) {
      return ctx.act.ascend();
    }
  }

  /*** crucial goals ***/

  /* examine equipment and swaps (:1519). */
  borgNotice(ctx);

  /* require light (:1522). */
  {
    const cmd = borgThinkDungeonLight(ctx, session);
    if (cmd) return cmd;
  }

  /* Decrement no-retreat (:1526). */
  if (self.noRetreat > 0) self.noRetreat -= 1;

  /* Too twitchy -> flee (:1530). */
  if (self.timesTwitch > 20) g.fleeing = true;

  /*** Important goals ***/

  /* Continue flowing to an anti-summon grid (:1536). */
  {
    const cmd = borgFlowOld(ctx, st, GOAL_DIGGING);
    if (cmd) return cmd;
  }

  /* Try not to die (:1540). */
  {
    const cmd = borgCaution(ctx);
    if (cmd) return cmd;
  }

  /*** returning from dungeon in bad shape (:1544) ***/
  if (
    !T(ctx, BI.LIGHT) ||
    T(ctx, BI.ISCUT) ||
    T(ctx, BI.ISPOISONED) ||
    T(ctx, BI.FOOD) === 0
  ) {
    if (!T(ctx, BI.LIGHT)) {
      const light = borgMaintainLight(ctx, itemDeps);
      if (light.need === BorgNeed.MET_NEED && light.cmd) return light.cmd;
      const wear = borgWearStuff(ctx, itemDeps);
      if (wear) return wear;
    }
    const rec = borgRecover(ctx, itemDeps);
    if (rec) return rec;
    /* borg_drop_hole to make space: not ported. */
    if (borgChooseShop(ctx, buildStoreDeps(session))) {
      const shop = flow.toShop(ctx, g.shop);
      if (shop) return shop;
    }
  }

  /* if I must go to town without delay (:1573). */
  if (mustReturnToTown(ctx) !== null) {
    const cmd = borgLeaveLevel(ctx, session, false);
    if (cmd) return cmd;
  }

  /* Learn useful spells immediately (:1579): borg_play_magic not ported. */

  /* Wear a weapon if using a digger or nothing (:1582). */
  if (borgWieldIsDigger(ctx) || !borgHasWeapon(ctx)) {
    const cmd = borgWearStuff(ctx, itemDeps);
    if (cmd) return cmd;
  }

  /* Dig an anti-summon corridor (:1592). */
  {
    const cmd = flow.toKillCorridor(ctx);
    if (cmd) return cmd;
  }

  /* Attack monsters (:1596). */
  {
    const cmd = borgAttack(ctx, false);
    if (cmd) return cmd;
  }

  /* Wear/swap gear (:1601). borg_swap_rings / borg_wear_rings not ported. */
  {
    const cmd = borgWearStuff(ctx, itemDeps);
    if (cmd) return cmd;
  }

  /* Continue flowing to objects (:1609). */
  {
    const cmd = borgFlowOld(ctx, st, GOAL_TAKE);
    if (cmd) return cmd;
  }
  /* Find a really close object (:1613). */
  {
    const cmd = flow.toTakes(ctx, true, 5);
    if (cmd) return cmd;
  }

  /* Remove useless / detrimental gear (:1625). borg_dump_quiver not ported. */
  {
    const cmd = borgRemoveStuff(ctx, itemDeps);
    if (cmd) return cmd;
  }

  /* Check the light (:1631). */
  {
    const cmd = borgCheckLightOnly(ctx, itemDeps);
    if (cmd) return cmd;
  }

  /* Flow to a safe recover grid (:1635) and recover (:1639). */
  {
    const cmd = borgFlowOld(ctx, st, GOAL_RECOVER);
    if (cmd) return cmd;
  }
  {
    const cmd = borgRecover(ctx, itemDeps);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toRecover(ctx, 50);
    if (cmd) return cmd;
  }

  /* Perma spells (:1648). */
  {
    const cmd = borgPermaSpell(ctx);
    if (cmd) return cmd;
  }

  /* Stick near stairs when weak, rest to regain mana (:1652). */
  if (
    T(ctx, BI.CLEVEL) < 10 &&
    T(ctx, BI.MAXSP) &&
    T(ctx, BI.CURSP) === 0 &&
    self.noRestPrep <= 1 &&
    !self.temp.bless &&
    !self.temp.hero &&
    !self.temp.berserk &&
    !self.temp.fastcast
  ) {
    const track = T(ctx, BI.CDEPTH) ? st.less : st.more;
    for (let i = 0; i < track.num; i++) {
      if (self.c.y === track.y[i] && self.c.x === track.x[i]) {
        if (T(ctx, BI.CDEPTH)) g.less = false;
        if (borgDanger(ctx, self.c.y, self.c.x, 1, true, false) === 0) {
          return ctx.act.rest();
        }
      }
    }
    const flee = borgFlowOld(ctx, st, GOAL_FLEE);
    if (flee) return flee;
    const up = flow.toStairs(ctx, false, GOAL_FLEE, true);
    if (up) return up;
  }

  /* Town with no money and nothing to sell -> leave (:1720). */
  if (
    T(ctx, BI.CDEPTH) === 0 &&
    T(ctx, BI.CLEVEL) < 6 &&
    T(ctx, BI.GOLD) < 10 &&
    borgCountSell(ctx, buildStoreDeps(session)) < 5
  ) {
    g.leaving = true;
    const flee = borgFlowOld(ctx, st, GOAL_FLEE);
    if (flee) return flee;
    const dn = flow.toStairs(ctx, true, GOAL_FLEE, false, false);
    if (dn) return dn;
  }

  /*** Flee the level ***/

  /* Return to (but do not use) up stairs (:1737). */
  if (g.less) {
    const flee = borgFlowOld(ctx, st, GOAL_FLEE);
    if (flee) return flee;
    if (w.facts.scaryGuyOnLevel) {
      const both = flow.toStairsBoth(ctx, GOAL_FLEE, false);
      if (both) return both;
    }
    const up = flow.toStairs(ctx, false, GOAL_FLEE, false);
    if (up) return up;
  }

  /* Flee the level (:1754). */
  if (g.fleeing && !g.recalling) {
    self.stairLess = self.stairMore = true;
    if (st.hooks.forceDescend) self.stairLess = false;
    const flee = borgFlowOld(ctx, st, GOAL_FLEE);
    if (flee) return flee;
    if (w.facts.scaryGuyOnLevel) {
      const both = flow.toStairsBoth(ctx, GOAL_FLEE, false);
      if (both) return both;
    }
    const up = flow.toStairs(ctx, false, GOAL_FLEE, false);
    if (up) return up;
    const dn = flow.toStairs(ctx, true, GOAL_FLEE, false, false);
    if (dn) return dn;
  }

  /* Flee to a safe Morgoth grid / lay glyphs (:1782). */
  if (
    !T(ctx, BI.KING) &&
    w.facts.morgothOnLevel &&
    !dg.morgothPosition &&
    T(ctx, BI.AGLYPH) >= 10 &&
    !T(ctx, BI.ISBLIND) &&
    !T(ctx, BI.ISCONFUSED)
  ) {
    const flowMisc = borgFlowOld(ctx, st, GOAL_MISC);
    if (flowMisc) return flowMisc;
    const glyph = flow.toGlyph(ctx);
    if (glyph) return glyph;
  }

  /* Objects, veins, close monsters (:1797). */
  {
    const cmd = borgFlowOld(ctx, st, GOAL_TAKE);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toTakes(ctx, false, 5);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toVein(ctx, true, 5);
    if (cmd) return cmd;
  }
  {
    const cmd = borgFlowOld(ctx, st, GOAL_KILL);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toKills(ctx, 20, true);
    if (cmd) return cmd;
  }
  {
    const cmd = borgFlowOld(ctx, st, GOAL_TAKE);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toTakes(ctx, false, 10);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toVein(ctx, false, 10);
    if (cmd) return cmd;
  }
  {
    const cmd = borgFlowOld(ctx, st, GOAL_KILL);
    if (cmd) return cmd;
  }
  {
    const cmd = borgFlowOld(ctx, st, GOAL_VAULT);
    if (cmd) return cmd;
  }

  /* Line up a ranged shot (:1833). */
  {
    const cmd = flow.toKillAim(ctx, true);
    if (cmd) return cmd;
  }

  /*** inventory objects ***/

  /* Use things (:1842). */
  {
    const cmd = borgUseThings(ctx, itemDeps);
    if (cmd) return cmd;
  }
  /* Identify unknown things (:1846). */
  {
    const cmd = borgTestStuff(ctx, itemDeps);
    if (cmd) return cmd;
  }
  /* Enchant (:1850). */
  {
    const cmd = borgEnchanting(ctx, itemDeps);
    if (cmd) return cmd;
  }
  /* Recharge (:1854). */
  {
    const cmd = borgRecharging(ctx, itemDeps);
    if (cmd) return cmd;
  }
  /* Drop junk (:1858) -> ported borgCrushJunk. */
  {
    const cmd = borgCrushJunk(ctx, itemDeps);
    if (cmd) return cmd;
  }
  /* Drop items to make space / if slow (:1862, :1866): not ported. */

  /*** Flow towards objects (:1871) ***/
  {
    const cmd = borgFlowOld(ctx, st, GOAL_TAKE);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toTakes(ctx, true, 250);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toVein(ctx, true, 250);
    if (cmd) return cmd;
  }

  /*** Leave the level (:1884) ***/
  if (
    (g.leaving && !g.recalling && !w.facts.uniqueOnLevel) ||
    (T(ctx, BI.CDEPTH) &&
      T(ctx, BI.CLEVEL) < 25 &&
      T(ctx, BI.GOLD) < 25000 &&
      borgCountSell(ctx, buildStoreDeps(session)) >= 13)
  ) {
    if (self.readyMorgoth === 0 && !st.hooks.forceDescend) self.stairLess = true;
    if (borgPrepared(ctx, T(ctx, BI.CDEPTH) + 1) === null) self.stairMore = true;
    const flee = borgFlowOld(ctx, st, GOAL_FLEE);
    if (flee) return flee;
    if (self.stairLess) {
      const up = flow.toStairs(ctx, false, GOAL_FLEE, false);
      if (up) return up;
    }
    if (
      T(ctx, BI.CDEPTH) &&
      T(ctx, BI.CLEVEL) < 25 &&
      T(ctx, BI.GOLD) < 25000 &&
      borgCountSell(ctx, buildStoreDeps(session)) >= 13
    ) {
      self.stairMore = false;
    }
    if (self.stairMore) {
      const dn = flow.toStairs(ctx, true, GOAL_FLEE, false, false);
      if (dn) return dn;
    }
  }

  /* Power dive if too shallow (:1926). */
  if (
    T(ctx, BI.CDEPTH) !== 0 &&
    borgPrepared(ctx, T(ctx, BI.CDEPTH) + 5) === null &&
    !self.stairLess
  ) {
    self.stairMore = true;
    const bore = borgFlowOld(ctx, st, GOAL_BORE);
    if (bore) return bore;
    if (
      T(ctx, BI.CDEPTH) &&
      T(ctx, BI.CLEVEL) < 25 &&
      T(ctx, BI.GOLD) < 25000 &&
      borgCountSell(ctx, buildStoreDeps(session)) >= 13
    ) {
      self.stairMore = false;
    }
    if (self.stairMore) {
      const dn = flow.toStairs(ctx, true, GOAL_BORE, true, false);
      if (dn) return dn;
    }
  }

  /*** Exploration (:1950) ***/
  {
    const cmd = borgFlowOld(ctx, st, GOAL_MISC);
    if (cmd) return cmd;
  }
  {
    const cmd = borgFlowOld(ctx, st, GOAL_DARK);
    if (cmd) return cmd;
  }
  {
    const cmd = borgFlowOld(ctx, st, GOAL_XTRA);
    if (cmd) return cmd;
  }
  {
    const cmd = borgFlowOld(ctx, st, GOAL_BORE);
    if (cmd) return cmd;
  }
  {
    const cmd = borgFlowOld(ctx, st, GOAL_VAULT);
    if (cmd) return cmd;
  }

  /*** Explore the dungeon (:1998) ***/

  /* Chase old monsters/objects (:1998). */
  {
    const cmd = flow.toKills(ctx, 250, false);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toTakes(ctx, false, 250);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toVein(ctx, false, 250);
    if (cmd) return cmd;
  }

  /* Explore interesting grids (:2008). */
  {
    const cmd = flow.toDark(ctx, true);
    if (cmd) return cmd;
  }

  /* Leave the level if needed (:2012). */
  {
    const cmd = borgLeaveLevel(ctx, session, false);
    if (cmd) return cmd;
  }

  /* Explore far interesting grids (:2022). */
  {
    const cmd = flow.toDark(ctx, false);
    if (cmd) return cmd;
  }

  /*** Deal with shops (:2028) ***/
  if (borgChooseShop(ctx, buildStoreDeps(session))) {
    const shop = flow.toShop(ctx, g.shop);
    if (shop) return shop;
  }

  /*** Leave the level (:2037) ***/

  /* Study/test boring spells: borg_play_magic not ported. */

  /* Search for secret doors (:2047). */
  {
    const cmd = flow.spastic(ctx, false);
    if (cmd) return cmd;
  }
  /* Flow directly to a monster if unable to be spastic (:2051). */
  {
    const cmd = flow.toKillDirect(ctx, false);
    if (cmd) return cmd;
  }

  /* Recharge before leaving: borg_wear_recharge not ported. */

  /* Leave the level (:2059). */
  {
    const cmd = borgLeaveLevel(ctx, session, true);
    if (cmd) return cmd;
  }

  /* Search for secret doors again (:2079). */
  {
    const cmd = flow.spastic(ctx, true);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toKillDirect(ctx, false);
    if (cmd) return cmd;
  }

  /*** Wait for recall (:2089) ***/
  if (
    g.recalling &&
    borgDanger(ctx, self.c.y, self.c.x, 1, true, false) <= 0
  ) {
    return ctx.act.rest();
  }

  /*** Nothing to do ***/

  /* Not allowed to retreat for 5 rounds (:2116). */
  self.noRetreat = 5;

  /* Boost bravery (1): retry the brave subset (:2119). */
  if (dg.avoidance < T(ctx, BI.CURHP) * 2) {
    dg.avoidance = T(ctx, BI.CURHP) * 2;
    st.avoidance = dg.avoidance;
    st.borgDangerWipe = true;
    const done = borgThinkDungeonBrave(ctx, session);
    dg.avoidance = T(ctx, BI.CURHP);
    st.avoidance = dg.avoidance;
    st.borgDangerWipe = true;
    if (done) return done;
  }

  /* try phase before boosting further (:2151). */
  self.timesTwitch += 1;
  if (self.timesTwitch < 3 && borgAllowTeleport(ctx)) {
    const cmd =
      borgSpell(ctx, Spell.PHASE_DOOR) ??
      borgActivateItem(ctx, "act_tele_phase", itemDeps) ??
      borgReadScroll(ctx, SVAL.scroll.phase_door!, itemDeps) ??
      borgDimensionDoor(ctx, 90) ??
      borgSpell(ctx, Spell.TELEPORT_SELF) ??
      borgSpell(ctx, Spell.PORTAL) ??
      borgShadowShift(ctx, 90);
    if (cmd) return cmd;
  }

  self.noRetreat = 10;

  /* Boost bravery (2) (:2173). */
  if (dg.avoidance < T(ctx, BI.MAXHP) * 4) {
    dg.avoidance = T(ctx, BI.MAXHP) * 4;
    st.avoidance = dg.avoidance;
    st.borgDangerWipe = true;
    const done = borgThinkDungeonBrave(ctx, session);
    dg.avoidance = T(ctx, BI.CURHP);
    st.avoidance = dg.avoidance;
    st.borgDangerWipe = true;
    if (done) return done;
  }

  /* Boost bravery (3): reset level facts and retry (:2205). */
  if (dg.avoidance < 30000) {
    dg.avoidance = 30000;
    st.avoidance = dg.avoidance;
    st.borgDangerWipe = true;
    w.facts.uniqueOnLevel = 0;
    w.facts.scaryGuyOnLevel = false;
    w.facts.breederLevel = false;
    g.type = 0;
    if (!T(ctx, BI.CDEPTH)) g.rising = false;
    g.ignoring = false;
    st.less.wipe();
    st.more.wipe();
    st.glyph.wipe();
    st.step.wipe();
    st.door.wipe();
    st.closed.wipe();
    st.vein.wipe();
    w.takes.wipe();
    const done = borgThinkDungeonBrave(ctx, session);
    dg.avoidance = T(ctx, BI.CURHP);
    st.avoidance = dg.avoidance;
    st.borgDangerWipe = true;
    if (done) return done;
  }

  /* Teleport before acting goofy (:2274). */
  self.timesTwitch += 1;
  if (self.timesTwitch < 5 && borgAllowTeleport(ctx)) {
    const cmd =
      borgDimensionDoor(ctx, 90) ??
      borgSpell(ctx, Spell.TELEPORT_SELF) ??
      borgSpell(ctx, Spell.PORTAL) ??
      borgShadowShift(ctx, 90) ??
      borgUseStaff(ctx, SVAL.staff.teleportation!, itemDeps) ??
      borgReadScroll(ctx, SVAL.scroll.teleport!, itemDeps) ??
      borgReadScroll(ctx, SVAL.scroll.teleport_level!, itemDeps) ??
      borgActivateItem(ctx, "act_tele_level", itemDeps);
    if (cmd) return cmd;
  }

  /* Recall to town (:2293). */
  if (T(ctx, BI.CDEPTH)) {
    const rc = borgRecall(ctx);
    if (rc) return rc;
  }

  /* Reset factors to jumpstart (:2304). */
  w.facts.uniqueOnLevel = 0;
  w.facts.scaryGuyOnLevel = false;
  w.facts.breederLevel = false;
  w.takes.wipe();
  w.kills.wipe();

  /* Dig to the center (:2320). */
  {
    const cmd = flow.toKillDirect(ctx, true);
    if (cmd) return cmd;
  }

  /* Twitch around (:2324). */
  {
    const cmd = flow.twitchy(ctx);
    if (cmd) return cmd;
  }

  /* Oops (:2328). */
  return null;
}

/* --------------------------------------------------- borg_think_dungeon_brave */

/**
 * borg_think_dungeon_brave (borg-think-dungeon.c:931): the boosted-bravery
 * subset run when the standard ladder stalls under excessive danger.
 */
export function borgThinkDungeonBrave(
  ctx: BorgContext,
  session: ThinkSession,
): AgentCommand | null {
  const w = ctx.world;
  const self = w.self;
  const g = self.goal;
  const flow = session.flow;
  const st = flow.state;
  const p1 = borgDanger(ctx, self.c.y, self.c.x, 1, true, false);

  /* Defense on 100 (:937). */
  if (T(ctx, BI.CDEPTH) === 100) {
    const cmd = borgDefend(ctx, p1);
    if (cmd) return cmd;
  }

  /* Attack (:941). */
  {
    const cmd = borgAttack(ctx, true);
    if (cmd) return cmd;
  }

  /* Light beam to remove fear (:945). */
  {
    const cmd = borgLightBeam(ctx, buildItemDeps(session));
    if (cmd) return cmd;
  }

  /* Take down stairs if standing on them (:952). */
  if (standingFeat(ctx) === FEAT.MORE) return ctx.act.descend();

  /* Return to stairs (goal.less) (:962). */
  if (g.less) {
    const flee = borgFlowOld(ctx, st, GOAL_FLEE);
    if (flee) return flee;
    if (w.facts.scaryGuyOnLevel && !T(ctx, BI.CDEPTH)) {
      const both = flow.toStairsBoth(ctx, GOAL_FLEE, false);
      if (both) return both;
    }
    const up = flow.toStairs(ctx, false, GOAL_FLEE, false);
    if (up) return up;
  }

  /* Flee the level (:980). */
  if (g.fleeing || g.leaving || w.facts.scaryGuyOnLevel) {
    self.stairLess = g.fleeing;
    if (self.readyMorgoth === 0) self.stairLess = true;
    if (st.hooks.forceDescend) self.stairLess = false;
    self.stairMore = g.fleeing;
    if (borgPrepared(ctx, T(ctx, BI.CDEPTH) + 1) === null) self.stairMore = true;
    const flee = borgFlowOld(ctx, st, GOAL_FLEE);
    if (flee) return flee;
    if (self.stairLess) {
      const up = flow.toStairs(ctx, false, GOAL_FLEE, false);
      if (up) return up;
    }
    if (self.stairMore) {
      const dn = flow.toStairs(ctx, true, GOAL_FLEE, false, true);
      if (dn) return dn;
    }
  }

  /* Vault handling (:1017). */
  if (w.facts.vaultOnLevel) {
    let cmd = borgFlowOld(ctx, st, GOAL_KILL);
    if (cmd) return cmd;
    cmd = flow.toKills(ctx, 35, true);
    if (cmd) return cmd;
    cmd = borgFlowOld(ctx, st, GOAL_TAKE);
    if (cmd) return cmd;
    cmd = flow.toTakes(ctx, true, 35);
    if (cmd) return cmd;
    cmd = flow.toVein(ctx, true, 35);
    if (cmd) return cmd;
    cmd = borgFlowOld(ctx, st, GOAL_VAULT);
    if (cmd) return cmd;
    cmd = flow.toVault(ctx, 35);
    if (cmd) return cmd;
  }

  /* Monsters then objects (:1045). */
  {
    let cmd = borgFlowOld(ctx, st, GOAL_KILL);
    if (cmd) return cmd;
    cmd = flow.toKills(ctx, 250, true);
    if (cmd) return cmd;
    cmd = borgFlowOld(ctx, st, GOAL_TAKE);
    if (cmd) return cmd;
    cmd = flow.toTakes(ctx, true, 250);
    if (cmd) return cmd;
    cmd = flow.toVein(ctx, true, 250);
    if (cmd) return cmd;
  }

  /*** Exploration (:1063) ***/
  for (const goal of [GOAL_MISC, GOAL_DARK, GOAL_XTRA, GOAL_BORE]) {
    const cmd = borgFlowOld(ctx, st, goal);
    if (cmd) return cmd;
  }
  {
    let cmd = flow.toDark(ctx, true);
    if (cmd) return cmd;
    cmd = flow.toDark(ctx, false);
    if (cmd) return cmd;
  }

  /*** Track down old stuff (:1099) ***/
  {
    let cmd = flow.toTakes(ctx, false, 250);
    if (cmd) return cmd;
    cmd = flow.toVein(ctx, false, 250);
    if (cmd) return cmd;
    cmd = flow.toKills(ctx, 250, false);
    if (cmd) return cmd;
  }

  /* Leave the level (:1116). */
  {
    const cmd = borgLeaveLevel(ctx, session, true);
    if (cmd) return cmd;
  }

  /* Secret doors (:1120). */
  {
    const cmd = flow.spastic(ctx, true);
    if (cmd) return cmd;
  }

  return null;
}

/* --------------------------------------------------- borg_think_stair_scum */

/**
 * borg_think_stair_scum (borg-think-dungeon-util.c:353): grab close items then
 * bolt for a stair. Used only when fleeing to town on depth 1.
 */
export function borgThinkStairScum(
  ctx: BorgContext,
  session: ThinkSession,
): AgentCommand | null {
  const w = ctx.world;
  const flow = session.flow;
  const st = flow.state;
  const deps = buildItemDeps(session);

  borgNotice(ctx);

  if (T(ctx, BI.CDEPTH) === 0 || T(ctx, BI.ISWEAK)) return null;

  /* No scumming if pack full (util:375). */
  if (flow.state.hooks.packFull(w)) return null;

  /* Require light (util:424). */
  const light = borgMaintainLight(ctx, deps);
  if (light.need === BorgNeed.MET_NEED && light.cmd) return light.cmd;

  /* Flow toward objects (util:433). */
  {
    const cmd = borgFlowOld(ctx, st, GOAL_TAKE);
    if (cmd) return cmd;
  }
  {
    const cmd = flow.toTakesScum(ctx, true, 6);
    if (cmd) return cmd;
  }

  /* Leave right away (util:441). */
  w.self.goal.fleeing = true;

  /* Going down (util:445). */
  if (st.more.num && (standingFeat(ctx) === FEAT.MORE || T(ctx, BI.CDEPTH) < 30)) {
    const flee = borgFlowOld(ctx, st, GOAL_FLEE);
    if (flee) return flee;
    const dn = flow.toStairs(ctx, true, GOAL_FLEE, false, false);
    if (dn) return dn;
    if (standingFeat(ctx) === FEAT.MORE) return ctx.act.descend();
  }

  /* Any stair (util:549). */
  if (T(ctx, BI.CDEPTH) >= 2) {
    const flee = borgFlowOld(ctx, st, GOAL_FLEE);
    if (flee) return flee;
    const both = flow.toStairsBoth(ctx, GOAL_FLEE, true);
    if (both) return both;
  }

  return null;
}

/* ---------------------------- weapon-slot helpers (borg_items[INVEN_WIELD]) */

/** Melee-weapon tvals (the "weapon" wield slot; wear.c wieldSlot). */
const WEAPON_TVALS: readonly number[] = [
  TV.DIGGING,
  TV.HAFTED,
  TV.POLEARM,
  TV.SWORD,
];

/** The wielded weapon is a digger (borg_items[INVEN_WIELD].tval == TV_DIGGING). */
function borgWieldIsDigger(ctx: BorgContext): boolean {
  for (const e of ctx.view.equipment()) {
    if (e && e.number > 0 && WEAPON_TVALS.includes(e.tval)) {
      return e.tval === TV.DIGGING;
    }
  }
  return false;
}

/** The borg has any melee weapon wielded (borg_items[INVEN_WIELD].tval). */
function borgHasWeapon(ctx: BorgContext): boolean {
  for (const e of ctx.view.equipment()) {
    if (e && e.number > 0 && WEAPON_TVALS.includes(e.tval)) return true;
  }
  return false;
}

/**
 * borg_notice / borg_notice_player - fill borg.trait[BI_*] (ctx.world.self.trait)
 * from the perceived player and items. Faithful port of
 * reference/src/borg/borg-trait.c:2185-3137.
 *
 * FIDELITY BOUNDARY. The C borg "cheats" by reading struct player and the body
 * slots directly. Our equivalent is ctx.view (PlayerView / ItemView). Two kinds
 * of value are handled differently, both faithfully:
 *
 *  1. Values the C re-derives only to reproduce a number the game already knows
 *     (net speed, final AC-less skills, light radius, infravision, blows/shots,
 *     max-HP) are taken straight from the corresponding already-derived
 *     PlayerView field. This is the value the C code is building toward, so the
 *     result is identical without needing race/class base tables AgentView does
 *     not expose.
 *  2. Values that are a genuine sum/OR over the equipped/carried items (armor
 *     and to-hit/to-dam decomposition, stat adds, resists/immunities/vulns,
 *     brands, slays, curses, object modifiers, sustains, consumable amounts) are
 *     re-derived from ItemView exactly as the C loop does, so the borg's
 *     decomposition that borg_power depends on (e.g. BI_TOHIT excludes the
 *     weapon's own to_h) is preserved to the weight.
 *
 * Engine internals with no AgentView home (race/class base-skill tables, the
 * obj_k knowledge mask, temp-buff timers, racial element resists, stat_max for
 * drain detection, spellbook contents, the spell/activation/swap/home
 * subsystems, and the per-object sval identity table) are documented seams on
 * BorgTraitOpts with inert defaults. See config.ts. Caveats in the port report.
 */

import type { ItemView, PlayerView } from "@neo-angband/core";
import type { BorgContext } from "../context";
import {
  BI,
  BI_MAX,
  CLASS_NECROMANCER,
  STAT_MAX,
  classIndexFromName,
  spellStatForClass,
  BORG_INVEN,
  BORG_EQUIP,
  BORG_QUILL,
} from "./trait-index";
import {
  ADJ_STR_HOLD,
  BORG_ADJ_DEX_TA,
  BORG_ADJ_DEX_TH,
  BORG_ADJ_STR_TD,
  BORG_ADJ_STR_TH,
  BORG_ADJ_STR_DIG,
  BORG_ADJ_STR_WGT,
  BORG_ADJ_MAG_MANA,
  BORG_ADJ_MAG_STAT,
  BORG_ADJ_MAG_FAIL,
  PY_FOOD_WEAK,
  PY_FOOD_HUNGRY,
  PY_FOOD_FULL,
  PY_FOOD_MAX,
  BORG_DIG,
  modifyStatValue,
  statToIndex,
} from "./tables";
import { hasFlag, mod, resLevel, hasBrand3, slayMult, present } from "./item-util";
import {
  resolveOpts,
  type BorgTraitOpts,
  type ResolvedOpts,
} from "./config";
import { resetDerived, addHas, type BorgDerived } from "./state";

/* Equipment body-slot indices (AgentView.equipment() order == game equip slots,
 * matching INVEN_WIELD..INVEN_FEET; generated/equip-slots.ts EQUIP_*). */
const SLOT_WIELD = 0;
const SLOT_BOW = 1;
const SLOT_LIGHT = 5;
const SLOT_BODY = 6;
const SLOT_OUTER = 7;
const SLOT_ARM = 8;
const SLOT_HEAD = 9;
const SLOT_HANDS = 10;
const SLOT_FEET = 11;

/* Missile tvals (generated/tvals.ts): shots/arrows/bolts. */
const TV_SHOT = 2;
const TV_ARROW = 3;
const TV_BOLT = 4;

/** Working context threaded through the notice helpers. */
interface Ctx {
  t: number[];
  d: BorgDerived;
  p: PlayerView;
  R: ResolvedOpts;
  equip: Array<ItemView | null>;
  inven: ItemView[];
  cls: number;
  spellStat: number;
}

/**
 * borg_notice - clear and rebuild the whole trait array (borg-trait.c:2825).
 * Writes ctx.world.self.trait in place.
 */
export function borgNotice(ctx: BorgContext, opts: BorgTraitOpts = {}): void {
  const R = resolveOpts(opts);
  const view = ctx.view;
  const p = view.player();

  /* Fresh trait buffer sized to BI_MAX (memset borg.trait, trait.c:2829). */
  const t = new Array<number>(BI_MAX).fill(0);
  const d = resetDerived(ctx.world);

  /* Start with a single blow, base speed 110, ammo defaults (trait.c:2833). */
  t[BI.BLOWS] = 1;
  t[BI.SPEED] = 110;
  t[BI.AMMO_TVAL] = -1;
  t[BI.AMMO_SIDES] = 4;

  const cls = classIndexFromName(p.cls);
  const spellStat = spellStatForClass(cls);
  const c: Ctx = {
    t,
    d,
    p,
    R,
    equip: view.equipment(),
    inven: view.inventory(),
    cls,
    spellStat,
  };

  borgNoticePlayer(c);
  borgNoticeEquipment(c);
  borgNoticeInventory(c);
  finishNotice(c);

  /* Publish the finished buffer. */
  ctx.world.self.trait = t;
}

/**
 * borg_notice_player - the "frame" values (borg-trait.c:2959). Mapped from
 * PlayerView; game-derived aggregates used where the C re-derives them.
 */
function borgNoticePlayer(c: Ctx): void {
  const { t, p } = c;

  t[BI.CLASS] = c.cls;

  /* level / exp / depth (trait.c:2964-3007) */
  t[BI.ISFIXLEV] = p.level < p.maxLevel ? 1 : 0;
  t[BI.CLEVEL] = p.level;
  t[BI.MAXCLEVEL] = p.maxLevel;
  t[BI.KING] = p.winner ? 1 : 0;
  t[BI.CDEPTH] = p.depth;
  t[BI.MAXDEPTH] = p.maxDepth;

  t[BI.ISFIXEXP] = 0;
  if (p.exp < p.maxExp) {
    if (t[BI.CLEVEL]! === 50 && t[BI.CDEPTH]! === 0) t[BI.ISFIXEXP] = 1;
    if (t[BI.CLEVEL]! === 50 && t[BI.CDEPTH]! >= 1) t[BI.ISFIXEXP] = 0;
    if (t[BI.CLEVEL]! !== 50) t[BI.ISFIXEXP] = 1;
  }

  t[BI.GOLD] = p.gold;

  /* HP / SP (trait.c:3043-3052). BI_HP_ADJ is the borg's re-derivation of mhp,
   * identical to the game's mhp by construction, so read maxHp directly. */
  t[BI.CURHP] = p.hp;
  t[BI.MAXHP] = p.maxHp;
  t[BI.HP_ADJ] = p.maxHp;
  t[BI.CURSP] = p.sp;
  t[BI.MAXSP] = p.maxSp;

  /* Food state (trait.c:3064-3082). status.food == player->timed[TMD_FOOD]. */
  const food = p.status.food;
  if (food < PY_FOOD_WEAK) {
    t[BI.ISWEAK] = 1;
    t[BI.ISHUNGRY] = 1;
  } else if (food < PY_FOOD_HUNGRY) {
    t[BI.ISHUNGRY] = 1;
  } else if (food < PY_FOOD_FULL) {
    /* normal */
  } else if (food < PY_FOOD_MAX) {
    t[BI.ISFULL] = 1;
  } else {
    t[BI.ISGORGED] = 1;
    t[BI.ISFULL] = 1;
  }

  /* Timed status (trait.c:3084-3122). */
  t[BI.ISBLIND] = p.status.blind ? 1 : 0;
  t[BI.ISCONFUSED] = p.status.confused ? 1 : 0;
  t[BI.ISAFRAID] = p.status.afraid ? 1 : 0;
  t[BI.ISPOISONED] = p.status.poisoned ? 1 : 0;
  t[BI.ISCUT] = p.status.cut ? 1 : 0;
  if (p.status.stun && p.status.stun <= 50) t[BI.ISSTUN] = 1;
  if (p.status.stun > 50) t[BI.ISHEAVYSTUN] = 1;
  if (p.status.paralyzed > 50) t[BI.ISPARALYZED] = 1;
  /* ISIMAGE (hallucination), ISFORGET (amnesia), ISSTUDY (new spells) have no
   * AgentView field; left 0 (caveat). */

  /* Stats: CSTR..CCON = stat_cur (natural). ISFIX* (drained) from frame. */
  const drained = c.R.frame.statDrained;
  for (let i = 0; i < STAT_MAX; i++) {
    t[BI.CSTR + i] = p.stats[i] ?? 10;
    t[BI.ISFIXSTR + i] = drained?.[i] ? 1 : 0;
  }

  /* Net speed, light, infravision, shots: game-derived (see fidelity note). */
  t[BI.SPEED] = p.speed;
  t[BI.LIGHT] = p.light;
  t[BI.INFRA] = p.seeInfra;

  /* SAURON_DEAD has no AgentView field; left 0 (caveat). */
}

/**
 * borg_notice_equipment - the equipment loop (borg-trait.c:1233-2180). Item
 * sums re-derived from ItemView; skills taken from the game-derived
 * PlayerView.skills (see fidelity note).
 */
function borgNoticeEquipment(c: Ctx): void {
  const { t, p, equip } = c;

  let extraShots = 0;
  let extraMight = 0;
  let myNumFire = 1;

  /* Player-level flags == player_flags(player) (trait.c:1296). PlayerView
   * .objectFlags already ORs racial + class + equipment flags. */
  const pf = p.objectFlags;
  if (pf.includes("SLOW_DIGEST")) t[BI.SDIG] = 1;
  if (pf.includes("FEATHER")) t[BI.FEATH] = 1;
  if (pf.includes("REGEN")) t[BI.REG] = 1;
  if (pf.includes("TELEPATHY")) t[BI.ESP] = 1;
  if (pf.includes("SEE_INVIS")) t[BI.SINV] = 1;
  if (pf.includes("FREE_ACT")) t[BI.FRACT] = 1;
  if (pf.includes("HOLD_LIFE")) t[BI.HLIFE] = 1;
  if (pf.includes("IMPACT")) t[BI.W_IMPACT] = 1;
  if (pf.includes("AGGRAVATE")) t[BI.CRSAGRV] = 1;
  if (pf.includes("AFRAID")) t[BI.CRSFEAR] = 1;
  if (pf.includes("DRAIN_EXP")) t[BI.CRSDRAIN_XP] = 1;
  if (pf.includes("PROT_FEAR")) t[BI.RFEAR] = 1;
  if (pf.includes("PROT_BLIND")) t[BI.RBLIND] = 1;
  if (pf.includes("PROT_CONF")) t[BI.RCONF] = 1;
  if (pf.includes("SUST_STR")) t[BI.SSTR] = 1;
  if (pf.includes("SUST_INT")) t[BI.SINT] = 1;
  if (pf.includes("SUST_WIS")) t[BI.SWIS] = 1;
  if (pf.includes("SUST_DEX")) t[BI.SDEX] = 1;
  if (pf.includes("SUST_CON")) t[BI.SCON] = 1;

  /* Scan worn equipment (trait.c:1414). */
  for (let i = 0; i < equip.length; i++) {
    const item = equip[i];
    if (!present(item)) continue;

    /* Curse tracking (uncursable unknown from ItemView; treated removable). */
    if (item.curses.length > 0) {
      t[BI.WHERE_CURSED] = t[BI.WHERE_CURSED]! | BORG_EQUIP;
      if (!t[BI.FIRST_CURSED]!) t[BI.FIRST_CURSED] = i + 1;
    }

    t[BI.WEIGHT] = t[BI.WEIGHT]! + item.weight * item.number;

    /* Affect stats (known mask defaults to 1). */
    const known = c.R.frame.statKnown;
    t[BI.ASTR] = t[BI.ASTR]! + mod(item, "STR") * (known ? (known[0] ?? 0) : 1);
    t[BI.AINT] = t[BI.AINT]! + mod(item, "INT") * (known ? (known[1] ?? 0) : 1);
    t[BI.AWIS] = t[BI.AWIS]! + mod(item, "WIS") * (known ? (known[2] ?? 0) : 1);
    t[BI.ADEX] = t[BI.ADEX]! + mod(item, "DEX") * (known ? (known[3] ?? 0) : 1);
    t[BI.ACON] = t[BI.ACON]! + mod(item, "CON") * (known ? (known[4] ?? 0) : 1);

    /* Slays: last-writer-wins overwrite, verbatim (trait.c:1453). */
    t[BI.WS_ANIMAL] = slayMult(item, "ANIMAL");
    t[BI.WS_EVIL] = slayMult(item, "EVIL");
    t[BI.WS_UNDEAD] = slayMult(item, "UNDEAD");
    t[BI.WS_DEMON] = slayMult(item, "DEMON");
    t[BI.WS_ORC] = slayMult(item, "ORC");
    t[BI.WS_TROLL] = slayMult(item, "TROLL");
    t[BI.WS_GIANT] = slayMult(item, "GIANT");
    t[BI.WS_DRAGON] = slayMult(item, "DRAGON");

    /* Brands: OR-accumulated, _3 codes only (trait.c:1463). */
    if (hasBrand3(item, "ACID")) t[BI.WB_ACID] = 1;
    if (hasBrand3(item, "ELEC")) t[BI.WB_ELEC] = 1;
    if (hasBrand3(item, "FIRE")) t[BI.WB_FIRE] = 1;
    if (hasBrand3(item, "COLD")) t[BI.WB_COLD] = 1;
    if (hasBrand3(item, "POIS")) t[BI.WB_POIS] = 1;
    if (hasFlag(item, "IMPACT")) t[BI.W_IMPACT] = 1;

    /* Object modifiers (trait.c:1477-1540). */
    t[BI.INFRA] = t[BI.INFRA]! + mod(item, "INFRA");
    t[BI.STL] = t[BI.STL]! + mod(item, "STEALTH");
    t[BI.SRCH] = t[BI.SRCH]! + mod(item, "SEARCH") * 5;

    let dig = 0;
    if (hasFlag(item, "DIG_1")) dig = 1;
    else if (hasFlag(item, "DIG_2")) dig = 2;
    else if (hasFlag(item, "DIG_3")) dig = 3;
    dig += mod(item, "TUNNEL");
    t[BI.DIG] = t[BI.DIG]! + dig * 20;

    t[BI.SPEED] = t[BI.SPEED]! + mod(item, "SPEED");
    if (i !== SLOT_WIELD) t[BI.EXTRA_BLOWS] = t[BI.EXTRA_BLOWS]! + mod(item, "BLOWS");
    extraShots += mod(item, "SHOTS");
    extraMight += mod(item, "MIGHT");

    if (
      i !== SLOT_LIGHT ||
      hasFlag(item, "NO_FUEL") ||
      item.timeout !== 0
    ) {
      t[BI.LIGHT] = t[BI.LIGHT]! + mod(item, "LIGHT");
      if (hasFlag(item, "LIGHT_2")) t[BI.LIGHT] = t[BI.LIGHT]! + 2;
      else if (hasFlag(item, "LIGHT_3")) t[BI.LIGHT] = t[BI.LIGHT]! + 3;
      if (mod(item, "LIGHT") > 0 && c.cls === CLASS_NECROMANCER) t[BI.LIGHT] = t[BI.LIGHT]! - 1;
      t[BI.LIGHT] = t[BI.LIGHT]! + mod(item, "LIGHT");
    }

    t[BI.MOD_MOVES] = t[BI.MOD_MOVES]! + mod(item, "MOVES");
    t[BI.DAM_RED] = t[BI.DAM_RED]! + mod(item, "DAM_RED");

    /* Item flags (trait.c:1543). */
    if (hasFlag(item, "SLOW_DIGEST")) t[BI.SDIG] = 1;
    if (hasFlag(item, "AGGRAVATE")) t[BI.CRSAGRV] = 1;
    if (hasFlag(item, "IMPAIR_HP")) t[BI.CRSHPIMP] = 1;
    if (hasFlag(item, "IMPAIR_MANA")) t[BI.CRSMPIMP] = 1;
    if (hasFlag(item, "AFRAID")) t[BI.CRSFEAR] = 1;
    if (hasFlag(item, "DRAIN_EXP")) t[BI.CRSDRAIN_XP] = 1;

    /* Curses by name (trait.c:1558). */
    applyCurses(t, item);

    /* Element vulnerabilities on the item (trait.c:1621). */
    if (resLevel(item, "FIRE") === -1) t[BI.CRSFVULN] = 1;
    if (resLevel(item, "ACID") === -1) t[BI.CRSAVULN] = 1;
    if (resLevel(item, "COLD") === -1) t[BI.CRSCVULN] = 1;
    if (resLevel(item, "ELEC") === -1) t[BI.CRSEVULN] = 1;

    /* Item flags -> resist/see/regen (trait.c:1630). */
    if (hasFlag(item, "REGEN")) t[BI.REG] = 1;
    if (hasFlag(item, "TELEPATHY")) t[BI.ESP] = 1;
    if (hasFlag(item, "SEE_INVIS")) t[BI.SINV] = 1;
    if (hasFlag(item, "FEATHER")) t[BI.FEATH] = 1;
    if (hasFlag(item, "FREE_ACT")) t[BI.FRACT] = 1;
    if (hasFlag(item, "HOLD_LIFE")) t[BI.HLIFE] = 1;
    if (hasFlag(item, "PROT_CONF")) t[BI.RCONF] = 1;
    if (hasFlag(item, "PROT_BLIND")) t[BI.RBLIND] = 1;

    /* Immunities (trait.c:1649). */
    if (resLevel(item, "FIRE") === 3) t[BI.IFIRE] = t[BI.RFIRE] = 1;
    if (resLevel(item, "ACID") === 3) t[BI.IACID] = t[BI.RACID] = 1;
    if (resLevel(item, "COLD") === 3) t[BI.ICOLD] = t[BI.RCOLD] = 1;
    if (resLevel(item, "ELEC") === 3) t[BI.IELEC] = t[BI.RELEC] = 1;

    /* Resistances (trait.c:1671). */
    if (resLevel(item, "ACID") > 0) t[BI.RACID] = 1;
    if (resLevel(item, "ELEC") > 0) t[BI.RELEC] = 1;
    if (resLevel(item, "FIRE") > 0) t[BI.RFIRE] = 1;
    if (resLevel(item, "COLD") > 0) t[BI.RCOLD] = 1;
    if (resLevel(item, "POIS") > 0) t[BI.RPOIS] = 1;
    if (resLevel(item, "SOUND") > 0) t[BI.RSND] = 1;
    if (resLevel(item, "LIGHT") > 0) t[BI.RLITE] = 1;
    if (resLevel(item, "DARK") > 0) t[BI.RDARK] = 1;
    if (resLevel(item, "CHAOS") > 0) t[BI.RKAOS] = 1;
    if (resLevel(item, "DISEN") > 0) t[BI.RDIS] = 1;
    if (resLevel(item, "SHARD") > 0) t[BI.RSHRD] = 1;
    if (resLevel(item, "NEXUS") > 0) t[BI.RNXUS] = 1;
    if (resLevel(item, "NETHER") > 0) t[BI.RNTHR] = 1;

    /* Sustains (trait.c:1699). */
    if (hasFlag(item, "SUST_STR")) t[BI.SSTR] = 1;
    if (hasFlag(item, "SUST_INT")) t[BI.SINT] = 1;
    if (hasFlag(item, "SUST_WIS")) t[BI.SWIS] = 1;
    if (hasFlag(item, "SUST_DEX")) t[BI.SDEX] = 1;
    if (hasFlag(item, "SUST_CON")) t[BI.SCON] = 1;

    /* Multiple useful high-resist bonuses (trait.c:1711). */
    const bonuses =
      (resLevel(item, "POIS") > 0 ? 1 : 0) +
      (resLevel(item, "SOUND") > 0 ? 1 : 0) +
      (resLevel(item, "SHARD") > 0 ? 1 : 0) +
      (resLevel(item, "NEXUS") > 0 ? 1 : 0) +
      (resLevel(item, "NETHER") > 0 ? 1 : 0) +
      (resLevel(item, "CHAOS") > 0 ? 1 : 0) +
      (resLevel(item, "DISEN") > 0 ? 1 : 0) +
      (resLevel(item, "FIRE") > 0 &&
      resLevel(item, "COLD") > 0 &&
      resLevel(item, "ELEC") > 0 &&
      resLevel(item, "ACID") > 0
        ? 1
        : 0) +
      (hasFlag(item, "SUST_STR") &&
      hasFlag(item, "SUST_INT") &&
      hasFlag(item, "SUST_WIS") &&
      hasFlag(item, "SUST_DEX") &&
      hasFlag(item, "SUST_CON")
        ? 1
        : 0);
    if (bonuses > 2) t[BI.MULTIPLE_BONUSES] = t[BI.MULTIPLE_BONUSES]! + bonuses;

    /* Armor: base ac + to_a (trait.c:1746). The acid-damage net-zero hack
     * needs a mutable to_a; approximate on a copy. */
    let toA = item.toA;
    if (!item.artifact && !item.ego && item.ac >= 1 && toA + item.ac <= 0) {
      toA = -20;
    }
    t[BI.ARMOR] = t[BI.ARMOR]! + item.ac + toA;

    /* Weapon/bow slots skip to-hit/to-dam accumulation (trait.c:1752). */
    if (i === SLOT_WIELD || i === SLOT_BOW) continue;
    t[BI.TOHIT] = t[BI.TOHIT]! + item.toH;
    t[BI.TODAM] = t[BI.TODAM]! + item.toD;
  }

  /* Necromancer unlight (trait.c:1765). */
  if (c.cls === CLASS_NECROMANCER && t[BI.LIGHT]! <= 0) t[BI.LIGHT] = 1;

  /* Post-loop curse effects that persist (trait.c:1770). The CSTR/CINT etc.
   * stat adjustments from dullness/sickness/weakness/clumsiness are clobbered
   * by the stat-index rebuild below in the C, so they are intentionally omitted
   * (they never affect STR_INDEX or CSTR in the original). */
  if (t[BI.CRSVULN]!) {
    t[BI.CRSAGRV] = 1;
    t[BI.ARMOR] = t[BI.ARMOR]! - 50;
  }
  if (t[BI.CRSANNOY]!) {
    t[BI.STL] = t[BI.STL]! - 10;
    t[BI.CRSAGRV] = 1;
  }

  /* Rebuild used-stats and indices (trait.c:1804-1834). */
  const statAdj = c.R.frame.statAdj;
  for (let i = 0; i < STAT_MAX; i++) {
    let add = t[BI.ASTR + i]!;
    add += statAdj ? (statAdj[i] ?? 0) : 0;
    const use = modifyStatValue(t[BI.CSTR + i]!, add);
    t[BI.STR_INDEX + i] = statToIndex(use);
    t[BI.STR + i] = use;
  }

  const strIdx = t[BI.STR_INDEX]!;
  const dexIdx = t[BI.DEX_INDEX]!;

  /* Spell-point / fail adjustment for casters (trait.c:1841). */
  if (c.spellStat >= 0) {
    const si = t[BI.STR_INDEX + c.spellStat]!;
    const spellFirst = c.R.frame.spellFirst ?? 1;
    t[BI.SP_ADJ] = Math.trunc(
      (BORG_ADJ_MAG_MANA[si]! * (t[BI.CLEVEL]! - spellFirst + 1)) / 2,
    );
    t[BI.FAIL1] = BORG_ADJ_MAG_STAT[si]!;
    t[BI.FAIL2] = BORG_ADJ_MAG_FAIL[si]!;
  }

  /* Actual modifier bonuses (trait.c:1859). */
  t[BI.ARMOR] = t[BI.ARMOR]! + BORG_ADJ_DEX_TA[dexIdx]!;
  t[BI.TODAM] = t[BI.TODAM]! + BORG_ADJ_STR_TD[strIdx]!;
  t[BI.TOHIT] = t[BI.TOHIT]! + BORG_ADJ_DEX_TH[dexIdx]!;
  t[BI.TOHIT] = t[BI.TOHIT]! + BORG_ADJ_STR_TH[strIdx]!;

  const hold = ADJ_STR_HOLD[strIdx]!;
  t[BI.DIG] = t[BI.DIG]! + BORG_ADJ_STR_DIG[strIdx]!;

  /* Bow (trait.c:1871). */
  const bow = equip[SLOT_BOW];
  if (present(bow) && bow.curses.length === 0) {
    t[BI.BTOHIT] = bow.toH;
    t[BI.BTODAM] = bow.toD;
    t[BI.BID] = 1;
    t[BI.BART] = bow.artifact ? 1 : 0;

    if (hold < bow.weight / 10) {
      t[BI.HEAVYBOW] = 1;
      t[BI.TOHIT] = t[BI.TOHIT]! + 2 * (hold - Math.trunc(bow.weight / 10));
    }

    if (hold >= bow.weight / 10) {
      /* Ammo tval/sides/power by bow sval (trait.c:1901). Uses provided svals. */
      const sv = c.R.svals;
      if (bow.sval === sv.sling) {
        t[BI.AMMO_TVAL] = TV_SHOT;
        t[BI.AMMO_SIDES] = 3;
        t[BI.AMMO_POWER] = 2;
      } else if (bow.sval === sv.short_bow) {
        t[BI.AMMO_TVAL] = TV_ARROW;
        t[BI.AMMO_SIDES] = 4;
        t[BI.AMMO_POWER] = 2;
      } else if (bow.sval === sv.long_bow) {
        t[BI.AMMO_TVAL] = TV_ARROW;
        t[BI.AMMO_SIDES] = 4;
        t[BI.AMMO_POWER] = 3;
      } else if (bow.sval === sv.light_xbow) {
        t[BI.AMMO_TVAL] = TV_BOLT;
        t[BI.AMMO_SIDES] = 5;
        t[BI.AMMO_POWER] = 3;
      } else if (bow.sval === sv.heavy_xbow) {
        t[BI.AMMO_TVAL] = TV_BOLT;
        t[BI.AMMO_SIDES] = 5;
        t[BI.AMMO_POWER] = 4;
      }
      t[BI.AMMO_POWER] = t[BI.AMMO_POWER]! + extraMight;

      if (c.R.spells.playerHas("FAST_SHOT")) {
        if (t[BI.AMMO_TVAL]! === TV_ARROW && t[BI.CLEVEL]! >= 20) myNumFire++;
        if (t[BI.CLEVEL]! >= 40) myNumFire++;
        t[BI.FAST_SHOTS] = 1;
      }
      myNumFire += extraShots;
      if (myNumFire < 1) myNumFire = 1;
    }
    t[BI.SLING] = bow.sval === c.R.svals.sling ? 1 : 0;
  }
  /* BI_SHOTS: the game already computes net shots (tenths); use it when a bow
   * is worn, else the borg's 1 (num_fire). */
  if (present(bow) && p.shots > 0) t[BI.SHOTS] = Math.trunc(p.shots / 10) || 1;
  else t[BI.SHOTS] = myNumFire;

  /* Weapon (trait.c:1950). */
  const wep = equip[SLOT_WIELD];
  if (present(wep) && wep.curses.length === 0) {
    t[BI.WTOHIT] = wep.toH;
    t[BI.WTODAM] = wep.toD;
    t[BI.WID] = 1;
    t[BI.WDD] = wep.dd;
    t[BI.WDS] = wep.ds;

    if (hold < wep.weight / 10) {
      t[BI.HEAVYWEPON] = 1;
      t[BI.TOHIT] = t[BI.TOHIT]! + 2 * (hold - Math.trunc(wep.weight / 10));
    }
    if (hold >= wep.weight / 10) {
      /* Blows: game-derived num_blows (hundredths) rather than the class-table
       * recompute (att_multiply/min_weight/max_attacks absent from AgentView). */
      t[BI.BLOWS] = p.blows > 0 ? Math.trunc(p.blows / 100) || 1 : 1;
      t[BI.DIG] = t[BI.DIG]! + Math.trunc(wep.weight / 10);
    }
  }

  /* Skills: game-derived (PlayerView.skills), the value the C tables build
   * toward (see fidelity note). SKILL order: DISARM_PHYS, DISARM_MAGIC, DEVICE,
   * SAVE, SEARCH, STEALTH, TO_HIT_MELEE, TO_HIT_BOW, TO_HIT_THROW, DIGGING. */
  const sk = p.skills;
  if (sk.length >= 10) {
    t[BI.DISP] = sk[0]!;
    t[BI.DISM] = sk[1]!;
    t[BI.DEV] = sk[2]!;
    t[BI.SAV] = sk[3]!;
    t[BI.SRCH] = t[BI.SRCH]! + sk[4]!;
    t[BI.STL] = t[BI.STL]! + sk[5]!;
    t[BI.THN] = sk[6]!;
    t[BI.THB] = sk[7]!;
    t[BI.THT] = sk[8]!;
    t[BI.DIG] = t[BI.DIG]! + sk[9]!;
  }

  /* Warrior bravery-30 res fear (trait.c:1987). */
  if (c.R.spells.playerHas("BRAVERY_30") && t[BI.CLEVEL]! >= 30) t[BI.RFEAR] = 1;

  /* Stealth clamp 0..30, dig min 1 (trait.c:2041). */
  if (t[BI.STL]! > 30) t[BI.STL] = 30;
  if (t[BI.STL]! < 0) t[BI.STL] = 0;
  if (t[BI.DIG]! < 1) t[BI.DIG] = 1;

  /* Fear penalties (trait.c:2053). */
  if (t[BI.ISAFRAID]! || t[BI.CRSFEAR]!) {
    t[BI.TOHIT] = t[BI.TOHIT]! - 20;
    t[BI.ARMOR] = t[BI.ARMOR]! + 8;
    t[BI.DEV] = Math.trunc((t[BI.DEV]! * 95) / 100);
  }

  /* Priest blessed-weapon bonus (trait.c:2060). */
  if (
    present(wep) &&
    c.R.spells.playerHas("BLESS_WEAPON") &&
    hasFlag(wep, "BLESSED")
  ) {
    t[BI.TOHIT] = t[BI.TOHIT]! + 2;
    t[BI.TODAM] = t[BI.TODAM]! + 2;
  }

  /* Enchant-needs on weapons/armor (trait.c:2071-2149). */
  const enchLimit = c.R.cfg.enchantLimit;
  for (let i = SLOT_WIELD; i <= SLOT_BOW; i++) {
    const item = equip[i];
    if (!present(item)) continue;
    if (item.curses.length > 0) continue;
    if (
      i === SLOT_BOW &&
      t[BI.AMMO_POWER]! < 3 &&
      !item.artifact &&
      !item.ego
    )
      continue;
    const canEnch =
      c.R.spells.spellLegalFail("ENCHANT_WEAPON", 65) || t[BI.AENCH_SWEP]! >= 1;
    const hLimit = canEnch ? enchLimit : 8;
    if (item.toH < hLimit) t[BI.NEED_ENCHANT_TO_H] = t[BI.NEED_ENCHANT_TO_H]! + hLimit - item.toH;
    if (item.toD < hLimit) t[BI.NEED_ENCHANT_TO_D] = t[BI.NEED_ENCHANT_TO_D]! + hLimit - item.toD;
  }
  for (let i = SLOT_BODY; i <= SLOT_FEET; i++) {
    const item = equip[i];
    if (!present(item)) continue;
    if (item.curses.length > 0) continue;
    const canEnch =
      c.R.spells.spellLegalFail("ENCHANT_ARMOUR", 65) || t[BI.AENCH_SARM]! >= 1;
    const aLimit = canEnch ? enchLimit : 8;
    if (item.toA < aLimit) t[BI.NEED_ENCHANT_TO_A] = t[BI.NEED_ENCHANT_TO_A]! + aLimit - item.toA;
  }

  /* See-invisible / free-action special cases (trait.c:2152-2173). */
  if (
    t[BI.CDEPTH]! === 0 &&
    c.R.spells.spellLegal("SENSE_INVISIBLE")
  )
    t[BI.SINV] = 1;
  if (t[BI.SAV]! >= 100) t[BI.FRACT] = 1;
  if (t[BI.SAV]! >= 100 && t[BI.RDARK]! && t[BI.RLITE]!) t[BI.RBLIND] = 1;

  /* Quiver ammo (trait.c:2178). AgentView folds the quiver into inventory(); it
   * is noticed in borgNoticeInventory via borg_is_ammo. */
}

/** Apply an item's curse list to the CRS* traits (trait.c:1558). */
function applyCurses(t: number[], item: ItemView): void {
  for (const name of item.curses) {
    switch (name) {
      case "vulnerability": t[BI.CRSVULN] = 1; break;
      case "teleportation": t[BI.CRSTELE] = 1; break;
      case "dullness": t[BI.CRSDULL] = 1; break;
      case "sickliness": t[BI.CRSSICK] = 1; break;
      case "enveloping": t[BI.CRSENVELOPING] = 1; break;
      case "irritation": t[BI.CRSAGRV] = 1; t[BI.CRSIRRITATION] = 1; break;
      case "weakness": t[BI.CRSWEAK] = 1; break;
      case "clumsiness": t[BI.CRSCLUM] = 1; break;
      case "slowness": t[BI.CRSSLOW] = 1; break;
      case "annoyance": t[BI.CRSANNOY] = 1; break;
      case "poison": t[BI.CRSPOIS] = 1; break;
      case "siren": t[BI.CRSSIREN] = 1; break;
      case "hallucination": t[BI.CRSHALU] = 1; break;
      case "paralysis": t[BI.CRSPARA] = 1; break;
      case "demon summon": t[BI.CRSSDEM] = 1; break;
      case "dragon summon": t[BI.CRSSDRA] = 1; break;
      case "undead summon": t[BI.CRSSUND] = 1; break;
      case "impair mana recovery": t[BI.CRSMPIMP] = 1; break;
      case "impair hitpoint recovery": t[BI.CRSHPIMP] = 1; break;
      case "cowardice": t[BI.CRSFEAR] = 1; break;
      case "stone": t[BI.CRSSTONE] = 1; break;
      case "anti-teleportation": t[BI.CRSNOTEL] = 1; break;
      case "treacherous weapon": t[BI.CRSTWEP] = 1; break;
      case "burning up": t[BI.CRSFVULN] = 1; t[BI.RCOLD] = 1; break;
      case "chilled to the bone": t[BI.CRSCVULN] = 1; t[BI.RFIRE] = 1; break;
      case "steelskin": t[BI.CRSSTEELSKIN] = 1; break;
      case "air swing": t[BI.CRSAIRSWING] = 1; break;
      default: t[BI.CRSUNKNO] = 1; break;
    }
  }
}

/**
 * borg_notice_inventory - carried consumables (borg-trait.c:2185). The sval
 * identity switch is ported verbatim, gated on the caller-supplied svals table
 * (config.ts); absent svals mean these amounts stay 0 (faithful "unaware").
 */
function borgNoticeInventory(c: Ctx): void {
  const { t, d, inven, R } = c;
  const sv = R.svals;
  const equip = c.equip;

  for (const item of inven) {
    if (!present(item)) continue;

    /* Ammo in the pack / quiver (trait.c:2218 -> borg_notice_ammo). */
    if (isAmmoTval(item.tval)) {
      noticeAmmo(c, item);
      continue;
    }

    t[BI.WEIGHT] = t[BI.WEIGHT]! + item.weight * item.number;

    if (item.curses.length > 0) {
      t[BI.WHERE_CURSED] = t[BI.WHERE_CURSED]! | BORG_INVEN;
      if (!t[BI.FIRST_CURSED]!) t[BI.FIRST_CURSED] = 1;
    }

    /* has[] by role (trait.c:2243). Keyed on the resolved sval identity. */
    creditHas(c, item);

    switch (item.tval) {
      case TV_MUSHROOM:
      case TV_FOOD:
        noticeFood(c, item);
        break;
      case TV_POTION:
        if (item.sval === sv.potion_healing) t[BI.AHEAL] = t[BI.AHEAL]! + item.number;
        else if (item.sval === sv.potion_star_healing) t[BI.AEZHEAL] = t[BI.AEZHEAL]! + item.number;
        else if (item.sval === sv.potion_life) t[BI.ALIFE] = t[BI.ALIFE]! + item.number;
        else if (item.sval === sv.potion_cure_critical) t[BI.ACCW] = t[BI.ACCW]! + item.number;
        else if (item.sval === sv.potion_cure_serious) t[BI.ACSW] = t[BI.ACSW]! + item.number;
        else if (item.sval === sv.potion_cure_light) t[BI.ACLW] = t[BI.ACLW]! + item.number;
        else if (item.sval === sv.potion_cure_poison) t[BI.ACUREPOIS] = t[BI.ACUREPOIS]! + item.number;
        else if (item.sval === sv.potion_resist_heat) t[BI.ARESHEAT] = t[BI.ARESHEAT]! + item.number;
        else if (item.sval === sv.potion_resist_cold) t[BI.ARESCOLD] = t[BI.ARESCOLD]! + item.number;
        else if (item.sval === sv.potion_resist_pois) t[BI.ARESPOIS] = t[BI.ARESPOIS]! + item.number;
        else if (item.sval === sv.potion_inc_str) d.amtStatgain[0]! += item.number;
        else if (item.sval === sv.potion_inc_int) d.amtStatgain[1]! += item.number;
        else if (item.sval === sv.potion_inc_wis) d.amtStatgain[2]! += item.number;
        else if (item.sval === sv.potion_inc_dex) d.amtStatgain[3]! += item.number;
        else if (item.sval === sv.potion_inc_con) d.amtStatgain[4]! += item.number;
        else if (item.sval === sv.potion_inc_all)
          for (let s = 0; s < STAT_MAX; s++) d.amtStatgain[s]! += item.number;
        else if (item.sval === sv.potion_restore_life) t[BI.HASFIXEXP] = 1;
        else if (item.sval === sv.potion_speed) t[BI.ASPEED] = t[BI.ASPEED]! + item.number;
        break;
      case TV_SCROLL:
        if (item.sval === sv.scroll_identify) t[BI.AID] = t[BI.AID]! + item.number;
        else if (item.sval === sv.scroll_recharging) t[BI.ARECHARGE] = t[BI.ARECHARGE]! + item.number;
        else if (item.sval === sv.scroll_phase_door) t[BI.APHASE] = t[BI.APHASE]! + item.number;
        else if (item.sval === sv.scroll_teleport) t[BI.ATELEPORT] = t[BI.ATELEPORT]! + item.number;
        else if (item.sval === sv.scroll_word_of_recall) t[BI.RECALL] = t[BI.RECALL]! + item.number;
        else if (item.sval === sv.scroll_enchant_armor) t[BI.AENCH_ARM] = t[BI.AENCH_ARM]! + item.number;
        else if (item.sval === sv.scroll_star_enchant_armor) t[BI.AENCH_SARM] = t[BI.AENCH_SARM]! + item.number;
        else if (item.sval === sv.scroll_enchant_weapon_to_hit) t[BI.AENCH_TOH] = t[BI.AENCH_TOH]! + item.number;
        else if (item.sval === sv.scroll_enchant_weapon_to_dam) t[BI.AENCH_TOD] = t[BI.AENCH_TOD]! + item.number;
        else if (item.sval === sv.scroll_star_enchant_weapon) t[BI.AENCH_SWEP] = t[BI.AENCH_SWEP]! + item.number;
        else if (item.sval === sv.scroll_protection_from_evil) t[BI.APFE] = t[BI.APFE]! + item.number;
        else if (item.sval === sv.scroll_rune_of_protection) t[BI.AGLYPH] = t[BI.AGLYPH]! + item.number;
        else if (item.sval === sv.scroll_teleport_level) {
          t[BI.ATELEPORTLVL] = t[BI.ATELEPORTLVL]! + item.number;
          t[BI.ATELEPORT] = t[BI.ATELEPORT]! + 1;
        } else if (item.sval === sv.scroll_mass_banishment) t[BI.AMASSBAN] = t[BI.AMASSBAN]! + item.number;
        break;
      case TV_ROD:
        noticeRod(c, item);
        break;
      case TV_WAND:
        if (item.sval === sv.wand_teleport_away) t[BI.ATPORTOTHER] = t[BI.ATPORTOTHER]! + item.pval;
        if (item.sval === sv.wand_stinking_cloud && t[BI.MAXDEPTH]! < 30)
          t[BI.GOOD_W_CHG] = t[BI.GOOD_W_CHG]! + item.pval;
        if (item.sval === sv.wand_magic_missile && t[BI.MAXDEPTH]! < 30)
          t[BI.GOOD_W_CHG] = t[BI.GOOD_W_CHG]! + item.pval;
        if (item.sval === sv.wand_annihilation) t[BI.GOOD_W_CHG] = t[BI.GOOD_W_CHG]! + item.pval;
        break;
      case TV_STAFF:
        if (item.sval === sv.staff_teleportation) t[BI.AESCAPE] = t[BI.AESCAPE]! + item.number;
        else if (item.sval === sv.staff_speed) t[BI.ASPEED] = t[BI.ASPEED]! + item.pval;
        else if (item.sval === sv.staff_healing) t[BI.AHEAL] = t[BI.AHEAL]! + item.pval;
        else if (item.sval === sv.staff_the_magi) t[BI.ASTFMAGI] = t[BI.ASTFMAGI]! + item.pval;
        else if (item.sval === sv.staff_destruction) t[BI.ASTFDEST] = t[BI.ASTFDEST]! + item.pval;
        else if (item.sval === sv.staff_power) t[BI.GOOD_S_CHG] = t[BI.GOOD_S_CHG]! + item.number;
        else if (item.sval === sv.staff_holiness) {
          t[BI.GOOD_S_CHG] = t[BI.GOOD_S_CHG]! + item.number;
          t[BI.AHEAL] = t[BI.AHEAL]! + item.pval;
        }
        break;
      case TV_FLASK:
        if (equip[SLOT_LIGHT]?.sval === sv.light_lantern) t[BI.AFUEL] = t[BI.AFUEL]! + item.number;
        break;
      case TV_LIGHT: {
        const light = equip[SLOT_LIGHT];
        if (
          item.sval === sv.light_torch &&
          item.timeout >= 1 &&
          light?.sval === sv.light_torch &&
          present(light)
        )
          t[BI.AFUEL] = t[BI.AFUEL]! + item.number;
        break;
      }
      case TV_DIGGING:
        if (item.number > 0 && item.curses.length === 0 && t[BI.DIG]! >= BORG_DIG)
          t[BI.ADIGGER] = t[BI.ADIGGER]! + item.number;
        break;
      default:
        break;
    }
  }

  /* Spell/activation "infinite amount" grants (trait.c:2579-2784). Seams; with
   * the inert defaults these add nothing. */
  applySpellGrants(c);

  /* Fuel need waived (trait.c:2789). */
  if (hasFlag(equip[SLOT_LIGHT] ?? emptyItem(), "NO_FUEL") || c.cls === CLASS_NECROMANCER)
    t[BI.AFUEL] = t[BI.AFUEL]! + 1000;

  /* Stat-gain needs (trait.c:2794). */
  if (t[BI.CSTR]! < 18 + 100) d.needStatgain[0] = true;
  if (t[BI.CINT]! < 18 + 100) d.needStatgain[1] = true;
  if (t[BI.CWIS]! < 18 + 100) d.needStatgain[2] = true;
  if (t[BI.CDEX]! < 18 + 100) d.needStatgain[3] = true;
  if (t[BI.CCON]! < 18 + 100) d.needStatgain[4] = true;

  /* No experience-repair need if not drained (trait.c:2810). */
  if (!t[BI.ISFIXEXP]!) t[BI.HASFIXEXP] = 1;

  /* Food correction (trait.c:2814). */
  t[BI.FOOD] = t[BI.FOOD]! + t[BI.FOOD_HI]!;
  t[BI.FOOD] = t[BI.FOOD]! + t[BI.FOOD_LO]!;
  if (t[BI.ISWEAK]! && t[BI.FOOD]! >= 1000) t[BI.FOOD] = t[BI.FOOD]! - 1000;
}

/** borg_notice_ammo (trait.c:1118). */
function noticeAmmo(c: Ctx, item: ItemView): void {
  const { t } = c;
  t[BI.WEIGHT] = t[BI.WEIGHT]! + item.weight * item.number;
  t[BI.AMMO_COUNT] = t[BI.AMMO_COUNT]! + item.number;
  if (item.tval !== t[BI.AMMO_TVAL]!) return;
  t[BI.AMISSILES] = t[BI.AMISSILES]! + item.number;
  if (item.curses.length > 0) {
    t[BI.WHERE_CURSED] = t[BI.WHERE_CURSED]! | BORG_QUILL;
    if (!t[BI.FIRST_CURSED]!) t[BI.FIRST_CURSED] = 1;
    t[BI.AMISSILES_CURSED] = t[BI.AMISSILES_CURSED]! + item.number;
    return;
  }
  if (item.ego) t[BI.AMISSILES_SPECIAL] = t[BI.AMISSILES_SPECIAL]! + item.number;
}

/** Food/mushroom analysis (trait.c:2264). */
function noticeFood(c: Ctx, item: ItemView): void {
  const { t, R } = c;
  const sv = R.svals;
  if (item.tval === TV_FOOD) {
    if (
      item.sval === sv.food_apple ||
      item.sval === sv.food_handful ||
      item.sval === sv.food_slime_mold ||
      item.sval === sv.food_pint ||
      item.sval === sv.food_sip
    )
      t[BI.FOOD_LO] = t[BI.FOOD_LO]! + item.number;
    else if (
      item.sval === sv.food_ration ||
      item.sval === sv.food_slice ||
      item.sval === sv.food_honey_cake ||
      item.sval === sv.food_waybread ||
      item.sval === sv.food_draught
    )
      t[BI.FOOD_HI] = t[BI.FOOD_HI]! + item.number;
  }
  /* Effects-based food (nourish/cure) require effect data not in ItemView;
   * omitted (caveat). */
}

/** Rod analysis (trait.c:2406). Activation-failure seam absent -> use the
 * conservative "good activation" branch amounts. */
function noticeRod(c: Ctx, item: ItemView): void {
  const { t, R } = c;
  const sv = R.svals;
  if (item.sval === sv.rod_recall) t[BI.RECALL] = t[BI.RECALL]! + item.number * 100;
  else if (item.sval === sv.rod_detection) {
    t[BI.ADETTRAP] = t[BI.ADETTRAP]! + item.number * 100;
    t[BI.ADETDOOR] = t[BI.ADETDOOR]! + item.number * 100;
    t[BI.ADETEVIL] = t[BI.ADETEVIL]! + item.number * 100;
  } else if (item.sval === sv.rod_illumination) t[BI.ALITE] = t[BI.ALITE]! + item.number * 100;
  else if (item.sval === sv.rod_speed) t[BI.ASPEED] = t[BI.ASPEED]! + item.number * 100;
  else if (item.sval === sv.rod_mapping) t[BI.AMAGICMAP] = t[BI.AMAGICMAP]! + item.number * 100;
  else if (item.sval === sv.rod_healing) t[BI.AHEAL] = t[BI.AHEAL]! + item.number * 3;
  else if (
    item.sval === sv.rod_light ||
    item.sval === sv.rod_fire_bolt ||
    item.sval === sv.rod_elec_bolt ||
    item.sval === sv.rod_cold_bolt ||
    item.sval === sv.rod_acid_bolt
  )
    t[BI.AROD1] = t[BI.AROD1]! + item.number;
  else if (
    item.sval === sv.rod_drain_life ||
    item.sval === sv.rod_fire_ball ||
    item.sval === sv.rod_elec_ball ||
    item.sval === sv.rod_cold_ball ||
    item.sval === sv.rod_acid_ball
  )
    t[BI.AROD2] = t[BI.AROD2]! + item.number;
}

/** Credit borg.has[role] for the roles power/prepared query (trait.c:2243). */
function creditHas(c: Ctx, item: ItemView): void {
  const { d, R } = c;
  const sv = R.svals;
  const roleFor: Array<[number | undefined, number | undefined, string]> = [
    [TV_POTION, sv.potion_healing, "potion_healing"],
    [TV_POTION, sv.potion_restore_mana, "potion_restore_mana"],
    [TV_ROD, sv.rod_recall, "rod_recall"],
    [TV_ROD, sv.rod_healing, "rod_healing"],
    [TV_MUSHROOM, sv.mush_stoneskin, "mush_stoneskin"],
    [TV_SCROLL, sv.scroll_mass_banishment, "scroll_mass_banishment"],
    [TV_SCROLL, sv.scroll_remove_curse, "scroll_remove_curse"],
    [TV_SCROLL, sv.scroll_star_remove_curse, "scroll_star_remove_curse"],
    [TV_WAND, sv.wand_magic_missile, "wand_magic_missile"],
    [TV_WAND, sv.wand_stinking_cloud, "wand_stinking_cloud"],
    [TV_WAND, sv.wand_annihilation, "wand_annihilation"],
    [TV_FLASK, sv.flask_oil, "flask_oil"],
  ];
  for (const [tval, sval, role] of roleFor) {
    if (sval !== undefined && item.tval === tval && item.sval === sval)
      addHas(d, role, item.number);
  }
}

/** Spell/device "infinite amount" grants (trait.c:2579). Seam-driven. */
function applySpellGrants(c: Ctx): void {
  const { t, R } = c;
  const s = R.spells;
  const legal = (sp: string) => s.spellLegal(sp);
  const fail = (sp: string, f: number) => s.spellLegalFail(sp, f);
  const eq = (a: string) => s.equipsItem(a);

  if (fail("REMOVE_HUNGER", 80) || fail("HERBAL_CURING", 80)) t[BI.FOOD] = t[BI.FOOD]! + 1000;
  if (legal("IDENTIFY_RUNE")) t[BI.AID] = t[BI.AID]! + 1000;
  if (legal("FIND_TRAPS_DOORS_STAIRS") || legal("DETECTION")) t[BI.ADETTRAP] = 1000;
  if (
    legal("REVEAL_MONSTERS") || legal("DETECT_LIFE") || legal("DETECT_EVIL") ||
    legal("READ_MINDS") || legal("DETECT_MONSTERS") || legal("SEEK_BATTLE")
  )
    t[BI.ADETEVIL] = 1000;
  if (legal("DETECTION") || eq("act_enlightenment") || eq("act_clairvoyance")) {
    t[BI.ADETDOOR] = 1000;
    t[BI.ADETTRAP] = 1000;
    t[BI.ADETEVIL] = 1000;
  }
  if (legal("SENSE_INVISIBLE")) t[BI.DINV] = 1;
  if (legal("SENSE_SURROUNDINGS") || eq("act_detect_all") || eq("act_mapping")) {
    t[BI.ADETDOOR] = 1000;
    t[BI.ADETTRAP] = 1000;
    t[BI.AMAGICMAP] = 1000;
  }
  if (legal("LIGHT_ROOM") || eq("act_light") || eq("act_illumination") || legal("CALL_LIGHT"))
    t[BI.ALITE] = t[BI.ALITE]! + 1000;
  if (legal("PROTECTION_FROM_EVIL") || eq("act_protevil") || eq("act_staff_holy"))
    t[BI.APFE] = t[BI.APFE]! + 1000;
  if (legal("GLYPH_OF_WARDING") || eq("act_glyph")) t[BI.AGLYPH] = t[BI.AGLYPH]! + 1000;
  if (legal("FIND_TRAPS_DOORS_STAIRS")) {
    t[BI.ADETDOOR] = 1000;
    t[BI.ADETTRAP] = 1000;
  }
  if (fail("ENCHANT_WEAPON", 65) || eq("act_enchant_weapon")) {
    t[BI.AENCH_TOH] = t[BI.AENCH_TOH]! + 1000;
    t[BI.AENCH_TOD] = t[BI.AENCH_TOD]! + 1000;
    t[BI.AENCH_SWEP] = t[BI.AENCH_SWEP]! + 1000;
  }
  if (eq("act_enchant_tohit")) t[BI.AENCH_TOH] = t[BI.AENCH_TOH]! + 1000;
  if (eq("act_enchant_todam")) t[BI.AENCH_TOD] = t[BI.AENCH_TOD]! + 1000;
  if (eq("act_firebrand") || fail("BRAND_AMMUNITION", 65)) t[BI.ABRAND] = t[BI.ABRAND]! + 1000;
  if (fail("ENCHANT_ARMOUR", 65) || eq("act_enchant_armor") || eq("act_enchant_armor2")) {
    t[BI.AENCH_ARM] = t[BI.AENCH_ARM]! + 1000;
    t[BI.AENCH_SARM] = t[BI.AENCH_SARM]! + 1000;
  }
  if (fail("TURN_STONE_TO_MUD", 40) || eq("act_stone_to_mud") || s.equipsRing(c.R.svals.ring_digging ?? -999))
    t[BI.ADIGGER] = t[BI.ADIGGER]! + 1;
  if (fail("WORD_OF_RECALL", 40) || (t[BI.CDEPTH]! === 100 && legal("WORD_OF_RECALL")))
    t[BI.RECALL] = t[BI.RECALL]! + 1000;
  if (eq("act_recall")) t[BI.RECALL] = t[BI.RECALL]! + 1;
  if (fail("TELEPORT_LEVEL", 20)) t[BI.ATELEPORTLVL] = t[BI.ATELEPORTLVL]! + 1000;
  if (fail("PHASE_DOOR", 3)) t[BI.APHASE] = t[BI.APHASE]! + 1000;
  if (eq("act_tele_phase")) t[BI.APHASE] = t[BI.APHASE]! + 1;
  if (fail("TELEPORT_SELF", 1) || fail("PORTAL", 1) || fail("SHADOW_SHIFT", 1) || fail("DIMENSION_DOOR", 1))
    t[BI.ATELEPORT] = t[BI.ATELEPORT]! + 1000;
  if (eq("act_tele_long")) {
    t[BI.AESCAPE] = t[BI.AESCAPE]! + 1;
    t[BI.ATELEPORT] = t[BI.ATELEPORT]! + 1;
  }
  if (fail("TELEPORT_OTHER", 40)) t[BI.ATPORTOTHER] = t[BI.ATPORTOTHER]! + 1000;
  if (legal("HOLY_WORD")) t[BI.AHWORD] = t[BI.AHWORD]! + 1000;
  if (legal("HASTE_SELF") || eq("act_haste") || eq("act_haste1") || eq("act_haste2"))
    t[BI.ASPEED] = t[BI.ASPEED]! + 1000;
  if (eq("act_cure_light")) t[BI.ACLW] = t[BI.ACLW]! + 1000;
  if (eq("act_cure_serious")) t[BI.ACSW] = t[BI.ACSW]! + 1000;
  if (eq("act_cure_critical")) t[BI.ACCW] = t[BI.ACCW]! + 1000;
  if (
    eq("act_cure_full") || eq("act_cure_full2") || eq("act_cure_nonorlybig") ||
    eq("act_heal1") || eq("act_heal2") || eq("act_heal3") || legal("HEALING")
  )
    t[BI.AHEAL] = t[BI.AHEAL]! + 1000;
  if (
    eq("act_cure_nonorlybig") || eq("act_restore_exp") || eq("act_restore_st_lev") ||
    eq("act_restore_life")
  )
    t[BI.HASFIXEXP] = 1;
  if (
    legal("REMEMBRANCE") || eq("act_cure_nonorlybig") || eq("act_restore_exp") ||
    eq("act_restore_st_lev") || eq("act_restore_life")
  )
    t[BI.HLIFE] = 1;
  if (eq("act_recharge") || legal("RECHARGING")) t[BI.ARECHARGE] = t[BI.ARECHARGE]! + 1000;
}

/** Final folds (trait.c:2865-2953): swap-resists, carry, ratio, prep-fight. */
function finishNotice(c: Ctx): void {
  const { t, R } = c;
  const s = R.spells;

  /* Swap subsystem is out of scope; swap resists resolve to base + any spell
   * resistance the seam grants (trait.c:2865). Defaults: SR* == R*. */
  const resSpell = s.spellLegalFail("RESISTANCE", 15);
  t[BI.SRACID] = t[BI.RACID]! || resSpell ? 1 : 0;
  t[BI.SRELEC] = t[BI.RELEC]! || resSpell ? 1 : 0;
  t[BI.SRFIRE] = t[BI.RFIRE]! || resSpell ? 1 : 0;
  t[BI.SRCOLD] = t[BI.RCOLD]! || resSpell ? 1 : 0;
  t[BI.SRPOIS] = t[BI.RPOIS]! || s.spellLegalFail("RESIST_POISON", 15) ? 1 : 0;
  t[BI.SRFEAR] = t[BI.RFEAR]!;
  t[BI.SRLITE] = t[BI.RLITE]!;
  t[BI.SRDARK] = t[BI.RDARK]!;
  t[BI.SRBLIND] = t[BI.RBLIND]!;
  t[BI.SRCONF] = t[BI.RCONF]!;
  t[BI.SRSND] = t[BI.RSND]!;
  t[BI.SRSHRD] = t[BI.RSHRD]!;
  t[BI.SRNXUS] = t[BI.RNXUS]!;
  t[BI.SRNTHR] = t[BI.RNTHR]!;
  t[BI.SRKAOS] = t[BI.RKAOS]!;
  t[BI.SRDIS] = t[BI.RDIS]!;
  t[BI.SHLIFE] = t[BI.HLIFE]!;
  t[BI.SFRACT] = t[BI.FRACT]!;

  /* Carry capacity (trait.c:2914). Encumbrance speed penalty is already folded
   * into the game-derived BI_SPEED, so it is not re-applied here. */
  t[BI.CARRY] = BORG_ADJ_STR_WGT[t[BI.STR_INDEX]!]! * 100;

  /* Big-fight prep (trait.c:2934). */
  t[BI.PREP_BIG_FIGHT] = 0;
  if (t[BI.MAXDEPTH]! >= 99) {
    let totalBigHeal = 0;
    totalBigHeal += t[BI.AEZHEAL]! + t[BI.ALIFE]!;
    totalBigHeal += R.home.numHealTrue + R.home.numEzhealTrue + R.home.numLifeTrue;
    if (totalBigHeal < 30 || R.home.numSpeed + t[BI.ASPEED]! < 15)
      t[BI.PREP_BIG_FIGHT] = 1;
  }
}

/* ---- small helpers / tval constants (list-tvals.h) ---- */

const TV_DIGGING = 6;
const TV_LIGHT = 19;
const TV_STAFF = 22;
const TV_WAND = 23;
const TV_ROD = 24;
const TV_SCROLL = 25;
const TV_POTION = 26;
const TV_FLASK = 27;
const TV_FOOD = 28;
const TV_MUSHROOM = 29;

function isAmmoTval(tval: number): boolean {
  return tval === TV_SHOT || tval === TV_ARROW || tval === TV_BOLT;
}

let _empty: ItemView | null = null;
function emptyItem(): ItemView {
  if (!_empty) {
    _empty = {
      handle: 0, label: "", tval: 0, sval: 0, pval: 0, number: 0, weight: 0,
      ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false,
      flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [],
      egoName: null, artifactName: null, activation: false, timeout: 0,
      inscription: null,
    };
  }
  return _empty;
}

/**
 * Home valuation - a faithful port of borg-home-notice.c (borg_notice_home:941,
 * counting what the home holds) and borg-home-power.c (borg_power_home:532,
 * valuing it). Together they decide what is worth stashing at / retrieving from
 * the home.
 *
 * Unlike the buy/sell PLAYER-power deltas, the home power is PURE arithmetic over
 * the home wares plus the borg's worn gear, so it is computed directly here (no
 * seam). The only parts that read engine internals the frozen view does not
 * surface - castable spells, an equipped glyph, the player race's innate element
 * resists, and per-weapon blow count - are folded into the HomeExtras seam
 * (store.ts) with inert defaults (borg-home-notice.c:794-931).
 *
 * borg_notice_home has three modes (borg-home-notice.c:936):
 *  - full  (in_item null, no_items false): all home wares + worn equipment.
 *  - empty (no_items true): no wares, no equipment (the innate section only).
 *  - single(in_item set): exactly that one ware, no equipment.
 * The port expresses these via noticeHome({ items, includeEquip }).
 */

import type { BorgContext } from "../context";
import type { ItemView, StoreItemView } from "@neo-angband/core";
import { BI } from "../trait/trait-index";
import { STAT_MAX, STAT_STR, STAT_INT, STAT_WIS, STAT_DEX, STAT_CON,
  CLASS_WARRIOR, spellStatForClass } from "../trait/trait-index";
import { hasFlag, mod, resLevel } from "../trait/item-util";
import { TV, SVAL } from "../item/svals";
import {
  type StoreDeps,
  type HomeExtras,
  st,
  iqty,
  isAware,
  needsIdent,
  homeWares,
  DEFAULT_MAX_STACK,
} from "./store";

/* ------------------------------------------------------------------ *
 * The counts borg_notice_home derives (borg-home-notice.c:39-138).
 * Only the fields borg_power_home reads are load-bearing; the rest are
 * computed for completeness and for callers that mirror the trait home seam.
 * ------------------------------------------------------------------ */

/** The home "amounts" (borg-home-notice.h:31-131). */
export interface HomeCounts {
  num_food: number;
  num_fuel: number;
  num_mold: number;
  num_ident: number;
  num_recall: number;
  num_phase: number;
  num_escape: number;
  num_tele_staves: number;
  num_teleport: number;
  num_berserk: number;
  num_teleport_level: number;
  num_recharge: number;
  num_cure_critical: number;
  num_cure_serious: number;
  num_pot_rheat: number;
  num_pot_rcold: number;
  num_missile: number;
  num_book: number[]; /* [9] */
  num_fix_stat: number[]; /* [STAT_MAX] */
  home_stat_add: number[]; /* [STAT_MAX] */
  num_fix_exp: number;
  num_mana: number;
  num_heal: number;
  num_ezheal: number;
  num_life: number;
  num_pfe: number;
  num_glyph: number;
  num_mass_genocide: number;
  num_genocide: number;
  num_speed: number;
  num_enchant_to_a: number;
  num_enchant_to_d: number;
  num_enchant_to_h: number;
  num_artifact: number;
  num_ego: number;
  home_slot_free: number;
  home_un_id: number;
  home_damage: number;
  num_duplicate_items: number;
  num_slow_digest: number;
  num_regenerate: number;
  num_telepathy: number;
  num_LIGHT: number;
  num_see_inv: number;
  num_ffall: number;
  num_free_act: number;
  num_hold_life: number;
  num_immune_acid: number;
  num_immune_elec: number;
  num_immune_fire: number;
  num_immune_cold: number;
  num_resist_acid: number;
  num_resist_elec: number;
  num_resist_fire: number;
  num_resist_cold: number;
  num_resist_pois: number;
  num_resist_conf: number;
  num_resist_sound: number;
  num_resist_LIGHT: number;
  num_resist_dark: number;
  num_resist_chaos: number;
  num_resist_disen: number;
  num_resist_shard: number;
  num_resist_nexus: number;
  num_resist_blind: number;
  num_resist_neth: number;
  num_sustain_str: number;
  num_sustain_int: number;
  num_sustain_wis: number;
  num_sustain_dex: number;
  num_sustain_con: number;
  num_sustain_all: number;
  num_edged_weapon: number;
  num_bad_gloves: number;
  num_weapons: number;
  num_bow: number;
  num_rings: number;
  num_neck: number;
  num_armor: number;
  num_cloaks: number;
  num_shields: number;
  num_hats: number;
  num_gloves: number;
  num_boots: number;
}

function zeroCounts(): HomeCounts {
  return {
    num_food: 0, num_fuel: 0, num_mold: 0, num_ident: 0, num_recall: 0,
    num_phase: 0, num_escape: 0, num_tele_staves: 0, num_teleport: 0,
    num_berserk: 0, num_teleport_level: 0, num_recharge: 0,
    num_cure_critical: 0, num_cure_serious: 0, num_pot_rheat: 0,
    num_pot_rcold: 0, num_missile: 0,
    num_book: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    num_fix_stat: [0, 0, 0, 0, 0],
    home_stat_add: [0, 0, 0, 0, 0],
    num_fix_exp: 0, num_mana: 0, num_heal: 0, num_ezheal: 0, num_life: 0,
    num_pfe: 0, num_glyph: 0, num_mass_genocide: 0, num_genocide: 0,
    num_speed: 0, num_enchant_to_a: 0, num_enchant_to_d: 0, num_enchant_to_h: 0,
    num_artifact: 0, num_ego: 0, home_slot_free: 0, home_un_id: 0,
    home_damage: 0, num_duplicate_items: 0, num_slow_digest: 0,
    num_regenerate: 0, num_telepathy: 0, num_LIGHT: 0, num_see_inv: 0,
    num_ffall: 0, num_free_act: 0, num_hold_life: 0, num_immune_acid: 0,
    num_immune_elec: 0, num_immune_fire: 0, num_immune_cold: 0,
    num_resist_acid: 0, num_resist_elec: 0, num_resist_fire: 0,
    num_resist_cold: 0, num_resist_pois: 0, num_resist_conf: 0,
    num_resist_sound: 0, num_resist_LIGHT: 0, num_resist_dark: 0,
    num_resist_chaos: 0, num_resist_disen: 0, num_resist_shard: 0,
    num_resist_nexus: 0, num_resist_blind: 0, num_resist_neth: 0,
    num_sustain_str: 0, num_sustain_int: 0, num_sustain_wis: 0,
    num_sustain_dex: 0, num_sustain_con: 0, num_sustain_all: 0,
    num_edged_weapon: 0, num_bad_gloves: 0, num_weapons: 0, num_bow: 0,
    num_rings: 0, num_neck: 0, num_armor: 0, num_cloaks: 0, num_shields: 0,
    num_hats: 0, num_gloves: 0, num_boots: 0,
  };
}

/** Options for a home notice (mirrors the C's in_item / no_items modes). */
export interface NoticeHomeOpts {
  /** The home wares to consider (empty for an empty-home valuation). */
  items?: ItemView[];
  /** Include the borg's worn equipment (full mode only). */
  includeEquip?: boolean;
}

/** The home art blows helper (borg_calc_blows); default 1 (see HomeExtras). */
function calcBlows(_item: ItemView): number {
  return 1;
}

/** obj_kind_can_browse proxy for a home spellbook. */
function isBook(tval: number): boolean {
  return (
    tval === TV.MAGIC_BOOK || tval === TV.PRAYER_BOOK ||
    tval === TV.NATURE_BOOK || tval === TV.SHADOW_BOOK || tval === TV.OTHER_BOOK
  );
}

/** borg_notice_home_dupe (borg-home-notice.c:282). */
function noticeDupe(
  c: HomeCounts,
  item: ItemView,
  checkSval: boolean,
  index: number,
  all: ItemView[],
  d?: StoreDeps,
): void {
  /* extra-power egos are never treated as duplicates (:294). We lack random-power
   * ego data (frozen view), so approximate: an ego that needs *ID* is skipped. */
  if (item.ego && needsIdent(item, d)) return;
  /* if it isn't identified, it isn't duplicate (:298). */
  if (needsIdent(item, d)) return;

  let dupeCount = iqty(item) - 1;
  for (let x = 0; x < index; x++) {
    const item2 = all[x];
    if (!item2 || iqty(item2) === 0 || !isAware(item2, d)) continue;
    if (
      item.tval === item2.tval &&
      (checkSval ? item.sval === item2.sval : true) &&
      (item.artifactName ?? null) === (item2.artifactName ?? null) &&
      (item.egoName ?? null) === (item2.egoName ?? null)
    ) {
      dupeCount++;
    }
  }
  /* two ring slots allow one ring dupe (:332). */
  if (item.tval === TV.RING && dupeCount) dupeCount--;
  c.num_duplicate_items += dupeCount;
}

/**
 * borg_notice_home (borg-home-notice.c:941). Returns the derived HomeCounts for
 * the given home contents.
 */
export function borgNoticeHome(
  ctx: BorgContext,
  opts: NoticeHomeOpts,
  d?: StoreDeps,
): HomeCounts {
  const c = zeroCounts();
  const ex: HomeExtras = d?.home ?? {};
  const items = opts.items ?? [];
  const equip = opts.includeEquip
    ? ctx.view.equipment().filter((i): i is ItemView => !!i && i.number > 0)
    : [];

  const P = SVAL.potion;
  const Sc = SVAL.scroll;
  const F = SVAL.food;
  const Ro = SVAL.rod;
  const Sf = SVAL.staff;
  const storeInvenLen = items.length; /* boundary: home vs equip in the list. */

  /* The combined scan list: home wares first, then worn equipment (mirrors the
   * C's borg_shops[BORG_HOME].ware[] then borg_items[INVEN_WIELD..]). */
  const all: ItemView[] = [...items, ...equip];

  /* Home free slots: the empty home ware slots (borg-home-notice.c:370). */
  c.home_slot_free = Math.max(
    0,
    (d?.storeInvenMax ?? 24) - storeInvenLen,
  );

  const lightSval = ctx.view.equipment().find((i) => i && i.tval === TV.LIGHT)?.sval;

  for (let i = 0; i < all.length; i++) {
    const item = all[i]!;
    const fromHome = i < storeInvenLen;
    if (iqty(item) === 0) continue;
    if (!isAware(item, d)) continue;

    if (hasFlag(item, "SLOW_DIGEST")) c.num_slow_digest += iqty(item);
    if (hasFlag(item, "REGEN")) c.num_regenerate += iqty(item);
    if (hasFlag(item, "TELEPATHY")) c.num_telepathy += iqty(item);
    if (hasFlag(item, "SEE_INVIS")) c.num_see_inv += iqty(item);
    if (hasFlag(item, "FEATHER")) c.num_ffall += iqty(item);
    if (hasFlag(item, "FREE_ACT")) c.num_free_act += iqty(item);
    if (hasFlag(item, "HOLD_LIFE")) c.num_hold_life += iqty(item);
    if (hasFlag(item, "PROT_CONF")) c.num_resist_conf += iqty(item);
    if (hasFlag(item, "PROT_BLIND")) c.num_resist_blind += iqty(item);

    if (resLevel(item, "FIRE") === 3) {
      c.num_immune_fire += iqty(item);
      c.num_resist_fire += iqty(item);
    }
    if (resLevel(item, "ACID") === 3) {
      c.num_immune_acid += iqty(item);
      c.num_resist_acid += iqty(item);
    }
    if (resLevel(item, "COLD") === 3) {
      c.num_immune_cold += iqty(item);
      c.num_resist_cold += iqty(item);
    }
    if (resLevel(item, "ELEC") === 3) {
      c.num_immune_elec += iqty(item);
      c.num_resist_elec += iqty(item);
    }
    if (resLevel(item, "ACID") === 1) c.num_resist_acid += iqty(item);
    if (resLevel(item, "ELEC") === 1) c.num_resist_elec += iqty(item);
    if (resLevel(item, "FIRE") === 1) c.num_resist_fire += iqty(item);
    if (resLevel(item, "COLD") === 1) c.num_resist_cold += iqty(item);
    if (resLevel(item, "POIS") === 1) c.num_resist_pois += iqty(item);
    if (resLevel(item, "SOUND") === 1) c.num_resist_sound += iqty(item);
    if (resLevel(item, "LIGHT") === 1) c.num_resist_LIGHT += iqty(item);
    if (resLevel(item, "DARK") === 1) c.num_resist_dark += iqty(item);
    if (resLevel(item, "CHAOS") === 1) c.num_resist_chaos += iqty(item);
    if (resLevel(item, "DISEN") === 1) c.num_resist_disen += iqty(item);
    if (resLevel(item, "SHARD") === 1) c.num_resist_shard += iqty(item);
    if (resLevel(item, "NEXUS") === 1) c.num_resist_nexus += iqty(item);
    if (resLevel(item, "NETHER") === 1) c.num_resist_neth += iqty(item);

    /* Sustains (borg-home-notice.c:442; note the upstream quirk: SUST_INT/WIS/
     * DEX/CON all add to num_sustain_STR, preserved verbatim). */
    if (hasFlag(item, "SUST_STR")) c.num_sustain_str += iqty(item);
    if (hasFlag(item, "SUST_INT")) c.num_sustain_str += iqty(item);
    if (hasFlag(item, "SUST_WIS")) c.num_sustain_str += iqty(item);
    if (hasFlag(item, "SUST_DEX")) c.num_sustain_str += iqty(item);
    if (hasFlag(item, "SUST_CON")) c.num_sustain_str += iqty(item);
    if (
      hasFlag(item, "SUST_STR") && hasFlag(item, "SUST_INT") &&
      hasFlag(item, "SUST_WIS") && hasFlag(item, "SUST_DEX") &&
      hasFlag(item, "SUST_CON")
    )
      c.num_sustain_all += iqty(item);

    /* stat modifiers (:461; rings only count above +3). */
    const addStat = (statCode: string, statIdx: number): void => {
      const v = mod(item, statCode);
      if (!v) return;
      if (item.tval !== TV.RING || v > 3)
        c.home_stat_add[statIdx]! += v * iqty(item);
    };
    addStat("STR", STAT_STR);
    addStat("INT", STAT_INT);
    addStat("WIS", STAT_WIS);
    addStat("DEX", STAT_DEX);
    addStat("CON", STAT_CON);

    c.num_speed += mod(item, "SPEED") * iqty(item);

    if (item.artifact) c.num_artifact += iqty(item);
    /* egos that need *ID* (:495): approximate random-power ego by needs_ident. */
    if (item.ego && needsIdent(item, d)) c.num_ego += iqty(item);

    if (needsIdent(item, d) && fromHome) c.home_un_id++;

    switch (item.tval) {
      case TV.SOFT_ARMOR:
      case TV.HARD_ARMOR:
        c.num_armor += iqty(item);
        noticeDupe(c, item, false, i, all, d);
        break;
      case TV.DRAG_ARMOR:
        c.num_armor += iqty(item);
        noticeDupe(c, item, true, i, all, d);
        break;
      case TV.CLOAK:
        c.num_cloaks += iqty(item);
        noticeDupe(c, item, false, i, all, d);
        break;
      case TV.SHIELD:
        c.num_shields += iqty(item);
        noticeDupe(c, item, false, i, all, d);
        break;
      case TV.HELM:
      case TV.CROWN:
        c.num_hats += iqty(item);
        noticeDupe(c, item, false, i, all, d);
        break;
      case TV.GLOVES:
        c.num_gloves += iqty(item);
        c.home_damage += item.toD * 3;
        noticeDupe(c, item, false, i, all, d);
        break;
      case TV.FLASK:
        if (lightSval === SVAL.light.lantern) c.num_fuel += iqty(item);
        break;
      case TV.LIGHT:
        if (lightSval === SVAL.light.torch) c.num_fuel += iqty(item);
        if (item.artifact) c.num_LIGHT += iqty(item);
        break;
      case TV.BOOTS:
        c.num_boots += iqty(item);
        noticeDupe(c, item, false, i, all, d);
        break;
      case TV.SWORD:
      case TV.POLEARM:
      case TV.HAFTED: {
        c.num_weapons += iqty(item);
        /* edged-weapon penalty for blessed-weapon classes (:593). */
        if ((ex.playerFlag && ex.playerFlag("BLESS_WEAPON")) ?? false) {
          if (!(item.tval === TV.HAFTED || hasFlag(item, "BLESSED")))
            c.num_edged_weapon += iqty(item);
        }
        const numBlow = calcBlows(item);
        if (item.toD > 8 || st(ctx, BI.CLEVEL) < 15) {
          c.home_damage +=
            numBlow * (item.dd * item.ds + (st(ctx, BI.TODAM) + item.toD));
        } else {
          c.home_damage +=
            numBlow * (item.dd * item.ds + (st(ctx, BI.TODAM) + 8));
        }
        noticeDupe(c, item, false, i, all, d);
        break;
      }
      case TV.BOW:
        c.num_bow += iqty(item);
        noticeDupe(c, item, false, i, all, d);
        break;
      case TV.RING:
        c.num_rings += iqty(item);
        noticeDupe(c, item, true, i, all, d);
        break;
      case TV.AMULET:
        c.num_neck += iqty(item);
        noticeDupe(c, item, true, i, all, d);
        break;
      case TV.MAGIC_BOOK:
      case TV.PRAYER_BOOK:
      case TV.NATURE_BOOK:
      case TV.SHADOW_BOOK:
      case TV.OTHER_BOOK:
        if (!isBook(item.tval)) break;
        /* only ever store non-dungeon books (:651): approximate KF_GOOD via the
         * isDungeonBook seam (default false -> counted). */
        if (d?.isDungeonBook && d.isDungeonBook(item)) break;
        if (item.sval >= 0 && item.sval < 9) c.num_book[item.sval]! += iqty(item);
        break;
      case TV.FOOD:
        /* Faithful reproduction of borg-home-notice.c:660: only ration and
         * slime_mold ever match a TV_FOOD item; the sv_mush_* comparisons are
         * upstream dead code (mushrooms are TV_MUSHROOM) and never fire, so they
         * are intentionally not reproduced (no behavioural change). */
        if (item.sval === F.ration) c.num_food += iqty(item);
        else if (item.sval === F.slime_mold) c.num_mold += iqty(item);
        break;
      case TV.POTION:
        if (item.sval === P.cure_critical) c.num_cure_critical += iqty(item);
        else if (item.sval === P.cure_serious) c.num_cure_serious += iqty(item);
        else if (item.sval === P.resist_heat) c.num_pot_rheat += iqty(item);
        else if (item.sval === P.resist_cold) c.num_pot_rcold += iqty(item);
        else if (item.sval === P.restore_life) c.num_fix_exp += iqty(item);
        else if (item.sval === P.restore_mana) c.num_mana += iqty(item);
        else if (item.sval === P.healing) c.num_heal += iqty(item);
        else if (item.sval === P.star_healing) c.num_ezheal += iqty(item);
        else if (item.sval === P.life) c.num_life += iqty(item);
        else if (item.sval === P.berserk) c.num_berserk += iqty(item);
        else if (item.sval === P.speed) c.num_speed += iqty(item);
        break;
      case TV.SCROLL:
        if (item.sval === Sc.identify) c.num_ident += iqty(item);
        else if (item.sval === Sc.phase_door) c.num_phase += iqty(item);
        else if (item.sval === Sc.teleport) c.num_teleport += iqty(item);
        else if (item.sval === Sc.word_of_recall) c.num_recall += iqty(item);
        else if (item.sval === Sc.enchant_armor) c.num_enchant_to_a += iqty(item);
        else if (item.sval === Sc.enchant_weapon_to_hit)
          c.num_enchant_to_h += iqty(item);
        else if (item.sval === Sc.enchant_weapon_to_dam)
          c.num_enchant_to_d += iqty(item);
        else if (item.sval === Sc.protection_from_evil) c.num_pfe += iqty(item);
        else if (item.sval === Sc.rune_of_protection) c.num_glyph += iqty(item);
        else if (item.sval === Sc.teleport_level)
          c.num_teleport_level += iqty(item);
        else if (item.sval === Sc.recharging) c.num_recharge += iqty(item);
        else if (item.sval === Sc.mass_banishment)
          c.num_mass_genocide += iqty(item);
        break;
      case TV.ROD:
        if (item.sval === Ro.recall) c.num_recall += iqty(item) * 100;
        break;
      case TV.STAFF:
        /* only staves with >3 charges at high level (:757). */
        if (item.pval <= 3 && st(ctx, BI.CLEVEL) > 30) break;
        if (item.sval === Sf.teleportation) {
          c.num_escape += item.pval * iqty(item);
          c.num_tele_staves++;
        }
        break;
      case TV.SHOT:
      case TV.ARROW:
      case TV.BOLT:
        if (item.tval !== st(ctx, BI.AMMO_TVAL)) break;
        if ((item.value ?? 0) <= 0) break;
        c.num_missile += iqty(item);
        break;
      default:
        break;
    }
  }

  /*** Spells / innate flags (borg-home-notice.c:793). ***/
  const legal = ex.spellLegal ?? ((): boolean => false);
  const legalFail = ex.spellLegalFail ?? ((): boolean => false);

  if (legal("REMOVE_HUNGER") || legal("HERBAL_CURING")) c.num_food += 1000;
  if (legal("IDENTIFY_RUNE")) c.num_ident += 1000;
  if (legalFail("ENCHANT_WEAPON", 65)) {
    c.num_enchant_to_h += 1000;
    c.num_enchant_to_d += 1000;
  }
  if (legal("PROTECTION_FROM_EVIL")) c.num_pfe += 1000;
  if (legal("GLYPH_OF_WARDING") || (ex.equipsGlyph ?? false)) c.num_glyph += 1000;
  if (legal("WORD_OF_RECALL")) c.num_recall += 1000;
  if (legal("TELEPORT_LEVEL")) c.num_teleport_level += 1000;
  if (legal("RECHARGING")) c.num_recharge += 1000;

  /* Sustain-need shortcut (:842). */
  if (st(ctx, BI.SSTR)) c.num_fix_stat[STAT_STR]! += 1000;
  if (st(ctx, BI.SINT)) c.num_fix_stat[STAT_INT]! += 1000;
  if (st(ctx, BI.SWIS)) c.num_fix_stat[STAT_WIS]! += 1000;
  if (st(ctx, BI.SDEX)) c.num_fix_stat[STAT_DEX]! += 1000;
  if (st(ctx, BI.SCON)) c.num_fix_stat[STAT_CON]! += 1000;

  /* Innate player/race flags (:854). Absent a seam these contribute nothing. */
  const pf = ex.playerFlag ?? ((): boolean => false);
  const rr = ex.raceResist ?? ((): number => 0);
  if (pf("SLOW_DIGEST")) c.num_slow_digest++;
  if (pf("FEATHER")) c.num_ffall++;
  if (pf("LIGHT_2") || pf("LIGHT_3")) c.num_LIGHT++;
  if (pf("REGEN")) c.num_regenerate++;
  if (pf("TELEPATHY")) c.num_telepathy++;
  if (pf("SEE_INVIS")) c.num_see_inv++;
  if (pf("FREE_ACT")) c.num_free_act++;
  if (pf("HOLD_LIFE")) c.num_hold_life++;
  if (pf("PROT_CONF")) c.num_resist_conf++;
  if (pf("PROT_BLIND")) c.num_resist_blind++;

  if (rr("FIRE") === 3) c.num_immune_fire++;
  if (rr("ACID") === 3) c.num_immune_acid++;
  if (rr("COLD") === 3) c.num_immune_cold++;
  if (rr("ELEC") === 3) c.num_immune_elec++;
  if (rr("ACID") > 0) c.num_resist_acid++;
  if (rr("ELEC") > 0) c.num_resist_elec++;
  if (rr("FIRE") > 0) c.num_resist_fire++;
  if (rr("COLD") > 0) c.num_resist_cold++;
  if (rr("POIS") > 0) c.num_resist_pois++;
  if (rr("LIGHT") > 0) c.num_resist_LIGHT++;
  if (rr("DARK") > 0) c.num_resist_dark++;
  if (rr("SOUND") > 0) c.num_resist_sound++;
  if (rr("SHARD") > 0) c.num_resist_shard++;
  if (rr("NEXUS") > 0) c.num_resist_nexus++;
  if (rr("NETHER") > 0) c.num_resist_neth++;
  if (rr("CHAOS") > 0) c.num_resist_chaos++;
  if (rr("DISEN") > 0) c.num_resist_disen++;
  if (pf("SUST_STR")) c.num_sustain_str++;
  if (pf("SUST_INT")) c.num_sustain_int++;
  if (pf("SUST_WIS")) c.num_sustain_wis++;
  if (pf("SUST_DEX")) c.num_sustain_dex++;
  if (pf("SUST_CON")) c.num_sustain_con++;

  return c;
}

/** Notice the REAL home (full: wares + worn gear). */
export function noticeHomeFull(ctx: BorgContext, d?: StoreDeps): HomeCounts {
  return borgNoticeHome(ctx, { items: homeWares(ctx), includeEquip: true }, d);
}

/** Notice an EMPTY home (no wares, no gear). */
export function noticeHomeEmpty(ctx: BorgContext, d?: StoreDeps): HomeCounts {
  return borgNoticeHome(ctx, { items: [], includeEquip: false }, d);
}

/** Notice a home holding exactly ONE ware (in_item mode). */
export function noticeHomeSingle(
  ctx: BorgContext,
  item: ItemView,
  d?: StoreDeps,
): HomeCounts {
  return borgNoticeHome(ctx, { items: [item], includeEquip: false }, d);
}

/* ------------------------------------------------------------------ *
 * borg_power_home (borg-home-power.c).
 * ------------------------------------------------------------------ */

/** kb_info[tval].max_stack (default 40). */
const MAX_STACK = DEFAULT_MAX_STACK;

/** borg_power_home_aux1 (borg-home-power.c:32): value of home equipment. */
function powerHomeAux1(ctx: BorgContext, c: HomeCounts): number {
  let value = 0;
  /* The C's "1 -> a, 2 -> b, >2 -> b + (n-2)*step" reward ladder. */
  const ladder = (n: number, a: number, b: number, step: number): number => {
    if (n === 1) return a;
    if (n === 2) return b;
    if (n > 2) return b + (n - 2) * step;
    return 0;
  };

  value += ladder(c.num_LIGHT, 150, 170, 5);
  value += ladder(c.num_slow_digest, 50, 70, 5);
  value += ladder(c.num_regenerate, 75, 100, 10);
  value += ladder(c.num_telepathy, 1000, 1500, 10);
  value += ladder(c.num_see_inv, 800, 1200, 10);
  value += ladder(c.num_ffall, 10, 15, 1);
  value += ladder(c.num_free_act, 1000, 1500, 10);
  value += ladder(c.num_hold_life, 1000, 1500, 10);

  value += ladder(c.num_resist_acid, 1000, 1500, 1);
  value += ladder(c.num_immune_acid, 3000, 5000, 30);
  value += ladder(c.num_resist_elec, 1000, 1500, 1);
  value += ladder(c.num_immune_elec, 3000, 5000, 30);
  value += ladder(c.num_resist_fire, 1000, 1500, 1);
  value += ladder(c.num_immune_fire, 3000, 5000, 30);
  value += ladder(c.num_resist_cold, 1000, 1500, 1);
  value += ladder(c.num_immune_cold, 3000, 5000, 30);
  value += ladder(c.num_resist_pois, 5000, 9000, 40);
  value += ladder(c.num_resist_conf, 2000, 8000, 45);
  value += ladder(c.num_resist_sound, 500, 700, 30);
  value += ladder(c.num_resist_LIGHT, 100, 150, 1);
  value += ladder(c.num_resist_dark, 100, 150, 1);
  value += ladder(c.num_resist_chaos, 1000, 1500, 10);
  value += ladder(c.num_resist_disen, 5000, 7000, 35);
  value += ladder(c.num_resist_shard, 100, 150, 1);
  value += ladder(c.num_resist_nexus, 200, 300, 2);
  value += ladder(c.num_resist_blind, 500, 1000, 5);
  value += ladder(c.num_resist_neth, 3000, 4000, 45);

  /* stat-gain items (:232). */
  const str = c.home_stat_add[STAT_STR]!;
  if (str < 9) value += str * 300;
  else if (str < 15) value += 9 * 300 + (str - 9) * 200;
  else value += 9 * 300 + 6 * 200 + (str - 15) * 1;

  const dex = c.home_stat_add[STAT_DEX]!;
  if (dex < 9) value += dex * 300;
  else if (dex < 15) value += 9 * 300 + (dex - 9) * 200;
  else value += 9 * 300 + 6 * 200 + (dex - 15) * 1;

  const con = c.home_stat_add[STAT_CON]!;
  if (con < 15) value += con * 300;
  else if (con < 21) value += 15 * 300 + (con - 15) * 200;
  else value += 15 * 300 + 6 * 200 + (con - 21) * 1;

  const spellStat = spellStatForClass(st(ctx, BI.CLASS));
  if (spellStat >= 0) {
    const ss = c.home_stat_add[spellStat]!;
    if (ss < 20) value += ss * 400;
    else if (ss < 26) value += 20 * 400 + (ss - 20) * 300;
    else value += 20 * 100 + 6 * 300 + (ss - 26) * 5;
  }

  value += ladder(c.num_sustain_str, 200, 250, 1);
  value += ladder(c.num_sustain_int, 200, 250, 1);
  value += ladder(c.num_sustain_wis, 200, 250, 1);
  value += ladder(c.num_sustain_con, 200, 250, 1);
  value += ladder(c.num_sustain_dex, 200, 250, 1);
  value += ladder(c.num_sustain_all, 1000, 1500, 1);

  /* duplicate penalties (:311). */
  if (c.num_weapons > 5) value -= (c.num_weapons - 5) * 2000;
  else if (c.num_weapons > 1) value -= (c.num_weapons - 1) * 100;
  if (c.num_bow > 2) value -= (c.num_bow - 2) * 1000;
  if (c.num_rings > 6) value -= (c.num_rings - 6) * 4000;
  else if (c.num_rings > 4) value -= (c.num_rings - 4) * 2000;
  if (c.num_neck > 3) value -= (c.num_neck - 3) * 1500;
  else if (c.num_neck > 3) value -= (c.num_neck - 3) * 700; /* upstream dead branch */
  if (c.num_armor > 6) value -= (c.num_armor - 6) * 1000;
  if (c.num_cloaks > 3) value -= (c.num_cloaks - 3) * 1000;
  if (c.num_shields > 3) value -= (c.num_shields - 3) * 1000;
  if (c.num_hats > 4) value -= (c.num_hats - 4) * 1000;
  if (c.num_gloves > 3) value -= (c.num_gloves - 3) * 1000;
  if (c.num_boots > 3) value -= (c.num_boots - 3) * 1000;

  value += c.home_damage;
  value -= c.num_edged_weapon * 50;
  value -= c.num_bad_gloves * 3000;
  value -= c.num_duplicate_items * 50000;

  return value;
}

/** borg_power_home_aux2 (borg-home-power.c:358): value of home inventory. */
function powerHomeAux2(ctx: BorgContext, c: HomeCounts): number {
  let value = 0;
  let k = 0;
  const cle = st(ctx, BI.CLEVEL);
  const maxcle = st(ctx, BI.MAXCLEVEL);
  const maxdepth = st(ctx, BI.MAXDEPTH);
  const cls = st(ctx, BI.CLASS);

  if (maxcle < 10) {
    for (k = 0; k < MAX_STACK && k < c.num_food; k++) value += 8000 - k * 10;
  }
  for (k = 0; k < MAX_STACK && k < c.num_ident; k++) value += 2000 - k * 10;
  if (cle < 45) {
    for (k = 0; k < MAX_STACK && k < c.num_enchant_to_a; k++) value += 500 - k * 10;
  }
  if (cle < 45) {
    for (k = 0; k < MAX_STACK && k < c.num_enchant_to_h; k++) value += 500 - k * 10;
  }
  if (cle < 45) {
    for (k = 0; k < MAX_STACK && k < c.num_enchant_to_d; k++) value += 500 - k * 10;
  }
  for (k = 0; k < MAX_STACK && k < c.num_pfe; k++) value += 500 - k * 10;
  for (k = 0; k < MAX_STACK && k < c.num_glyph; k++) value += 500 - k * 10;
  for (k = 0; k < MAX_STACK * 2 && k < c.num_genocide; k++) value += 500 - k * 10;
  for (k = 0; k < MAX_STACK * 2 && k < c.num_mass_genocide; k++) value += 500;
  for (k = 0; k < MAX_STACK && k < c.num_recharge; k++) value += 500 - k * 10;

  if (cls === CLASS_WARRIOR && maxdepth > 20 && maxdepth < 80) {
    k = 0;
    for (; k < MAX_STACK && k < c.num_pot_rheat; k++) value += 100 - k * 10;
    for (; k < MAX_STACK && k < c.num_pot_rcold; k++) value += 100 - k * 10;
  }

  for (k = 0; k < 5 && k < c.num_recall; k++) value += 100;
  for (k = 0; k < 85 && k < c.num_escape; k++) value += 2000 - k * 10;
  for (k = MAX_STACK; k < c.num_tele_staves; k++) value -= 50000;
  for (k = 0; k < 85 && k < c.num_teleport; k++) value += 5000;

  if (maxcle < 10) {
    for (k = 0; k < MAX_STACK && k < c.num_phase; k++) value += 5000;
  }

  if (st(ctx, BI.MAXSP) > 1) {
    for (k = 0; k < MAX_STACK && k < c.num_mana; k++) value += 6000 - k * 8;
  }

  if (cle === 1) {
    for (k = 0; k < 10 && k < c.num_heal; k++) value -= 5000;
  }

  /*** Healing ***/
  for (k = 0; k < MAX_STACK && k < c.num_cure_critical; k++) value += 1500 - k * 10;
  for (k = 0; k < 90 && k < c.num_heal; k++) value += 3000;
  for (k = 0; k < 198 && k < c.num_ezheal; k++) value += 8000;
  for (k = 0; k < 198 && k < c.num_life; k++) value += 9000;

  if (cle > 35)
    for (k = 0; k < 90 && k < c.num_cure_serious; k++) value -= 1500 - k * 10;

  /*** Various ***/
  if (cle === 50 && c.num_fix_exp) value -= 7500;
  if (cle > 35 && cle <= 49)
    for (k = 0; k < 70 && k < c.num_fix_exp; k++) value += 1000 - k * 10;
  else if (cle <= 35)
    for (k = 0; k < 5 && k < c.num_fix_exp; k++) value += 1000 - k * 10;

  /*** books ***/
  for (let book = 0; book < 9; book++) {
    if (cle < 15) {
      for (k = 0; k < 5 && k < c.num_book[book]!; k++) {
        if (c.num_book[book]!) value += 5000 - k * 10;
      }
    }
  }

  value += c.num_artifact * 500;
  value += c.num_ego * 5000;

  if (c.home_un_id) value += (c.home_un_id - st(ctx, BI.AID)) * 1005;

  return value;
}

/** borg_power_home (borg-home-power.c:532): total home value from HomeCounts. */
export function borgPowerHomeFrom(ctx: BorgContext, c: HomeCounts): number {
  return powerHomeAux1(ctx, c) + powerHomeAux2(ctx, c);
}

/** Convenience: value of the REAL home right now. */
export function borgPowerHome(ctx: BorgContext, d?: StoreDeps): number {
  return borgPowerHomeFrom(ctx, noticeHomeFull(ctx, d));
}

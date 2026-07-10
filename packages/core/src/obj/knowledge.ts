/**
 * The player's object-knowledge (the "rune" learning system), ported from
 * reference/src/obj-knowledge.c (Angband 4.2.6).
 *
 * The learn-by-use half is fully ported: runes are learned on wield
 * (object_learn_on_wield), on attack and defend (equip_learn_on_melee_attack /
 * _ranged_attack / _on_defend, missile_learn_on_ranged_attack), when a flag or
 * element fires in play (equip_learn_flag / equip_learn_element), over time
 * (equip_learn_after_time), from brands/slays biting a monster
 * (player_learn_brand/slay via combat/brand-slay.ts), plus the racial innates
 * at birth (player_learn_innate) and the learn-everything wizard ramp
 * (player_learn_all_runes).
 *
 * The modifier runes gate REAL play: calc_bonuses (player-calcs.c L1942-1981)
 * multiplies every equipped item's modifier by p->obj_k->modifiers, so an
 * unlearned modifier is INERT. Flags, resists, and the to_a/to_h/to_d combat
 * bonuses always apply for the real state and their runes feed the DISPLAYED
 * known_state (character sheet / inspect), which lands with the display task;
 * the knowledge itself is tracked here exactly as upstream so the display
 * work is pure presentation.
 *
 * DEFERRED (ledgered in parity/ledger/obj-knowledge.yaml): the per-object
 * obj->known twin (display-only shadow copies: "had a chance to notice"
 * markers, object_fully_known short-circuits, update_player_object_knowledge's
 * gear/store sweep), rune inscriptions (rune_note), monster-lore learning from
 * brands/slays (lore is #24), and shapechange learning (shapes are bound raw).
 */

import { FlagSet } from "../bitflag";
import type { RandomValue } from "../rng";
import type { GameObject } from "./object";
import { sameMonstersSlain, tvalIsBodyArmor } from "./object";
import type {
  Brand,
  Curse,
  ObjectKind,
  ObjectProperty,
  Slay,
} from "./types";
import {
  ELEM_HIGH_MAX,
  ELEM_MAX,
  OBJ_MOD_MAX,
  OBJ_PROPERTY,
  OF_SIZE,
  OFID,
} from "./types";
import { OF } from "../generated";
import { OBJ_MOD } from "../generated/object-modifiers";
import { STAT_MAX } from "../player/types";
import type { Player } from "../player/player";

/** obj->notice bits (object.h). */
export const OBJ_NOTICE = {
  WORN: 0x01,
  ASSESSED: 0x02,
  IGNORE: 0x04,
  IMAGINED: 0x08,
} as const;

/**
 * The registry tables and equipment access rune learning reads. Built once
 * per game (session/game.ts wireGame) from the bound registries; the harness
 * provides an inert default for worldless tests.
 */
export interface RuneEnv {
  brands: readonly (Brand | null)[];
  slays: readonly (Slay | null)[];
  curses: readonly (Curse | null)[];
  properties: readonly (ObjectProperty | null)[];
  /** Element rune names (upstream projections[i].name: "acid", ...). */
  elementNames: readonly string[];
  /** slot_object(p, i): the equipped object in body slot i, or null. */
  slotObject(slot: number): GameObject | null;
  /** randcalc_varies, for object_has_standard_to_h on body armor. */
  randcalcVaries(v: RandomValue): boolean;
  /** Flavor knowledge, for object_flavor_tried on wield. */
  flavor?: FlavorKnowledge;
  /** msg() sink for rune / flag / modifier messages. */
  msg?(text: string): void;
}

/** Optional registry tables for makeRuneEnv (inert defaults when absent). */
export interface RuneEnvTables {
  brands?: readonly (Brand | null)[];
  slays?: readonly (Slay | null)[];
  curses?: readonly (Curse | null)[];
  properties?: readonly (ObjectProperty | null)[];
  elementNames?: readonly string[];
  flavor?: FlavorKnowledge;
  msg?(text: string): void;
}

/**
 * Assemble a RuneEnv from equipment access plus whatever registry tables the
 * caller has; missing tables default to empty (learning against them is a
 * no-op), which keeps worldless harness tests total.
 */
export function makeRuneEnv(
  slotObject: (slot: number) => GameObject | null,
  randcalcVaries: (v: RandomValue) => boolean,
  tables: RuneEnvTables = {},
): RuneEnv {
  return {
    brands: tables.brands ?? [null],
    slays: tables.slays ?? [null],
    curses: tables.curses ?? [null],
    properties: tables.properties ?? [null],
    elementNames: tables.elementNames ?? [],
    slotObject,
    randcalcVaries,
    ...(tables.flavor ? { flavor: tables.flavor } : {}),
    ...(tables.msg ? { msg: tables.msg } : {}),
  };
}

function lookupProp(
  env: RuneEnv,
  type: number,
  propIndex: number,
): ObjectProperty | null {
  for (const p of env.properties) {
    if (p && p.type === type && p.propIndex === propIndex) return p;
  }
  return null;
}

/** "You have learned the rune of %s." (player_learn_rune's msgt). */
function runeMsg(env: RuneEnv, name: string | null): void {
  if (name) env.msg?.(`You have learned the rune of ${name}.`);
}

/**
 * flag_message (obj-properties.c): the property's msg with the object's base
 * name substituted for {name}/%s. Only sent while actually playing.
 */
function flagMessage(p: Player, env: RuneEnv, flag: number, oName: string): void {
  if (!p.upkeep.playing || !env.msg) return;
  const prop = lookupProp(env, OBJ_PROPERTY.FLAG, flag);
  if (!prop || !prop.msg) return;
  env.msg(prop.msg.replace(/\{name\}/g, oName).replace(/%s/g, oName));
}

/** ODESC_BASE approximation until object_desc lands: the kind's plain name. */
export function objBaseName(obj: GameObject): string {
  return obj.kind.name.replace(/[~&]/g, "").trim();
}
const baseName = objBaseName;

/* ------------------------------------------------------------------ *
 * player_knows_* accessors.
 * ------------------------------------------------------------------ */

/** player_knows_brand. */
export function playerKnowsBrand(p: Player, i: number): boolean {
  return p.objKnown.brands[i] ?? false;
}

/** player_knows_slay. */
export function playerKnowsSlay(p: Player, i: number): boolean {
  return p.objKnown.slays[i] ?? false;
}

/** player_knows_curse. */
export function playerKnowsCurse(p: Player, i: number): boolean {
  return (p.objKnown.curses[i] ?? 0) > 0;
}

/* ------------------------------------------------------------------ *
 * player_learn_rune, split by variety (the port has no flat rune list;
 * each case of the upstream switch is a typed function).
 * ------------------------------------------------------------------ */

const COMBAT_RUNE_NAMES = {
  toA: "enchantment to armor",
  toH: "enchantment to hit",
  toD: "enchantment to damage",
} as const;

/** RUNE_VAR_COMBAT: learn one of the three combat runes. */
export function playerLearnCombat(
  p: Player,
  env: RuneEnv,
  which: "toA" | "toH" | "toD",
  message = true,
): boolean {
  if (p.objKnown[which]) return false;
  p.objKnown[which] = 1;
  if (message) runeMsg(env, COMBAT_RUNE_NAMES[which]);
  return true;
}

/** RUNE_VAR_MOD: learn a modifier rune. */
export function playerLearnMod(
  p: Player,
  env: RuneEnv,
  i: number,
  message = true,
): boolean {
  if (p.objKnown.modifiers[i]) return false;
  p.objKnown.modifiers[i] = 1;
  if (message) {
    runeMsg(env, lookupProp(env, OBJ_PROPERTY.MOD, i)?.name ??
      lookupProp(env, OBJ_PROPERTY.STAT, i)?.name ?? null);
  }
  return true;
}

/** RUNE_VAR_RESIST: learn an element rune (high elements only, as the list). */
export function playerLearnResist(
  p: Player,
  env: RuneEnv,
  elem: number,
  message = true,
): boolean {
  if (elem < 0 || elem >= ELEM_HIGH_MAX) return false;
  const el = p.objKnown.elInfo[elem];
  if (!el || el.resLevel) return false;
  el.resLevel = 1;
  if (message) runeMsg(env, env.elementNames[elem] ?? null);
  return true;
}

/** RUNE_VAR_FLAG: learn an object-flag rune. */
export function playerLearnFlagRune(
  p: Player,
  env: RuneEnv,
  flag: number,
  message = true,
): boolean {
  if (p.objKnown.flags.has(flag)) return false;
  p.objKnown.flags.on(flag);
  if (message) {
    runeMsg(env, lookupProp(env, OBJ_PROPERTY.FLAG, flag)?.name ?? null);
  }
  return true;
}

/**
 * RUNE_VAR_BRAND: learn a brand rune; all brands sharing the name are learned
 * together (a rune covers "fire" whatever the multiplier).
 */
export function playerLearnBrand(
  p: Player,
  env: RuneEnv,
  index: number,
  message = true,
): boolean {
  if (playerKnowsBrand(p, index)) return false;
  const name = env.brands[index]?.name;
  if (!name) return false;
  for (let j = 1; j < env.brands.length; j++) {
    if (env.brands[j]?.name === name) p.objKnown.brands[j] = true;
  }
  if (message) runeMsg(env, name);
  return true;
}

/**
 * RUNE_VAR_SLAY: learn a slay rune; all slays hitting the same monsters
 * (same_monsters_slain) are learned together.
 */
export function playerLearnSlay(
  p: Player,
  env: RuneEnv,
  index: number,
  message = true,
): boolean {
  if (playerKnowsSlay(p, index)) return false;
  const s = env.slays[index];
  if (!s) return false;
  for (let j = 1; j < env.slays.length; j++) {
    if (sameMonstersSlain(env.slays, index, j)) p.objKnown.slays[j] = true;
  }
  if (message) runeMsg(env, s.name);
  return true;
}

/** RUNE_VAR_CURSE: learn a curse rune. */
export function playerLearnCurse(
  p: Player,
  env: RuneEnv,
  index: number,
  message = true,
): boolean {
  if (playerKnowsCurse(p, index)) return false;
  if (!env.curses[index]) return false;
  p.objKnown.curses[index] = 1;
  if (message) runeMsg(env, env.curses[index]?.name ?? null);
  return true;
}

/* ------------------------------------------------------------------ *
 * Masks and object predicates.
 * ------------------------------------------------------------------ */

/**
 * create_obj_flag_mask(f, true, id, OFT_MAX): every OF_* flag whose property
 * has the given OFID_* identify type.
 */
export function objFlagMaskById(env: RuneEnv, id: number): FlagSet {
  const mask = new FlagSet(OF_SIZE);
  for (const prop of env.properties) {
    if (prop && prop.type === OBJ_PROPERTY.FLAG && prop.idType === id) {
      mask.on(prop.propIndex);
    }
  }
  return mask;
}

/** sustain_flag(stat): the OF_SUST_* flag for a stat (contiguous block). */
export function sustainFlag(stat: number): number {
  if (stat < 0 || stat >= STAT_MAX) return -1;
  return OF.SUST_STR + stat;
}

/**
 * object_has_standard_to_h: body armor with a fixed kind to_h matches the
 * kind's base; anything else is standard only at to_h == 0.
 */
export function objectHasStandardToH(env: RuneEnv, obj: GameObject): boolean {
  if (tvalIsBodyArmor(obj.tval) && !env.randcalcVaries(obj.kind.toH)) {
    return obj.toH === obj.kind.toH.base;
  }
  return obj.toH === 0;
}

/* ------------------------------------------------------------------ *
 * object_curses_find_*: notice properties supplied by an object's curses,
 * learning both the property rune and the curse rune.
 * ------------------------------------------------------------------ */

function curseLearnCombat(
  p: Player,
  env: RuneEnv,
  obj: GameObject,
  which: "toA" | "toH" | "toD",
): void {
  if (!obj.curses) return;
  for (let i = 1; i < env.curses.length; i++) {
    const c = env.curses[i];
    if (!obj.curses[i]?.power || !c) continue;
    if (c.obj[which] !== 0) {
      playerLearnCombat(p, env, which);
      playerLearnCurse(p, env, i);
    }
  }
}

export function objectCursesFindToA(p: Player, env: RuneEnv, obj: GameObject): void {
  curseLearnCombat(p, env, obj, "toA");
}
export function objectCursesFindToH(p: Player, env: RuneEnv, obj: GameObject): void {
  curseLearnCombat(p, env, obj, "toH");
}
export function objectCursesFindToD(p: Player, env: RuneEnv, obj: GameObject): void {
  curseLearnCombat(p, env, obj, "toD");
}

/** object_curses_find_flags: learn test-mask flags carried by curses. */
export function objectCursesFindFlags(
  p: Player,
  env: RuneEnv,
  obj: GameObject,
  testFlags: FlagSet,
): boolean {
  if (!obj.curses) return false;
  let found = false;
  const oName = baseName(obj);
  for (let i = 1; i < env.curses.length; i++) {
    const c = env.curses[i];
    if (!obj.curses[i]?.power || !c) continue;
    for (let flag = 1; flag < OF.MAX; flag++) {
      if (!c.obj.flags.has(flag) || !testFlags.has(flag)) continue;
      if (!p.objKnown.flags.has(flag)) {
        found = true;
        playerLearnFlagRune(p, env, flag);
        flagMessage(p, env, flag, oName);
      }
      playerLearnCurse(p, env, i);
    }
  }
  return found;
}

/** object_curses_find_modifiers: learn modifier runes carried by curses. */
export function objectCursesFindModifiers(
  p: Player,
  env: RuneEnv,
  obj: GameObject,
): void {
  if (!obj.curses) return;
  for (let i = 1; i < env.curses.length; i++) {
    const c = env.curses[i];
    if (!obj.curses[i]?.power || !c) continue;
    for (let j = 0; j < OBJ_MOD_MAX; j++) {
      if (c.obj.modifiers[j]) {
        if (!p.objKnown.modifiers[j]) {
          playerLearnMod(p, env, j);
          if (p.upkeep.playing) modMessage(env, obj, j);
        }
        playerLearnCurse(p, env, i);
      }
    }
  }
}

/** object_curses_find_element: learn an element rune carried by curses. */
export function objectCursesFindElement(
  p: Player,
  env: RuneEnv,
  obj: GameObject,
  elem: number,
): boolean {
  if (!obj.curses) return false;
  let found = false;
  const oName = baseName(obj);
  for (let i = 1; i < env.curses.length; i++) {
    const c = env.curses[i];
    if (!obj.curses[i]?.power || !c) continue;
    if ((c.obj.elInfo[elem]?.resLevel ?? 0) !== 0) {
      if (!(p.objKnown.elInfo[elem]?.resLevel ?? 0)) {
        env.msg?.(`Your ${oName} glows.`);
        playerLearnResist(p, env, elem);
      }
      playerLearnCurse(p, env, i);
      found = true;
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * Learning from individual objects.
 * ------------------------------------------------------------------ */

/** mod_message (obj-knowledge.c L1492): "You feel..." on noticing a modifier. */
function modMessage(env: RuneEnv, obj: GameObject, mod: number): void {
  if (!env.msg) return;
  const v = obj.modifiers[mod] ?? 0;
  const both = (pos: string, neg: string): string | null =>
    v > 0 ? pos : v < 0 ? neg : null;
  let text: string | null = null;
  switch (mod) {
    case OBJ_MOD.STR: text = both("You feel stronger!", "You feel weaker!"); break;
    case OBJ_MOD.INT: text = both("You feel smarter!", "You feel more stupid!"); break;
    case OBJ_MOD.WIS: text = both("You feel wiser!", "You feel more naive!"); break;
    case OBJ_MOD.DEX: text = both("You feel more dextrous!", "You feel clumsier!"); break;
    case OBJ_MOD.CON: text = both("You feel healthier!", "You feel sicklier!"); break;
    case OBJ_MOD.STEALTH: text = both("You feel stealthier.", "You feel noisier."); break;
    case OBJ_MOD.SPEED: text = both("You feel strangely quick.", "You feel strangely sluggish."); break;
    case OBJ_MOD.BLOWS: text = both("Your weapon tingles in your hands.", "Your weapon aches in your hands."); break;
    case OBJ_MOD.SHOTS: text = both("Your missile weapon tingles in your hands.", "Your missile weapon aches in your hands."); break;
    case OBJ_MOD.INFRA: text = "Your eyes tingle."; break;
    case OBJ_MOD.LIGHT: text = "It glows!"; break;
    default: break;
  }
  if (text) env.msg(text);
}

/**
 * object_learn_on_wield (obj-knowledge.c L1820): learn the properties that
 * become obvious the moment an item is worn or wielded - the obvious
 * (OFID_WIELD) flags with sustains promoted to obvious on stat items, every
 * modifier, and anything the item's curses supply. Guarded by the
 * OBJ_NOTICE_WORN bit and marks flavored wearables tried.
 *
 * Without an env (worldless callers, e.g. unit tests that only exercise the
 * calc_bonuses gate) only the modifier runes are learned, which is the whole
 * real-play effect.
 */
export function objectLearnOnWield(
  player: Player,
  obj: GameObject,
  env?: RuneEnv,
): void {
  if (!env) {
    const known = player.objKnown.modifiers;
    for (let i = 0; i < OBJ_MOD_MAX; i++) {
      if ((obj.modifiers[i] ?? 0) !== 0 && (known[i] ?? 0) === 0) known[i] = 1;
    }
    return;
  }

  /* Check the worn flag. */
  if (obj.notice & OBJ_NOTICE.WORN) return;
  obj.notice |= OBJ_NOTICE.WORN;

  /* Worn means tried (for flavored wearables). */
  env.flavor?.setTried(obj.kind);

  /* The obvious object flags, plus sustains on items with a stat bonus. */
  const obviousMask = objFlagMaskById(env, OFID.WIELD);
  for (let i = 0; i < STAT_MAX; i++) {
    if (obj.modifiers[i]) obviousMask.on(sustainFlag(i));
  }

  /* Learn about obvious, previously unknown flags. */
  const oName = baseName(obj);
  for (let flag = 1; flag < OF.MAX; flag++) {
    if (!obj.flags.has(flag) || !obviousMask.has(flag)) continue;
    if (!player.objKnown.flags.has(flag)) {
      playerLearnFlagRune(player, env, flag);
      flagMessage(player, env, flag, oName);
    }
  }

  /* Learn all modifiers. */
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    if ((obj.modifiers[i] ?? 0) !== 0 && !player.objKnown.modifiers[i]) {
      playerLearnMod(player, env, i);
      if (player.upkeep.playing) modMessage(env, obj, i);
    }
  }

  /* Learn curses. */
  objectCursesFindToA(player, env, obj);
  objectCursesFindToH(player, env, obj);
  objectCursesFindToD(player, env, obj);
  objectCursesFindFlags(player, env, obj, obviousMask);
  objectCursesFindModifiers(player, env, obj);
  for (let i = 0; i < ELEM_MAX; i++) {
    if (player.objKnown.elInfo[i]?.resLevel) {
      objectCursesFindElement(player, env, obj, i);
    }
  }
}

/**
 * missile_learn_on_ranged_attack: firing teaches the to-hit rune (when the
 * missile or launcher is off-standard) and the to-dam rune.
 */
export function missileLearnOnRangedAttack(
  p: Player,
  env: RuneEnv,
  obj: GameObject,
): void {
  if (p.objKnown.toH && p.objKnown.toD) return;
  if (!objectHasStandardToH(env, obj)) playerLearnCombat(p, env, "toH");
  if (obj.toD) playerLearnCombat(p, env, "toD");
  objectCursesFindToH(p, env, obj);
  objectCursesFindToD(p, env, obj);
}

/* ------------------------------------------------------------------ *
 * Learning from the equipment's behaviour.
 * ------------------------------------------------------------------ */

/** equip_learn_on_defend: being hit teaches the to-armor rune. */
export function equipLearnOnDefend(p: Player, env: RuneEnv): void {
  if (p.objKnown.toA) return;
  for (let i = 0; i < p.body.count; i++) {
    const obj = env.slotObject(i);
    if (!obj) continue;
    if (obj.toA) playerLearnCombat(p, env, "toA");
    objectCursesFindToA(p, env, obj);
    if (p.objKnown.toA) return;
  }
  /* Shape to_a: shapes are bound raw; DEFERRED with the shapechange system. */
}

function slotIndexByType(p: Player, type: string): number {
  for (let i = 0; i < p.body.count; i++) {
    if (p.body.slots[i]?.type === type) return i;
  }
  return -1;
}

/**
 * equip_learn_on_ranged_attack: firing teaches the to-hit rune from any
 * off-standard equipment except the weapon and launcher.
 */
export function equipLearnOnRangedAttack(p: Player, env: RuneEnv): void {
  if (p.objKnown.toH) return;
  const weaponSlot = slotIndexByType(p, "WEAPON");
  const bowSlot = slotIndexByType(p, "BOW");
  for (let i = 0; i < p.body.count; i++) {
    if (i === weaponSlot || i === bowSlot) continue;
    const obj = env.slotObject(i);
    if (!obj) continue;
    if (!objectHasStandardToH(env, obj)) playerLearnCombat(p, env, "toH");
    objectCursesFindToH(p, env, obj);
    if (p.objKnown.toH) return;
  }
}

/**
 * equip_learn_on_melee_attack: attacking teaches the to-hit and to-dam runes
 * from any off-standard equipment except the launcher.
 */
export function equipLearnOnMeleeAttack(p: Player, env: RuneEnv): void {
  if (p.objKnown.toH && p.objKnown.toD) return;
  const bowSlot = slotIndexByType(p, "BOW");
  for (let i = 0; i < p.body.count; i++) {
    if (i === bowSlot) continue;
    const obj = env.slotObject(i);
    if (!obj) continue;
    if (!objectHasStandardToH(env, obj)) playerLearnCombat(p, env, "toH");
    if (obj.toD) playerLearnCombat(p, env, "toD");
    objectCursesFindToH(p, env, obj);
    objectCursesFindToD(p, env, obj);
    if (p.objKnown.toH && p.objKnown.toD) return;
  }
}

/**
 * equip_learn_flag: a flag fired in play; learn its rune from any equipped
 * item carrying it (with the flag_message), including via curses.
 */
export function equipLearnFlag(p: Player, env: RuneEnv, flag: number): void {
  if (!flag || flag < 0) return;
  const mask = new FlagSet(OF_SIZE);
  mask.on(flag);
  for (let i = 0; i < p.body.count; i++) {
    const obj = env.slotObject(i);
    if (!obj) continue;
    if (obj.flags.has(flag)) {
      if (!p.objKnown.flags.has(flag)) {
        flagMessage(p, env, flag, baseName(obj));
        playerLearnFlagRune(p, env, flag);
      }
    }
    /* obj->known "had a chance to display" marking: DEFERRED (display). */
    objectCursesFindFlags(p, env, obj, mask);
  }
}

/**
 * equip_learn_element: an element hit the player; learn its rune from any
 * equipped item affecting it (with the glow message), including via curses.
 */
export function equipLearnElement(p: Player, env: RuneEnv, element: number): void {
  if (element < 0 || element >= ELEM_MAX) return;
  if ((p.objKnown.elInfo[element]?.resLevel ?? 0) === 1) return;
  for (let i = 0; i < p.body.count; i++) {
    const obj = env.slotObject(i);
    if (!obj) continue;
    if ((obj.elInfo[element]?.resLevel ?? 0) !== 0) {
      if (p.upkeep.playing) env.msg?.(`Your ${baseName(obj)} glows.`);
      playerLearnResist(p, env, element);
    }
    /* obj->known element marking: DEFERRED (display). */
    objectCursesFindElement(p, env, obj, element);
  }
}

/**
 * equip_learn_after_time: learn the timed (OFID_TIMED) flags the equipment
 * carries; called every 100 game turns from process_world.
 */
export function equipLearnAfterTime(p: Player, env: RuneEnv): void {
  const timedMask = objFlagMaskById(env, OFID.TIMED);
  /* Drop already-known flags; bail if nothing is left to notice. */
  let any = false;
  for (let flag = 1; flag < OF.MAX; flag++) {
    if (!timedMask.has(flag)) continue;
    if (p.objKnown.flags.has(flag)) timedMask.off(flag);
    else any = true;
  }
  if (!any) return;

  for (let i = 0; i < p.body.count; i++) {
    const obj = env.slotObject(i);
    if (!obj) continue;
    const oName = baseName(obj);
    for (let flag = 1; flag < OF.MAX; flag++) {
      if (!obj.flags.has(flag) || !timedMask.has(flag)) continue;
      if (!p.objKnown.flags.has(flag)) flagMessage(p, env, flag, oName);
      playerLearnFlagRune(p, env, flag);
    }
    objectCursesFindFlags(p, env, obj, timedMask);
  }
}

/* ------------------------------------------------------------------ *
 * Bulk learning.
 * ------------------------------------------------------------------ */

/** player_learn_innate: know the racial element and flag runes at birth. */
export function playerLearnInnate(p: Player, env: RuneEnv): void {
  for (let elem = 0; elem < ELEM_MAX; elem++) {
    if ((p.race.elInfo[elem]?.resLevel ?? 0) !== 0) {
      playerLearnResist(p, env, elem, false);
    }
  }
  for (let flag = 1; flag < OF.MAX; flag++) {
    if (p.race.flags.has(flag)) playerLearnFlagRune(p, env, flag, false);
  }
}

/** player_learn_all_runes: learn absolutely everything (wizard mode). */
export function playerLearnAllRunes(p: Player, env: RuneEnv): void {
  playerLearnCombat(p, env, "toA", false);
  playerLearnCombat(p, env, "toH", false);
  playerLearnCombat(p, env, "toD", false);
  for (let i = 0; i < OBJ_MOD_MAX; i++) playerLearnMod(p, env, i, false);
  for (let i = 0; i < ELEM_HIGH_MAX; i++) playerLearnResist(p, env, i, false);
  for (let i = 1; i < OF.MAX; i++) playerLearnFlagRune(p, env, i, false);
  for (let i = 1; i < env.brands.length; i++) playerLearnBrand(p, env, i, false);
  for (let i = 1; i < env.slays.length; i++) playerLearnSlay(p, env, i, false);
  for (let i = 1; i < env.curses.length; i++) playerLearnCurse(p, env, i, false);
}

/**
 * Flavor awareness, ported from the kind->aware / kind->tried bits of
 * reference/src/object.h and the accessors/setters in obj-knowledge.c
 * (object_flavor_is_aware L2243, object_flavor_was_tried L2254,
 * object_flavor_aware L2266, object_flavor_tried L2320).
 *
 * Upstream these two bits live on the shared object_kind template and are
 * global to the running game. This port keeps them out of the immutable bound
 * registry and in a per-game FlavorKnowledge, keyed by kind index (kidx), so a
 * bound ObjRegistry stays reusable across games.
 *
 * "aware" means the player knows what a flavored kind does (has quaffed the
 * potion, etc.); "tried" means a kind of that flavor has been used without the
 * effect being learned. object_value and object_value_base read is_aware to
 * decide between the real cost and a flat per-tval guess.
 */
export class FlavorKnowledge {
  private readonly awareKidx = new Set<number>();
  private readonly triedKidx = new Set<number>();

  /**
   * @param ordinaryKindCount z_info->ordinary_kind_max: kinds at or above this
   * index are INSTA_ART dummies and are never marked tried.
   */
  constructor(private readonly ordinaryKindCount: number) {}

  /** object_flavor_is_aware(obj): is the player aware of this kind's flavor? */
  isAware(kind: ObjectKind): boolean {
    return this.awareKidx.has(kind.kidx);
  }

  /** object_flavor_was_tried(obj): has a kind of this flavor been tried? */
  wasTried(kind: ObjectKind): boolean {
    return this.triedKidx.has(kind.kidx);
  }

  /**
   * object_flavor_aware core (L2266): mark a kind's flavor known; returns true
   * when this made a change. The upstream side effects - revealing
   * obj->known->effect, ignore/autoinscribe fixes, propagating
   * object_set_base_known over gear and every store's stock, and refreshing
   * floor tiles that change glyph on awareness - need the player, stores and
   * cave and are DEFERRED (ledgered in obj-knowledge.yaml); they belong with
   * the known-object and UI wiring.
   */
  setAware(kind: ObjectKind): boolean {
    if (this.awareKidx.has(kind.kidx)) return false;
    this.awareKidx.add(kind.kidx);
    return true;
  }

  /** object_flavor_tried (L2320): mark a kind tried; artifacts are skipped. */
  setTried(kind: ObjectKind): void {
    if (kind.kidx >= this.ordinaryKindCount) return;
    this.triedKidx.add(kind.kidx);
  }

  /** A JSON-safe snapshot of the aware/tried kidx sets, for savefiles. */
  snapshot(): { aware: number[]; tried: number[] } {
    return {
      aware: Array.from(this.awareKidx),
      tried: Array.from(this.triedKidx),
    };
  }

  /** Restore a snapshot() payload (replacing the current knowledge). */
  restore(data: { aware: number[]; tried: number[] }): void {
    this.awareKidx.clear();
    this.triedKidx.clear();
    for (const k of data.aware) this.awareKidx.add(k);
    for (const k of data.tried) this.triedKidx.add(k);
  }
}

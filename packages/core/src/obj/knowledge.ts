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

import { FLAG_START, FlagSet, NO_FLAG } from "../bitflag";
import type { RandomValue } from "../rng";
import type { GameObject } from "./object";
import { sameMonstersSlain, tvalIsBodyArmor, tvalIsJewelry } from "./object";
import type {
  Brand,
  Curse,
  EgoItem,
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
  OFT,
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

/**
 * player_outfit's obvious-flag knowledge (player-birth.c L597-602): at birth the
 * player knows every LIGHT / DIG / THROW / CURSE_ONLY subtype object flag. These
 * are the non-rune "on wield" flags (init_rune skips their subtypes), so without
 * this a mundane torch / digger / thrown item would read as not-fully-known and
 * show a spurious "{??}" in stores and lists. Marking them known here makes such
 * items fully known the moment they are seen, exactly as upstream. Mutates the
 * passed flag set in place.
 */
export function learnBirthObviousFlags(
  known: FlagSet,
  properties: readonly (ObjectProperty | null)[],
): void {
  for (const prop of properties) {
    if (!prop || prop.type !== OBJ_PROPERTY.FLAG) continue;
    if (
      prop.subtype === OFT.LIGHT ||
      prop.subtype === OFT.DIG ||
      prop.subtype === OFT.THROW ||
      prop.subtype === OFT.CURSE_ONLY
    ) {
      known.on(prop.propIndex);
    }
  }
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
 * shape_learn_on_assume (L1892): on taking a shape, learn its obvious
 * (OFID_WIELD) flags and its resists, through the same equipment learn
 * calls upstream uses.
 */
export function shapeLearnOnAssume(
  p: Player,
  env: RuneEnv,
  shape: import("../player/types").Shape,
): void {
  /* Get the shape's obvious flags. */
  const f = shape.flags.clone();
  f.inter(objFlagMaskById(env, OFID.WIELD));

  /* Learn flags. */
  for (let flag = f.next(FLAG_START); flag !== NO_FLAG; flag = f.next(flag + 1)) {
    equipLearnFlag(p, env, flag);
  }

  /* Learn elements. */
  for (let element = 0; element < ELEM_MAX; element++) {
    if (
      (shape.elInfo[element]?.resLevel ?? 0) !== 0 &&
      (p.objKnown.elInfo[element]?.resLevel ?? 0) === 0
    ) {
      equipLearnElement(p, env, element);
    }
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

/* ------------------------------------------------------------------ *
 * The rune list (init_rune) and per-object rune enumeration. The port
 * keeps player rune knowledge in typed stores (objKnown) instead of the
 * upstream flat list, so the list here exists for the consumers that
 * genuinely need enumeration order: EF_IDENTIFY's random unknown rune
 * (upstream poss_runes fills in list order before randint0) and the later
 * knowledge screens.
 * ------------------------------------------------------------------ */

/** enum rune_variety. */
export type RuneVariety =
  | "combat"
  | "mod"
  | "resist"
  | "brand"
  | "slay"
  | "curse"
  | "flag";

/** struct rune, resolved: a variety, its per-variety index, and a name. */
export interface Rune {
  variety: RuneVariety;
  index: number;
  name: string;
}

/** COMBAT_RUNE_TO_A / TO_H / TO_D. */
const COMBAT_RUNE = ["toA", "toH", "toD"] as const;

/**
 * init_rune: build the rune list in the exact upstream order - combat,
 * modifiers, high elements, brands (first of each name), slays (first of
 * each same-monsters group), named curses, then the identifiable flags
 * (subtypes NONE / LIGHT / DIG / THROW / CURSE_ONLY excluded).
 */
export function buildRuneList(env: RuneEnv): Rune[] {
  const runes: Rune[] = [];
  const combatNames = [
    COMBAT_RUNE_NAMES.toA,
    COMBAT_RUNE_NAMES.toH,
    COMBAT_RUNE_NAMES.toD,
  ];
  for (let i = 0; i < 3; i++) {
    runes.push({ variety: "combat", index: i, name: combatNames[i]! });
  }
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    const name =
      lookupProp(env, OBJ_PROPERTY.MOD, i)?.name ??
      lookupProp(env, OBJ_PROPERTY.STAT, i)?.name ??
      "";
    runes.push({ variety: "mod", index: i, name });
  }
  for (let i = 0; i < ELEM_HIGH_MAX; i++) {
    runes.push({ variety: "resist", index: i, name: env.elementNames[i] ?? "" });
  }
  for (let i = 1; i < env.brands.length; i++) {
    const name = env.brands[i]?.name;
    if (!name) continue;
    let counted = false;
    for (let j = 1; j < i; j++) {
      if (env.brands[j]?.name === name) {
        counted = true;
        break;
      }
    }
    if (!counted) runes.push({ variety: "brand", index: i, name });
  }
  for (let i = 1; i < env.slays.length; i++) {
    const s = env.slays[i];
    if (!s?.name) continue;
    let counted = false;
    for (let j = 1; j < i; j++) {
      if (sameMonstersSlain(env.slays, i, j)) counted = true;
    }
    if (!counted) runes.push({ variety: "slay", index: i, name: s.name });
  }
  for (let i = 1; i < env.curses.length; i++) {
    const name = env.curses[i]?.name;
    if (name) runes.push({ variety: "curse", index: i, name });
  }
  for (let i = 1; i < OF.MAX; i++) {
    const prop = lookupProp(env, OBJ_PROPERTY.FLAG, i);
    if (!prop) continue;
    if (
      prop.subtype === OFT.NONE ||
      prop.subtype === OFT.LIGHT ||
      prop.subtype === OFT.DIG ||
      prop.subtype === OFT.THROW ||
      prop.subtype === OFT.CURSE_ONLY
    ) {
      continue;
    }
    runes.push({ variety: "flag", index: i, name: prop.name });
  }
  return runes;
}

/**
 * rune_desc (obj-knowledge.c L344-403): the recall description of a rune. The
 * text is computed per variety (no per-rune desc field in the data pack), so
 * this ports the C switch verbatim. Combat runes have fixed strings keyed by
 * COMBAT_RUNE_TO_A/H/D (obj-knowledge.h L35-37); curse runes read the curse's
 * own desc (curses[index].desc) formatted as "Object %s."; every other variety
 * substitutes the rune's name into its template. Returns "" for an out-of-range
 * curse (the C default falls through to NULL).
 */
export function runeDesc(env: RuneEnv, rune: Rune): string {
  switch (rune.variety) {
    case "combat":
      if (rune.index === 0)
        return "Object magically increases the player's armor class";
      if (rune.index === 1)
        return "Object magically increases the player's chance to hit";
      if (rune.index === 2)
        return "Object magically increases the player's damage";
      return "";
    case "mod":
      return `Object gives the player a magical bonus to ${rune.name}.`;
    case "resist":
      return `Object affects the player's resistance to ${rune.name}.`;
    case "brand":
      return `Object brands the player's attacks with ${rune.name}.`;
    case "slay":
      return `Object makes the player's attacks against ${rune.name} more powerful.`;
    case "curse": {
      const desc = env.curses[rune.index]?.desc;
      return desc ? `Object ${desc}.` : "";
    }
    case "flag":
      return `Object gives the player the property of ${rune.name}.`;
  }
}

/** player_knows_rune over the typed knowledge stores. */
export function playerKnowsRune(p: Player, rune: Rune): boolean {
  switch (rune.variety) {
    case "combat":
      return !!p.objKnown[COMBAT_RUNE[rune.index] as "toA" | "toH" | "toD"];
    case "mod":
      return !!p.objKnown.modifiers[rune.index];
    case "resist":
      return !!p.objKnown.elInfo[rune.index]?.resLevel;
    case "brand":
      return playerKnowsBrand(p, rune.index);
    case "slay":
      return playerKnowsSlay(p, rune.index);
    case "curse":
      return playerKnowsCurse(p, rune.index);
    case "flag":
      return p.objKnown.flags.has(rune.index);
  }
}

/** object_has_rune. */
export function objectHasRune(
  env: RuneEnv,
  obj: GameObject,
  rune: Rune,
): boolean {
  switch (rune.variety) {
    case "combat":
      if (rune.index === 0) return obj.toA !== 0;
      if (rune.index === 1) return !objectHasStandardToH(env, obj);
      return obj.toD !== 0;
    case "mod":
      return (obj.modifiers[rune.index] ?? 0) !== 0;
    case "resist":
      return (obj.elInfo[rune.index]?.resLevel ?? 0) !== 0;
    case "brand": {
      if (!obj.brands) return false;
      for (let i = 0; i < obj.brands.length; i++) {
        if (obj.brands[i] && env.brands[i]?.name === rune.name) return true;
      }
      return false;
    }
    case "slay": {
      if (!obj.slays) return false;
      for (let i = 0; i < obj.slays.length; i++) {
        if (obj.slays[i] && sameMonstersSlain(env.slays, rune.index, i)) {
          return true;
        }
      }
      return false;
    }
    case "curse":
      return (obj.curses?.[rune.index]?.power ?? 0) !== 0;
    case "flag":
      return obj.flags.has(rune.index);
  }
}

/**
 * object_runes_known, reduced to the port's player-rune knowledge model:
 * every rune the object carries is known to the player. (Upstream compares
 * the obj->known twin, which is filled from the same rune knowledge.)
 */
export function objectRunesKnown(
  p: Player,
  env: RuneEnv,
  obj: GameObject,
  runes: readonly Rune[],
): boolean {
  for (const rune of runes) {
    if (objectHasRune(env, obj, rune) && !playerKnowsRune(p, rune)) {
      return false;
    }
  }
  return true;
}

/** player_learn_rune dispatched by variety. */
export function playerLearnRune(
  p: Player,
  env: RuneEnv,
  rune: Rune,
  message: boolean,
): boolean {
  switch (rune.variety) {
    case "combat":
      return playerLearnCombat(
        p,
        env,
        COMBAT_RUNE[rune.index] as "toA" | "toH" | "toD",
        message,
      );
    case "mod":
      return playerLearnMod(p, env, rune.index, message);
    case "resist":
      return playerLearnResist(p, env, rune.index, message);
    case "brand":
      return playerLearnBrand(p, env, rune.index, message);
    case "slay":
      return playerLearnSlay(p, env, rune.index, message);
    case "curse":
      return playerLearnCurse(p, env, rune.index, message);
    case "flag":
      return playerLearnFlagRune(p, env, rune.index, message);
  }
}

/**
 * object_find_unknown_rune: a random unknown rune carried by the object
 * (upstream RNG: candidates gathered in list order, then randint0), or -1.
 */
export function objectFindUnknownRune(
  rng: { randint0(m: number): number },
  p: Player,
  env: RuneEnv,
  obj: GameObject,
  runes: readonly Rune[],
): number {
  if (objectRunesKnown(p, env, obj, runes)) return -1;
  const poss: number[] = [];
  for (let i = 0; i < runes.length; i++) {
    if (objectHasRune(env, obj, runes[i]!) && !playerKnowsRune(p, runes[i]!)) {
      poss.push(i);
    }
  }
  if (poss.length === 0) return -1;
  return poss[rng.randint0(poss.length)]!;
}

/**
 * object_learn_unknown_rune (obj-knowledge.c L1798): learn a random unknown
 * rune from the object; with none left the object is marked assessed. Returns
 * whether a rune was learned.
 *
 * Upstream both branches end in player_know_object (directly at L1806, or via
 * player_learn_rune -> update_player_object_knowledge at L1811), which fires the
 * object_flavor_aware side effect for the object. The port synthesises the
 * known shadow on demand for display, so that awareness half is fired here (a
 * knowledge-UPDATE site) via playerKnowObjectAwareness. `flavor` is optional so
 * callers with no flavor environment (older tests) keep the bare rune-learn.
 */
export function objectLearnUnknownRune(
  rng: { randint0(m: number): number },
  p: Player,
  env: RuneEnv,
  obj: GameObject,
  runes: readonly Rune[],
  flavor?: FlavorKnowledge,
  flavorDeps: FlavorAwareDeps = NOOP_FLAVOR_AWARE_DEPS,
): boolean {
  const i = objectFindUnknownRune(rng, p, env, obj, runes);
  let learned: boolean;
  if (i < 0) {
    /* No unknown runes: assessed (player_know_object rides the known
     * twin, which the port's rune model replaces). */
    obj.notice |= OBJ_NOTICE.ASSESSED;
    learned = false;
  } else {
    learned = playerLearnRune(p, env, runes[i]!, true);
  }
  /* player_know_object's awareness side effect (L1163-1175), fired for this
   * object at the knowledge-update site (never in the display-only shadow). */
  if (flavor) playerKnowObjectAwareness(p, env, obj, runes, flavor, flavorDeps);
  return learned;
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
/**
 * The player-side side effects object_flavor_aware fires beyond flipping the
 * aware bit (obj-knowledge.c L2276-2279). Injected so FlavorKnowledge stays
 * decoupled from the ignore subsystem (obj/ignore.ts IgnoreSettings) and the
 * player's upkeep, mirroring how the rest of the port threads deps. The
 * gear/store base_known sweep and floor re-light are NOT here: the former is
 * covered by the on-demand known shadow, the latter is a display concern (see
 * FlavorKnowledge.objectFlavorAware).
 */
export interface FlavorAwareDeps {
  /** kind_is_ignored_unaware(kind) (obj-ignore.c): ignored while unidentified? */
  isIgnoredUnaware(kidx: number): boolean;
  /** kind_ignore_when_aware(kind) (obj-ignore.c): carry the ignore bit over. */
  ignoreWhenAware(kidx: number): void;
  /** p->upkeep->notice |= PN_IGNORE: request an ignore re-check of the pack. */
  requestIgnoreNotice(): void;
}

/**
 * An inert FlavorAwareDeps for callers that have a FlavorKnowledge but no
 * live ignore/notice environment (birth-time scripting, tests, or a caller
 * that intentionally wants the bare aware-bit flip with none of the L2276-79
 * side effects). Equivalent to the old bare setAware() call.
 */
export const NOOP_FLAVOR_AWARE_DEPS: FlavorAwareDeps = {
  isIgnoredUnaware: () => false,
  ignoreWhenAware: () => {},
  requestIgnoreNotice: () => {},
};

export class FlavorKnowledge {
  private readonly awareKidx = new Set<number>();
  private readonly triedKidx = new Set<number>();

  /**
   * @param ordinaryKindCount z_info->ordinary_kind_max: kinds at or above this
   * index are INSTA_ART dummies and are never marked tried.
   */
  constructor(private readonly ordinaryKindCount: number) {}

  /**
   * z_info->ordinary_kind_max: kinds at or above this index are special-artifact
   * dummies (see obj-knowledge.c L1168's kidx >= ordinary_kind_max test).
   */
  get ordinaryKindMax(): number {
    return this.ordinaryKindCount;
  }

  /** object_flavor_is_aware(obj): is the player aware of this kind's flavor? */
  isAware(kind: ObjectKind): boolean {
    return this.awareKidx.has(kind.kidx);
  }

  /** object_flavor_was_tried(obj): has a kind of this flavor been tried? */
  wasTried(kind: ObjectKind): boolean {
    return this.triedKidx.has(kind.kidx);
  }

  /**
   * The aware-bit half of object_flavor_aware (L2272-2273): mark a kind's
   * flavor known; returns true when this made a change. This is the pure
   * primitive - it flips the bit and nothing else, so it is safe for birth
   * aware-marking (flavor.ts) and savefile restore, which must NOT trigger the
   * ignore re-check. Callers that are the player becoming aware in play should
   * use objectFlavorAware() below, which layers on the awareness side effects.
   */
  setAware(kind: ObjectKind): boolean {
    if (this.awareKidx.has(kind.kidx)) return false;
    this.awareKidx.add(kind.kidx);
    return true;
  }

  /**
   * object_flavor_aware (obj-knowledge.c L2266): the player becomes aware of a
   * flavoured kind AND the awareness side effects fire. Returns true when
   * awareness newly changed (upstream is void; the port surfaces the change so
   * callers can gate a message / redraw).
   *
   * What each upstream step maps to in the port's on-demand-shadow model:
   * - kind->aware = true (L2272-2273): setAware below.
   * - obj->known->effect = obj->effect (L2274): the port keeps NO persistent
   *   obj->known twin; the known shadow is synthesised on demand and
   *   objectSetBaseKnown (known-object.ts L157-170) already fills shadow.effect
   *   from deps.isAware(kind). Once the bit above flips, every later synthesis
   *   reveals the effect automatically - there is nothing to write here.
   * - ignore/autoinscribe fix (L2276-2279): ported below via `deps`.
   * - object_set_base_known over p->gear and every store's stock (L2281-2290):
   *   a NO-OP in the port. Those are exactly the twins that are synthesised on
   *   demand and re-read the freshly-flipped aware bit, so there is no stored
   *   copy to re-sweep. (Building a persistent twin to sweep is the separate
   *   DEFERRED obj->known item, out of scope here.)
   * - floor-tile re-light for kinds that change glyph on awareness
   *   (L2293-2312): a cave/display concern, outside packages/core/src/obj.
   *
   * @returns true iff the kind was not already aware.
   */
  objectFlavorAware(kind: ObjectKind, deps: FlavorAwareDeps): boolean {
    /* if (obj->kind->aware) return; obj->kind->aware = true; (L2272-2273). The
     * obj->known->effect reveal (L2274) is covered by the on-demand shadow. */
    if (!this.setAware(kind)) return false;

    /* Fix ignore/autoinscribe (L2276-2279): an item ignored while unaware keeps
     * being ignored now that it is aware, then flag an ignore re-check. */
    if (deps.isIgnoredUnaware(kind.kidx)) deps.ignoreWhenAware(kind.kidx);
    deps.requestIgnoreNotice();

    /* Gear/store base_known sweep (L2281-2290) and floor re-light (L2293-2312)
     * are on-demand-covered / display-layer respectively; see the doc above. */
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

/**
 * The per-game "everseen" knowledge (object.h struct object_kind.everseen and
 * struct ego_item.everseen). Upstream these bits live on the shared kind/ego
 * templates and are global to the running game; this port keeps them out of the
 * immutable bound registry - exactly like FlavorKnowledge - in a per-game store
 * keyed by kind index (kidx) and ego index (eidx), so a bound ObjRegistry stays
 * reusable across games and the flags ride the save (save.c L397, L533).
 *
 * A kind or ego is marked everseen the first time the player sees an item whose
 * name they know: object_desc sets obj->kind->everseen once the flavour is
 * aware, and obj->ego->everseen once the ego is identified (obj-desc.c
 * L633-637), plus player-birth.c L658 marks each bought start-item's kind. The
 * object-knowledge browser lists a kind when it is everseen OR flavoured
 * (ui-knowledge.c L2157); the ego browser lists an ego when it is everseen
 * (L1847).
 *
 * Marking is a pure Set insert: it draws no RNG and does not depend on draw
 * order, so wiring it into object_desc/generation cannot perturb determinism.
 */
export class EverseenKnowledge {
  private readonly seenKidx = new Set<number>();
  private readonly seenEidx = new Set<number>();

  /** obj->kind->everseen: has the player ever seen this kind (name known)? */
  kindSeen(kind: ObjectKind): boolean {
    return this.seenKidx.has(kind.kidx);
  }

  /** obj->ego->everseen: has the player ever seen this ego (identified)? */
  egoSeen(ego: EgoItem): boolean {
    return this.seenEidx.has(ego.eidx);
  }

  /** obj->kind->everseen = true (obj-desc.c L637 / player-birth.c L658). */
  markKind(kind: ObjectKind): void {
    this.seenKidx.add(kind.kidx);
  }

  /** obj->ego->everseen = true (obj-desc.c L634). */
  markEgo(ego: EgoItem): void {
    this.seenEidx.add(ego.eidx);
  }

  /** A JSON-safe snapshot of the seen kidx/eidx sets, for savefiles. */
  snapshot(): { kinds: number[]; egos: number[] } {
    return {
      kinds: Array.from(this.seenKidx),
      egos: Array.from(this.seenEidx),
    };
  }

  /** Restore a snapshot() payload (replacing the current knowledge). */
  restore(data: { kinds: number[]; egos: number[] }): void {
    this.seenKidx.clear();
    this.seenEidx.clear();
    for (const k of data.kinds) this.seenKidx.add(k);
    for (const e of data.egos) this.seenEidx.add(e);
  }
}

/**
 * The per-kind autoinscription registry (object.h L241-242's
 * kind->note_aware / kind->note_unaware). Upstream these two quark strings
 * live on the shared object_kind template and are global to the running game;
 * this port keeps them out of the immutable bound registry - like
 * FlavorKnowledge and IgnoreSettings - in a per-game store keyed by kind index
 * (kidx), so a bound ObjRegistry stays reusable across games and the notes ride
 * the save.
 *
 * get(kidx, aware) is get_autoinscription (obj-ignore.c L229): the aware note
 * when the kind is aware, else the unaware note. set() is
 * add_autoinscription / remove_autoinscription (obj-ignore.c L322 / L294): a
 * non-empty note registers that slot, an empty note clears it (upstream's
 * NULL-inscription -> remove_autoinscription path).
 *
 * This is the KIND-note half only. The separate rune-based autoinscription
 * (runes_autoinscribe, obj-ignore.c L217) rides the rune-knowledge system and
 * stays ledger-deferred (#24).
 */
export class AutoinscriptionRegistry {
  /** kind->note_aware / note_unaware, keyed by kidx. Absent slot == no note. */
  private readonly notes = new Map<number, { aware?: string; unaware?: string }>();

  /** get_autoinscription(kind, aware) (obj-ignore.c L229). */
  get(kidx: number, aware: boolean): string | undefined {
    const rec = this.notes.get(kidx);
    if (!rec) return undefined;
    return aware ? rec.aware : rec.unaware;
  }

  /**
   * add_autoinscription (obj-ignore.c L322) / remove_autoinscription (L294):
   * register the aware or unaware note for a kind. An empty note clears that
   * slot (upstream's null-inscription branch); a kind with neither slot set is
   * dropped from the map entirely.
   */
  set(kidx: number, note: string, aware: boolean): void {
    const rec = this.notes.get(kidx) ?? {};
    if (note.length > 0) {
      if (aware) rec.aware = note;
      else rec.unaware = note;
    } else if (aware) {
      delete rec.aware;
    } else {
      delete rec.unaware;
    }
    if (rec.aware === undefined && rec.unaware === undefined) {
      this.notes.delete(kidx);
    } else {
      this.notes.set(kidx, rec);
    }
  }

  /** remove_autoinscription (obj-ignore.c L294): clear both slots for a kind. */
  clear(kidx: number): void {
    this.notes.delete(kidx);
  }

  /** Every kind with a registered note (either slot), for the management UI. */
  entries(): Array<[number, { aware?: string; unaware?: string }]> {
    return Array.from(this.notes.entries()).map(([kidx, rec]) => [
      kidx,
      { ...rec },
    ]);
  }
}

/**
 * get_autoinscription (obj-ignore.c L229) as a free function over the registry,
 * mirroring the upstream signature: the aware note when the kind is aware, else
 * the unaware note; undefined when the kind has no note for that awareness.
 */
export function getAutoinscription(
  registry: AutoinscriptionRegistry,
  kidx: number,
  aware: boolean,
): string | undefined {
  return registry.get(kidx, aware);
}

/**
 * add_autoinscription / remove_autoinscription (obj-ignore.c L322 / L294) as a
 * free function over the registry: register `note` for the aware or unaware
 * slot; an empty note clears it.
 */
export function setAutoinscription(
  registry: AutoinscriptionRegistry,
  kidx: number,
  note: string,
  aware: boolean,
): void {
  registry.set(kidx, note, aware);
}

/**
 * The object_flavor_aware side effect of player_know_object (obj-knowledge.c
 * L1163-1175). This is the awareness-UPDATE half of player_know_object, split
 * out so it can be fired at the port's knowledge-update sites - upstream the
 * whole of player_know_object writes the obj->known twin AND fires this; the
 * port synthesises the twin on demand for display, so ONLY this awareness half
 * needs a home, and it must never live on the display path (describing an item
 * must not mutate the player's knowledge).
 *
 * player_know_object early-returns for a not-yet-assessed object (L1033) before
 * ever reaching these branches, so this mirrors that gate: awareness fires only
 * once the object is ASSESSED. Then:
 * - jewellery whose non-curse runes are all known becomes aware (L1163-1167);
 * - a special artifact that isn't jewellery (kidx >= ordinary_kind_max) becomes
 *   aware outright (L1168-1175).
 *
 * object_flavor_aware itself early-returns when the kind is already aware, so
 * re-firing across repeated rune-learns is a no-op.
 */
export function playerKnowObjectAwareness(
  p: Player,
  env: RuneEnv,
  obj: GameObject,
  runes: readonly Rune[],
  flavor: FlavorKnowledge,
  flavorDeps: FlavorAwareDeps,
): void {
  /* player_know_object's early return at L1033: no awareness for the unassessed. */
  if ((obj.notice & OBJ_NOTICE.ASSESSED) === 0) return;

  if (tvalIsJewelry(obj.tval)) {
    /* object_non_curse_runes_known(obj) (L678): every non-curse rune the object
     * carries is known to the player. */
    const nonCurse = runes.filter((r) => r.variety !== "curse");
    if (objectRunesKnown(p, env, obj, nonCurse)) {
      flavor.objectFlavorAware(obj.kind, flavorDeps); // L1166
    }
  } else if (obj.kind.kidx >= flavor.ordinaryKindMax) {
    /* Special artifact that isn't jewelry (L1168-1175). */
    flavor.objectFlavorAware(obj.kind, flavorDeps); // L1174
  }
}

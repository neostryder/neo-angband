/**
 * Shape-change lore renderer, ported from the shape_lore_append_* chain in
 * reference/src/ui-knowledge.c (Angband 4.2.6, L2704-3140). Upstream builds a
 * textblock describing what taking a player shape does - combat bonuses,
 * skills, modifiers, resistances, protection, sustains, misc flags, the change
 * effect and the spells that trigger it. The Shape registry (player/bind.ts)
 * carries all the raw fields but had no renderer; this is that renderer,
 * producing an array of display lines (one per textblock paragraph).
 *
 * The pure parts (everything through misc flags) depend only on the Shape plus
 * a small env of property/element/ability tables. The two dynamic tails -
 * shape_lore_append_change_effects (effect_describe) and
 * shape_lore_append_triggering_spells (the class-spellbook scan) - are supplied
 * pre-rendered by the caller through the env, since they reach outside the shape
 * data into the effect-description subsystem and the class registry.
 *
 * Attribution: neostryder / RPGM Tools.
 */

import { STAT_MAX, SKILL_MAX } from "./types";
import type { Shape } from "./types";
import { OBJ_PROPERTY, OBJ_MOD_MAX, ELEM_MAX, OFT } from "../obj/types";
import type { ObjectProperty } from "../obj/types";
import { OF } from "../generated";
import { sustainFlag } from "../obj/knowledge";

/** One entry of the player_abilities list, filtered to type "player". */
export interface ShapeLorePlayerAbility {
  /** The PF_ flag index (ability->index). */
  index: number;
  /** ability->desc. */
  desc: string;
}

/** The tables + pre-rendered tails shape_lore needs beyond the Shape itself. */
export interface ShapeLoreEnv {
  /** obj_properties table (1-based, index 0 null), for name/desc/subtype. */
  properties: readonly (ObjectProperty | null)[];
  /** projections[i].name for i in [0, ELEM_MAX): "acid", "fire", ... */
  elementNames: readonly string[];
  /** player_abilities filtered to streq(type, "player") (misc flags tail). */
  playerAbilities: readonly ShapeLorePlayerAbility[];
  /**
   * effect_describe(s->effect, "Changing into the shape ", 0, false) rendered to
   * text, or null/absent when the shape has no change effect. Optional: absent
   * omits shape_lore_append_change_effects (L3044-3056).
   */
  changeEffectText?: string | null;
  /**
   * shape_lore_append_triggering_spells (L3059-3113) output, one string per
   * "The <class> spell, <spell>, from <book> triggers the shapechange." line.
   * Optional: absent omits that tail.
   */
  triggeringSpells?: readonly string[];
}

/** lookup_obj_property(type, propIndex): match on (type, the OF_/OBJ_MOD value). */
function lookupProp(
  env: ShapeLoreEnv,
  type: number,
  propIndex: number,
): ObjectProperty | null {
  for (const p of env.properties) {
    if (p && p.type === type && p.propIndex === propIndex) return p;
  }
  return null;
}

/** skill_index_to_name (ui-knowledge.c L2721-2767); STEALTH has no case. */
function skillIndexToName(i: number): string {
  switch (i) {
    case 0:
      return "physical disarming";
    case 1:
      return "magical disarming";
    case 2:
      return "magic devices";
    case 3:
      return "saving throws";
    case 4:
      return "searching";
    case 6:
      return "melee to hit";
    case 7:
      return "shooting to hit";
    case 8:
      return "throwing to hit";
    case 9:
      return "digging";
    default:
      return "unknown skill";
  }
}

/** C's %+d ("+0", "+3", "-2"). */
function plus(n: number): string {
  return n < 0 ? String(n) : `+${n}`;
}

/**
 * shape_lore_append_list (ui-knowledge.c L2770-2782): " a", " a and b",
 * " a, b and c". Returns the fragment (leading space included) or "".
 */
function appendList(list: readonly string[]): string {
  const n = list.length;
  if (n === 0) return "";
  let out = ` ${list[0]}`;
  for (let i = 1; i < n; i++) {
    out += `${i < n - 1 ? "," : " and"} ${list[i]}`;
  }
  return out;
}

/** shape_lore_append_basic_combat (L2785-2814). */
function basicCombat(shape: Shape): string | null {
  const msgs: string[] = [];
  if (shape.toA !== 0) msgs.push(`${plus(shape.toA)} to AC`);
  if (shape.toH !== 0) msgs.push(`${plus(shape.toH)} to hit`);
  if (shape.toD !== 0) msgs.push(`${plus(shape.toD)} to damage`);
  if (msgs.length === 0) return null;
  return `Adds${appendList(msgs)}.`;
}

/** shape_lore_append_skills (L2817-2843). */
function skills(shape: Shape): string | null {
  const msgs: string[] = [];
  for (let i = 0; i < SKILL_MAX; i++) {
    const v = shape.skills[i] ?? 0;
    if (v !== 0) msgs.push(`${plus(v)} to ${skillIndexToName(i)}`);
  }
  if (msgs.length === 0) return null;
  return `Adds${appendList(msgs)}.`;
}

/** shape_lore_append_non_stat_modifiers (L2846-2871) + stat (L2874-2902). */
function modifiers(shape: Shape, env: ShapeLoreEnv, from: number, to: number): string | null {
  const msgs: string[] = [];
  for (let i = from; i < to; i++) {
    const v = shape.modifiers[i] ?? 0;
    if (v !== 0) {
      const name = lookupProp(env, OBJ_PROPERTY.MOD, i)?.name ?? "";
      msgs.push(`${plus(v)} to ${name}`);
    }
  }
  if (msgs.length === 0) return null;
  return `Adds${appendList(msgs)}.`;
}

/** shape_lore_append_resistances (L2905-2945): up to three lines. */
function resistances(shape: Shape, env: ShapeLoreEnv): string[] {
  const vul: string[] = [];
  const res: string[] = [];
  const imm: string[] = [];
  for (let i = 0; i < ELEM_MAX; i++) {
    const lvl = shape.elInfo[i]?.resLevel ?? 0;
    const name = env.elementNames[i] ?? "";
    if (lvl < 0) vul.push(name);
    else if (lvl >= 3) imm.push(name);
    else if (lvl !== 0) res.push(name);
  }
  const lines: string[] = [];
  if (vul.length) lines.push(`Makes you vulnerable to${appendList(vul)}.`);
  if (res.length) lines.push(`Makes you resistant to${appendList(res)}.`);
  if (imm.length) lines.push(`Makes you immune to${appendList(imm)}.`);
  return lines;
}

/** shape_lore_append_protection_flags (L2948-2977). */
function protection(shape: Shape, env: ShapeLoreEnv): string | null {
  const msgs: string[] = [];
  for (let i = 1; i < OF.MAX; i++) {
    const prop = lookupProp(env, OBJ_PROPERTY.FLAG, i);
    if (prop && prop.subtype === OFT.PROT && shape.flags.has(prop.propIndex)) {
      msgs.push(prop.desc);
    }
  }
  if (msgs.length === 0) return null;
  return `Provides protection from${appendList(msgs)}.`;
}

/** shape_lore_append_sustains (L2980-3005). */
function sustains(shape: Shape, env: ShapeLoreEnv): string | null {
  const msgs: string[] = [];
  for (let i = 0; i < STAT_MAX; i++) {
    const prop = lookupProp(env, OBJ_PROPERTY.STAT, i);
    if (prop && shape.flags.has(sustainFlag(prop.propIndex))) msgs.push(prop.name);
  }
  if (msgs.length === 0) return null;
  return `Sustains${appendList(msgs)}.`;
}

/** shape_lore_append_misc_flags (L3008-3040): sentences joined by "  ". */
function miscFlags(shape: Shape, env: ShapeLoreEnv): string | null {
  let out = "";
  let n = 0;
  for (let i = 1; i < OF.MAX; i++) {
    const prop = lookupProp(env, OBJ_PROPERTY.FLAG, i);
    if (
      prop &&
      (prop.subtype === OFT.MISC || prop.subtype === OFT.MELEE || prop.subtype === OFT.BAD) &&
      shape.flags.has(prop.propIndex)
    ) {
      out += `${n > 0 ? "  " : ""}${prop.desc}.`;
      n++;
    }
  }
  for (const ability of env.playerAbilities) {
    if (shape.pflags.has(ability.index)) {
      out += `${n > 0 ? "  " : ""}${ability.desc}`;
      n++;
    }
  }
  return n > 0 ? out : null;
}

/**
 * The fixed intro paragraph shape_lore prints before the field summaries
 * (ui-knowledge.c L3121-3128).
 */
const SHAPE_LORE_INTRO =
  "Like all shapes, the equipment at the time of the shapechange sets the " +
  "base attributes, including damage per blow, number of blows and " +
  "resistances.  While changed, items in your pack or on the floor (except " +
  "for pickup or eating) are inaccessible.  To switch back to your normal " +
  "shape, cast a spell or use an item command other than eat (drop, for " +
  "instance).";

/**
 * shape_lore (ui-knowledge.c L3116-3140): the full description of one shape,
 * returned as display lines (one per emitted textblock paragraph). Line 0 is
 * the shape name, line 1 the fixed intro, then each field summary that has
 * content, then the change-effect and triggering-spell tails from the env.
 */
export function shapeLoreLines(shape: Shape, env: ShapeLoreEnv): string[] {
  const lines: string[] = [shape.name, SHAPE_LORE_INTRO];
  const push = (s: string | null): void => {
    if (s) lines.push(s);
  };
  push(basicCombat(shape));
  push(skills(shape));
  push(modifiers(shape, env, STAT_MAX, OBJ_MOD_MAX)); // non-stat modifiers
  push(modifiers(shape, env, 0, STAT_MAX)); // stat modifiers
  for (const l of resistances(shape, env)) lines.push(l);
  push(protection(shape, env));
  push(sustains(shape, env));
  push(miscFlags(shape, env));
  if (env.changeEffectText) lines.push(`${env.changeEffectText}.`);
  if (env.triggeringSpells) for (const l of env.triggeringSpells) lines.push(l);
  return lines;
}

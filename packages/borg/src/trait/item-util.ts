/**
 * Accessors that read an AgentView ItemView the way the C borg reads a
 * borg_item: flag membership (of_has), element resist level (el_info.res_level),
 * object modifiers, brands and slays. These bridge the frozen ItemView shape
 * (code-string lists) to the borg's numeric/flag view.
 */

import type { ItemView } from "@neo-angband/core";

/** of_has(item->flags, OF_<name>). ItemView.flags holds OF_* names sans prefix. */
export function hasFlag(item: ItemView, name: string): boolean {
  return item.flags.includes(name);
}

/** item->modifiers[OBJ_MOD_<code>] (0 if unset). Codes: STR/DEX/.../SPEED/BLOWS/... */
export function mod(item: ItemView, code: string): number {
  for (const m of item.modifiers) if (m.code === code) return m.value;
  return 0;
}

/** item->el_info[ELEM_<name>].res_level (0 none, >0 resist, 3 immune, -1 vuln). */
export function resLevel(item: ItemView, element: string): number {
  for (const r of item.resists) if (r.element === element) return r.level;
  return 0;
}

/**
 * item->brands[ELEM_x] as the C borg reads it. The borg indexes item->brands
 * by element, which - given brand.txt orders ACID_3, ELEC_3, FIRE_3, COLD_3,
 * POIS_3 first (indices 0..4 == ELEM_ACID..ELEM_POIS) - only ever detects the
 * multiplier-3 brand of each element and ignores the _2 variants
 * (borg-trait.c:1463-1472). Faithfully replicate: the "_3" brand code only.
 */
export function hasBrand3(item: ItemView, element: string): boolean {
  return item.brands.includes(`${element}_3`);
}

/**
 * item->slays[RF_<race>] - the slay multiplier per race flag. borg_set_slays
 * writes slays[race_flag] = multiplier (borg-item-analyze.c:326); a code like
 * UNDEAD_5 -> race UNDEAD, multiplier 5. Returns the max multiplier for the race
 * (last-writer-wins in C, but per race only one slay code applies).
 */
export function slayMult(item: ItemView, race: string): number {
  let m = 0;
  for (const code of item.slays) {
    const us = code.lastIndexOf("_");
    if (us < 0) continue;
    if (code.slice(0, us) !== race) continue;
    const mult = Number(code.slice(us + 1));
    if (Number.isFinite(mult)) m = mult;
  }
  return m;
}

/** The item is present (a nonempty stack). */
export function present(item: ItemView | null | undefined): item is ItemView {
  return !!item && item.number > 0;
}

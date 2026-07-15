/**
 * @neo-angband/borg item subsystem (P8.5): the per-role sval identity table.
 *
 * The C borg resolves object svals by NAME at init via lookup_sval(tval, name)
 * (reference/src/borg/borg-item-val.c). @neo-angband/core exports the TV_*
 * constants (generated/tvals.ts) but does NOT export the sv_* constants, so this
 * module transcribes the canonical svals as a self-contained table.
 *
 * FIDELITY: the svals here are the 1-based file order per tval in
 * reference/lib/gamedata/object.txt, which is exactly how core assigns them
 * (ObjRegistry.bindKinds: `sval = ++base.numSvals`, obj/bind.ts:654,684). So a
 * carried ItemView.sval matches these numbers byte-for-byte with what
 * lookup_sval would have returned in the C borg. Where the C had a copy/paste
 * quirk (e.g. sv_wand_confuse_monster / sv_wand_elec_ball point at the wrong
 * kind) the quirk is preserved and noted, so behaviour is identical.
 */

/* Re-export the engine tval constants so callers use one source. */
export { TV } from "@neo-angband/core";

/**
 * Role -> canonical sval, keyed exactly by the sv_/kv_ role name in
 * borg-item-val.h (the "sv_"/"kv_" prefix stripped and grouped by category).
 * Structurally compatible with the trait subsystem's BorgSvals seam
 * (Partial<Record<string, number>>), so it can be passed straight into
 * borgNotice(ctx, { svals: FOOD_SVALS ... }) too.
 */
export interface BorgSvalTable {
  food: Record<string, number>;
  mush: Record<string, number>;
  light: Record<string, number>;
  flask: Record<string, number>;
  potion: Record<string, number>;
  scroll: Record<string, number>;
  ring: Record<string, number>;
  amulet: Record<string, number>;
  rod: Record<string, number>;
  staff: Record<string, number>;
  wand: Record<string, number>;
  dragon: Record<string, number>;
}

/**
 * The canonical, faithful sval identity table (borg-item-val.c). Numbers are the
 * object.txt per-tval file order (see module header). Comments cite the C role
 * name and, where relevant, the upstream quirk that is reproduced.
 */
export const SVAL: BorgSvalTable = {
  /* food (borg-item-val.c:263-273) */
  food: {
    apple: 2,
    ration: 5,
    slime_mold: 4,
    draught: 14,
    pint: 11,
    sip: 12,
    waybread: 9,
    honey_cake: 8,
    slice: 7,
    handful: 3,
  },
  /* mushroom (borg-item-val.c:275-287) */
  mush: {
    second_sight: 1,
    fast_recovery: 2,
    restoring: 3, /* "Vigor" */
    mana: 4, /* "Clear Mind" */
    emergency: 5,
    terror: 6,
    stoneskin: 7,
    debility: 9,
    sprinting: 10,
    cure_mind: 4, /* C maps cure_mind -> "Clear Mind" too */
    purging: 11,
  },
  /* light (borg-item-val.c:289-291) */
  light: { lantern: 2, torch: 1 },
  /* flask (borg-item-val.c:293-295) */
  flask: { oil: 1 },
  /* potion (borg-item-val.c:297-338) */
  potion: {
    cure_critical: 10,
    cure_serious: 9,
    cure_light: 8,
    healing: 11,
    star_healing: 12, /* "*Healing*" */
    life: 13,
    restore_mana: 15,
    cure_poison: 14, /* "Neutralize Poison" */
    resist_heat: 28,
    resist_cold: 29,
    resist_pois: 30,
    inc_str: 1,
    inc_int: 2,
    inc_wis: 3,
    inc_dex: 4,
    inc_con: 5,
    inc_all: 6, /* "Augmentation" */
    inc_str2: 17, /* "Brawn" */
    inc_int2: 18, /* "Intellect" */
    inc_wis2: 19, /* "Contemplation" */
    inc_dex2: 20, /* "Nimbleness" */
    inc_con2: 21, /* "Toughness" */
    restore_life: 16, /* "Restore Life Levels" */
    speed: 24,
    berserk: 26, /* "Berserk Strength" */
    sleep: 34,
    slowness: 38,
    poison: 37,
    blindness: 35,
    confusion: 36,
    heroism: 25,
    boldness: 27,
    detect_invis: 31, /* "True Seeing" */
    enlightenment: 22,
    slime_mold: 33, /* "Slime Mold Juice" */
    infravision: 32,
    inc_exp: 7, /* "Experience" */
  },
  /* scroll (borg-item-val.c:340-383) */
  scroll: {
    identify: 7, /* "Identify Rune" */
    phase_door: 1,
    teleport: 2, /* "Teleportation" */
    word_of_recall: 24,
    enchant_armor: 10, /* "Enchant Armour" */
    enchant_weapon_to_hit: 8,
    enchant_weapon_to_dam: 9,
    star_enchant_weapon: 11, /* "*Enchant Weapon*" */
    star_enchant_armor: 12, /* "*Enchant Armour*" */
    protection_from_evil: 31,
    rune_of_protection: 33,
    teleport_level: 3,
    deep_descent: 27,
    recharging: 25,
    banishment: 20,
    mass_banishment: 21,
    blessing: 28,
    holy_chant: 29,
    holy_prayer: 30,
    detect_invis: 6, /* "Detect Invisible" */
    satisfy_hunger: 22, /* "Remove Hunger" */
    light: 23,
    mapping: 4, /* "Magic Mapping" */
    acquirement: 17,
    star_acquirement: 18, /* "*Acquirement*" */
    remove_curse: 13,
    star_remove_curse: 14, /* "*Remove Curse*" */
    monster_confusion: 32,
    trap_door_destruction: 26, /* "Door Destruction" */
    dispel_undead: 19,
  },
  /* ring (borg-item-val.c:385-393) */
  ring: {
    flames: 12,
    ice: 14,
    acid: 13,
    lightning: 15,
    digging: 30,
    speed: 5,
    damage: 16,
    dog: 25, /* "the Dog" */
  },
  /* amulet (borg-item-val.c:395-396) */
  amulet: { teleportation: 14 },
  /* rod (borg-item-val.c:398-420) */
  rod: {
    recall: 24,
    detection: 2,
    illumination: 23,
    speed: 25,
    mapping: 3, /* "Magic Mapping" */
    healing: 16,
    light: 22,
    fire_bolt: 5, /* "Fire Bolts" */
    elec_bolt: 7, /* "Lightning Bolts" */
    cold_bolt: 6, /* "Frost Bolts" */
    acid_bolt: 8, /* "Acid Bolts" */
    drain_life: 19,
    fire_ball: 9, /* "Fire Balls" */
    elec_ball: 11, /* "Lightning Balls" */
    cold_ball: 10, /* "Cold Balls" */
    acid_ball: 12, /* "Acid Balls" */
    teleport_other: 20,
    slow_monster: 13,
    sleep_monster: 14, /* "Hold Monster" */
    curing: 15,
  },
  /* staff (borg-item-val.c:422-440) */
  staff: {
    teleportation: 21,
    destruction: 5, /* "*Destruction*" */
    speed: 22,
    healing: 14,
    the_magi: 24, /* "the Magi" */
    power: 17,
    holiness: 18,
    curing: 12,
    sleep_monsters: 8,
    slow_monsters: 7,
    detect_invis: 9, /* "Detect Invisible" */
    detect_evil: 10,
    dispel_evil: 15,
    banishment: 16,
    light: 19,
    mapping: 11,
    remove_curse: 23,
  },
  /* wand (borg-item-val.c:442-467). NOTE: two upstream copy/paste quirks are
   * reproduced: confuse_monster resolves to "Scare Monster" (==fear_monster),
   * and elec_ball resolves to "Lightning Bolts" (the bolt, not the ball). */
  wand: {
    light: 16,
    teleport_away: 21, /* "Teleport Other" */
    stinking_cloud: 6,
    magic_missile: 1,
    annihilation: 28,
    stone_to_mud: 17,
    wonder: 23,
    hold_monster: 13,
    slow_monster: 11,
    fear_monster: 15, /* "Scare Monster" */
    confuse_monster: 15, /* upstream quirk: also "Scare Monster" */
    fire_bolt: 4, /* "Fire Bolts" */
    cold_bolt: 3, /* "Frost Bolts" */
    acid_bolt: 5, /* "Acid Bolts" */
    elec_bolt: 2, /* "Lightning Bolts" */
    fire_ball: 9, /* "Fire Balls" */
    cold_ball: 8, /* "Cold Balls" */
    acid_ball: 10, /* "Acid Balls" */
    elec_ball: 2, /* upstream quirk: "Lightning Bolts" (bolt sval) */
    dragon_cold: 25, /* "Dragon's Frost" */
    dragon_fire: 24, /* "Dragon's Flame" */
    drain_life: 27,
  },
  /* dragon armor (borg-item-val.c:500-511) */
  dragon: {
    black: 1,
    blue: 2,
    white: 3,
    red: 4,
    green: 5,
    multihued: 6,
    shining: 7,
    law: 8,
    gold: 9,
    chaos: 10,
    balance: 11,
    power: 12,
  },
};

// Generated from reference/src/list-player-flags.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Player race and class flags (player.h PF_ enum).
 */

export const PLAYER_FLAG_ENTRIES = [
  { name: "NONE" },
  { name: "FAST_SHOT" },
  { name: "BRAVERY_30" },
  { name: "BLESS_WEAPON" },
  { name: "ZERO_FAIL" },
  { name: "BEAM" },
  { name: "CHOOSE_SPELLS" },
  { name: "KNOW_MUSHROOM" },
  { name: "KNOW_ZAPPER" },
  { name: "SEE_ORE" },
  { name: "NO_MANA" },
  { name: "CHARM" },
  { name: "UNLIGHT" },
  { name: "ROCK" },
  { name: "STEAL" },
  { name: "SHIELD_BASH" },
  { name: "EVIL" },
  { name: "COMBAT_REGEN" },
] as const;

/** NAME -> upstream enum value (PF_ prefix upstream). */
export const PF = {
  NONE: 0,
  FAST_SHOT: 1,
  BRAVERY_30: 2,
  BLESS_WEAPON: 3,
  ZERO_FAIL: 4,
  BEAM: 5,
  CHOOSE_SPELLS: 6,
  KNOW_MUSHROOM: 7,
  KNOW_ZAPPER: 8,
  SEE_ORE: 9,
  NO_MANA: 10,
  CHARM: 11,
  UNLIGHT: 12,
  ROCK: 13,
  STEAL: 14,
  SHIELD_BASH: 15,
  EVIL: 16,
  COMBAT_REGEN: 17,
} as const;

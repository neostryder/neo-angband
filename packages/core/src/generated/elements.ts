// Generated from reference/src/list-elements.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Elements used in spells and attacks (object.h ELEM_ enum; ACID is 0).
 */

export const ELEMENT_ENTRIES = [
  { name: "ACID" },
  { name: "ELEC" },
  { name: "FIRE" },
  { name: "COLD" },
  { name: "POIS" },
  { name: "LIGHT" },
  { name: "DARK" },
  { name: "SOUND" },
  { name: "SHARD" },
  { name: "NEXUS" },
  { name: "NETHER" },
  { name: "CHAOS" },
  { name: "DISEN" },
  { name: "WATER" },
  { name: "ICE" },
  { name: "GRAVITY" },
  { name: "INERTIA" },
  { name: "FORCE" },
  { name: "TIME" },
  { name: "PLASMA" },
  { name: "METEOR" },
  { name: "MISSILE" },
  { name: "MANA" },
  { name: "HOLY_ORB" },
  { name: "ARROW" },
] as const;

/** NAME -> upstream enum value (ELEM_ prefix upstream). */
export const ELEM = {
  ACID: 0,
  ELEC: 1,
  FIRE: 2,
  COLD: 3,
  POIS: 4,
  LIGHT: 5,
  DARK: 6,
  SOUND: 7,
  SHARD: 8,
  NEXUS: 9,
  NETHER: 10,
  CHAOS: 11,
  DISEN: 12,
  WATER: 13,
  ICE: 14,
  GRAVITY: 15,
  INERTIA: 16,
  FORCE: 17,
  TIME: 18,
  PLASMA: 19,
  METEOR: 20,
  MISSILE: 21,
  MANA: 22,
  HOLY_ORB: 23,
  ARROW: 24,
} as const;

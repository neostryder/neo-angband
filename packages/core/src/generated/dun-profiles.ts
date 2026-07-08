// Generated from reference/src/list-dun-profiles.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Dungeon profiles: name and builder function (generate.c cave_builders).
 */

export const DUN_PROFILE_ENTRIES = [
  { name: "town", builder: "town" },
  { name: "modified", builder: "modified" },
  { name: "moria", builder: "moria" },
  { name: "lair", builder: "lair" },
  { name: "gauntlet", builder: "gauntlet" },
  { name: "hard centre", builder: "hard_centre" },
  { name: "labyrinth", builder: "labyrinth" },
  { name: "cavern", builder: "cavern" },
  { name: "classic", builder: "classic" },
] as const;

/** NAME -> upstream enum value (DUN_ prefix upstream). */
export const DUN = {
  town: 0,
  modified: 1,
  moria: 2,
  lair: 3,
  gauntlet: 4,
  "hard centre": 5,
  labyrinth: 6,
  cavern: 7,
  classic: 8,
} as const;

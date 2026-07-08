// Generated from reference/src/list-stats.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Player stats (player.h STAT_ enum; order matches the sustains in list-object-flags.h).
 */

export const STAT_ENTRIES = [
  { name: "STR" },
  { name: "INT" },
  { name: "WIS" },
  { name: "DEX" },
  { name: "CON" },
] as const;

/** NAME -> upstream enum value (STAT_ prefix upstream). */
export const STAT = {
  STR: 0,
  INT: 1,
  WIS: 2,
  DEX: 3,
  CON: 4,
} as const;

// Generated from reference/src/list-object-modifiers.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Object modifiers (obj-properties.h OBJ_MOD_ enum starts with the five stats from list-stats.h, so STEALTH is 5).
 *
 * The upstream enum places 5 value(s) before this
 * header's entries, so OBJ_MOD values start at 5 while the
 * entries tuple is indexed from 0.
 */

export const OBJECT_MODIFIER_ENTRIES = [
  { name: "STEALTH" },
  { name: "SEARCH" },
  { name: "INFRA" },
  { name: "TUNNEL" },
  { name: "SPEED" },
  { name: "BLOWS" },
  { name: "SHOTS" },
  { name: "MIGHT" },
  { name: "LIGHT" },
  { name: "DAM_RED" },
  { name: "MOVES" },
] as const;

/** NAME -> upstream enum value (OBJ_MOD_ prefix upstream). */
export const OBJ_MOD = {
  STR: 0,
  INT: 1,
  WIS: 2,
  DEX: 3,
  CON: 4,
  STEALTH: 5,
  SEARCH: 6,
  INFRA: 7,
  TUNNEL: 8,
  SPEED: 9,
  BLOWS: 10,
  SHOTS: 11,
  MIGHT: 12,
  LIGHT: 13,
  DAM_RED: 14,
  MOVES: 15,
} as const;

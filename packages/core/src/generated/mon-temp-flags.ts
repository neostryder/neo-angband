// Generated from reference/src/list-mon-temp-flags.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Temporary monster flags (monster.h MFLAG_ enum).
 */

export const MON_TEMP_FLAG_ENTRIES = [
  { name: "NONE", description: "" },
  { name: "VIEW", description: "Monster is in line of sight" },
  { name: "ACTIVE", description: "Monster is in active mode" },
  { name: "NICE", description: "Monster is still being nice" },
  { name: "SHOW", description: "Monster is recently memorized" },
  { name: "MARK", description: "Monster is currently memorized" },
  { name: "VISIBLE", description: "Monster is \"visible\"" },
  { name: "CAMOUFLAGE", description: "Player doesn't know this is a monster" },
  { name: "AWARE", description: "Monster is aware of the player" },
  { name: "HANDLED", description: "Monster has been processed this turn" },
  { name: "TRACKING", description: "Monster is tracking the player by sound or scent" },
] as const;

/** NAME -> upstream enum value (MFLAG_ prefix upstream). */
export const MFLAG = {
  NONE: 0,
  VIEW: 1,
  ACTIVE: 2,
  NICE: 3,
  SHOW: 4,
  MARK: 5,
  VISIBLE: 6,
  CAMOUFLAGE: 7,
  AWARE: 8,
  HANDLED: 9,
  TRACKING: 10,
} as const;

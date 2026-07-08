// Generated from reference/src/list-history-types.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * History message types (player-history.h HIST_ enum).
 */

export const HISTORY_TYPE_ENTRIES = [
  { name: "NONE", description: "" },
  { name: "PLAYER_BIRTH", description: "Player was born" },
  { name: "ARTIFACT_UNKNOWN", description: "Player found but not IDd an artifact" },
  { name: "ARTIFACT_KNOWN", description: "Player has IDed an artifact" },
  { name: "ARTIFACT_LOST", description: "Player had an artifact and lost it" },
  { name: "PLAYER_DEATH", description: "Player has been slain" },
  { name: "SLAY_UNIQUE", description: "Player has slain a unique monster" },
  { name: "USER_INPUT", description: "User-added note" },
  { name: "SAVEFILE_IMPORT", description: "Added when an older version savefile is imported" },
  { name: "GAIN_LEVEL", description: "Player gained a level" },
  { name: "GENERIC", description: "Anything else not covered here (unused)" },
] as const;

/** NAME -> upstream enum value (HIST_ prefix upstream). */
export const HIST = {
  NONE: 0,
  PLAYER_BIRTH: 1,
  ARTIFACT_UNKNOWN: 2,
  ARTIFACT_KNOWN: 3,
  ARTIFACT_LOST: 4,
  PLAYER_DEATH: 5,
  SLAY_UNIQUE: 6,
  USER_INPUT: 7,
  SAVEFILE_IMPORT: 8,
  GAIN_LEVEL: 9,
  GENERIC: 10,
} as const;

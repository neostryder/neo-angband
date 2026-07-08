// Generated from reference/src/list-square-flags.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Special grid flags (cave.h SQUARE_ enum).
 */

export const SQUARE_FLAG_ENTRIES = [
  { name: "NONE", description: "" },
  { name: "MARK", description: "memorized feature" },
  { name: "GLOW", description: "self-illuminating" },
  { name: "VAULT", description: "part of a vault" },
  { name: "ROOM", description: "part of a room" },
  { name: "SEEN", description: "seen flag" },
  { name: "VIEW", description: "view flag" },
  { name: "WASSEEN", description: "previously seen (during update)" },
  { name: "FEEL", description: "hidden points to trigger feelings" },
  { name: "TRAP", description: "square containing a known trap" },
  { name: "INVIS", description: "square containing an unknown trap" },
  { name: "WALL_INNER", description: "inner wall generation flag" },
  { name: "WALL_OUTER", description: "outer wall generation flag" },
  { name: "WALL_SOLID", description: "solid wall generation flag" },
  { name: "MON_RESTRICT", description: "no random monster flag" },
  { name: "NO_TELEPORT", description: "player can't teleport from this square" },
  { name: "NO_MAP", description: "square can't be magically mapped" },
  { name: "NO_ESP", description: "telepathy doesn't work on this square" },
  { name: "PROJECT", description: "marked for projection processing" },
  { name: "DTRAP", description: "trap detected square" },
  { name: "NO_STAIRS", description: "square is not suitable for placing stairs" },
  { name: "CLOSE_PLAYER", description: "square is seen and in player's light radius or UNLIGHT detection radius" },
] as const;

/** NAME -> upstream enum value (SQUARE_ prefix upstream). */
export const SQUARE = {
  NONE: 0,
  MARK: 1,
  GLOW: 2,
  VAULT: 3,
  ROOM: 4,
  SEEN: 5,
  VIEW: 6,
  WASSEEN: 7,
  FEEL: 8,
  TRAP: 9,
  INVIS: 10,
  WALL_INNER: 11,
  WALL_OUTER: 12,
  WALL_SOLID: 13,
  MON_RESTRICT: 14,
  NO_TELEPORT: 15,
  NO_MAP: 16,
  NO_ESP: 17,
  PROJECT: 18,
  DTRAP: 19,
  NO_STAIRS: 20,
  CLOSE_PLAYER: 21,
} as const;

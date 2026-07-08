// Generated from reference/src/list-trap-flags.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Trap properties (trap.h TRF_ enum).
 */

export const TRAP_FLAG_ENTRIES = [
  { name: "NONE", description: "" },
  { name: "GLYPH", description: "Is a glyph" },
  { name: "TRAP", description: "Is a player trap" },
  { name: "VISIBLE", description: "Is visible" },
  { name: "INVISIBLE", description: "Is invisible" },
  { name: "FLOOR", description: "Can be set on a floor" },
  { name: "DOWN", description: "Takes the player down a level" },
  { name: "PIT", description: "Moves the player onto the trap" },
  { name: "ONETIME", description: "Disappears after being activated" },
  { name: "MAGICAL", description: "Has magical activation (absence of this flag means physical)" },
  { name: "SAVE_THROW", description: "Allows a save from all effects by standard saving throw" },
  { name: "SAVE_ARMOR", description: "Allows a save from all effects due to AC" },
  { name: "LOCK", description: "Is a door lock" },
  { name: "DELAY", description: "Has a delayed effect" },
  { name: "WEB", description: "Is a web" },
] as const;

/** NAME -> upstream enum value (TRF_ prefix upstream). */
export const TRF = {
  NONE: 0,
  GLYPH: 1,
  TRAP: 2,
  VISIBLE: 3,
  INVISIBLE: 4,
  FLOOR: 5,
  DOWN: 6,
  PIT: 7,
  ONETIME: 8,
  MAGICAL: 9,
  SAVE_THROW: 10,
  SAVE_ARMOR: 11,
  LOCK: 12,
  DELAY: 13,
  WEB: 14,
} as const;

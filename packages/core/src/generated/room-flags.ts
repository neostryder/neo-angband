// Generated from reference/src/list-room-flags.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Room type flags (generate.h enum prepends ROOMF_NONE; ROOMF_<name> == entry index + 1).
 *
 * The upstream enum places 1 value(s) before this
 * header's entries, so ROOMF values start at 1 while the
 * entries tuple is indexed from 0.
 */

export const ROOM_FLAG_ENTRIES = [
  { name: "FEW_ENTRANCES", help: "select alternate tunneling for a room since it can only be entered from a few directions or the entrances involve digging" },
  { name: "MAX", help: "" },
] as const;

/** NAME -> upstream enum value (ROOMF_ prefix upstream). */
export const ROOMF = {
  NONE: 0,
  FEW_ENTRANCES: 1,
  MAX: 2,
} as const;

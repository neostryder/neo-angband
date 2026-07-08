// Generated from reference/src/list-terrain.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Terrain (feature) types (cave.h FEAT_ enum; stored as uint8 upstream).
 */

export const TERRAIN_ENTRIES = [
  { name: "NONE" },
  { name: "FLOOR" },
  { name: "CLOSED" },
  { name: "OPEN" },
  { name: "BROKEN" },
  { name: "LESS" },
  { name: "MORE" },
  { name: "STORE_GENERAL" },
  { name: "STORE_ARMOR" },
  { name: "STORE_WEAPON" },
  { name: "STORE_BOOK" },
  { name: "STORE_ALCHEMY" },
  { name: "STORE_MAGIC" },
  { name: "STORE_BLACK" },
  { name: "HOME" },
  { name: "SECRET" },
  { name: "RUBBLE" },
  { name: "MAGMA" },
  { name: "QUARTZ" },
  { name: "MAGMA_K" },
  { name: "QUARTZ_K" },
  { name: "GRANITE" },
  { name: "PERM" },
  { name: "LAVA" },
  { name: "PASS_RUBBLE" },
] as const;

/** NAME -> upstream enum value (FEAT_ prefix upstream). */
export const FEAT = {
  NONE: 0,
  FLOOR: 1,
  CLOSED: 2,
  OPEN: 3,
  BROKEN: 4,
  LESS: 5,
  MORE: 6,
  STORE_GENERAL: 7,
  STORE_ARMOR: 8,
  STORE_WEAPON: 9,
  STORE_BOOK: 10,
  STORE_ALCHEMY: 11,
  STORE_MAGIC: 12,
  STORE_BLACK: 13,
  HOME: 14,
  SECRET: 15,
  RUBBLE: 16,
  MAGMA: 17,
  QUARTZ: 18,
  MAGMA_K: 19,
  QUARTZ_K: 20,
  GRANITE: 21,
  PERM: 22,
  LAVA: 23,
  PASS_RUBBLE: 24,
} as const;

// Generated from reference/src/list-origins.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Object origins (object.h ORIGIN_ enum; args is the format argument count per obj-info.c).
 */

export const ORIGIN_ENTRIES = [
  { name: "NONE", args: -1, description: "" },
  { name: "FLOOR", args: 1, description: "Found lying on the floor %s" },
  { name: "CHEST", args: 1, description: "Taken from a chest found %s" },
  { name: "SPECIAL", args: 1, description: "Found lying on the floor of a special room %s" },
  { name: "PIT", args: 1, description: "Found lying on the floor in a pit %s" },
  { name: "VAULT", args: 1, description: "Found lying on the floor in a vault %s" },
  { name: "LABYRINTH", args: 1, description: "Found lying on the floor of a labyrinth %s" },
  { name: "CAVERN", args: 1, description: "Found lying on the floor of a cavern %s" },
  { name: "RUBBLE", args: 1, description: "Found under some rubble %s" },
  { name: "MIXED", args: -1, description: "" },
  { name: "DROP", args: 2, description: "Dropped by %s %s" },
  { name: "DROP_SPECIAL", args: 2, description: "Dropped by %s %s" },
  { name: "DROP_PIT", args: 2, description: "Dropped by %s %s" },
  { name: "DROP_VAULT", args: 2, description: "Dropped by %s %s" },
  { name: "STATS", args: -1, description: "" },
  { name: "ACQUIRE", args: 1, description: "Conjured forth by magic %s" },
  { name: "STORE", args: 0, description: "Bought from a store" },
  { name: "STOLEN", args: -1, description: "" },
  { name: "BIRTH", args: 0, description: "An inheritance from your family" },
  { name: "CHEAT", args: 0, description: "Created by debug option" },
  { name: "DROP_BREED", args: 2, description: "Dropped by %s %s" },
  { name: "DROP_SUMMON", args: 2, description: "Dropped by %s %s" },
  { name: "DROP_UNKNOWN", args: 1, description: "Dropped by an unknown monster %s" },
  { name: "DROP_POLY", args: 2, description: "Dropped by %s %s" },
  { name: "DROP_MIMIC", args: 2, description: "Dropped by %s %s" },
  { name: "DROP_WIZARD", args: 2, description: "Dropped by %s %s" },
] as const;

/** NAME -> upstream enum value (ORIGIN_ prefix upstream). */
export const ORIGIN = {
  NONE: 0,
  FLOOR: 1,
  CHEST: 2,
  SPECIAL: 3,
  PIT: 4,
  VAULT: 5,
  LABYRINTH: 6,
  CAVERN: 7,
  RUBBLE: 8,
  MIXED: 9,
  DROP: 10,
  DROP_SPECIAL: 11,
  DROP_PIT: 12,
  DROP_VAULT: 13,
  STATS: 14,
  ACQUIRE: 15,
  STORE: 16,
  STOLEN: 17,
  BIRTH: 18,
  CHEAT: 19,
  DROP_BREED: 20,
  DROP_SUMMON: 21,
  DROP_UNKNOWN: 22,
  DROP_POLY: 23,
  DROP_MIMIC: 24,
  DROP_WIZARD: 25,
} as const;

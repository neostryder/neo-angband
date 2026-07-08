// Generated from reference/src/list-kind-flags.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Object kind flags (obj-properties.h KF_ enum).
 */

export const KIND_FLAG_ENTRIES = [
  { name: "NONE", message: "" },
  { name: "RAND_HI_RES", message: "" },
  { name: "RAND_SUSTAIN", message: "" },
  { name: "RAND_POWER", message: "" },
  { name: "INSTA_ART", message: "" },
  { name: "QUEST_ART", message: "" },
  { name: "EASY_KNOW", message: "" },
  { name: "GOOD", message: "" },
  { name: "SHOW_DICE", message: "" },
  { name: "SHOW_MULT", message: "" },
  { name: "SHOOTS_SHOTS", message: "" },
  { name: "SHOOTS_ARROWS", message: "" },
  { name: "SHOOTS_BOLTS", message: "" },
  { name: "RAND_BASE_RES", message: "" },
  { name: "RAND_RES_POWER", message: "" },
  { name: "MAX", message: "" },
] as const;

/** NAME -> upstream enum value (KF_ prefix upstream). */
export const KF = {
  NONE: 0,
  RAND_HI_RES: 1,
  RAND_SUSTAIN: 2,
  RAND_POWER: 3,
  INSTA_ART: 4,
  QUEST_ART: 5,
  EASY_KNOW: 6,
  GOOD: 7,
  SHOW_DICE: 8,
  SHOW_MULT: 9,
  SHOOTS_SHOTS: 10,
  SHOOTS_ARROWS: 11,
  SHOOTS_BOLTS: 12,
  RAND_BASE_RES: 13,
  RAND_RES_POWER: 14,
  MAX: 15,
} as const;

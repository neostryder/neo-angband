// Generated from reference/src/list-equip-slots.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Equipment slot types (obj-gear.h EQUIP_ enum; fields per header comment: slot, acid_v, name, mention, heavy describe, describe).
 */

export const EQUIP_SLOT_ENTRIES = [
  { name: "NONE", acidVuln: false, named: false, mention: "", heavyDescribe: "", describe: "" },
  { name: "WEAPON", acidVuln: false, named: false, mention: "Wielding", heavyDescribe: "just lifting", describe: "attacking monsters with" },
  { name: "BOW", acidVuln: false, named: false, mention: "Shooting", heavyDescribe: "just holding", describe: "shooting missiles with" },
  { name: "RING", acidVuln: false, named: true, mention: "On %s", heavyDescribe: "", describe: "wearing on your %s" },
  { name: "AMULET", acidVuln: false, named: true, mention: "Around %s", heavyDescribe: "", describe: "wearing around your %s" },
  { name: "LIGHT", acidVuln: false, named: false, mention: "Light source", heavyDescribe: "", describe: "using to light your way" },
  { name: "BODY_ARMOR", acidVuln: true, named: true, mention: "On %s", heavyDescribe: "", describe: "wearing on your %s" },
  { name: "CLOAK", acidVuln: true, named: true, mention: "On %s", heavyDescribe: "", describe: "wearing on your %s" },
  { name: "SHIELD", acidVuln: true, named: true, mention: "On %s", heavyDescribe: "", describe: "wearing on your %s" },
  { name: "HAT", acidVuln: true, named: true, mention: "On %s", heavyDescribe: "", describe: "wearing on your %s" },
  { name: "GLOVES", acidVuln: true, named: true, mention: "On %s", heavyDescribe: "", describe: "wearing on your %s" },
  { name: "BOOTS", acidVuln: true, named: true, mention: "On %s", heavyDescribe: "", describe: "wearing on your %s" },
] as const;

/** NAME -> upstream enum value (EQUIP_ prefix upstream). */
export const EQUIP = {
  NONE: 0,
  WEAPON: 1,
  BOW: 2,
  RING: 3,
  AMULET: 4,
  LIGHT: 5,
  BODY_ARMOR: 6,
  CLOAK: 7,
  SHIELD: 8,
  HAT: 9,
  GLOVES: 10,
  BOOTS: 11,
} as const;

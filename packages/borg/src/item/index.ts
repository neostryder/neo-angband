/**
 * @neo-angband/borg item/magic/recovery subsystem (P8.5).
 *
 * A faithful port of the Angband 4.2.6 borg's consumable, magic, wear, junk,
 * light and recovery decisions (reference/src/borg/borg-item-*, borg-magic*,
 * borg-junk, borg-light, borg-recover). Every decision returns an AgentCommand
 * (built from ctx.act) or null; the query helpers return booleans / numbers.
 *
 * Public surface the fight (P8.4) and think (P8.6) ladders call:
 * - Magic legality/fail (magic.ts): borgSpellLegal / borgSpellOkay /
 *   borgSpellOkayFail / borgSpellFailRate / borgSpellLegalFail / borgSpell /
 *   borgSpellFail, plus the Spell enum and borgGetSpellPower / borgCanCast.
 * - Consumables (item-use.ts): borgQuaffCrit / borgQuaffPotion / borgReadScroll /
 *   borgEat / borgEatFoodAny / borgZapRod / borgUseStaff(Fail) / borgAimWand /
 *   borgActivate* / borgUseThings / borgRecharging and the device-fail queries.
 * - Wear/remove (item-wear.ts, junk.ts): borgWearStuff / borgRemoveStuff.
 * - Junk (junk.ts): borgCrushJunk.
 * - Light (light.ts): borgMaintainLight / borgCheckLightOnly / borgLightBeam.
 * - Recovery (recover.ts): borgRecover.
 * - Identify / enchant / decurse: borgTestStuff / borgEnchanting / borgDecurseAny.
 * - Identity (svals.ts): SVAL table + TV; seams (deps.ts): ItemDeps.
 */

export * from "./svals";
/* deps.ts holds mostly internal helpers (trait/danger/itemLevel/... imported
 * directly by the item modules). Only the public seam + slot/device helpers are
 * re-exported; `trait` in particular is NOT (it also lives in flow/think, so a
 * flat root re-export would clash). */
export type { ItemDeps } from "./deps";
export { borgSlot, hasSlot, deviceFail } from "./deps";
export * from "./magic";
export * from "./item-use";
export * from "./item-id";
export * from "./item-decurse";
export * from "./item-enchant";
export * from "./light";
export * from "./recover";
export * from "./junk";
export * from "./item-wear";
